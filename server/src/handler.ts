import { parseLog, sha256Hex } from '@inkling/domain'
import { type Store, isSafeDeviceId, isSafeHash } from './store'

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
export function createHandler(store: Store): (request: Request) => Promise<Response> {
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
