import { type LLMProvider, noteFilename, parseLog, sha256Hex } from '@inkling/domain'
import type { ConfigProblem, Runtime, ServerConfig } from './config'
import { publicConfig, validateConfig } from './config'
import { fetchPage, isFetchableUrl } from './fetchPage'
import type { ModelStatus } from './provider'
import { PRESETS } from './providerConfig'
import { notBuiltPage, serveStatic } from './static'
import { type Store, isSafeDeviceId, isSafeHash } from './store'
import { type VaultConfig, resolveNotePath, vaultStatus, writeNote } from './vault'

const encoder = new TextEncoder()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Permissive CORS: this is a personal server the PWA may reach on another origin. */
function withCors(headers: Headers): Headers {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, PUT, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type')
  return headers
}

/** BodyInit wants a concretely-typed ArrayBuffer, so copy into a fresh one. */
function toBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function providerList() {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    keyEnv: preset.keyEnv,
    defaultModel: preset.defaultModel,
    keyOptional: Boolean(preset.keyOptional),
    noEmbeddings: Boolean(preset.noEmbeddings),
    note: preset.note ?? null,
  }))
}

/** Read the known settings fields out of a request body. */
function configPatch(body: Record<string, unknown>): ServerConfig {
  const patch: ServerConfig = {}
  const target = patch as Record<string, unknown>
  for (const key of [
    'provider',
    'model',
    'embedProvider',
    'embedModel',
    'vault',
    'folder',
    'apiKey',
    'embedApiKey',
  ] as const) {
    const value = body[key]
    if (typeof value === 'string') target[key] = value.trim()
  }
  const similarity = body.embedSimilarity
  if (similarity === null) {
    target.embedSimilarity = null
  } else if (typeof similarity === 'number') {
    target.embedSimilarity = similarity
  } else if (typeof similarity === 'string' && similarity.trim() !== '') {
    const parsed = Number(similarity)
    if (Number.isFinite(parsed)) target.embedSimilarity = parsed
  }
  return patch
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The sync API.
 *
 *   GET  /api/health
 *   GET  /api/devices
 *   GET  /api/logs/:deviceId?offset=N     -> JSONL bytes past N
 *   PUT  /api/logs/:deviceId              -> append JSONL (device's own log only)
 *   HEAD /api/blobs/:hash                 -> existence
 *   GET  /api/blobs/:hash
 *   PUT  /api/blobs/:hash                 -> content-addressed, hash verified
 */
/** Reads and writes the saved settings, rebuilding the runtime on change. */
export interface SettingsBridge {
  read: () => Promise<{ config: ServerConfig; runtime: Runtime }>
  update: (
    patch: ServerConfig,
  ) => Promise<{ config: ServerConfig; runtime: Runtime; problems: ConfigProblem[] }>
}

export interface HandlerOptions {
  llm?: LLMProvider
  /** Serves embeddings when set; otherwise the main provider is asked. */
  embed?: LLMProvider
  model?: ModelStatus
  vault?: VaultConfig
  /**
   * Read on every request, so the settings screen can change the model and vault
   * without restarting the server. A getter rather than an object, because
   * replacing the object would leave the handler holding the stale one.
   */
  runtime?: () => Runtime
  settings?: SettingsBridge
  /** Directory of the built PWA. When set, the server serves the app itself. */
  staticDir?: string
}

export function createHandler(
  store: Store,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const { llm, embed, model: status, vault } = options
  return async function handle(request: Request): Promise<Response> {
    // Re-read on every request when a runtime was supplied, so settings changes
    // take effect immediately.
    const live = options.runtime?.() ?? { llm, embed, status, vault }
    const url = new URL(request.url)
    const path = url.pathname.startsWith('/api') ? url.pathname.slice(4) : url.pathname
    const parts = path.split('/').filter((part) => part.length > 0)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors(new Headers()) })
    }

    // Anything that is not the API is the app itself, when it has been built.
    if (!url.pathname.startsWith('/api')) {
      if (options.staticDir) {
        const file = await serveStatic(options.staticDir, url.pathname)
        if (file) return file
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        return notBuiltPage()
      }
    }

    if (parts.length === 1 && parts[0] === 'health') {
      return json({ ok: true, service: 'inkling', time: new Date().toISOString() })
    }

    if (parts.length === 1 && parts[0] === 'devices') {
      return json({ devices: await store.devices() })
    }

    if (parts.length === 1 && parts[0] === 'digests') {
      return json({ digests: await store.digests() })
    }

    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'health') {
      const configured = live.status?.configured ?? (live.llm ? await live.llm.available() : false)
      return json({
        configured,
        provider: live.status?.provider ?? (configured ? live.llm?.name : null) ?? null,
        providerName: live.status?.providerName ?? null,
        model: live.status?.model ?? null,
        embedModel: live.status?.embedModel ?? null,
        embedProvider: live.status?.embedProvider ?? null,
        embedProviderName: live.status?.embedProviderName ?? null,
        embedSimilarity: live.status?.embedSimilarity ?? null,
        embeddings: live.status?.embeddings ?? false,
        keySource: live.status?.keySource ?? null,
        note: live.status?.note ?? null,
      })
    }

    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'providers') {
      return json({ providers: providerList() })
    }

    // What the provider says it can serve, so the model field can offer a list.
    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'models') {
      const kind = url.searchParams.get('kind') === 'embed' ? 'embed' : 'chat'
      const provider = kind === 'embed' ? (live.embed ?? live.llm) : live.llm
      if (!provider) return json({ error: 'no model configured' }, 503)
      if (!provider.listModels) return json({ error: 'this provider cannot list models' }, 501)
      try {
        return json({ models: await provider.listModels() })
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'could not list models' },
          502,
        )
      }
    }

    // One real round trip, so "does this actually work?" has an answer.
    if (
      parts.length === 2 &&
      parts[0] === 'llm' &&
      parts[1] === 'test' &&
      request.method === 'POST'
    ) {
      const body = await readJson(request)
      const kind = body?.kind === 'embed' ? 'embed' : 'chat'
      const provider = kind === 'embed' ? (live.embed ?? live.llm) : live.llm
      if (!provider || !(await provider.available())) {
        return json({ ok: false, error: 'no model configured for this' })
      }

      const started = Date.now()
      try {
        if (kind === 'embed') {
          const vectors = await provider.embed(['a short test'])
          return json({
            ok: true,
            ms: Date.now() - started,
            detail: `${vectors[0]?.length ?? 0}-dimension vector`,
          })
        }
        const text = await provider.completeStructured({
          system: 'You reply with JSON only.',
          prompt: 'Reply with exactly {"ok":true}',
        })
        return json({ ok: true, ms: Date.now() - started, detail: text.slice(0, 200) })
      } catch (error) {
        return json({
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : 'the model call failed',
        })
      }
    }

    if (parts.length === 2 && parts[0] === 'digests') {
      const deviceId = parts[1]
      if (!deviceId || !isSafeDeviceId(deviceId)) return json({ error: 'invalid device id' }, 400)
      if (request.method === 'PUT') {
        const digest = (await request.text()).trim()
        if (!/^[a-f0-9]{64}$/.test(digest)) return json({ error: 'invalid digest' }, 400)
        await store.putDigest(deviceId, digest)
        return json({ ok: true })
      }
      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'obsidian' && parts[1] === 'status') {
      if (!live.vault) return json({ error: 'no vault configured' }, 503)
      return json(await vaultStatus(live.vault))
    }

    if (parts.length === 2 && parts[0] === 'obsidian' && parts[1] === 'note') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
      const vault = live.vault
      if (!vault) return json({ error: 'no vault configured' }, 503)

      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
      const explicitPath = typeof body.path === 'string' ? body.path.trim() : ''
      const markdown = typeof body.markdown === 'string' ? body.markdown : ''

      if (!markdown) return json({ error: 'markdown is required' }, 400)
      if (filename && filename.includes('/')) {
        return json({ error: 'filename must not contain a path separator' }, 400)
      }

      // An explicit path means "this blip's own note", so it is written back to.
      // Otherwise the folder is applied here — the client never has to know where
      // notes live — and a title becomes a filename.
      const inFolder = (name: string) => (vault.folder ? `${vault.folder}/${name}` : name)
      const relativePath = explicitPath || inFolder(filename || noteFilename(title || 'Untitled'))

      if (!resolveNotePath(vault.vault, relativePath)) {
        return json({ error: 'note path escapes the vault, or is not a .md file' }, 400)
      }

      try {
        const result = await writeNote(vault.vault, relativePath, markdown, {
          replace: Boolean(explicitPath),
        })
        return json({ ok: true, path: result.path, created: result.created })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'write failed'
        return json({ error: message }, 502)
      }
    }

    if (parts.length === 1 && parts[0] === 'config') {
      const bridge = options.settings
      if (!bridge) return json({ error: 'settings are not available on this server' }, 503)

      if (request.method === 'GET') {
        const { config, runtime } = await bridge.read()
        return json({ config: publicConfig(config, runtime), providers: providerList() })
      }

      if (request.method === 'PUT') {
        const body = await readJson(request)
        if (!body) return json({ error: 'invalid json body' }, 400)

        const patch = configPatch(body)
        const problems = validateConfig(patch)
        if (problems.length > 0) {
          return json({ error: 'invalid settings', problems }, 400)
        }

        const { config, runtime } = await bridge.update(patch)
        return json({ config: publicConfig(config, runtime), providers: providerList() })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'llm' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)

      if (parts[1] === 'complete') {
        const system = typeof body.system === 'string' ? body.system : ''
        const prompt = typeof body.prompt === 'string' ? body.prompt : ''
        if (!prompt.trim()) return json({ error: 'prompt is required' }, 400)
        if (!live.llm || !(await live.llm.available())) {
          return json({ error: 'no language model configured' }, 503)
        }
        try {
          return json({ text: await live.llm.completeStructured({ system, prompt }) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'completion failed' }, 502)
        }
      }

      if (parts[1] === 'embed') {
        const texts = Array.isArray(body.texts)
          ? body.texts.filter((entry): entry is string => typeof entry === 'string').slice(0, 64)
          : []
        if (texts.length === 0) return json({ error: 'texts is required' }, 400)
        const embedder = live.embed ?? live.llm
        if (!embedder || !(await embedder.available())) {
          return json({ error: 'no embedding model configured' }, 503)
        }
        try {
          return json({ vectors: await embedder.embed(texts) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'embedding failed' }, 502)
        }
      }

      return json({ error: 'not found' }, 404)
    }

    if (parts.length === 1 && parts[0] === 'fetch' && request.method === 'POST') {
      const body = await readJson(request)
      const url = body && typeof body.url === 'string' ? body.url : ''
      if (!url) return json({ error: 'url is required' }, 400)
      if (!isFetchableUrl(url)) return json({ error: 'url is not fetchable' }, 400)
      try {
        return json(await fetchPage(url))
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'fetch failed' }, 502)
      }
    }

    if (parts.length === 2 && parts[0] === 'logs') {
      const deviceId = parts[1]
      if (!deviceId || !isSafeDeviceId(deviceId)) return json({ error: 'invalid device id' }, 400)

      if (request.method === 'GET') {
        const raw = url.searchParams.get('offset') ?? '0'
        const offset = Number(raw)
        if (!Number.isFinite(offset) || offset < 0) return json({ error: 'invalid offset' }, 400)
        const size = await store.logSize(deviceId)
        const bytes = offset >= size ? new Uint8Array(0) : await store.readLog(deviceId, offset)
        return new Response(toBody(bytes), {
          status: 200,
          headers: withCors(
            new Headers({
              'content-type': 'text/plain; charset=utf-8',
              'x-log-size': String(size),
            }),
          ),
        })
      }

      if (request.method === 'PUT') {
        const text = await request.text()
        let events: ReturnType<typeof parseLog>
        try {
          events = parseLog(text)
        } catch {
          return json({ error: 'malformed JSONL' }, 400)
        }
        // A device may only write its own log. This is what makes two writers
        // conflict-free rather than merely unlikely.
        if (events.some((event) => event.deviceId !== deviceId)) {
          return json({ error: 'event deviceId does not match the log being written' }, 400)
        }
        if (events.length === 0) {
          return json({ size: await store.logSize(deviceId), appended: 0 })
        }
        // Refuse a partial line rather than silently repairing it: a half-line
        // appended to a log would corrupt that device's history permanently.
        if (!text.endsWith('\n')) {
          return json({ error: 'payload must end at a line boundary' }, 400)
        }
        const size = await store.appendLog(deviceId, encoder.encode(text))
        return json({ size, appended: events.length })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'blobs') {
      const hash = parts[1]
      if (!hash || !isSafeHash(hash)) return json({ error: 'invalid hash' }, 400)

      if (request.method === 'HEAD') {
        const exists = await store.hasBlob(hash)
        return new Response(null, { status: exists ? 200 : 404, headers: withCors(new Headers()) })
      }

      if (request.method === 'GET') {
        const bytes = await store.getBlob(hash)
        if (!bytes) return json({ error: 'not found' }, 404)
        return new Response(toBody(bytes), {
          status: 200,
          headers: withCors(new Headers({ 'content-type': 'application/octet-stream' })),
        })
      }

      if (request.method === 'PUT') {
        const bytes = new Uint8Array(await request.arrayBuffer())
        if ((await sha256Hex(bytes)) !== hash) return json({ error: 'hash mismatch' }, 400)
        await store.putBlob(hash, bytes)
        return json({ ok: true, size: bytes.length })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    return json({ error: 'not found' }, 404)
  }
}
