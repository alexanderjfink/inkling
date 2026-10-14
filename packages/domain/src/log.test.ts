import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, BlipType } from '../src/index'
import {
  devicesIn,
  eventKey,
  mergeEvents,
  parseLog,
  project,
  serializeLog,
  serializeLogBytes,
} from '../src/index'

function ev(body: BlipEventBody, seq: number, at: string, deviceId: string): BlipEvent {
  return { ...body, deviceId, seq, at }
}

function capture(
  id: string,
  text: string,
  seq: number,
  at: string,
  deviceId: string,
  type: BlipType = 'idea',
) {
  return ev({ t: 'captured', id, input: { kind: 'text', text }, type }, seq, at, deviceId)
}

describe('log serialization', () => {
  test('round-trips through JSONL', () => {
    const events = [
      capture('a', 'first', 0, '2026-01-01T00:00:00Z', 'phone'),
      capture('b', 'second', 1, '2026-01-01T00:00:01Z', 'phone'),
    ]
    const text = serializeLog(events, 'phone')
    expect(text.endsWith('\n')).toBe(true)
    expect(parseLog(text)).toEqual(events)
  })

  test('only serializes the named device, ordered by seq', () => {
    const events = [
      capture('b', 'second', 1, '2026-01-01T00:00:01Z', 'phone'),
      capture('a', 'first', 0, '2026-01-01T00:00:00Z', 'phone'),
      capture('x', 'other device', 0, '2026-01-01T00:00:02Z', 'laptop'),
    ]
    const parsed = parseLog(serializeLog(events, 'phone'))
    expect(parsed.map((e) => e.id)).toEqual(['a', 'b'])
  })

  test('appending never changes earlier bytes, so offsets stay valid', () => {
    const base = [
      capture('a', 'first', 0, '2026-01-01T00:00:00Z', 'phone'),
      capture('b', 'second', 1, '2026-01-01T00:00:01Z', 'phone'),
    ]
    const before = serializeLog(base, 'phone')
    const after = serializeLog(
      [...base, capture('c', 'third', 2, '2026-01-01T00:00:02Z', 'phone')],
      'phone',
    )
    expect(after.startsWith(before)).toBe(true)
    expect(after.length).toBeGreaterThan(before.length)
  })

  test('an empty log serializes to nothing', () => {
    expect(serializeLog([], 'phone')).toBe('')
  })

  test('byte length differs from string length, so offsets must be bytes', () => {
    const events = [
      capture('a', 'an em dash — and an emoji 🧠', 0, '2026-01-01T00:00:00Z', 'phone'),
    ]
    const text = serializeLog(events, 'phone')
    const bytes = serializeLogBytes(events, 'phone')
    expect(bytes.length).toBe(new TextEncoder().encode(text).length)
    expect(bytes.length).toBeGreaterThan(text.length)
  })

  test('slicing bytes at a recorded byte length yields whole lines', () => {
    const one = [capture('a', 'dash — here', 0, '2026-01-01T00:00:00Z', 'phone')]
    const two = [...one, capture('b', 'second', 1, '2026-01-01T00:00:01Z', 'phone')]

    const firstBytes = serializeLogBytes(one, 'phone')
    const bothBytes = serializeLogBytes(two, 'phone')
    const tail = new TextDecoder().decode(bothBytes.slice(firstBytes.length))

    expect(parseLog(tail).map((e) => e.id)).toEqual(['b'])
  })

  test('parseLog tolerates blank lines but rejects junk', () => {
    expect(parseLog('\n\n')).toEqual([])
    expect(() => parseLog('{"not":"an event"}')).toThrow()
  })
})

describe('merge', () => {
  test('is idempotent: re-ingesting the same events adds nothing', () => {
    const local = [capture('a', 'first', 0, '2026-01-01T00:00:00Z', 'phone')]
    const incoming = [
      capture('a', 'first', 0, '2026-01-01T00:00:00Z', 'phone'),
      capture('b', 'second', 1, '2026-01-01T00:00:01Z', 'phone'),
    ]
    const first = mergeEvents(local, incoming)
    expect(first.added.map((e) => e.id)).toEqual(['b'])
    expect(first.skipped).toBe(1)

    const second = mergeEvents([...local, ...first.added], incoming)
    expect(second.added).toEqual([])
    expect(second.skipped).toBe(2)
  })

  test('two devices with identical seq numbers do not collide', () => {
    const a = capture('a', 'from phone', 0, '2026-01-01T00:00:00Z', 'phone')
    const b = capture('b', 'from laptop', 0, '2026-01-01T00:00:00Z', 'laptop')
    expect(eventKey(a)).not.toBe(eventKey(b))
    const merged = mergeEvents([a], [b])
    expect(merged.added).toHaveLength(1)
  })

  test('both devices converge to the same state, in either order', () => {
    const phone = [
      capture('a', 'question from phone?', 0, '2026-01-01T00:00:00Z', 'phone'),
      ev({ t: 'promoteToDesktop', id: 'a' }, 1, '2026-01-01T00:00:05Z', 'phone'),
    ]
    const laptop = [
      capture('b', 'idea from laptop', 0, '2026-01-01T00:00:02Z', 'laptop'),
      ev({ t: 'retired', id: 'b' }, 1, '2026-01-01T00:00:03Z', 'laptop'),
    ]

    const onPhone = [...phone, ...mergeEvents(phone, laptop).added]
    const onLaptop = [...laptop, ...mergeEvents(laptop, phone).added]

    expect(JSON.stringify(project(onPhone))).toBe(JSON.stringify(project(onLaptop)))

    const blips = project(onPhone)
    expect(blips.find((b) => b.id === 'a')?.desktopPinned).toBe(true)
    expect(blips.find((b) => b.id === 'b')?.status).toBe('retired')
  })

  test('devicesIn reports who contributed what', () => {
    const events = [
      capture('a', 'one', 0, '2026-01-01T00:00:00Z', 'phone'),
      capture('b', 'two', 1, '2026-01-01T00:00:01Z', 'phone'),
      capture('c', 'three', 0, '2026-01-01T00:00:02Z', 'laptop'),
    ]
    expect(devicesIn(events)).toEqual([
      { deviceId: 'laptop', count: 1 },
      { deviceId: 'phone', count: 2 },
    ])
  })
})
