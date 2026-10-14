import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, BlipType } from '../src/index'
import { buildDailyFeed, isDue, newId, project, scoreBlip, snoozeUntil } from '../src/index'

const DEVICE = 'deviceA'
const NOW = new Date('2026-03-01T12:00:00Z')

function ev(body: BlipEventBody, seq: number, at: string): BlipEvent {
  return { ...body, deviceId: DEVICE, seq, at }
}

/** Project exactly one blip, failing loudly if the fold produced none. */
function only(events: BlipEvent[]): Blip {
  const [blip] = project(events)
  if (!blip) throw new Error('expected exactly one blip')
  return blip
}

function blipFrom(text: string, at: string, type: BlipType = 'idea', topics: string[] = []) {
  const id = newId()
  const events: BlipEvent[] = [
    ev({ t: 'captured', id, input: { kind: 'text', text }, type, topics }, 0, at),
  ]
  return { id, events }
}

describe('scheduler', () => {
  test('a freshly captured blip is due and resurfaceable', () => {
    const { events } = blipFrom('new', '2026-02-28T12:00:00Z')
    expect(isDue(only(events), NOW)).toBe(true)
  })

  test('a blip snoozed into the future is not due; a matching trigger overrides', () => {
    const { id, events } = blipFrom('snoozy', '2026-02-01T12:00:00Z')
    const blip = only([
      ...events,
      ev(
        { t: 'snoozed', id, until: '2026-06-01T00:00:00Z', triggers: ['timeful texts'] },
        1,
        '2026-02-02T00:00:00Z',
      ),
    ])
    expect(isDue(blip, NOW)).toBe(false)
    expect(isDue(blip, NOW, ['timeful texts'])).toBe(true)
  })

  test('retired blips never surface', () => {
    const { id, events } = blipFrom('done', '2026-01-01T00:00:00Z')
    const blip = only([...events, ev({ t: 'retired', id }, 1, '2026-01-02T00:00:00Z')])
    expect(isDue(blip, NOW)).toBe(false)
    expect(buildDailyFeed([blip], { now: NOW })).toHaveLength(0)
  })

  test('the feed is finite and never exceeds its size', () => {
    const blips = Array.from({ length: 20 }, (_, i) =>
      only(blipFrom(`blip ${i}`, '2026-02-01T12:00:00Z').events),
    )
    const feed = buildDailyFeed(blips, { now: NOW, size: 6 })
    expect(feed.length).toBe(6)
  })

  test('no overdue term: an untouched old blip is stale, not late', () => {
    const ancient = only(blipFrom('ancient', '2020-01-01T00:00:00Z').events)
    const recent = only(blipFrom('recent', '2026-02-28T00:00:00Z').events)
    expect(scoreBlip(ancient, { now: NOW })).toBeGreaterThan(scoreBlip(recent, { now: NOW }))
  })

  test('topic context raises a blip score', () => {
    const blip = only(
      blipFrom('about timeful texts', '2026-02-01T00:00:00Z', 'idea', ['timeful texts']).events,
    )
    const without = scoreBlip(blip, { now: NOW })
    const withContext = scoreBlip(blip, { now: NOW, todayTopics: ['timeful texts'] })
    expect(withContext).toBeGreaterThan(without)
  })

  test('engagement stretches the interval, skips shorten it', () => {
    const engaged0 = Date.parse(snoozeUntil('engaged', NOW, 0))
    const engaged3 = Date.parse(snoozeUntil('engaged', NOW, 3))
    const skipped3 = Date.parse(snoozeUntil('skipped', NOW, 3))
    expect(engaged3).toBeGreaterThan(engaged0)
    expect(skipped3).toBeLessThan(engaged0)
  })
})
