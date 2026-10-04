import { useCallback, useEffect, useRef, useState } from 'react'
import { voicePcmWorklet } from '#/lib/voice-pcm-worklet'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export type VoiceCaption = { role: 'user' | 'assistant'; text: string }

const SAMPLE_RATE = 24_000
const INSTRUCTIONS = `You are Phab, a personal agent talking with the user on a live voice call.
Keep replies short and conversational, like a phone call. Ask a follow-up when it helps.`

type CallSession = {
  abort: AbortController
  connected: boolean
  socket?: WebSocket
  stream?: MediaStream
  context?: AudioContext
  source?: MediaStreamAudioSourceNode
  processor?: AudioWorkletNode
  timer?: ReturnType<typeof setTimeout>
  // Scheduled Grok audio, so barge-in can silence it immediately.
  playing: Set<AudioBufferSourceNode>
  playhead: number
}

// Deliberate mount-only browser-resource cleanup; starting a call is an event.
function useMountEffect(effect: () => void | (() => void)) {
  useEffect(effect, [])
}

function silence(session: CallSession) {
  session.playing.forEach((node) => {
    node.onended = null
    try { node.stop() } catch {}
  })
  session.playing.clear()
  session.playhead = 0
}

function releaseSession(session: CallSession) {
  clearTimeout(session.timer)
  session.abort.abort()
  silence(session)
  session.stream?.getTracks().forEach((track) => track.stop())
  session.source?.disconnect()
  session.processor?.disconnect()
  session.processor?.port.close()
  if (session.context && session.context.state !== 'closed') {
    void session.context.close().catch(() => {})
  }
  if (session.socket) {
    session.socket.onopen = null
    session.socket.onmessage = null
    session.socket.onerror = null
    session.socket.onclose = null
    session.socket.close()
  }
}

function microphoneError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Allow microphone access in your browser to call.'
    if (error.name === 'NotFoundError') return 'No microphone found. Connect a microphone and try again.'
    if (error.name === 'NotReadableError') return 'Your microphone is busy. Close other recording apps and try again.'
  }
  return error instanceof Error ? error.message : 'The call could not start. Please try again.'
}

function encodePcm(bytes: ArrayBuffer) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodePcm(base64: string) {
  const binary = atob(base64)
  const samples = new Float32Array(binary.length >> 1)
  for (let i = 0; i < samples.length; i++) {
    const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000
  }
  return samples
}

export function useXaiVoice() {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [captions, setCaptions] = useState<VoiceCaption[]>([])
  const sessionRef = useRef<CallSession | null>(null)

  useMountEffect(() => {
    const dispose = () => {
      const session = sessionRef.current
      sessionRef.current = null
      if (session) releaseSession(session)
    }
    window.addEventListener('pagehide', dispose)
    return () => {
      window.removeEventListener('pagehide', dispose)
      dispose()
    }
  })

  const hangUp = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    releaseSession(session)
    setStatus('idle')
    setError(null)
  }, [])

  const call = useCallback(async () => {
    if (sessionRef.current) return
    setError(null)
    setCaptions([])
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setStatus('error')
      setError('Calling needs a browser with microphone support on HTTPS or localhost.')
      return
    }

    const session: CallSession = {
      abort: new AbortController(), connected: false, playing: new Set(), playhead: 0,
    }
    sessionRef.current = session
    setStatus('connecting')
    const isCurrent = () => sessionRef.current === session
    const fail = (message: string) => {
      if (!isCurrent()) return
      sessionRef.current = null
      releaseSession(session)
      setError(message)
      setStatus('error')
    }
    const caption = (role: VoiceCaption['role'], text: string) => {
      setCaptions((lines) => {
        const last = lines.at(-1)
        // Assistant transcript arrives in deltas; grow the current line.
        if (role === 'assistant' && last?.role === 'assistant' && !last.text.endsWith('\n')) {
          return [...lines.slice(0, -1), { role, text: last.text + text }]
        }
        return [...lines, { role, text }].slice(-20)
      })
    }

    try {
      // Resume from the button gesture before waiting for microphone permission.
      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      session.context = context
      const resumed = context.resume()
      void resumed.catch(() => {})
      if (!context.audioWorklet) throw new Error('This browser does not support calling. Try a current Chrome or Safari browser.')
      session.timer = setTimeout(() => fail('Microphone setup timed out. Allow access and try again.'), 60_000)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      session.stream = stream
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => fail('The microphone disconnected. The call ended.')
      })
      await resumed
      if (!isCurrent()) return
      if (context.state !== 'running') throw new Error('Your browser paused audio. Press call to try again.')

      const workletUrl = URL.createObjectURL(new Blob([voicePcmWorklet], { type: 'text/javascript' }))
      try {
        await context.audioWorklet.addModule(workletUrl)
      } finally {
        URL.revokeObjectURL(workletUrl)
      }
      if (!isCurrent()) return

      clearTimeout(session.timer)
      session.timer = setTimeout(() => fail('Could not connect the call. Please try again.'), 25_000)
      const response = await fetch('/api/voice', { method: 'POST', signal: session.abort.signal })
      const credentials = await response.json() as { token?: string; error?: string }
      if (!isCurrent()) return
      if (!response.ok || !credentials.token) throw new Error(credentials.error ?? 'Could not create a voice session.')

      const protocol = credentials.token.startsWith('xai-client-secret.')
        ? credentials.token : `xai-client-secret.${credentials.token}`
      const socket = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', [protocol])
      session.socket = socket

      const play = (base64: string) => {
        const samples = decodePcm(base64)
        if (!samples.length) return
        const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const node = context.createBufferSource()
        node.buffer = buffer
        node.connect(context.destination)
        const startAt = Math.max(context.currentTime + 0.03, session.playhead)
        node.start(startAt)
        session.playhead = startAt + buffer.duration
        session.playing.add(node)
        node.onended = () => {
          session.playing.delete(node)
          if (isCurrent() && !session.playing.size) setStatus('listening')
        }
        setStatus('speaking')
      }

      const openMicrophone = () => {
        const source = context.createMediaStreamSource(stream)
        const processor = new AudioWorkletNode(context, 'voice-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
        session.source = source
        session.processor = processor
        processor.onprocessorerror = () => fail('Microphone capture stopped. The call ended.')
        processor.port.onmessage = ({ data: chunk }: MessageEvent<{ type: string; bytes?: ArrayBuffer }>) => {
          if (!isCurrent() || !chunk.bytes || socket.readyState !== WebSocket.OPEN) return
          if (socket.bufferedAmount > 1_000_000) {
            fail('Your connection is too slow for a call. Please try again.')
            return
          }
          socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encodePcm(chunk.bytes) }))
        }
        source.connect(processor)
        processor.connect(context.destination)
      }

      socket.onopen = () => {
        if (!isCurrent()) return
        socket.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: 'eve',
            instructions: INSTRUCTIONS,
            turn_detection: { type: 'server_vad', silence_duration_ms: 500, prefix_padding_ms: 300 },
            audio: {
              input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
              output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
            },
          },
        }))
      }
      socket.onerror = () => fail('Could not connect to xAI voice. Please try again.')
      socket.onclose = () => fail('The call dropped. Press call to reconnect.')
      socket.onmessage = ({ data }) => {
        if (!isCurrent() || typeof data !== 'string') return
        let event: { type?: string; delta?: string; transcript?: string; error?: { message?: string } }
        try {
          event = JSON.parse(data)
        } catch {
          return
        }
        switch (event.type) {
          case 'session.updated':
            if (session.connected) return
            session.connected = true
            clearTimeout(session.timer)
            try {
              openMicrophone()
            } catch (captureError) {
              fail(microphoneError(captureError))
              return
            }
            setStatus('listening')
            // Grok answers the phone.
            socket.send(JSON.stringify({ type: 'response.create' }))
            return
          case 'input_audio_buffer.speech_started':
            // Barge-in: the caller talking over Grok cuts its audio off.
            silence(session)
            setStatus('listening')
            return
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            if (event.delta) play(event.delta)
            return
          case 'response.output_audio_transcript.delta':
          case 'response.audio_transcript.delta':
            if (event.delta) caption('assistant', event.delta)
            return
          case 'response.done':
            // Seal the assistant line so the next reply starts a new caption.
            setCaptions((lines) => {
              const last = lines.at(-1)
              return last?.role === 'assistant' ? [...lines.slice(0, -1), { ...last, text: last.text + '\n' }] : lines
            })
            return
          case 'conversation.item.input_audio_transcription.completed': {
            const transcript = event.transcript?.trim()
            if (transcript) caption('user', transcript)
            return
          }
          case 'error':
            // Mid-call errors (e.g. cancelling a finished response) are not fatal.
            if (!session.connected) fail(event.error?.message ?? 'xAI could not start the call.')
            else console.warn('xAI voice error', event.error)
            return
        }
      }
    } catch (startError) {
      fail(microphoneError(startError))
    }
  }, [])

  const isActive = status === 'connecting' || status === 'listening' || status === 'speaking'
  const toggle = useCallback(() => {
    if (sessionRef.current) hangUp()
    else void call()
  }, [call, hangUp])
  const label = isActive ? 'Hang up' : 'Call Phab'

  return {
    status, isActive, error, captions, call, hangUp, toggle,
    buttonProps: { type: 'button' as const, onClick: toggle, 'aria-label': label, 'aria-pressed': isActive, title: label },
  }
}
