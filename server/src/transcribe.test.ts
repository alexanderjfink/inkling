import { describe, expect, test } from 'bun:test'
import type { ServerConfig } from './config'
import { resolveTranscriber, transcribe } from './transcribe'

const CONFIG: ServerConfig = {
  transcribeModel: 'whisper-1',
  transcribeBaseUrl: 'http://127.0.0.1:9000/v1/',
  transcribeApiKey: 'sk-local',
}

describe('having somewhere to listen', () => {
  test('needs both a model and an address to send it to', () => {
    // One without the other is a setting somebody half-filled in, and it should read as
    // "not set up" rather than as a failure at the moment somebody speaks.
    expect(resolveTranscriber({ transcribeModel: 'whisper-1' })).toBeNull()
    expect(resolveTranscriber({ transcribeBaseUrl: 'http://x/v1' })).toBeNull()
    expect(resolveTranscriber({})).toBeNull()
  })

  test('the trailing slash goes, so the path does not double up', () => {
    expect(resolveTranscriber(CONFIG)?.baseUrl).toBe('http://127.0.0.1:9000/v1')
  })
})

describe('sending a recording', () => {
  const audio = new Blob(['not really audio'], { type: 'audio/webm' })

  test('posts it to the audio endpoint with the model named', async () => {
    let seen = ''
    let model = ''
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = url
      const form = init.body as FormData
      model = String(form.get('model'))
      return Response.json({ text: '  a few chords  ' })
    }) as unknown as typeof fetch

    const result = await transcribe(resolveTranscriber(CONFIG)!, audio, { fetcher })
    expect(seen).toBe('http://127.0.0.1:9000/v1/audio/transcriptions')
    expect(model).toBe('whisper-1')
    expect(result.text).toBe('a few chords')
  })

  test('sends the key when there is one, and nothing when there is not', async () => {
    let header: string | undefined
    const fetcher = (async (_url: string, init: RequestInit) => {
      header = (init.headers as Record<string, string>).authorization
      return Response.json({ text: 'ok' })
    }) as unknown as typeof fetch

    await transcribe(resolveTranscriber(CONFIG)!, audio, { fetcher })
    expect(header).toBe('Bearer sk-local')

    await transcribe({ baseUrl: 'http://x/v1', apiKey: null, model: 'm' }, audio, { fetcher })
    expect(header).toBeUndefined()
  })

  test('a refused key says so, rather than saying 401', async () => {
    // "the transcriber said 401" tells you nothing about which field to fix.
    const fetcher = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    await expect(transcribe(resolveTranscriber(CONFIG)!, audio, { fetcher })).rejects.toThrow(
      'refused the key',
    )
  })

  test('silence is a failure, not an empty Inkling', async () => {
    const fetcher = (async () => Response.json({ text: '   ' })) as unknown as typeof fetch
    await expect(transcribe(resolveTranscriber(CONFIG)!, audio, { fetcher })).rejects.toThrow(
      'heard nothing',
    )
  })
})
