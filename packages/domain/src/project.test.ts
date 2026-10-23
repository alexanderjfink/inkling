import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, BlipType } from '../src/index'
import {
  DEMO_MOVE,
  doneMoves,
  liveBlips,
  newId,
  pendingFriendMoves,
  project,
  unansweredFriendMove,
} from '../src/index'

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

  test('the same move shown twice for one Inkling is one move shown', () => {
    // The card records a move whenever it is put in front of somebody, and the card remounts
    // every time the round pages — so the log filled up with the same offering over and over, and
    // "MOVES SO FAR · 24" was one move looked at twenty-four times.
    const id = newId()
    const shown = (seq: number, at: string, title = 'play it badly') =>
      ev({ t: 'moveShown', id, moveId: 'm1', moveSpec: { ...DEMO_MOVE, id: 'm1', title } }, seq, at)

    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      shown(1, '2026-01-02T00:00:00Z'),
      shown(2, '2026-01-03T00:00:00Z'),
      shown(3, '2026-01-04T00:00:00Z'),
    ])

    expect(blip?.moves).toHaveLength(1)
    expect(blip?.schedule.timesShown).toBe(1)

    // A re-worded move is the same move: the title was in the identity once, and three rows all
    // saying the same thing is what "shows that move a bunch of times" was.
    const [reworded] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      shown(1, '2026-01-02T00:00:00Z'),
      shown(2, '2026-01-03T00:00:00Z', 'play it badly, louder'),
    ])
    expect(reworded?.moves).toHaveLength(1)
    expect(reworded?.moves[0]?.spec.title).toBe('play it badly, louder')
  })

  test('the same words under two ids are one row', () => {
    // This is the duplicate that survived being deduped by id: a friend suggests the move the app
    // had already offered, and the two arrive with different ids — `friend.<the words>` and
    // `idea.smallestTest` — saying the same sentence. Two rows, because the ids differed, and
    // nothing about the display could tell they were one thing.
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      ev(
        {
          t: 'moveShown',
          id,
          moveId: 'idea.smallestTest',
          moveSpec: { ...DEMO_MOVE, id: 'idea.smallestTest', title: 'What is the smallest test?' },
        },
        1,
        '2026-01-02T00:00:00Z',
      ),
      ev(
        {
          t: 'moveShown',
          id,
          moveId: 'friend.whatisthesmallesttest',
          moveSpec: {
            ...DEMO_MOVE,
            id: 'friend.whatisthesmallesttest',
            title: 'what is the smallest test',
            generatedBy: 'friend',
          },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
    ])

    expect(blip?.moves).toHaveLength(1)
    // The other id is remembered, so what happens to the move under either name still lands here.
    expect(blip?.moves[0]?.alsoIds).toEqual(['friend.whatisthesmallesttest'])
  })

  test('two moves you set yourself are two, even in the same words', () => {
    // The words match, so a friend's move would merge with either — but two things you decided
    // to do are two things you did, however similarly you described them.
    const id = newId()
    const own = (seq: number, moveId: string) =>
      ev(
        {
          t: 'moveShown',
          id,
          moveId,
          moveSpec: {
            ...DEMO_MOVE,
            id: moveId,
            title: 'walk to the corner',
            generatedBy: 'you' as const,
          },
        },
        seq,
        `2026-01-0${seq}T00:00:00Z`,
      )
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      own(1, 'you.a'),
      own(2, 'you.b'),
    ])
    expect(blip?.moves).toHaveLength(2)
  })

  test('doing it under the other id marks the one row done', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      ev(
        {
          t: 'moveShown',
          id,
          moveId: 'idea.smallestTest',
          moveSpec: { ...DEMO_MOVE, id: 'idea.smallestTest', title: 'What is the smallest test?' },
        },
        1,
        '2026-01-02T00:00:00Z',
      ),
      // The friend's copy is shown on the card too — the app writes that down, which is what
      // records the second id.
      ev(
        {
          t: 'moveShown',
          id,
          moveId: 'friend.whatisthesmallesttest',
          moveSpec: {
            ...DEMO_MOVE,
            id: 'friend.whatisthesmallesttest',
            title: 'What is the smallest test?',
            generatedBy: 'friend',
          },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
      ev({ t: 'moveDone', id, moveId: 'friend.whatisthesmallesttest' }, 3, '2026-01-04T00:00:00Z'),
    ])

    expect(blip?.moves).toHaveLength(1)
    expect(blip?.moves[0]?.outcome).toBe('done')
  })

  test('the card shows what was done, oldest first, and nothing that was only offered', () => {
    // "Moves you have done" is a record, not a log of every prompt: the offers are what made the
    // list look like it had lost track, and they are not a thing anybody did.
    const id = newId()
    const shown = (seq: number, moveId: string, title: string) =>
      ev(
        { t: 'moveShown', id, moveId, moveSpec: { ...DEMO_MOVE, id: moveId, title } },
        seq,
        `2026-01-0${seq}T00:00:00Z`,
      )
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      shown(1, 'm1', 'play it badly'),
      ev({ t: 'moveDone', id, moveId: 'm1' }, 2, '2026-01-02T00:00:00Z'),
      shown(3, 'm2', 'only offered'),
      shown(4, 'm3', 'hum it'),
      ev({ t: 'moveDone', id, moveId: 'm3' }, 5, '2026-01-05T00:00:00Z'),
    ])

    expect(doneMoves(blip!).map((entry) => entry.spec.title)).toEqual(['play it badly', 'hum it'])
  })

  test('it is unanswered until an entry says it answers it', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
    ])
    expect(unansweredFriendMove(blip!)).toBeDefined()

    // An entry that does not say which move it answers leaves the move waiting: you wrote
    // something, and the thing they suggested is still something you have not done.
    const [unrelated] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      ev(
        {
          t: 'entry',
          id,
          entry: { id: 'e1', kind: 'note', text: 'a thought', at: '2026-01-03T00:00:00Z' },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
    ])
    expect(pendingFriendMoves(unrelated!)).toHaveLength(1)

    const [answered] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      ev(
        {
          t: 'entry',
          id,
          fromMessageId: 'm1',
          entry: { id: 'e1', kind: 'note', text: 'tried it', at: '2026-01-03T00:00:00Z' },
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
    ])
    expect(unansweredFriendMove(answered!)).toBeUndefined()
    expect(answered?.entries[0]?.fromMessageId).toBe('m1')
  })

  test('two moves come one at a time, oldest first, and the second waits its turn', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      received(id, 'm2', '2026-01-04T00:00:00Z', 2),
    ])

    const queue = pendingFriendMoves(blip!)
    expect(queue.map((move) => move.messageId)).toEqual(['m1', 'm2'])

    // Answering the first leaves the second — the entry names the one it is about, so one
    // entry cannot tidy away a move nobody has done.
    const [after] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      received(id, 'm2', '2026-01-04T00:00:00Z', 2),
      ev(
        {
          t: 'entry',
          id,
          fromMessageId: 'm1',
          entry: { id: 'e1', kind: 'note', text: 'did the first one', at: '2026-01-05T00:00:00Z' },
        },
        3,
        '2026-01-05T00:00:00Z',
      ),
    ])
    expect(pendingFriendMoves(after!).map((move) => move.messageId)).toEqual(['m2'])
  })

  test('"not this move" takes it off the card and leaves it in the history', () => {
    const id = newId()
    const [blip] = project([
      captured(id, 'learn a few chords', 0, '2026-01-01T00:00:00Z'),
      received(id, 'm1', '2026-01-02T00:00:00Z'),
      received(id, 'm2', '2026-01-04T00:00:00Z', 2),
      // The dismissal arrives before the move it refers to, which is what a two-device merge
      // can produce — and the fold is only ever a fold, so the order must not matter.
      ev({ t: 'friendMoveDismissed', id, messageId: 'm2' }, 3, '2026-01-03T00:00:00Z'),
    ])

    expect(pendingFriendMoves(blip!).map((move) => move.messageId)).toEqual(['m1'])
    // Still here, still theirs, still in the history.
    expect(blip?.friendMoves).toHaveLength(2)
    expect(blip?.friendMoves.find((move) => move.messageId === 'm2')?.dismissed).toBe(true)
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
