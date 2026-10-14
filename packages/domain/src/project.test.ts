import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, BlipType } from '../src/index'
import { liveBlips, newId, project } from '../src/index'

const DEVICE = 'deviceA'

function ev(body: BlipEventBody, seq: number, at: string, deviceId = DEVICE): BlipEvent {
  return { ...body, deviceId, seq, at }
}

function captured(id: string, text: string, seq: number, at: string, type: BlipType = 'idea') {
  return ev({ t: 'captured', id, input: { kind: 'text', text }, type }, seq, at)
}

describe('project (fold)', () => {
  test('a captured event creates a blip with a derived title', () => {
    const id = newId()
    const blips = project([
      captured(id, 'Look into stages of change theory', 0, '2026-01-01T00:00:00Z'),
    ])
    expect(blips).toHaveLength(1)
    const blip = blips[0]
    expect(blip?.id).toBe(id)
    expect(blip?.title).toBe('Look into stages of change theory')
    expect(blip?.status).toBe('active')
    expect(blip?.schedule.heat).toBeGreaterThan(0)
  })

  test('entries accumulate and raise heat, and the feed records engagement', () => {
    const id = newId()
    const blips = project([
      captured(id, 'What are my principles?', 0, '2026-01-01T00:00:00Z', 'question'),
      ev(
        {
          t: 'entry',
          id,
          entry: { id: 'e1', kind: 'note', text: 'first thought', at: '2026-01-02T00:00:00Z' },
        },
        1,
        '2026-01-02T00:00:00Z',
      ),
      ev(
        {
          t: 'entry',
          id,
          entry: { id: 'e2', kind: 'utterance', text: 'ramble', at: '2026-01-03T00:00:00Z' },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
    ])
    const blip = blips[0]
    expect(blip?.entries).toHaveLength(2)
    expect(blip?.schedule.heat).toBeGreaterThan(0.4)
    expect(blip?.schedule.timesEngaged).toBe(2)
    expect(blip?.schedule.lastTouched).toBe('2026-01-03T00:00:00Z')
  })

  test('snooze, retire and revive move the blip through its lifecycle', () => {
    const id = newId()
    const base = captured(id, 'try drawabox.com', 0, '2026-01-01T00:00:00Z', 'quest')

    const snoozed = project([
      base,
      ev({ t: 'snoozed', id, until: '2026-02-01T00:00:00Z' }, 1, '2026-01-02T00:00:00Z'),
    ])
    expect(snoozed[0]?.status).toBe('snoozed')
    expect(snoozed[0]?.schedule.nextEarliest).toBe('2026-02-01T00:00:00Z')

    const retired = project([base, ev({ t: 'retired', id }, 1, '2026-01-02T00:00:00Z')])
    expect(retired[0]?.status).toBe('retired')

    const revived = project([
      base,
      ev({ t: 'retired', id }, 1, '2026-01-02T00:00:00Z'),
      ev({ t: 'revived', id }, 2, '2026-01-03T00:00:00Z'),
    ])
    expect(revived[0]?.status).toBe('active')
    expect(revived[0]?.schedule.nextEarliest).toBeUndefined()
  })

  test('fold is order-independent, so two devices converge', () => {
    const a = newId()
    const b = newId()
    const events: BlipEvent[] = [
      captured(a, 'idea A', 0, '2026-01-01T00:00:00Z'),
      captured(b, 'idea B', 0, '2026-01-01T00:00:01Z', 'insight'),
      ev({ t: 'linked', id: a, otherId: b, reason: 'related' }, 1, '2026-01-01T00:00:02Z'),
      ev(
        {
          t: 'entry',
          id: b,
          entry: { id: 'x', kind: 'note', text: 'n', at: '2026-01-01T00:00:03Z' },
        },
        1,
        '2026-01-01T00:00:03Z',
      ),
    ]

    const forward = project(events)
    const shuffled = project([...events].reverse())
    const [e0, e1, e2, e3] = events
    if (!e0 || !e1 || !e2 || !e3) throw new Error('expected four events')
    const interleaved = project([e2, e0, e3, e1])

    expect(JSON.stringify(forward)).toBe(JSON.stringify(shuffled))
    expect(JSON.stringify(forward)).toBe(JSON.stringify(interleaved))
  })

  test('links become symmetric even when the target is created later', () => {
    const a = newId()
    const b = newId()
    const blips = project([
      captured(a, 'A', 0, '2026-01-01T00:00:00Z'),
      ev({ t: 'linked', id: a, otherId: b }, 1, '2026-01-01T00:00:01Z'),
      captured(b, 'B', 0, '2026-01-01T00:00:02Z'),
    ])
    const byId = new Map(blips.map((x) => [x.id, x]))
    expect(byId.get(a)?.links).toContain(b)
    expect(byId.get(b)?.links).toContain(a)
  })

  test('deleted is a tombstone, not a removal', () => {
    const id = newId()
    const blips = project([
      captured(id, 'gone soon', 0, '2026-01-01T00:00:00Z'),
      ev({ t: 'deleted', id }, 1, '2026-01-02T00:00:00Z'),
    ])
    expect(blips).toHaveLength(1)
    expect(blips[0]?.deleted).toBe(true)
    expect(liveBlips(blips)).toHaveLength(0)
  })

  test('promoteToDesktop pins a blip for the desktop handoff', () => {
    const id = newId()
    const blips = project([
      captured(id, 'carry me to the mac', 0, '2026-01-01T00:00:00Z'),
      ev({ t: 'promoteToDesktop', id }, 1, '2026-01-02T00:00:00Z'),
    ])
    expect(blips[0]?.desktopPinned).toBe(true)
  })
})
