import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LLMProvider } from '@inkling/domain'
import { fetchPage, isFetchableUrl } from './fetchPage'
import { createHandler } from './handler'
import { llmConfigFromEnv } from './llm'
import { FileStore } from './store'

const BASE = 'http://localhost/api'

function fakeLlm(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: 'fake',
    available: async () => true,
    completeStructured: async () => '{"id":"idea.variations"}',
    embed: async (texts) => texts.map(() => [0.1, 0.2]),
    ...overrides,
  }
}

describe('isFetchableUrl', () => {
  test('accepts ordinary public http(s) urls', () => {
    expect(isFetchableUrl('https://example.com/paper.pdf')).toBe(true)
    expect(isFetchableUrl('http://drawabox.com')).toBe(true)
  })

  test('refuses schemes that are not http(s)', () => {
    expect(isFetchableUrl('file:///etc/passwd')).toBe(false)
    expect(isFetchableUrl('ftp://example.com')).toBe(false)
    expect(isFetchableUrl('not a url')).toBe(false)
  })

  test('refuses the private network, so a captured url cannot probe the host', () => {
    expect(isFetchableUrl('http://localhost:8787/api/devices')).toBe(false)
    expect(isFetchableUrl('http://127.0.0.1/')).toBe(false)
    expect(isFetchableUrl('http://192.168.1.1/')).toBe(false)
    expect(isFetchableUrl('http://10.0.0.5/')).toBe(false)
    expect(isFetchableUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isFetchableUrl('http://172.16.0.1/')).toBe(false)
  })
})

describe('fetchPage', () => {
  const html = `<!doctype html><html><head><title>Stages of Change &amp; You</title>
    <style>body{color:red}</style></head>
    <body><script>alert('x')</script><p>Precontemplation is the first stage.</p>
    <p>Interventions differ by stage.</p></body></html>`

  test('reduces a page to a title and a readable excerpt', async () => {
    const fetcher = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch
    const page = await fetchPage('https://example.com/a', { fetcher })
    expect(page.title).toBe('Stages of Change & You')
    expect(page.excerpt).toContain('Precontemplation is the first stage.')
    expect(page.excerpt).toContain('Interventions differ by stage.')
    expect(page.excerpt).not.toContain('alert')
    expect(page.excerpt).not.toContain('color:red')
  })

  test('refuses an unfetchable url before making a request', async () => {
    let called = false
    const fetcher = (async () => {
      called = true
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    await expect(fetchPage('http://127.0.0.1/', { fetcher })).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('surfaces a non-ok response', async () => {
    const fetcher = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(fetchPage('https://example.com/a', { fetcher })).rejects.toThrow(
      'fetch failed: 500',
    )
  })
})

describe('llmConfigFromEnv', () => {
  test('is unconfigured without a key, which is a valid state', () => {
    const config = llmConfigFromEnv({})
    expect(config.apiKey).toBeNull()
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1')
  })

  test('reads a key and overrides', () => {
    const config = llmConfigFromEnv({
      OPENROUTER_API_KEY: 'sk-test',
      INKLING_MODEL: 'some/model',
      OPENROUTER_BASE_URL: 'https://proxy.local/v1/',
    })
    expect(config.apiKey).toBe('sk-test')
    expect(config.model).toBe('some/model')
    expect(config.baseUrl).toBe('https://proxy.local/v1')
  })

  test('treats a blank key as unconfigured', () => {
    expect(llmConfigFromEnv({ OPENROUTER_API_KEY: '   ' }).apiKey).toBeNull()
  })
})

describe('llm and fetch routes', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inkling-llm-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('completion answers 503 when no model is configured, so the client falls back', async () => {
    const handle = createHandler(new FileStore(dir))
    const res = await handle(
      new Request(`${BASE}/llm/complete`, {
        method: 'POST',
        body: JSON.stringify({ system: 's', prompt: 'p' }),
      }),
    )
    expect(res.status).toBe(503)
  })

  test('completion proxies through the provider when one is configured', async () => {
    const handle = createHandler(new FileStore(dir), fakeLlm())
    const res = await handle(
      new Request(`${BASE}/llm/complete`, {
        method: 'POST',
        body: JSON.stringify({ system: 's', prompt: 'p' }),
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('{"id":"idea.variations"}')
  })

  test('completion reports an upstream failure as 502, not as a crash', async () => {
    const handle = createHandler(
      new FileStore(dir),
      fakeLlm({
        completeStructured: async () => {
          throw new Error('upstream exploded')
        },
      }),
    )
    const res = await handle(
      new Request(`${BASE}/llm/complete`, {
        method: 'POST',
        body: JSON.stringify({ system: 's', prompt: 'p' }),
      }),
    )
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('upstream exploded')
  })

  test('completion rejects an empty prompt and a non-json body', async () => {
    const handle = createHandler(new FileStore(dir), fakeLlm())
    expect(
      (
        await handle(
          new Request(`${BASE}/llm/complete`, {
            method: 'POST',
            body: JSON.stringify({ prompt: '' }),
          }),
        )
      ).status,
    ).toBe(400)
    expect(
      (await handle(new Request(`${BASE}/llm/complete`, { method: 'POST', body: 'not json' })))
        .status,
    ).toBe(400)
  })

  test('embedding returns vectors, and 503 when unconfigured', async () => {
    const configured = createHandler(new FileStore(dir), fakeLlm())
    const ok = await configured(
      new Request(`${BASE}/llm/embed`, {
        method: 'POST',
        body: JSON.stringify({ texts: ['a', 'b'] }),
      }),
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).vectors).toHaveLength(2)

    const unconfigured = createHandler(new FileStore(dir))
    expect(
      (
        await unconfigured(
          new Request(`${BASE}/llm/embed`, {
            method: 'POST',
            body: JSON.stringify({ texts: ['a'] }),
          }),
        )
      ).status,
    ).toBe(503)
  })

  test('llm health reports whether a model is configured', async () => {
    const without = createHandler(new FileStore(dir))
    const a = await without(new Request(`${BASE}/llm/health`))
    expect((await a.json()).configured).toBe(false)

    const withModel = createHandler(new FileStore(dir), fakeLlm())
    const b = await withModel(new Request(`${BASE}/llm/health`))
    expect(await b.json()).toEqual({ configured: true, provider: 'fake' })
  })

  test('fetch validates its url before doing anything', async () => {
    const handle = createHandler(new FileStore(dir))
    const missing = await handle(new Request(`${BASE}/fetch`, { method: 'POST', body: '{}' }))
    expect(missing.status).toBe(400)

    const privateHost = await handle(
      new Request(`${BASE}/fetch`, {
        method: 'POST',
        body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
      }),
    )
    expect(privateHost.status).toBe(400)
  })
})
