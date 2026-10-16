import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Runtime,
  type ServerConfig,
  assetLinks,
  buildRuntime,
  configPath,
  loadConfig,
  mergeConfig,
  publicConfig,
  saveConfig,
  validateConfig,
} from './config'
import { createHandler } from './handler'
import { FileStore } from './store'

const BASE = 'http://localhost/api'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkling-config-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('config storage', () => {
  test('a missing file is simply empty, not an error', async () => {
    expect(await loadConfig(dir)).toEqual({})
  })

  test('round-trips through the file', async () => {
    const config: ServerConfig = { provider: 'ollama', model: 'llama3.2', folder: 'Notes' }
    await saveConfig(dir, config)
    expect(await loadConfig(dir)).toEqual(config)
    expect(configPath(dir).endsWith('config.json')).toBe(true)
  })

  test('a corrupt file is treated as empty rather than crashing the server', async () => {
    await saveConfig(dir, {})
    const { writeFile } = await import('node:fs/promises')
    await writeFile(configPath(dir), 'not json', 'utf8')
    expect(await loadConfig(dir)).toEqual({})
  })
})

describe('mergeConfig', () => {
  const base: ServerConfig = { provider: 'opencode-go', model: 'kimi-k2.6', folder: 'Inkling' }

  test('a patch overrides only what it mentions', () => {
    expect(mergeConfig(base, { model: 'other-model' })).toEqual({
      provider: 'opencode-go',
      model: 'other-model',
      folder: 'Inkling',
    })
  })

  test('an empty string clears a field, so a setting can be unset', () => {
    expect(mergeConfig(base, { model: '' })).toEqual({
      provider: 'opencode-go',
      folder: 'Inkling',
    })
  })

  test('null clears a numeric field', () => {
    const withSimilarity: ServerConfig = { ...base, embedSimilarity: 0.8 }
    expect(mergeConfig(withSimilarity, { embedSimilarity: null })).toEqual(base)
  })

  test('undefined leaves a field alone', () => {
    expect(mergeConfig(base, { model: undefined })).toEqual(base)
  })
})

describe('validateConfig', () => {
  test('accepts a sensible patch', () => {
    expect(validateConfig({ provider: 'ollama', model: 'llama3.2', vault: '/tmp/v' })).toEqual([])
  })

  test('rejects an unknown provider, rather than failing later', () => {
    expect(validateConfig({ provider: 'nope' })[0]?.field).toBe('provider')
  })

  test('an empty value clears the field rather than failing the save', () => {
    // The contract mergeConfig documents, and the one the settings form relies on: it
    // sends an empty value for every field left blank. Refusing them meant a blank
    // similarity floor failed the save that was carrying an API key.
    expect(validateConfig({ model: '' })).toHaveLength(0)
    expect(validateConfig({ vault: '' })).toHaveLength(0)
    expect(validateConfig({ provider: '' })).toHaveLength(0)
    expect(validateConfig({ embedSimilarity: null })).toHaveLength(0)
  })

  test('a whitespace-only value is left alone too, since trim would clear it anyway', () => {
    expect(validateConfig({ model: '   ' })).toHaveLength(0)
  })

  test('a similarity that is not a number between 0 and 1 is still refused', () => {
    expect(validateConfig({ embedSimilarity: 0 })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: 1 })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: 9 })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: Number.NaN })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: 0.75 })).toHaveLength(0)
  })

  test('rejects an embedding provider that cannot embed', () => {
    expect(validateConfig({ embedProvider: 'anthropic' })[0]?.message).toContain('no embeddings')
  })

  test('rejects a similarity outside 0..1', () => {
    expect(validateConfig({ embedSimilarity: 1.5 })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: 0 })[0]?.field).toBe('embedSimilarity')
    expect(validateConfig({ embedSimilarity: 0.75 })).toEqual([])
  })
})

describe('buildRuntime', () => {
  test('saved settings win over the environment', () => {
    const runtime = buildRuntime(
      { provider: 'ollama', model: 'llama3.2', vault: '/tmp/vault', folder: 'Notes' },
      { INKLING_PROVIDER: 'opencode-go' },
    )
    expect(runtime.status.provider).toBe('ollama')
    expect(runtime.status.model).toBe('llama3.2')
    expect(runtime.vault.vault).toBe('/tmp/vault')
    expect(runtime.vault.folder).toBe('Notes')
  })

  test('the environment still supplies what settings do not', () => {
    const runtime = buildRuntime({ model: 'llama3.2' }, { INKLING_PROVIDER: 'ollama' })
    expect(runtime.status.provider).toBe('ollama')
    expect(runtime.status.model).toBe('llama3.2')
  })

  test('an embedding provider can be set from settings alone', () => {
    const runtime = buildRuntime({ embedProvider: 'ollama', embedModel: 'nomic-embed-text' }, {})
    expect(runtime.status.embeddings).toBe(true)
    expect(runtime.status.embedProvider).toBe('ollama')
    expect(runtime.embed).toBeTruthy()
  })

  test('an unconfigured model is a valid state, not a crash', () => {
    const runtime = buildRuntime({ provider: 'custom' }, {})
    expect(runtime.status.configured).toBe(false)
    expect(runtime.llm).toBeUndefined()
  })

  test('the public view never carries a key', () => {
    const runtime = buildRuntime({ provider: 'openai', apiKey: 'sk-secret' }, {})
    const view = publicConfig({ provider: 'openai', apiKey: 'sk-secret' }, runtime) as Record<
      string,
      unknown
    >
    expect(view.apiKeySet).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-secret')
  })
})

describe('config routes', () => {
  function withBridge(initial: ServerConfig = {}) {
    let config = initial
    let runtime: Runtime = buildRuntime(config)
    const handle = createHandler(new FileStore(dir), {
      runtime: () => runtime,
      settings: {
        read: async () => ({ config, runtime }),
        update: async (patch) => {
          config = mergeConfig(config, patch)
          runtime = buildRuntime(config)
          return { config, runtime, problems: [] }
        },
      },
    })
    return { handle, current: () => config }
  }

  test('answers 503 when the server has no settings bridge', async () => {
    const handle = createHandler(new FileStore(dir))
    expect((await handle(new Request(`${BASE}/config`))).status).toBe(503)
  })

  test('reports the effective configuration and the providers on offer', async () => {
    const { handle } = withBridge({ provider: 'ollama', model: 'llama3.2' })
    const body = await handle(new Request(`${BASE}/config`)).then((res) => res.json())
    expect(body.config.provider).toBe('ollama')
    expect(body.config.model).toBe('llama3.2')
    expect(body.providers.map((preset: { id: string }) => preset.id)).toContain('omlx')
  })

  test('applies a patch and reflects it immediately', async () => {
    const { handle, current } = withBridge()
    const res = await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ provider: 'ollama', model: 'llama3.2', folder: 'Notes' }),
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).config.model).toBe('llama3.2')
    expect(current().folder).toBe('Notes')
  })

  test('rejects an invalid patch with a reason, and changes nothing', async () => {
    const { handle, current } = withBridge({ provider: 'ollama' })
    const res = await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ provider: 'not-a-provider' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.problems[0].field).toBe('provider')
    expect(current().provider).toBe('ollama')
  })

  test('a settings change reaches the model routes without a restart', async () => {
    const { handle } = withBridge()
    const before = await handle(new Request(`${BASE}/llm/health`)).then((res) => res.json())
    expect(before.embeddings).toBe(false)

    await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ embedProvider: 'ollama', embedModel: 'nomic-embed-text' }),
      }),
    )

    // The handler must read the runtime per request; holding the object it was
    // built with meant a settings change never reached the model routes.
    const after = await handle(new Request(`${BASE}/llm/health`)).then((res) => res.json())
    expect(after.embeddings).toBe(true)
    expect(after.embedProvider).toBe('ollama')
    expect(after.embedModel).toBe('nomic-embed-text')
  })

  test('accepts a key without ever returning it', async () => {
    const { handle } = withBridge()
    await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-secret' }),
      }),
    )
    const body = await handle(new Request(`${BASE}/config`)).then((res) => res.json())
    expect(body.config.apiKeySet).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sk-secret')
  })

  test('coerces a similarity sent as a string, and rejects a silly one', async () => {
    const { handle } = withBridge()
    const ok = await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ embedSimilarity: '0.8' }),
      }),
    )
    expect((await ok.json()).config.embedSimilarity).toBe(0.8)

    const bad = await handle(
      new Request(`${BASE}/config`, {
        method: 'PUT',
        body: JSON.stringify({ embedSimilarity: '9' }),
      }),
    )
    expect(bad.status).toBe(400)
  })
})

const GOOD_FINGERPRINT =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'

describe('Digital Asset Links (for a TWA APK)', () => {
  test('nothing is served until both fields are set', () => {
    expect(assetLinks({})).toBeNull()
    expect(assetLinks({ twaPackage: 'app.inkling.twa' })).toBeNull()
    expect(assetLinks({ twaFingerprint: GOOD_FINGERPRINT })).toBeNull()
  })

  test('the document has the shape Android expects', () => {
    const links = assetLinks({ twaPackage: 'app.inkling.twa', twaFingerprint: GOOD_FINGERPRINT })
    expect(links).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.inkling.twa',
          sha256_cert_fingerprints: [GOOD_FINGERPRINT],
        },
      },
    ])
  })

  test('a lowercase fingerprint is upper-cased, since Android prints it that way', () => {
    const links = assetLinks({
      twaPackage: 'app.inkling.twa',
      twaFingerprint: GOOD_FINGERPRINT.toLowerCase(),
    })
    const target = (links?.[0] as { target: { sha256_cert_fingerprints: string[] } }).target
    expect(target.sha256_cert_fingerprints[0]).toBe(GOOD_FINGERPRINT)
  })

  test('a fingerprint that is not 32 hex pairs is rejected rather than half-working', () => {
    // A wrong fingerprint is worse than none: the APK installs and then shows a URL
    // bar, which looks like the feature not working rather than a typo.
    expect(validateConfig({ twaFingerprint: 'AA:BB:CC' })).toHaveLength(1)
    expect(
      validateConfig({
        twaFingerprint:
          'ZZ:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      }),
    ).toHaveLength(1)
    expect(validateConfig({ twaFingerprint: GOOD_FINGERPRINT })).toHaveLength(0)
  })

  test('an empty fingerprint clears it, and is not an error', () => {
    expect(validateConfig({ twaFingerprint: '' })).toHaveLength(0)
  })

  test('an empty package name clears it too, rather than complaining it is empty', () => {
    // mergeConfig treats "" as "unset", so validation must not contradict it — otherwise
    // there is no way to undo a TWA setup once it is wrong.
    expect(validateConfig({ twaPackage: '' })).toHaveLength(0)
    expect(mergeConfig({ twaPackage: 'app.inkling.mobile' }, { twaPackage: '' })).toEqual({})
  })

  test('clearing both leaves nothing to serve', () => {
    const configured: ServerConfig = {
      twaPackage: 'app.inkling.mobile',
      twaFingerprint: GOOD_FINGERPRINT,
    }
    expect(assetLinks(configured)).not.toBeNull()
    expect(assetLinks(mergeConfig(configured, { twaPackage: '', twaFingerprint: '' }))).toBeNull()
  })

  test('a package name needs at least two segments', () => {
    expect(validateConfig({ twaPackage: 'inkling' })).toHaveLength(1)
    expect(validateConfig({ twaPackage: 'app.inkling.mobile' })).toHaveLength(0)
  })

  test('both fields survive a merge and are readable back', () => {
    const merged = mergeConfig(
      {},
      { twaPackage: 'app.inkling.twa', twaFingerprint: GOOD_FINGERPRINT },
    )
    expect(merged.twaPackage).toBe('app.inkling.twa')
    expect(merged.twaFingerprint).toBe(GOOD_FINGERPRINT)
  })

  test('the endpoint serves the document, and explains itself when unset', async () => {
    let config: ServerConfig = {}
    let runtime: Runtime = buildRuntime(config)
    const dir = await mkdtemp(join(tmpdir(), 'inkling-twa-'))
    const handle = createHandler(new FileStore(dir), {
      runtime: () => runtime,
      settings: {
        read: async () => ({ config, runtime }),
        update: async (patch) => {
          config = mergeConfig(config, patch)
          runtime = buildRuntime(config)
          return { config, runtime, problems: [] }
        },
      },
    })

    try {
      const before = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
      expect(before.status).toBe(404)
      expect((await before.json()).hint).toContain('Settings')

      config = mergeConfig(config, {
        twaPackage: 'app.inkling.twa',
        twaFingerprint: GOOD_FINGERPRINT,
      })
      const after = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
      expect(after.status).toBe(200)
      const body = (await after.json()) as Array<{ target: { package_name: string } }>
      expect(body[0]?.target.package_name).toBe('app.inkling.twa')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a model server that is not where the preset says', () => {
  /**
   * The "custom endpoint" preset had no endpoint to give it: the address was read from
   * INKLING_BASE_URL and nothing in the app could set it. A remote Ollama had the same
   * problem — its preset points at 127.0.0.1, and there was no way to say otherwise.
   */
  async function withServer(initial: ServerConfig = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'inkling-baseurl-'))
    let config = initial
    let runtime: Runtime = buildRuntime(config)
    const handle = createHandler(new FileStore(dir), {
      runtime: () => runtime,
      settings: {
        read: async () => ({ config, runtime }),
        update: async (patch) => {
          config = mergeConfig(config, patch)
          // Persist, as the real bridge does — otherwise "survives a restart" would not
          // actually be testing anything.
          await saveConfig(dir, config)
          runtime = buildRuntime(config)
          return { config, runtime, problems: [] }
        },
      },
    })
    return { handle, dir, current: () => config }
  }

  const put = (handle: (r: Request) => Promise<Response>, body: unknown) =>
    handle(new Request(`${BASE}/config`, { method: 'PUT', body: JSON.stringify(body) }))

  test('a saved address is used, and reported back', async () => {
    const { handle, dir } = await withServer()
    try {
      const saved = await put(handle, {
        provider: 'ollama',
        baseUrl: 'https://ollama.example.com/v1',
      })
      expect(saved.status).toBe(200)
      expect((await saved.json()).config.baseUrl).toBe('https://ollama.example.com/v1')

      // The provider is actually pointed at it, not merely storing the string.
      const health = (await (await handle(new Request(`${BASE}/llm/health`))).json()) as {
        baseUrl: string
      }
      expect(health.baseUrl).toBe('https://ollama.example.com/v1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('with no address saved, the preset default is used', async () => {
    const { handle, dir } = await withServer()
    try {
      await put(handle, { provider: 'ollama' })
      const health = (await (await handle(new Request(`${BASE}/llm/health`))).json()) as {
        baseUrl: string
      }
      expect(health.baseUrl).toBe('http://127.0.0.1:11434/v1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an empty address goes back to the preset default', async () => {
    const { handle, dir } = await withServer()
    try {
      await put(handle, { provider: 'ollama', baseUrl: 'https://elsewhere.example.com/v1' })
      await put(handle, { baseUrl: '' })
      const health = (await (await handle(new Request(`${BASE}/llm/health`))).json()) as {
        baseUrl: string
      }
      expect(health.baseUrl).toBe('http://127.0.0.1:11434/v1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the embeddings provider has its own address', async () => {
    const { handle, dir } = await withServer()
    try {
      await put(handle, {
        embedProvider: 'ollama',
        embedBaseUrl: 'https://ollama.example.com/v1',
      })
      const health = (await (await handle(new Request(`${BASE}/llm/health`))).json()) as {
        embedBaseUrl: string
      }
      expect(health.embedBaseUrl).toBe('https://ollama.example.com/v1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('something that is not an address is refused, with a reason', async () => {
    const { handle, dir } = await withServer()
    try {
      for (const bad of ['not a url', 'ftp://example.com', 'example.com/v1']) {
        const res = await put(handle, { baseUrl: bad })
        expect({ bad, status: res.status }).toEqual({ bad, status: 400 })
        const body = (await res.json()) as { problems: Array<{ field: string }> }
        expect(body.problems[0]?.field).toBe('baseUrl')
      }
      // A trailing slash is fine: it is stripped before use, not rejected.
      expect((await put(handle, { baseUrl: 'https://example.com/v1/' })).status).toBe(200)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('the address survives a restart, because it is in the config file', async () => {
    const { handle, dir } = await withServer()
    try {
      await put(handle, { provider: 'ollama', baseUrl: 'https://ollama.example.com/v1' })
      const saved = await loadConfig(dir)
      expect(saved.baseUrl).toBe('https://ollama.example.com/v1')
      expect(buildRuntime(saved).status.baseUrl).toBe('https://ollama.example.com/v1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
