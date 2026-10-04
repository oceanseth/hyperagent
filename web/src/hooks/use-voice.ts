import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasJob } from '#/lib/canvas'
import { receiveCanvasJob, refreshCanvas, requestCanvasFocus, selectedContextIds } from '#/lib/canvas-workspace'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

export type VoiceCaption = { role: 'user' | 'assistant'; text: string }

// Browser-native voice: SpeechRecognition captures the caller, each finished
// phrase becomes one /api/voice turn against the gateway model, and the reply
// is spoken with speechSynthesis. Recognition pauses while Phab speaks so the
// microphone never transcribes Phab's own voice.

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionFactory(): (() => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? () => new Ctor() : undefined
}

function recognitionError(code?: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Allow microphone access in your browser to call.'
  if (code === 'audio-capture') return 'No microphone found. Connect a microphone and try again.'
  if (code === 'network') return 'Speech recognition lost its connection. Please try again.'
  return undefined
}

type CallSession = {
  active: boolean
  recognition?: Recognition
  conversation: { role: 'user' | 'assistant'; text: string }[]
  turning: boolean
}

// Deliberate mount-only browser-resource cleanup; starting a call is an event.
function useMountEffect(effect: () => void | (() => void)) {
  useEffect(effect, [])
}

function releaseSession(session: CallSession) {
  session.active = false
  if (session.recognition) {
    session.recognition.onresult = null
    session.recognition.onerror = null
    session.recognition.onend = null
    try { session.recognition.abort() } catch {}
  }
  window.speechSynthesis?.cancel()
}

export function useVoice() {
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
    const create = recognitionFactory()
    if (!window.isSecureContext || !create || !window.speechSynthesis) {
      setStatus('error')
      setError('Calling needs speech support on HTTPS — use a current Chrome, Edge, or Safari browser.')
      return
    }

    const session: CallSession = { active: true, conversation: [], turning: false }
    sessionRef.current = session
    const isCurrent = () => sessionRef.current === session && session.active
    const fail = (message: string) => {
      if (!isCurrent()) return
      sessionRef.current = null
      releaseSession(session)
      setError(message)
      setStatus('error')
    }
    const caption = (role: VoiceCaption['role'], text: string) => {
      setCaptions((lines) => [...lines, { role, text }].slice(-20))
    }

    const listen = () => {
      if (!isCurrent() || session.turning) return
      const recognition = create()
      session.recognition = recognition
      recognition.lang = navigator.language || 'en-US'
      recognition.continuous = false
      recognition.interimResults = false
      recognition.onresult = (event) => {
        const result = event.results[event.resultIndex]
        const transcript = result?.isFinal ? result[0].transcript.trim() : ''
        if (transcript) void takeTurn(transcript)
      }
      recognition.onerror = (event) => {
        const message = recognitionError(event.error)
        if (message) fail(message)
        // 'no-speech' and 'aborted' are routine; onend restarts listening.
      }
      recognition.onend = () => {
        // Chrome ends one-shot recognition after each phrase or silence window.
        if (isCurrent() && !session.turning) listen()
      }
      try { recognition.start() } catch {}
      setStatus('listening')
    }

    const speak = (text: string) => new Promise<void>((resolve) => {
      if (!isCurrent()) return resolve()
      setStatus('speaking')
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = navigator.language || 'en-US'
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })

    const takeTurn = async (transcript: string) => {
      if (!isCurrent() || session.turning) return
      session.turning = true
      try { session.recognition?.abort() } catch {}
      caption('user', transcript)
      session.conversation.push({ role: 'user', text: transcript })
      setStatus('connecting')
      try {
        const response = await fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: session.conversation.slice(-40), contextStackIds: selectedContextIds() }),
          signal: AbortSignal.timeout(75_000),
        })
        const result = await response.json() as { text?: string; jobs?: CanvasJob[]; focus?: { id?: string }; error?: string }
        if (!isCurrent()) return
        if (!response.ok || !result.text) {
          const message = result.error ?? 'Phab could not answer. Try again.'
          caption('assistant', message)
          await speak(message)
          return
        }
        if (result.jobs?.length) result.jobs.forEach(receiveCanvasJob)
        if (result.focus?.id) requestCanvasFocus(result.focus.id)
        if (result.jobs?.length || result.focus?.id) void refreshCanvas()
        session.conversation.push({ role: 'assistant', text: result.text })
        caption('assistant', result.text)
        await speak(result.text)
      } catch {
        if (!isCurrent()) return
        caption('assistant', 'The connection hiccuped. Say that again?')
        await speak('The connection hiccuped. Say that again?')
      } finally {
        session.turning = false
        if (isCurrent()) listen()
      }
    }

    // Phab answers the phone.
    const greeting = 'Hey, this is Phab. What are we working on?'
    session.conversation.push({ role: 'assistant', text: greeting })
    caption('assistant', greeting)
    setStatus('connecting')
    await Promise.all([refreshCanvas(), speak(greeting)])
    if (isCurrent()) listen()
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
