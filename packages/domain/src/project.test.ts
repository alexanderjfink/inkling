import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, BlipType } from '../src/index'
import { DEMO_MOVE, liveBlips, newId, project, unansweredFriendMove } from '../src/index'

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
    const base = captured(id, 'try example.com', 0, '2026-01-01T00:00:00Z', 'quest')

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

describe('the example Inkling', () => {
  test('an example is an ordinary Inkling that happens to say so', () => {
    // The point of writing it as a real event rather than a demo mode: everything the
    // fold already does to an Inkling has to keep working on it.
    const id = newId()
    const [blip] = project([
      ev(
        {
          t: 'captured',
          id,
          input: { kind: 'text', text: 'Learn a few chords on the keyboard' },
          type: 'quest',
          demo: true,
        },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev(
        { t: 'moveSaved', id, moveId: 'reference.firstLook', moveSpec: DEMO_MOVE },
        1,
        '2026-01-01T00:00:01Z',
      ),
    ])
    expect(blip?.demo).toBe(true)
    expect(blip?.status).toBe('active')
    expect(blip?.savedMove?.title).toContain('MIDI keyboard')
    expect(blip?.deleted).toBe(false)
  })

  test('the example can be retired, and deleted, like anything else', () => {
    const id = newId()
    const [retired] = project([
      ev(
        { t: 'captured', id, input: { kind: 'text', text: 'x' }, type: 'quest', demo: true },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'deleted', id }, 1, '2026-01-01T00:00:01Z'),
    ])
    expect(retired?.deleted).toBe(true)
    expect(liveBlips([retired!])).toHaveLength(0)
  })

  test('an ordinary Inkling is not marked as an example', () => {
    const [blip] = project([captured(newId(), 'something I noticed', 0, '2026-01-01T00:00:00Z')])
    expect(blip?.demo).toBeUndefined()
  })

  test('its move is written out, so the example works before anything is configured', () => {
    // A new person has no API key. An example whose move needs a model would sit on
    // "choosing a move…" forever, which teaches the opposite of what it is for.
    expect(DEMO_MOVE.generatedBy).toBe('playbook')
    expect(DEMO_MOVE.lookUp?.length).toBeGreaterThan(1)
    expect(DEMO_MOVE.timeLimitSec).toBeLessThanOrEqual(300)
  })
})

describe('help from a friend', () => {
  const MOVE = {
    id: 'friend.one',
    title: 'Try it with the cheapest keyboard you can borrow',
    why: 'because the point is the chords, not the gear',
    timeLimitSec: 300,
    goal: 'one chord, played twice',
    playbook: 'friend',
    generatedBy: 'friend' as const,
  }

  const received = (id: string, messageId: string, at: string, seq = 1) =>
    ev(
      { t: 'friendMove', id, messageId, from: 'u-sam', fromUsername: 'sam', moveSpec: MOVE },
      seq,
      at,
    )

  test('a move from a friend is kept on the Inkling, with who sent it', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
    ])
    expect(blip?.friendMoves).toHaveLength(1)
    expect(blip?.friendMoves[0]?.fromUsername).toBe('sam')
    expect(blip?.friendMoves[0]?.spec.title).toContain('cheapest keyboard')
  })

  test('the same message arriving twice is one move from one friend', () => {
    // Two devices both receive it, and both append an event. A card that says it twice is
    // a card that looks broken.
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z', 1),
      received(id, 'm1', '2026-01-02T00:00:01Z', 2),
    ])
    expect(blip?.friendMoves).toHaveLength(1)
  })

  test('it is unanswered until something is written against it', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
    ])
    expect(unansweredFriendMove(blip!)).toBeDefined()

    const [answered] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      ev(
        {
          t: 'entry',
          id,
          entry: { id: 'e1', kind: 'note', text: 'tried it', at: '2026-01-03T00:00:00Z' },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
    ])
    expect(unansweredFriendMove(answered!)).toBeUndefined()
  })

  test('an Inkling is private unless it was written shared', () => {
    // Absent means private, which is what everything written before this was.
    const [blip] = project([captured(newId(), 'something', 0, '2026-01-01T00:00:00Z')])
    expect(blip?.visibility).toBe('private')
  })

  test('sharing is per Inkling, and can be taken back', () => {
    const id = newId()
    const [shared] = project([
      ev(
        {
          t: 'captured',
          id,
          input: { kind: 'text', text: 'x' },
          type: 'idea',
          visibility: 'friends',
        },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'shared', id, visibility: 'private' }, 1, '2026-01-01T01:00:00Z'),
    ])
    expect(shared?.visibility).toBe('private')
  })

  test('a note from a friend is kept once, and remembers which way it went', () => {
    const id = newId()
    const note = {
      id: 'n1',
      direction: 'in' as const,
      kind: 'kudos' as const,
      username: 'sam',
      moveTitle: 'Try it with the cheapest keyboard',
      text: 'this one was good',
      at: '2026-01-03T00:00:00Z',
    }
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      ev({ t: 'friendNote', id, note }, 1, '2026-01-03T00:00:00Z'),
      ev({ t: 'friendNote', id, note }, 2, '2026-01-03T00:00:01Z'),
    ])
    expect(blip?.friendNotes).toHaveLength(1)
    expect(blip?.friendNotes[0]?.direction).toBe('in')
  })
})
