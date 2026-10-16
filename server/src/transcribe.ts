import type { ServerConfig } from './config'

/**
 * Turning a recording into words.
 *
 * The chat model cannot hear, so this is its own provider — usually a different machine
 * entirely: Whisper on a laptop, Parakeet on a spare GPU, whatever a hosted service offers.
 * Everything that does this speaks the same endpoint, because OpenAI's is the one everybody
 * copied, so there is one shape to talk to rather than one per model.
 *
 * The browser's own speech recognition is preferred when it exists, and it needs none of
 * this: it is instant and free. This is for the phones and browsers that do not have it, and
 * for anybody who would rather their own machine did the listening.
 */

export interface Transcriber {
  baseUrl: string
  apiKey: string | null
  model: string
}

/** Whether anything is set up to listen. */
export function resolveTranscriber(config: ServerConfig): Transcriber | null {
  const model = config.transcribeModel?.trim()
  if (!model) return null
  const baseUrl = (config.transcribeBaseUrl?.trim() ?? '').replace(/\/+$/, '')
  if (!baseUrl) return null
  return { baseUrl, apiKey: config.transcribeApiKey?.trim() || null, model }
}

/** How long to wait before deciding the transcriber is not coming back. */
const TIMEOUT_MS = 120_000

export interface Transcription {
  text: string
}

/**
 * Send a recording to the transcriber and get words back.
 *
 * Throws with a sentence worth reading rather than a status code: "the transcriber said 401"
 * tells you nothing, and "the key was refused" tells you which field to fix.
 */
export async function transcribe(
  transcriber: Transcriber,
  audio: Blob,
  options: { fetcher?: typeof fetch } = {},
): Promise<Transcription> {
  const fetcher = options.fetcher ?? fetch
  const body = new FormData()
  body.set('file', audio, 'recording.webm')
  body.set('model', transcriber.model)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetcher(`${transcriber.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: transcriber.apiKey ? { authorization: `Bearer ${transcriber.apiKey}` } : {},
      body,
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'the transcriber refused the key'
          : `the transcriber said ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      )
    }

    const answer = (await res.json()) as { text?: unknown }
    const text = typeof answer.text === 'string' ? answer.text.trim() : ''
    if (!text) throw new Error('the transcriber heard nothing')
    return { text }
  } finally {
    clearTimeout(timer)
  }
}
