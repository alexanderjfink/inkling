import { describe, expect, test } from 'bun:test'
import { type FriendEvent, areFriends, friendsOf, pairKey, sanitizeFriendMove } from './social'

const NAMES = new Map([
  ['u-priya', 'priya'],
  ['u-sam', 'sam'],
])

function event(t: FriendEvent['t'], from: string, to: string, at: string): FriendEvent {
  return { t, from, to, at }
}

describe('friendships', () => {
  test('the pair is one thing seen from two ends', () => {
    expect(pairKey('u-sam', 'u-priya')).toBe(pairKey('u-priya', 'u-sam'))
  })

  test('latest event wins, so asking again after removing works', () => {
    const events = [
      event('requested', 'u-priya', 'u-sam', '2026-01-01T00:00:00Z'),
      event('accepted', 'u-priya', 'u-sam', '2026-01-02T00:00:00Z'),
      event('removed', 'u-sam', 'u-priya', '2026-01-03T00:00:00Z'),
      event('requested', 'u-sam', 'u-priya', '2026-01-04T00:00:00Z'),
    ]
    expect(areFriends('u-priya', 'u-sam', events)).toBe(false)
    expect(friendsOf('u-priya', events, NAMES)[0]?.status).toBe('asked-of-you')
  })

  test('a request is not a friendship, and typing a name is not enough', () => {
    const events = [event('requested', 'u-priya', 'u-sam', '2026-01-01T00:00:00Z')]
    expect(areFriends('u-priya', 'u-sam', events)).toBe(false)
    // The colour is theirs and stable, so it is asserted only to be present: what matters
    // is the status, which is the part that decides what you can do.
    const priyas = friendsOf('u-priya', events, NAMES)
    expect(priyas.map(({ userId, username, status }) => ({ userId, username, status }))).toEqual([
      { userId: 'u-sam', username: 'sam', status: 'asked' },
    ])
    expect(priyas[0]?.color).toBeTruthy()
    expect(friendsOf('u-sam', events, NAMES)).toEqual([
      {
        userId: 'u-priya',
        username: 'priya',
        status: 'asked-of-you',
        at: '2026-01-01T00:00:00Z',
        color: expect.any(String),
      },
    ])
  })

  test('a removed friendship is the absence of one, not a kind of pending', () => {
    const events = [
      event('requested', 'u-priya', 'u-sam', '2026-01-01T00:00:00Z'),
      event('accepted', 'u-priya', 'u-sam', '2026-01-02T00:00:00Z'),
      event('removed', 'u-priya', 'u-sam', '2026-01-03T00:00:00Z'),
    ]
    expect(friendsOf('u-priya', events, NAMES)).toEqual([])
    expect(friendsOf('u-sam', events, NAMES)).toEqual([])
  })

  test('a friendship with somebody else is not mine to see', () => {
    const events = [
      event('requested', 'u-a', 'u-b', '2026-01-01T00:00:00Z'),
      event('accepted', 'u-a', 'u-b', '2026-01-02T00:00:00Z'),
    ]
    expect(friendsOf('u-priya', events, NAMES)).toEqual([])
    expect(areFriends('u-a', 'u-b', events)).toBe(true)
  })

  test('friends come back in a stable order', () => {
    const events = [
      event('accepted', 'u-priya', 'u-sam', '2026-01-02T00:00:00Z'),
      event('accepted', 'u-priya', 'u-zoe', '2026-01-01T00:00:00Z'),
    ]
    const names = new Map([...NAMES, ['u-zoe', 'zoe']])
    expect(friendsOf('u-priya', events, names).map((f) => f.username)).toEqual(['sam', 'zoe'])
  })
})

describe('a move from a friend, as it arrives', () => {
  test('is bounded and labelled as coming from a person', () => {
    const move = sanitizeFriendMove({
      title: '  Play one chord badly, twice  ',
      goal: 'one chord, both times',
      timeLimitSec: 300,
      lookUp: ['MIDI keyboard'],
    })
    expect(move?.title).toBe('Play one chord badly, twice')
    expect(move?.generatedBy).toBe('friend')
    expect(move?.playbook).toBe('friend')
    expect(move?.timeLimitSec).toBe(300)
    expect(move?.lookUp).toEqual(['MIDI keyboard'])
  })

  test('a move with no title or no goal is not a move', () => {
    expect(sanitizeFriendMove({ goal: 'something' })).toBeNull()
    expect(sanitizeFriendMove({ title: 'something' })).toBeNull()
    expect(sanitizeFriendMove({ title: '  ', goal: '  ' })).toBeNull()
    expect(sanitizeFriendMove('not an object')).toBeNull()
  })

  test('it cannot be made longer than a move is allowed to be', () => {
    // It arrives over the network and is going to be shown to somebody as a suggestion.
    const move = sanitizeFriendMove({ title: 't', goal: 'g', timeLimitSec: 100_000 })
    expect(move?.timeLimitSec).toBeLessThanOrEqual(900)
    const tiny = sanitizeFriendMove({ title: 't', goal: 'g', timeLimitSec: 1 })
    expect(tiny?.timeLimitSec).toBeGreaterThanOrEqual(30)
  })

  test('nothing that is not a field of a move survives', () => {
    const move = sanitizeFriendMove({
      title: 't',
      goal: 'g',
      // A client could put anything in here; none of it is a move.
      id: 'playbook.question.oneSentence',
      generatedBy: 'llm',
      playbook: 'question',
      steps: ['do this', 'then that'],
      __proto__: { polluted: true },
    })
    expect(move?.id.startsWith('friend.')).toBe(true)
    expect(move?.generatedBy).toBe('friend')
    expect(move?.playbook).toBe('friend')
    expect(move?.steps).toBeUndefined()
  })

  test('the phrases are capped and trimmed like any other', () => {
    const move = sanitizeFriendMove({
      title: 't',
      goal: 'g',
      lookUp: ['one', 'two', 'three', 'four', 'x'.repeat(400), '  '],
    })
    expect(move?.lookUp).toEqual(['one', 'two', 'three'])
  })
})
