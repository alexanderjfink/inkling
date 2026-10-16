import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResult {
  [index: number]: RecognitionAlternative | undefined
}
interface RecognitionEvent {
  resultIndex: number
  results: { length: number; [index: number]: RecognitionResult | undefined }
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * Voice capture.
 *
 * Two ways, and it picks whichever is available.
 *
 * The browser's own recogniser transcribes as you talk, which is what a sofa wants: rambling
 * for two minutes and watching the words appear. It is not everywhere though — Firefox has
 * none of it, and some phones have it only in a language you are not speaking — so when the
 * server has a transcriber set up, the recording is captured to a file, sent there, and the
 * words come back. That path works anywhere the microphone does, including with a model
 * running on your own machine.
 *
 * The browser wins when both exist, because it is instant and costs nothing.
 */
export function useSpeech(
  onText: (text: string) => void,
  options: { transcribeUrl?: string | null } = {},
) {
  const builtIn = useMemo(() => recognitionCtor() !== null, [])
  const canRecord = useMemo(
    () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  )
  const uploads = Boolean(options.transcribeUrl) && canRecord
  const supported = builtIn || uploads

  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const handlerRef = useRef(onText)
  handlerRef.current = onText
  const urlRef = useRef(options.transcribeUrl ?? null)
  urlRef.current = options.transcribeUrl ?? null

  /** Stop everything the microphone is doing, whichever way it was being used. */
  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recorderRef.current?.stop()
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setListening(false)
  }, [])

  /** Record to a file, send it, and put what comes back where the words would have gone. */
  const recordAndSend = useCallback(async () => {
    const url = urlRef.current
    if (!url) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('the microphone was refused')
      return
    }

    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    streamRef.current = stream
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop()
      setListening(false)
      if (chunks.length === 0) return
      setThinking(true)
      void (async () => {
        try {
          const body = new FormData()
          body.set('audio', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
          const res = await fetch(url, { method: 'POST', body })
          const answer = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
          if (!res.ok) {
            setError(answer.error ?? `the transcriber said ${res.status}`)
            return
          }
          if (answer.text?.trim()) handlerRef.current(answer.text.trim())
        } catch {
          setError('could not reach the transcriber')
        } finally {
          setThinking(false)
        }
      })()
    }

    recorder.start()
    setError(null)
    setListening(true)
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    // No built-in recogniser, or it is the one thing that has it: record and send instead.
    if (!Ctor || (uploads && !builtIn)) {
      void recordAndSend()
      return
    }

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    recognition.onresult = (event) => {
      let spoken = ''
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const alternative = event.results[index]?.[0]
        if (alternative) spoken += alternative.transcript
      }
      if (spoken.trim()) handlerRef.current(spoken.trim())
    }
    recognition.onerror = () => {
      setError('speech recognition stopped')
      setListening(false)
    }
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    setError(null)
    recognition.start()
    setListening(true)
  }, [])

  useEffect(() => () => stop(), [stop])

  return { supported, alwaysAvailable: uploads, listening, thinking, error, start, stop }
}
