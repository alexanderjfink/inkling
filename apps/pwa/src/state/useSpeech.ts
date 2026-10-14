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
 * Voice capture, transcribed on the device.
 *
 * Deliberately the browser's own recogniser rather than uploading audio: the
 * source material's example move is "set a timer for two minutes and ramble into
 * the microphone", and a ramble that has to be shipped to a server and back is a
 * worse fit for a sofa than one that transcribes as you talk.
 *
 * Honest limit: Chrome on Android supports this well; Firefox does not, and the
 * button says so rather than failing silently.
 */
export function useSpeech(onText: (text: string) => void) {
  const supported = useMemo(() => recognitionCtor() !== null, [])

  // Say why, rather than leaving a dead button. The two causes are quite different.
  const reason = supported
    ? null
    : window.isSecureContext === false
      ? 'voice needs a secure connection — https, or localhost'
      : 'this browser cannot transcribe speech. Chrome on Android or desktop can.'

  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const handlerRef = useRef(onText)
  handlerRef.current = onText

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setError('this browser cannot transcribe speech — type instead')
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

  useEffect(() => () => recognitionRef.current?.stop(), [])

  return { supported, reason, listening, error, start, stop }
}
