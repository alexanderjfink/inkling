import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, BlipType } from '../src/index'
import {
  buildDailyFeed,
  buildNearFeed,
  buildRound,
  deferUntil,
  isDue,
  newId,
  project,
  rankBlips,
  roundQueue,
  scoreBlip,
  snoozeUntil,
} from '../src/index'

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

  test('a matching auto-extracted topic also overrides a snooze', () => {
    const { id, events } = blipFrom('about change theory', '2026-02-01T12:00:00Z', 'idea', [
      'change',
    ])
    const blip = only([
      ...events,
      ev({ t: 'snoozed', id, until: '2026-06-01T00:00:00Z' }, 1, '2026-02-02T00:00:00Z'),
    ])
    expect(isDue(blip, NOW)).toBe(false)
    expect(isDue(blip, NOW, ['change'])).toBe(true)
    expect(isDue(blip, NOW, ['something-else'])).toBe(false)
  })

  test('a topic match does not resurrect a retired blip', () => {
    const { id, events } = blipFrom('about change theory', '2026-02-01T12:00:00Z', 'idea', [
      'change',
    ])
    const blip = only([...events, ev({ t: 'retired', id }, 1, '2026-02-02T00:00:00Z')])
    expect(isDue(blip, NOW, ['change'])).toBe(false)
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

  test('a blip sent to the desktop goes first, even against a much older one', () => {
    const { events } = blipFrom('carry me to the mac', '2026-02-28T12:00:00Z')
    const plain = only(events)
    const pinned = only([
      ...events,
      ev({ t: 'promoteToDesktop', id: plain.id }, 1, '2026-03-01T00:00:00Z'),
    ])

    const older = only(blipFrom('an older thing', '2026-01-01T00:00:00Z').events)
    const feed = buildDailyFeed([older, pinned], { now: NOW })

    expect(feed[0]?.id).toBe(pinned.id)
    expect(feed.map((blip) => blip.id)).toContain(older.id)
  })

  test('ranking covers everything, in the same order the feed would use', () => {
    const old = only(blipFrom('old', '2026-01-01T00:00:00Z').events)
    const pinnedSource = blipFrom('pinned', '2026-02-28T12:00:00Z')
    const pinned = only([
      ...pinnedSource.events,
      ev({ t: 'promoteToDesktop', id: pinnedSource.id }, 1, '2026-03-01T00:00:00Z'),
    ])
    const snoozedSource = blipFrom('snoozed', '2026-02-01T00:00:00Z')
    const snoozed = only([
      ...snoozedSource.events,
      ev(
        { t: 'snoozed', id: snoozedSource.id, until: '2026-12-01T00:00:00Z' },
        1,
        '2026-02-02T00:00:00Z',
      ),
    ])

    const ranked = rankBlips([old, pinned, snoozed], { now: NOW })
    expect(ranked[0]?.id).toBe(pinned.id)
    // A blip put down until December is still reviewable — that is the point.
    expect(ranked.map((blip) => blip.id)).toContain(snoozed.id)
  })

  test('ranking leaves out retired and promoted blips', () => {
    const retiredSource = blipFrom('retired', '2026-02-01T00:00:00Z')
    const retired = only([
      ...retiredSource.events,
      ev({ t: 'retired', id: retiredSource.id }, 1, '2026-02-02T00:00:00Z'),
    ])
    const live = only(blipFrom('live', '2026-02-01T00:00:00Z').events)
    expect(rankBlips([retired, live], { now: NOW }).map((blip) => blip.id)).toEqual([live.id])
  })

  test('deferral choices are floors, in the future, in order', () => {
    const tomorrow = Date.parse(deferUntil('tomorrow', NOW))
    const fewDays = Date.parse(deferUntil('few-days', NOW))
    const nextWeek = Date.parse(deferUntil('next-week', NOW))
    const nextMonth = Date.parse(deferUntil('next-month', NOW))

    expect(tomorrow).toBeGreaterThan(NOW.getTime())
    expect(tomorrow).toBeLessThan(fewDays)
    expect(fewDays).toBeLessThan(nextWeek)
    expect(nextWeek).toBeLessThan(nextMonth)
  })

  test('a deferred blip is not due until its floor', () => {
    const { id, events } = blipFrom('later', '2026-02-28T12:00:00Z')
    const deferred = only([
      ...events,
      ev({ t: 'snoozed', id, until: deferUntil('next-month', NOW) }, 1, '2026-03-01T00:00:00Z'),
    ])
    expect(isDue(deferred, NOW)).toBe(false)
    expect(isDue(deferred, new Date(NOW.getTime() + 31 * 86_400_000))).toBe(true)
  })
})

describe('buildRound and roundQueue', () => {
  /**
   * These exist because of a real bug: a focused Inkling was pinned to the front of
   * every new round, and switching scope cleared the decisions — so a blip that had
   * already been deleted came back and could be deleted again. It was deleted twice in
   * the log before anyone noticed.
   */
  function blips(...ids: string[]): { list: Blip[]; byId: Map<string, Blip> } {
    const list = ids.map((id) => only(blipFrom(id, '2026-02-28T12:00:00Z').events))
    return { list, byId: new Map(list.map((blip) => [blip.id, blip])) }
  }

  test('with no focus, the round is the candidates in order', () => {
    const { list, byId } = blips('a', 'b', 'c')
    expect(buildRound(list, byId)).toEqual(list.map((blip) => blip.id))
  })

  test('a focused Inkling goes first — this is how you open one from the attic', () => {
    const { list, byId } = blips('a', 'b', 'c')
    const third = list[2]
    if (!third) throw new Error('expected three')
    expect(buildRound(list, byId, third.id)[0]).toBe(third.id)
  })

  test('a retired Inkling can still be focused — retiring is "not now"', () => {
    const { list } = blips('a')
    const first = list[0]
    if (!first) throw new Error('expected one')
    const retired = { ...first, status: 'retired' as const }
    const withRetired = new Map([[retired.id, retired]])
    expect(buildRound([], withRetired, retired.id)).toEqual([retired.id])
  })

  test('a DELETED Inkling is not focused back into the round', () => {
    const { list, byId } = blips('a', 'b')
    const gone = list[0]
    if (!gone) throw new Error('expected one')
    // The override must come last: spreading byId after it would put the live blip back.
    const withDeleted = new Map([...byId, [gone.id, { ...gone, deleted: true }] as const])
    expect(buildRound([list[1]!], withDeleted, gone.id)).not.toContain(gone.id)
  })

  test('a focused id that does not exist is ignored rather than crashing', () => {
    const { list, byId } = blips('a')
    expect(buildRound(list, byId, 'nope')).toEqual(list.map((blip) => blip.id))
  })

  test('deleted candidates never enter a round', () => {
    const { list, byId } = blips('a', 'b')
    const gone = list[0]
    if (!gone) throw new Error('expected one')
    const mixed = [{ ...gone, deleted: true }, list[1]!]
    expect(buildRound(mixed, byId)).toEqual([list[1]!.id])
  })

  test('the queue drops deleted Inklings from a frozen round', () => {
    const { list, byId } = blips('a', 'b', 'c')
    const session = list.map((blip) => blip.id)
    const gone = list[1]
    if (!gone) throw new Error('expected two')
    const withDeleted = new Map(byId)
    withDeleted.set(gone.id, { ...gone, deleted: true })
    const queue = roundQueue(session, list, withDeleted, new Set())
    expect(queue.map((blip) => blip.id)).toEqual([list[0]!.id, list[2]!.id])
  })

  test('the queue drops what was already decided this round', () => {
    const { list, byId } = blips('a', 'b')
    const session = list.map((blip) => blip.id)
    const decided = new Set([list[0]!.id])
    expect(roundQueue(session, list, byId, decided).map((blip) => blip.id)).toEqual([list[1]!.id])
  })

  test('a session id with no blip behind it is skipped, not shown as undefined', () => {
    const { list, byId } = blips('a')
    const queue = roundQueue(['missing', list[0]!.id], list, byId, new Set())
    expect(queue.map((blip) => blip.id)).toEqual([list[0]!.id])
  })

  test('a null session falls back to the candidates', () => {
    const { list, byId } = blips('a', 'b')
    expect(roundQueue(null, list, byId, new Set())).toHaveLength(2)
  })
})

describe('a move from a friend', () => {
  const MOVE = {
    id: 'friend.one',
    title: 'Try the cheapest keyboard you can borrow',
    why: 'because',
    timeLimitSec: 300,
    goal: 'one chord, played twice',
    playbook: 'friend',
    generatedBy: 'friend' as const,
  }

  test('a deferral wins, even when a friend has suggested something', () => {
    // It used to be the other way round, on the grounds that somebody was waiting on you — and
    // the effect was that "put this down until Tuesday" came back the next morning, which makes
    // the button a lie. The move is announced in the notifications and is still on the card
    // when the deferral ends; it does not drag the card into today.
    const { id, events } = blipFrom('learn a few chords', '2026-02-01T12:00:00Z')
    const snoozed = [
      ...events,
      ev({ t: 'snoozed', id, until: '2026-04-01T12:00:00Z' }, 1, '2026-02-02T12:00:00Z'),
    ]
    expect(isDue(only(snoozed), NOW)).toBe(false)

    const withMove = [
      ...snoozed,
      ev(
        { t: 'friendMove', id, messageId: 'm1', from: 'u', fromUsername: 'sam', moveSpec: MOVE },
        2,
        '2026-02-03T12:00:00Z',
      ),
    ]
    expect(isDue(only(withMove), NOW)).toBe(false)

    // And it is back, move and all, when the day arrives.
    const later = new Date('2026-04-02T12:00:00Z')
    expect(isDue(only(withMove), later)).toBe(true)
  })

  test('leads the round, and stops leading once something is written against it', () => {
    const plain = blipFrom('learn a few chords', '2026-02-01T12:00:00Z')
    const withMove = only([
      ...plain.events,
      ev(
        {
          t: 'friendMove',
          id: plain.id,
          messageId: 'm1',
          from: 'u',
          fromUsername: 'sam',
          moveSpec: MOVE,
        },
        1,
        '2026-02-02T12:00:00Z',
      ),
    ])
    const before = scoreBlip(withMove, { now: NOW })

    const answered = only([
      ...plain.events,
      ev(
        {
          t: 'friendMove',
          id: plain.id,
          messageId: 'm1',
          from: 'u',
          fromUsername: 'sam',
          moveSpec: MOVE,
        },
        1,
        '2026-02-02T12:00:00Z',
      ),
      ev(
        {
          t: 'entry',
          id: plain.id,
          // Answering *that* move: an entry that does not name one leaves it waiting, which
          // is the distinction the card's queue is built on.
          fromMessageId: 'm1',
          entry: { id: 'e1', kind: 'note', text: 'tried it', at: '2026-02-03T12:00:00Z' },
        },
        2,
        '2026-02-03T12:00:00Z',
      ),
    ])
    const after = scoreBlip(answered, { now: NOW })

    expect(before - after).toBeGreaterThan(5)
  })

  test('a friend move outranks a stale Inkling with more heat', () => {
    const older = blipFrom('been here a while', '2026-01-01T12:00:00Z')
    const asked = blipFrom('learn a few chords', '2026-02-28T12:00:00Z')
    const withMove = only([
      ...asked.events,
      ev(
        {
          t: 'friendMove',
          id: asked.id,
          messageId: 'm1',
          from: 'u',
          fromUsername: 'sam',
          moveSpec: MOVE,
        },
        1,
        '2026-02-28T13:00:00Z',
      ),
    ])
    const ranked = rankBlips([only(older.events), withMove], { now: NOW })
    expect(ranked[0]?.id).toBe(asked.id)
  })
})

describe('what is coming back soon', () => {
  test('is what is snoozed inside the window, and not what is due now', () => {
    // The middle window: not today, but not someday either. It sits between the daily feed
    // and everything, and it is the one you actually want to look at.
    const due = blipFrom('due now', '2026-02-28T12:00:00Z')
    const soon = blipFrom('back on Thursday', '2026-02-20T12:00:00Z')
    const far = blipFrom('back next year', '2026-02-20T12:00:00Z')

    const snoozedSoon = only([
      ...soon.events,
      ev({ t: 'snoozed', id: soon.id, until: '2026-03-03T12:00:00Z' }, 1, '2026-02-25T12:00:00Z'),
    ])
    const snoozedFar = only([
      ...far.events,
      ev({ t: 'snoozed', id: far.id, until: '2026-09-01T12:00:00Z' }, 1, '2026-02-25T12:00:00Z'),
    ])

    const near = buildNearFeed([only(due.events), snoozedSoon, snoozedFar], { now: NOW })
    expect(near.map((blip) => blip.title)).toEqual(['back on Thursday'])
  })

  test('a retired Inkling is not coming back soon, because it is not coming back', () => {
    const { id, events } = blipFrom('put away', '2026-02-20T12:00:00Z')
    const retired = only([
      ...events,
      ev({ t: 'snoozed', id, until: '2026-03-02T12:00:00Z' }, 1, '2026-02-25T12:00:00Z'),
      ev({ t: 'retired', id }, 2, '2026-02-26T12:00:00Z'),
    ])
    expect(buildNearFeed([retired], { now: NOW })).toEqual([])
  })

  test('an Inkling with no floor at all is not near — it is due', () => {
    const { events } = blipFrom('never put down', '2026-02-28T12:00:00Z')
    expect(buildNearFeed([only(events)], { now: NOW })).toEqual([])
  })
})
