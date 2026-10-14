import { type LLMProvider, parseLog, sha256Hex } from '@inkling/domain'
import { fetchPage, isFetchableUrl } from './fetchPage'
import type { ModelStatus } from './provider'
import { PRESETS } from './providerConfig'
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
export interface HandlerOptions {
  llm?: LLMProvider
  /** Serves embeddings when set; otherwise the main provider is asked. */
  embed?: LLMProvider
  model?: ModelStatus
  vault?: VaultConfig
}

export function createHandler(
  store: Store,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const { llm, embed, model: status, vault } = options
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.startsWith('/api') ? url.pathname.slice(4) : url.pathname
    const parts = path.split('/').filter((part) => part.length > 0)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors(new Headers()) })
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
      const configured = status?.configured ?? (llm ? await llm.available() : false)
      return json({
        configured,
        provider: status?.provider ?? (configured ? llm?.name : null) ?? null,
        providerName: status?.providerName ?? null,
        model: status?.model ?? null,
        embedModel: status?.embedModel ?? null,
        embedProvider: status?.embedProvider ?? null,
        embedProviderName: status?.embedProviderName ?? null,
        embedSimilarity: status?.embedSimilarity ?? null,
        embeddings: status?.embeddings ?? false,
        keySource: status?.keySource ?? null,
        note: status?.note ?? null,
      })
    }

    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'providers') {
      return json({
        providers: PRESETS.map((preset) => ({
          id: preset.id,
          name: preset.name,
          kind: preset.kind,
          keyEnv: preset.keyEnv,
          defaultModel: preset.defaultModel,
          keyOptional: Boolean(preset.keyOptional),
          noEmbeddings: Boolean(preset.noEmbeddings),
          note: preset.note ?? null,
        })),
      })
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
      if (!vault) return json({ error: 'no vault configured' }, 503)
      return json(await vaultStatus(vault))
    }

    if (parts.length === 2 && parts[0] === 'obsidian' && parts[1] === 'note') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
      if (!vault) return json({ error: 'no vault configured' }, 503)

      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)
      const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
      const explicitPath = typeof body.path === 'string' ? body.path.trim() : ''
      const markdown = typeof body.markdown === 'string' ? body.markdown : ''

      // A bare filename is prefixed with the configured folder here, so the client
      // never has to know where notes live.
      if (filename && filename.includes('/')) {
        return json({ error: 'filename must not contain a path separator' }, 400)
      }
      const relativePath = filename
        ? vault.folder
          ? `${vault.folder}/${filename}`
          : filename
        : explicitPath

      if (!relativePath || !markdown) {
        return json({ error: 'filename and markdown are required' }, 400)
      }
      if (!resolveNotePath(vault.vault, relativePath)) {
        return json({ error: 'note path escapes the vault, or is not a .md file' }, 400)
      }

      try {
        const result = await writeNote(vault.vault, relativePath, markdown)
        return json({ ok: true, path: result.path, created: result.created })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'write failed'
        return json({ error: message }, 502)
      }
    }

    if (parts.length === 2 && parts[0] === 'llm' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)

      if (parts[1] === 'complete') {
        const system = typeof body.system === 'string' ? body.system : ''
        const prompt = typeof body.prompt === 'string' ? body.prompt : ''
        if (!prompt.trim()) return json({ error: 'prompt is required' }, 400)
        if (!llm || !(await llm.available())) {
          return json({ error: 'no language model configured' }, 503)
        }
        try {
          return json({ text: await llm.completeStructured({ system, prompt }) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'completion failed' }, 502)
        }
      }

      if (parts[1] === 'embed') {
        const texts = Array.isArray(body.texts)
          ? body.texts.filter((entry): entry is string => typeof entry === 'string').slice(0, 64)
          : []
        if (texts.length === 0) return json({ error: 'texts is required' }, 400)
        const embedder = embed ?? llm
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
