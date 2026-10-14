import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  createProvider,
  modelStatus,
} from './provider'
import {
  PRESETS,
  describeProvider,
  findPreset,
  readOpencodeAuth,
  resolveProvider,
} from './providerConfig'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  calls: Array<{ url: string; body: unknown; headers: Record<string, string> }>
} {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> })
    return handler(url, init)
  }) as unknown as typeof fetch
  return { calls }
}

/** Never read the real OpenCode auth store from a test. */
const NO_AUTH = join(tmpdir(), 'inkling-no-such-auth.json')

describe('provider presets', () => {
  test('every preset is coherent', () => {
    for (const preset of PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0)
      expect(preset.name.length).toBeGreaterThan(0)
      expect(Array.isArray(preset.keyEnv)).toBe(true)
      if (preset.id !== 'custom') expect(preset.baseUrl.startsWith('http')).toBe(true)
      if (!preset.keyOptional) expect(preset.keyEnv.length).toBeGreaterThan(0)
    }
  })

  test('covers the providers that matter, including local runners', () => {
    const ids = PRESETS.map((preset) => preset.id)
    for (const id of [
      'opencode-go',
      'openai',
      'anthropic',
      'google',
      'openrouter',
      'ollama',
      'vllm',
      'custom',
    ]) {
      expect(ids).toContain(id)
    }
  })

  test('opencode-go points at the OpenCode gateway', () => {
    const preset = findPreset('opencode-go')
    expect(preset?.baseUrl).toBe('https://opencode.ai/inference/go/v1')
    expect(preset?.opencodeAuthId).toBe('opencode-go')
  })
})

describe('resolveProvider', () => {
  test('defaults to OpenCode Go, since that is what OpenCode already has', () => {
    const resolved = resolveProvider({}, { authPath: NO_AUTH })
    expect(resolved.preset.id).toBe('opencode-go')
    expect(resolved.model).toBe('kimi-k2.6')
    expect(resolved.configured).toBe(false)
    expect(resolved.keySource).toBe('none')
  })

  test('selects a provider by name', () => {
    expect(resolveProvider({ INKLING_PROVIDER: 'ollama' }, { authPath: NO_AUTH }).preset.id).toBe(
      'ollama',
    )
    expect(resolveProvider({ INKLING_PROVIDER: 'vllm' }, { authPath: NO_AUTH }).preset.id).toBe(
      'vllm',
    )
  })

  test('falls back to the custom preset for an unknown name', () => {
    expect(resolveProvider({ INKLING_PROVIDER: 'nope' }, { authPath: NO_AUTH }).preset.id).toBe(
      'custom',
    )
  })

  test('takes a key from the environment', () => {
    const resolved = resolveProvider({ OPENCODE_API_KEY: 'sk-test' }, { authPath: NO_AUTH })
    expect(resolved.apiKey).toBe('sk-test')
    expect(resolved.keySource).toBe('env')
    expect(resolved.configured).toBe(true)
  })

  test('falls back to the key OpenCode already stored, so nothing must be copied', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkling-auth-'))
    const authPath = join(dir, 'auth.json')
    await writeFile(
      authPath,
      JSON.stringify({
        'opencode-go': { type: 'api', key: 'key-from-opencode' },
        anthropic: { type: 'oauth', access: 'should-be-ignored' },
      }),
    )
    try {
      const resolved = resolveProvider({}, { authPath })
      expect(resolved.apiKey).toBe('key-from-opencode')
      expect(resolved.keySource).toBe('opencode-auth')
      expect(resolved.configured).toBe(true)

      // An OAuth token is not an API key and must not be used as one.
      expect(readOpencodeAuth('anthropic', authPath)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an explicit env key wins over the stored one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkling-auth-'))
    const authPath = join(dir, 'auth.json')
    await writeFile(authPath, JSON.stringify({ 'opencode-go': { type: 'api', key: 'stored' } }))
    try {
      const resolved = resolveProvider({ INKLING_API_KEY: 'explicit' }, { authPath })
      expect(resolved.apiKey).toBe('explicit')
      expect(resolved.keySource).toBe('env')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a missing or broken auth store is not an error', () => {
    expect(resolveProvider({}, { authPath: NO_AUTH }).configured).toBe(false)
    expect(readOpencodeAuth('opencode-go', NO_AUTH)).toBeNull()
  })

  test('local runners need no key', () => {
    const ollama = resolveProvider({ INKLING_PROVIDER: 'ollama' }, { authPath: NO_AUTH })
    expect(ollama.keySource).toBe('not-needed')
    expect(ollama.configured).toBe(true)
    expect(ollama.baseUrl).toBe('http://127.0.0.1:11434/v1')

    const vllm = resolveProvider({ INKLING_PROVIDER: 'vllm' }, { authPath: NO_AUTH })
    expect(vllm.configured).toBe(true)
  })

  test('overrides for base url, model and embedding model', () => {
    const resolved = resolveProvider(
      {
        INKLING_PROVIDER: 'custom',
        INKLING_BASE_URL: 'http://192.168.1.9:8000/v1/',
        INKLING_MODEL: 'my-model',
        INKLING_EMBED_MODEL: 'my-embed',
        INKLING_API_KEY: 'k',
      },
      { authPath: NO_AUTH },
    )
    expect(resolved.baseUrl).toBe('http://192.168.1.9:8000/v1')
    expect(resolved.model).toBe('my-model')
    expect(resolved.embedModel).toBe('my-embed')
    expect(resolved.configured).toBe(true)
  })

  test('anthropic reports no embeddings, because it has none', () => {
    const resolved = resolveProvider({ INKLING_PROVIDER: 'anthropic' }, { authPath: NO_AUTH })
    expect(resolved.embedModel).toBeNull()
    expect(modelStatus(resolved).embeddings).toBe(false)
  })

  test('a custom endpoint with no base url is not configured', () => {
    const resolved = resolveProvider({ INKLING_PROVIDER: 'custom' }, { authPath: NO_AUTH })
    expect(resolved.configured).toBe(false)
    expect(describeProvider(resolved)).toContain('not configured')
  })

  test('describeProvider names the provider, model and key origin', () => {
    const resolved = resolveProvider({ INKLING_PROVIDER: 'ollama' }, { authPath: NO_AUTH })
    expect(describeProvider(resolved)).toContain('Ollama')
    expect(describeProvider(resolved)).toContain('llama3.2')
  })
})

describe('createProvider', () => {
  test('picks the transport that matches the preset', () => {
    expect(
      createProvider(
        resolveProvider({ INKLING_PROVIDER: 'anthropic' }, { authPath: NO_AUTH }),
      ) instanceof AnthropicProvider,
    ).toBe(true)
    expect(
      createProvider(
        resolveProvider({ INKLING_PROVIDER: 'ollama' }, { authPath: NO_AUTH }),
      ) instanceof OpenAiCompatibleProvider,
    ).toBe(true)
  })
})

describe('OpenAiCompatibleProvider', () => {
  function provider(env: Record<string, string> = {}) {
    return new OpenAiCompatibleProvider(
      resolveProvider(
        { INKLING_PROVIDER: 'ollama', INKLING_MODEL: 'test-model', ...env },
        { authPath: NO_AUTH },
      ),
    )
  }

  test('posts a chat completion and returns the text', async () => {
    const stub = stubFetch(async () =>
      Response.json({ choices: [{ message: { content: 'hello' } }] }),
    )
    expect(await provider().completeStructured({ system: 's', prompt: 'p' })).toBe('hello')
    expect(stub.calls[0]?.url).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  test('retries without response_format when a server rejects it', async () => {
    const stub = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: unknown }
      if (body.response_format) return new Response('unsupported', { status: 400 })
      return Response.json({ choices: [{ message: { content: 'worked' } }] })
    })
    expect(await provider().completeStructured({ system: 's', prompt: 'p' })).toBe('worked')
    expect(stub.calls).toHaveLength(2)
    expect((stub.calls[1]?.body as { response_format?: unknown }).response_format).toBeUndefined()
  })

  test('sends a bearer token when there is one', async () => {
    const stub = stubFetch(async () => Response.json({ choices: [{ message: { content: 'x' } }] }))
    await new OpenAiCompatibleProvider(
      resolveProvider(
        { INKLING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-abc' },
        { authPath: NO_AUTH },
      ),
    ).completeStructured({ system: 's', prompt: 'p' })
    expect(stub.calls[0]?.headers.authorization).toBe('Bearer sk-abc')
  })

  test('throws on a failed completion, so the caller falls back to the playbook', async () => {
    stubFetch(async () => new Response('boom', { status: 500 }))
    await expect(provider().completeStructured({ system: 's', prompt: 'p' })).rejects.toThrow('500')
  })

  test('throws when the server returns no content', async () => {
    stubFetch(async () => Response.json({ choices: [] }))
    await expect(provider().completeStructured({ system: 's', prompt: 'p' })).rejects.toThrow()
  })

  test('embeds when an embedding model is configured', async () => {
    const stub = stubFetch(async () =>
      Response.json({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }),
    )
    const vectors = await provider({ INKLING_EMBED_MODEL: 'nomic-embed-text' }).embed(['a', 'b'])
    expect(vectors).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(stub.calls[0]?.url).toBe('http://127.0.0.1:11434/v1/embeddings')
  })

  test('refuses to embed without a model rather than sending a bad request', async () => {
    const stub = stubFetch(async () => Response.json({ data: [] }))
    // vLLM's preset has no embedding model by default.
    const keyless = new OpenAiCompatibleProvider(
      resolveProvider({ INKLING_PROVIDER: 'vllm' }, { authPath: NO_AUTH }),
    )
    await expect(keyless.embed(['a'])).rejects.toThrow('no embedding model')
    expect(stub.calls).toHaveLength(0)
  })
})

describe('AnthropicProvider', () => {
  const resolved = resolveProvider(
    { INKLING_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant' },
    { authPath: NO_AUTH },
  )

  test('posts to the messages API with an x-api-key and reads text blocks', async () => {
    const stub = stubFetch(async () =>
      Response.json({ content: [{ type: 'text', text: '{"id":"any.react"}' }] }),
    )
    const text = await new AnthropicProvider(resolved).completeStructured({
      system: 's',
      prompt: 'p',
    })
    expect(text).toBe('{"id":"any.react"}')
    expect(stub.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(stub.calls[0]?.headers['x-api-key']).toBe('sk-ant')
    expect(stub.calls[0]?.headers['anthropic-version']).toBe('2023-06-01')
  })

  test('is unavailable without a key', async () => {
    const keyless = new AnthropicProvider(
      resolveProvider({ INKLING_PROVIDER: 'anthropic' }, { authPath: NO_AUTH }),
    )
    expect(await keyless.available()).toBe(false)
  })

  test('embedding fails with a useful message rather than a confusing one', async () => {
    await expect(new AnthropicProvider(resolved).embed(['a'])).rejects.toThrow('no embeddings API')
  })
})
