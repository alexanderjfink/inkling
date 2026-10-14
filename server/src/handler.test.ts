import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BlipEvent, BlipEventBody } from '@inkling/domain'
import { parseLog, serializeLog, sha256Hex } from '@inkling/domain'
import { createHandler } from './handler'
import { FileStore } from './store'

const BASE = 'http://localhost/api'

let dir: string
let handle: (request: Request) => Promise<Response>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkling-'))
  handle = createHandler(new FileStore(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ev(body: BlipEventBody, seq: number, at: string, deviceId: string): BlipEvent {
  return { ...body, deviceId, seq, at }
}

function captured(id: string, text: string, seq: number, deviceId: string): BlipEvent {
  return ev(
    { t: 'captured', id, input: { kind: 'text', text }, type: 'idea' },
    seq,
    `2026-01-01T00:00:0${seq}Z`,
    deviceId,
  )
}

describe('sync API', () => {
  test('health', async () => {
    const res = await handle(new Request(`${BASE}/health`))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  test('a device pushes its log and another can pull it whole', async () => {
    const log = serializeLog([captured('a', 'from the phone', 0, 'phone')], 'phone')
    const put = await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: log }))
    expect(put.status).toBe(200)
    expect((await put.json()).appended).toBe(1)

    const get = await handle(new Request(`${BASE}/logs/phone`))
    expect(parseLog(await get.text())).toEqual(parseLog(log))
  })

  test('pulling with an offset returns only the tail', async () => {
    const first = serializeLog([captured('a', 'one', 0, 'phone')], 'phone')
    await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: first }))

    const second = serializeLog(
      [captured('a', 'one', 0, 'phone'), captured('b', 'two', 1, 'phone')],
      'phone',
    )
    const tail = second.slice(first.length)
    await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: tail }))

    const res = await handle(new Request(`${BASE}/logs/phone?offset=${first.length}`))
    const body = await res.text()
    expect(parseLog(body).map((e) => e.id)).toEqual(['b'])
    expect(res.headers.get('x-log-size')).toBe(String(second.length))
  })

  test('appends accumulate rather than replace', async () => {
    const first = serializeLog([captured('a', 'one', 0, 'phone')], 'phone')
    const both = serializeLog(
      [captured('a', 'one', 0, 'phone'), captured('b', 'two', 1, 'phone')],
      'phone',
    )

    await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: first }))
    await handle(
      new Request(`${BASE}/logs/phone`, { method: 'PUT', body: both.slice(first.length) }),
    )

    const all = parseLog(await (await handle(new Request(`${BASE}/logs/phone`))).text())
    expect(all.map((e) => e.id)).toEqual(['a', 'b'])
  })

  test('a device cannot write into another device log', async () => {
    const smuggled = serializeLog([captured('a', 'mine', 0, 'laptop')], 'laptop')
    const res = await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: smuggled }))
    expect(res.status).toBe(400)
  })

  test('malformed JSONL is rejected', async () => {
    const res = await handle(
      new Request(`${BASE}/logs/phone`, { method: 'PUT', body: '{"nope":true}' }),
    )
    expect(res.status).toBe(400)
  })

  test('rejects a payload that does not end at a line boundary', async () => {
    const log = serializeLog([captured('a', 'one', 0, 'phone')], 'phone')
    const res = await handle(
      new Request(`${BASE}/logs/phone`, { method: 'PUT', body: log.replace(/\n$/, '') }),
    )
    expect(res.status).toBe(400)
  })

  test('offsets are byte offsets, so multibyte content stays line-aligned', async () => {
    const text = 'an em dash — and an emoji 🧠'
    const one = serializeLog([captured('a', text, 0, 'phone')], 'phone')

    const { size } = await (
      await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: one }))
    ).json()

    // The server reports UTF-8 byte length, which exceeds the string length.
    expect(size).toBe(new TextEncoder().encode(one).length)
    expect(size).toBeGreaterThan(one.length)

    const both = serializeLog(
      [captured('a', text, 0, 'phone'), captured('b', 'second', 1, 'phone')],
      'phone',
    )
    const tail = new TextDecoder().decode(new TextEncoder().encode(both).slice(size))
    await handle(new Request(`${BASE}/logs/phone`, { method: 'PUT', body: tail }))

    const res = await handle(new Request(`${BASE}/logs/phone?offset=${size}`))
    expect(parseLog(await res.text()).map((e) => e.id)).toEqual(['b'])
  })

  test('an unknown log reads as empty, not as an error', async () => {
    const res = await handle(new Request(`${BASE}/logs/nobody`))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(res.headers.get('x-log-size')).toBe('0')
  })

  test('device ids are validated', async () => {
    // An encoded traversal reaches the route and is rejected by the id pattern.
    expect((await handle(new Request(`${BASE}/logs/..%2Fetc`))).status).toBe(400)
    // A plain traversal never reaches the route: URL parsing normalizes it away.
    expect((await handle(new Request(`${BASE}/logs/../etc`))).status).toBe(404)
    expect((await handle(new Request(`${BASE}/logs/ab`))).status).toBe(400)
  })

  test('devices lists every log with its size', async () => {
    await handle(
      new Request(`${BASE}/logs/phone`, {
        method: 'PUT',
        body: serializeLog([captured('a', 'x', 0, 'phone')], 'phone'),
      }),
    )
    await handle(
      new Request(`${BASE}/logs/laptop`, {
        method: 'PUT',
        body: serializeLog([captured('b', 'y', 0, 'laptop')], 'laptop'),
      }),
    )

    const devices = (await (await handle(new Request(`${BASE}/devices`))).json()).devices
    expect(devices.map((d: { deviceId: string }) => d.deviceId)).toEqual(['laptop', 'phone'])
    expect(devices.every((d: { size: number }) => d.size > 0)).toBe(true)
  })
})

describe('digest API', () => {
  const digest = 'a'.repeat(64)

  test('publishes and lists state digests per device', async () => {
    const before = await (await handle(new Request(`${BASE}/digests`))).json()
    expect(before.digests).toEqual([])

    const put = await handle(new Request(`${BASE}/digests/phone`, { method: 'PUT', body: digest }))
    expect(put.status).toBe(200)

    const after = await (await handle(new Request(`${BASE}/digests`))).json()
    expect(after.digests).toEqual([{ deviceId: 'phone', digest }])
  })

  test('rejects a digest that is not a sha256 hex string', async () => {
    const res = await handle(new Request(`${BASE}/digests/phone`, { method: 'PUT', body: 'nope' }))
    expect(res.status).toBe(400)
  })
})

describe('blob API', () => {
  const bytes = new TextEncoder().encode('pretend this is a photo')

  test('round-trips a blob, with existence checks before and after', async () => {
    const hash = await sha256Hex(bytes)

    const before = await handle(new Request(`${BASE}/blobs/${hash}`, { method: 'HEAD' }))
    expect(before.status).toBe(404)

    const put = await handle(new Request(`${BASE}/blobs/${hash}`, { method: 'PUT', body: bytes }))
    expect(put.status).toBe(200)

    const after = await handle(new Request(`${BASE}/blobs/${hash}`, { method: 'HEAD' }))
    expect(after.status).toBe(200)

    const got = new Uint8Array(
      await (await handle(new Request(`${BASE}/blobs/${hash}`))).arrayBuffer(),
    )
    expect(got).toEqual(bytes)
  })

  test('rejects a blob whose bytes do not match its hash', async () => {
    const wrong = 'a'.repeat(64)
    const res = await handle(new Request(`${BASE}/blobs/${wrong}`, { method: 'PUT', body: bytes }))
    expect(res.status).toBe(400)
  })

  test('rejects a malformed hash without touching the disk', async () => {
    expect((await handle(new Request(`${BASE}/blobs/not-a-hash`))).status).toBe(400)
  })
})
