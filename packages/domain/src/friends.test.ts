import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, MoveSpec } from '../src/index'
import {
  buildFriendTimeline,
  buildSocialTimeline,
  hasThanked,
  thanksReceivedNote,
  unseenFriendMoves,
} from '../src/index'

const DEVICE = 'deviceA'
const SAM = { userId: 'user-sam-0001', username: 'sam' }

function ev(body: BlipEventBody, seq: number, at: string): BlipEvent {
  return { ...body, deviceId: DEVICE, seq, at }
}

const MOVE: MoveSpec = {
  id: 'friend.play-one',
  title: 'Play one chord badly, twice',
  why: 'because a friend thought of it',
  timeLimitSec: 300,
  goal: 'one chord, both times',
  playbook: 'friend',
  generatedBy: 'friend',
}

const titles = new Map([
  ['blip-mine', 'learn the keyboard'],
  ['blip-theirs', 'the sourdough starter'],
])

describe('the history between two people', () => {
  test('an ask you sent is open until something comes back', () => {
    const asked = ev(
      {
        t: 'friendAsk',
        id: 'blip-mine',
        messageId: 'm1',
        direction: 'out',
        userId: SAM.userId,
        username: SAM.username,
      },
      0,
      '2026-01-01T00:00:00Z',
    )

    const open = buildFriendTimeline([asked], SAM, titles)
    expect(open).toHaveLength(1)
    expect(open[0]?.kind).toBe('you-asked')
    expect(open[0]?.direction).toBe('out')
    expect(open[0]?.open).toBe(true)
    // Named by what you called it, not by the id in the log.
    expect(open[0]?.title).toBe('learn the keyboard')

    const answered = buildFriendTimeline(
      [
        asked,
        ev(
          {
            t: 'friendMove',
            id: 'blip-mine',
            messageId: 'm2',
            from: SAM.userId,
            fromUsername: SAM.username,
            moveSpec: MOVE,
          },
          1,
          '2026-01-02T00:00:00Z',
        ),
      ],
      SAM,
      titles,
    )
    expect(answered.find((entry) => entry.kind === 'you-asked')?.open).toBe(false)
  })

  test('an ask they sent is open until something goes back, however you answered it', () => {
    const asked = ev(
      {
        t: 'friendAsk',
        id: 'foreign-id',
        messageId: 'm1',
        direction: 'in',
        userId: SAM.userId,
        username: SAM.username,
        context: {
          blipId: 'blip-theirs',
          type: 'idea',
          title: 'the sourdough starter',
          topics: [],
          entries: [],
          offered: [],
        },
      },
      0,
      '2026-01-01T00:00:00Z',
    )

    const open = buildFriendTimeline([asked], SAM, titles)
    expect(open[0]?.kind).toBe('they-asked')
    expect(open[0]?.direction).toBe('in')
    expect(open[0]?.open).toBe(true)

    // Answered by browsing their Inklings, which does not know which ask it answers —
    // only which Inkling. That has to count, or the question stays open for ever.
    const answered = buildFriendTimeline(
      [
        asked,
        ev(
          {
            t: 'friendMoveSent',
            id: 'sent-1',
            messageId: 'm2',
            to: SAM.userId,
            toUsername: SAM.username,
            moveSpec: MOVE,
            blipId: 'blip-theirs',
          },
          1,
          '2026-01-02T00:00:00Z',
        ),
      ],
      SAM,
      titles,
    )
    expect(answered.find((entry) => entry.kind === 'they-asked')?.open).toBe(false)
  })

  test('moves, in both directions, with the Inkling each was about', () => {
    const entries = buildFriendTimeline(
      [
        ev(
          {
            t: 'friendMove',
            id: 'blip-mine',
            messageId: 'm1',
            from: SAM.userId,
            fromUsername: SAM.username,
            moveSpec: MOVE,
          },
          0,
          '2026-01-02T00:00:00Z',
        ),
        ev(
          {
            t: 'friendMoveSent',
            id: 'sent-1',
            messageId: 'm2',
            to: SAM.userId,
            toUsername: SAM.username,
            moveSpec: MOVE,
            blipId: 'blip-theirs',
          },
          1,
          '2026-01-03T00:00:00Z',
        ),
      ],
      SAM,
      titles,
    )

    const received = entries.find((entry) => entry.kind === 'they-sent-move')
    expect(received?.direction).toBe('in')
    expect(received?.title).toBe('learn the keyboard')
    expect(received?.moveTitle).toBe('Play one chord badly, twice')

    const sent = entries.find((entry) => entry.kind === 'you-sent-move')
    expect(sent?.direction).toBe('out')
    expect(sent?.title).toBe('the sourdough starter')
  })

  test('newest first, and only about this friend', () => {
    const entries = buildFriendTimeline(
      [
        ev(
          {
            t: 'friendAsk',
            id: 'blip-mine',
            messageId: 'm1',
            direction: 'out',
            userId: SAM.userId,
            username: SAM.username,
          },
          0,
          '2026-01-01T00:00:00Z',
        ),
        ev(
          {
            t: 'friendAsk',
            id: 'blip-mine',
            messageId: 'm2',
            direction: 'out',
            userId: 'user-alex-0002',
            username: 'alex',
          },
          1,
          '2026-01-05T00:00:00Z',
        ),
        ev(
          {
            t: 'friendMove',
            id: 'blip-mine',
            messageId: 'm3',
            from: SAM.userId,
            fromUsername: SAM.username,
            moveSpec: MOVE,
          },
          2,
          '2026-01-09T00:00:00Z',
        ),
      ],
      SAM,
      titles,
    )

    expect(entries.map((entry) => entry.kind)).toEqual(['they-sent-move', 'you-asked'])
  })

  test('every kind of interaction is classified by who helped whom', () => {
    // The direction filter is the only thing standing between "what I have done for people"
    // and "what people have done for me", so each kind is pinned down here.
    const events: BlipEvent[] = [
      ev(
        {
          t: 'friendAsk',
          id: 'blip-mine',
          messageId: 'ask-out',
          direction: 'out',
          userId: SAM.userId,
          username: SAM.username,
        },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev(
        {
          t: 'friendAsk',
          id: 'foreign',
          messageId: 'ask-in',
          direction: 'in',
          userId: SAM.userId,
          username: SAM.username,
          context: {
            blipId: 'blip-theirs',
            type: 'idea',
            title: 'the sourdough starter',
            topics: [],
            entries: [],
            offered: [],
          },
        },
        1,
        '2026-01-02T00:00:00Z',
      ),
      ev(
        {
          t: 'friendMove',
          id: 'blip-mine',
          messageId: 'move-in',
          from: SAM.userId,
          fromUsername: SAM.username,
          moveSpec: MOVE,
        },
        2,
        '2026-01-03T00:00:00Z',
      ),
      ev(
        {
          t: 'friendMoveSent',
          id: 'sent',
          messageId: 'move-out',
          to: SAM.userId,
          toUsername: SAM.username,
          moveSpec: MOVE,
          blipId: 'blip-theirs',
        },
        3,
        '2026-01-04T00:00:00Z',
      ),
      ev(
        {
          t: 'friendNote',
          id: 'blip-mine',
          note: {
            id: 'n1',
            direction: 'out',
            kind: 'thanks',
            username: SAM.username,
            userId: SAM.userId,
            text: '🙏',
            at: '2026-01-05T00:00:00Z',
          },
        },
        4,
        '2026-01-05T00:00:00Z',
      ),
      ev(
        {
          t: 'friendNote',
          id: 'blip-mine',
          note: {
            id: 'n2',
            direction: 'in',
            kind: 'thanks',
            username: SAM.username,
            userId: SAM.userId,
            text: '🙏',
            at: '2026-01-06T00:00:00Z',
          },
        },
        5,
        '2026-01-06T00:00:00Z',
      ),
    ]

    const byKind = new Map(
      buildFriendTimeline(events, SAM, titles).map((entry) => [entry.kind, entry.direction]),
    )

    // Out: help I gave. In: help I was given.
    expect(byKind.get('you-asked')).toBe('out')
    expect(byKind.get('they-asked')).toBe('in')
    expect(byKind.get('you-sent-move')).toBe('out')
    expect(byKind.get('they-sent-move')).toBe('in')
    expect(byKind.get('you-thanked')).toBe('out')
    expect(byKind.get('they-thanked')).toBe('in')
  })

  test('the whole timeline knows who each thing was with', () => {
    const entries = buildSocialTimeline(
      [
        ev(
          {
            t: 'friendMove',
            id: 'blip-mine',
            messageId: 'm1',
            from: SAM.userId,
            fromUsername: SAM.username,
            moveSpec: MOVE,
          },
          0,
          '2026-01-02T00:00:00Z',
        ),
        ev(
          {
            t: 'friendAsk',
            id: 'blip-mine',
            messageId: 'm2',
            direction: 'out',
            userId: 'user-alex-0002',
            username: 'alex',
          },
          1,
          '2026-01-05T00:00:00Z',
        ),
      ],
      titles,
    )

    expect(entries.map((entry) => entry.username)).toEqual(['alex', 'sam'])
    // And one person's view is a filter on it, not a second implementation.
    expect(buildFriendTimeline(entries.length ? [] : [], SAM, titles)).toEqual([])
    expect(buildSocialTimeline(entries.length ? [] : [], titles)).toEqual([])
  })

  test('a move from a friend is announced until somebody waves it away', () => {
    const arrived = ev(
      {
        t: 'friendMove',
        id: 'blip-mine',
        messageId: 'm1',
        from: SAM.userId,
        fromUsername: SAM.username,
        moveSpec: MOVE,
        note: 'this might be the one',
      },
      0,
      '2026-01-02T00:00:00Z',
    )

    const announced = unseenFriendMoves([arrived])
    expect(announced).toHaveLength(1)
    expect(announced[0]?.moveTitle).toBe('Play one chord badly, twice')
    expect(announced[0]?.blipId).toBe('blip-mine')
    expect(announced[0]?.fromUsername).toBe('sam')
    expect(announced[0]?.note).toBe('this might be the one')

    // Cleared: the telling ends, and the move does not.
    const cleared = unseenFriendMoves([
      arrived,
      ev({ t: 'friendMoveSeen', id: 'blip-mine', messageId: 'm1' }, 1, '2026-01-03T00:00:00Z'),
    ])
    expect(cleared).toHaveLength(0)

    // A move that never arrived is not cleared by clearing something else.
    const other = ev(
      {
        t: 'friendMove',
        id: 'blip-mine',
        messageId: 'm2',
        from: SAM.userId,
        fromUsername: SAM.username,
        moveSpec: MOVE,
      },
      2,
      '2026-01-04T00:00:00Z',
    )
    expect(unseenFriendMoves([arrived, other]).map((notice) => notice.messageId)).toEqual([
      'm2',
      'm1',
    ])
  })

  test('thank-yous are counted, and an old one with no id still lands on the right person', () => {
    const events: BlipEvent[] = [
      ev(
        {
          t: 'friendNote',
          id: 'blip-mine',
          note: {
            id: 'n1',
            direction: 'out',
            kind: 'thanks',
            username: SAM.username,
            userId: SAM.userId,
            blipId: 'blip-mine',
            text: '🙏',
            at: '2026-01-02T00:00:00Z',
          },
        },
        0,
        '2026-01-02T00:00:00Z',
      ),
      ev(
        {
          t: 'friendNote',
          id: 'foreign',
          note: {
            id: 'n2',
            direction: 'in',
            kind: 'thanks',
            username: 'alex',
            text: '🙏',
            at: '2026-01-03T00:00:00Z',
          },
        },
        1,
        '2026-01-03T00:00:00Z',
      ),
    ]

    expect(thanksReceivedNote(events)).toBe(1)

    const entries = buildFriendTimeline(events, SAM, titles)
    expect(entries.map((entry) => entry.kind)).toEqual(['you-thanked'])
    expect(hasThanked(events, SAM, 'blip-mine')).toBe(true)
    expect(hasThanked(events, SAM, 'blip-theirs')).toBe(false)
  })
})
