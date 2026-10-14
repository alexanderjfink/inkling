import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LLMProvider } from '@inkling/domain'
import { fetchPage, isFetchableUrl } from './fetchPage'
import { createHandler } from './handler'
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
    const handle = createHandler(new FileStore(dir), { llm: fakeLlm() })
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
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm({
        completeStructured: async () => {
          throw new Error('upstream exploded')
        },
      }),
    })
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
    const handle = createHandler(new FileStore(dir), { llm: fakeLlm() })
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
    const configured = createHandler(new FileStore(dir), { llm: fakeLlm() })
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

  test('embeddings go to the embedding provider, completions to the chat provider', async () => {
    const asked: string[] = []
    const chat = fakeLlm({
      completeStructured: async () => {
        asked.push('chat')
        return '{"ok":true}'
      },
    })
    const embedder = fakeLlm({
      name: 'local-embed',
      embed: async (texts) => {
        asked.push('embed')
        return texts.map(() => [9, 9])
      },
    })

    const handle = createHandler(new FileStore(dir), { llm: chat, embed: embedder })
    const vectors = await handle(
      new Request(`${BASE}/llm/embed`, { method: 'POST', body: JSON.stringify({ texts: ['a'] }) }),
    )
    await handle(
      new Request(`${BASE}/llm/complete`, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'p' }),
      }),
    )

    expect((await vectors.json()).vectors).toEqual([[9, 9]])
    expect(asked).toEqual(['embed', 'chat'])
  })

  test('llm health reports whether a model is configured', async () => {
    const without = createHandler(new FileStore(dir))
    const a = await without(new Request(`${BASE}/llm/health`))
    expect((await a.json()).configured).toBe(false)

    const withModel = createHandler(new FileStore(dir), { llm: fakeLlm() })
    const body = await withModel(new Request(`${BASE}/llm/health`)).then((res) => res.json())
    expect(body.configured).toBe(true)
    expect(body.provider).toBe('fake')
  })

  test('llm health reports the resolved provider when there is one', async () => {
    const status = {
      provider: 'opencode-go',
      providerName: 'OpenCode Go',
      model: 'kimi-k2.6',
      embedModel: null,
      embedProvider: null,
      embedProviderName: null,
      embedSimilarity: null,
      configured: true,
      keySource: 'opencode-auth' as const,
      embeddings: false,
    }
    const handle = createHandler(new FileStore(dir), { llm: fakeLlm(), model: status })
    const body = await handle(new Request(`${BASE}/llm/health`)).then((res) => res.json())
    expect(body).toMatchObject({
      configured: true,
      provider: 'opencode-go',
      providerName: 'OpenCode Go',
      model: 'kimi-k2.6',
      keySource: 'opencode-auth',
      embeddings: false,
    })
  })

  test('llm providers lists the presets a client can choose from', async () => {
    const handle = createHandler(new FileStore(dir))
    const body = await handle(new Request(`${BASE}/llm/providers`)).then((res) => res.json())
    const ids = body.providers.map((preset: { id: string }) => preset.id)
    expect(ids).toContain('opencode-go')
    expect(ids).toContain('ollama')
    expect(ids).toContain('anthropic')
  })

  test('models are listed when the provider can, so the field can offer a dropdown', async () => {
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm({ listModels: async () => ['a-model', 'b-model'] }),
    })
    const body = await handle(new Request(`${BASE}/llm/models`)).then((res) => res.json())
    expect(body.models).toEqual(['a-model', 'b-model'])
  })

  test('models answers honestly when the provider cannot list them', async () => {
    const handle = createHandler(new FileStore(dir), { llm: fakeLlm() })
    expect((await handle(new Request(`${BASE}/llm/models`))).status).toBe(501)

    const bare = createHandler(new FileStore(dir))
    expect((await bare(new Request(`${BASE}/llm/models`))).status).toBe(503)
  })

  test('models can be listed for the embedding provider separately', async () => {
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm({ listModels: async () => ['chat-model'] }),
      embed: fakeLlm({ name: 'embedder', listModels: async () => ['embed-model'] }),
    })
    const chat = await handle(new Request(`${BASE}/llm/models`)).then((res) => res.json())
    const embed = await handle(new Request(`${BASE}/llm/models?kind=embed`)).then((res) =>
      res.json(),
    )
    expect(chat.models).toEqual(['chat-model'])
    expect(embed.models).toEqual(['embed-model'])
  })

  test('a test call reports success, timing and a sample', async () => {
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm({ completeStructured: async () => '{"ok":true}' }),
    })
    const body = await handle(new Request(`${BASE}/llm/test`, { method: 'POST' })).then((res) =>
      res.json(),
    )
    expect(body.ok).toBe(true)
    expect(typeof body.ms).toBe('number')
    expect(body.detail).toBe('{"ok":true}')
  })

  test('a test call reports the failure rather than throwing', async () => {
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm({
        completeStructured: async () => {
          throw new Error('upstream said no')
        },
      }),
    })
    const res = await handle(new Request(`${BASE}/llm/test`, { method: 'POST' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('upstream said no')
  })

  test('a test call with nothing configured says so instead of failing obscurely', async () => {
    const handle = createHandler(new FileStore(dir))
    const body = await handle(new Request(`${BASE}/llm/test`, { method: 'POST' })).then((res) =>
      res.json(),
    )
    expect(body.ok).toBe(false)
    expect(body.error).toContain('no model configured')
  })

  test('an embedding test uses the embedding provider', async () => {
    const asked: string[] = []
    const handle = createHandler(new FileStore(dir), {
      llm: fakeLlm(),
      embed: fakeLlm({
        name: 'embedder',
        embed: async () => {
          asked.push('embed')
          return [[0.1, 0.2, 0.3]]
        },
      }),
    })
    const body = await handle(
      new Request(`${BASE}/llm/test`, { method: 'POST', body: JSON.stringify({ kind: 'embed' }) }),
    ).then((res) => res.json())
    expect(body.ok).toBe(true)
    expect(body.detail).toBe('3-dimension vector')
    expect(asked).toEqual(['embed'])
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
