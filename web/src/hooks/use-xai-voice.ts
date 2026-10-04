import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasJob } from '#/lib/canvas'
import { receiveCanvasJob, refreshCanvas, selectedContextIds } from '#/lib/canvas-workspace'
import { voicePcmWorklet } from '#/lib/voice-pcm-worklet'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export type VoiceCaption = { role: 'user' | 'assistant'; text: string }

const SAMPLE_RATE = 24_000
const INSTRUCTIONS = `You are Phab, a personal agent talking with the user on a live voice call.
Keep replies short and conversational, like a phone call. Ask a follow-up when it helps.
When the user asks you to research, find sources, documents or images, or create research cards,
call queue_research with a short title and a self-contained task including the user's requirements.
A canvas sidecar handles the request: if it refines earlier research (e.g. "office buildings" then
"in San Francisco"), include the original topic in the task and it replaces the earlier cards.
It can also remove cards when asked.
The worker automatically receives the user's selected canvas context. Queue an actionable request
without asking for confirmation. Once the tool confirms it is queued, briefly say the research is
queued and cards will appear on the canvas. Keep talking with the user while the worker runs.
Never claim research has started, finished, or produced cards without a tool result confirming it.
If the tool reports an error, explain it honestly; do not pretend the request succeeded or retry
automatically when its outcome is unknown.`

const RESEARCH_TOOL = {
  type: 'function',
  name: 'queue_research',
  description: 'Queue independent research, source/document/image searches, or new research cards on the canvas. Returns a job ID immediately while research continues in the background.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120, description: 'Short title for the research job.' },
      task: { type: 'string', minLength: 1, maxLength: 10000, description: 'Complete research request, including relevant details from this conversation.' },
    },
    required: ['title', 'task'],
    additionalProperties: false,
  },
}

type VoiceEvent = {
  type?: string
  delta?: string
  transcript?: string
  call_id?: string
  name?: string
  arguments?: string
  error?: { message?: string }
}

async function queueVoiceResearch(event: VoiceEvent) {
  if (event.name !== 'queue_research') return { status: 'failed', error: 'This voice tool is not available.' }
  let args: { title?: unknown; task?: unknown }
  try {
    args = JSON.parse(event.arguments ?? '')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments')
  } catch {
    return { status: 'failed', error: 'The research request was invalid and was not queued.' }
  }
  try {
    // Finishing this request does not depend on the call remaining connected.
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: args.title, task: args.task, contextStackIds: selectedContextIds() }),
      signal: AbortSignal.timeout(25_000),
    })
    const result = await response.json() as { job?: CanvasJob; jobs?: CanvasJob[]; summary?: string; removedStacks?: number; error?: string }
    if (!response.ok || (!result.job && !result.removedStacks)) {
      const status = response.status >= 500 || response.ok ? 'unknown' : 'failed'
      if (status === 'unknown') void refreshCanvas()
      return { status, error: result.error ?? 'Could not confirm the research request. Check the canvas before retrying.' }
    }
    result.jobs?.forEach(receiveCanvasJob)
    if (!result.job) { void refreshCanvas(); return { status: 'done', message: result.summary } }
    return { status: 'queued', jobId: result.job.id, title: result.job.title, summary: result.summary, message: 'Saved to the background research queue. Cards will appear on the canvas. Keep talking with the user.' }
  } catch {
    void refreshCanvas()
    return { status: 'unknown', error: 'Could not confirm whether research was queued. Check the canvas before retrying; do not submit a duplicate request.' }
  }
}

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
      // Establish the workspace cookie before a voice tool can enqueue work.
      const [response] = await Promise.all([
        fetch('/api/voice', { method: 'POST', signal: session.abort.signal }),
        refreshCanvas(),
      ])
      const credentials = await response.json() as { token?: string; error?: string }
      if (!isCurrent()) return
      if (!response.ok || !credentials.token) throw new Error(credentials.error ?? 'Could not create a voice session.')

      const protocol = credentials.token.startsWith('xai-client-secret.')
        ? credentials.token : `xai-client-secret.${credentials.token}`
      const socket = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', [protocol])
      session.socket = socket
      const handledCalls = new Set<string>()
      let pendingTools = 0
      let responseActive = false
      let toolResponseNeeded = false

      const continueAfterTools = () => {
        if (!isCurrent() || socket.readyState !== WebSocket.OPEN || responseActive || pendingTools || !toolResponseNeeded) return
        toolResponseNeeded = false
        responseActive = true
        socket.send(JSON.stringify({ type: 'response.create' }))
      }

      const handleToolCall = async (event: VoiceEvent) => {
        if (!event.call_id || handledCalls.has(event.call_id)) return
        handledCalls.add(event.call_id)
        pendingTools++
        responseActive = true
        const output = await queueVoiceResearch(event)
        pendingTools--
        if (!isCurrent() || socket.readyState !== WebSocket.OPEN) return
        socket.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(output) },
        }))
        toolResponseNeeded = true
        // Parallel function calls must all resolve before the model continues.
        continueAfterTools()
      }

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
            tools: [RESEARCH_TOOL],
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
        let event: VoiceEvent
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
          case 'response.created':
            responseActive = true
            return
          case 'response.function_call_arguments.done':
            void handleToolCall(event)
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
            responseActive = false
            // Seal the assistant line so the next reply starts a new caption.
            setCaptions((lines) => {
              const last = lines.at(-1)
              return last?.role === 'assistant' ? [...lines.slice(0, -1), { ...last, text: last.text + '\n' }] : lines
            })
            continueAfterTools()
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
