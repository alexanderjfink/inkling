import { describe, expect, test } from 'bun:test'
import type { AskContext } from './events'
import { buildFriendsRound, friendShareKey } from './social'

/**
 * The friends round, as pure data.
 *
 * Two promises to keep, and they pull against each other: an ask is somebody saying they are
 * stuck and must never be queued behind a limit, while the round has to stay finite or it is
 * a feed. Everything here is about which of the two wins in a given situation.
 */

function context(blipId: string, updated: string, title = blipId): AskContext {
  return {
    blipId,
    type: 'idea',
    title,
    topics: [],
    entries: [],
    offered: [],
    updated,
  }
}

const share = (friendId: string, blipId: string, updated: string) => ({
  friendId,
  context: context(blipId, updated),
})

const ask = (friendId: string, blipId: string, at: string) => ({
  friendId,
  messageId: `m-${blipId}`,
  context: context(blipId, at),
  at,
})

describe('buildFriendsRound', () => {
  test('asks come first, oldest first, before anything unasked', () => {
    const round = buildFriendsRound({
      asks: [ask('sam', 'b', '2026-02-02T00:00:00Z'), ask('priya', 'a', '2026-02-01T00:00:00Z')],
      shares: [share('sam', 'c', '2026-03-01T00:00:00Z')],
    })

    expect(round.map((item) => item.context.blipId)).toEqual(['a', 'b', 'c'])
    expect(round[0]?.kind).toBe('ask')
    expect(round[0]?.messageId).toBe('m-a')
    expect(round[2]?.kind).toBe('inkling')
  })

  test('an ask is never dropped to make room', () => {
    const asks = Array.from({ length: 4 }, (_, index) =>
      ask('sam', `ask-${index}`, `2026-02-0${index + 1}T00:00:00Z`),
    )
    const shares = Array.from({ length: 10 }, (_, index) =>
      share('priya', `share-${index}`, `2026-03-0${(index % 9) + 1}T00:00:00Z`),
    )

    const round = buildFriendsRound({ asks, shares, limit: 3 })
    expect(round.filter((item) => item.kind === 'ask')).toHaveLength(4)
    // and the limit still bounds the unasked half
    expect(round.filter((item) => item.kind === 'inkling')).toHaveLength(0)
  })

  test('ten is the round, and one friend cannot fill it', () => {
    const shares = [
      ...Array.from({ length: 8 }, (_, index) =>
        share('sam', `sam-${index}`, `2026-03-0${(index % 9) + 1}T00:00:00Z`),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        share('priya', `priya-${index}`, `2026-04-0${(index % 9) + 1}T00:00:00Z`),
      ),
    ]

    const round = buildFriendsRound({ asks: [], shares })
    expect(round).toHaveLength(10)

    // Alternating, not eight of one and two of the other.
    const friends = round.map((item) => item.friendId)
    expect(friends.slice(0, 4)).toEqual(['priya', 'sam', 'priya', 'sam'])
  })

  test('the newest share of each friend comes first', () => {
    const round = buildFriendsRound({
      asks: [],
      shares: [
        share('sam', 'old', '2026-01-01T00:00:00Z'),
        share('sam', 'new', '2026-05-01T00:00:00Z'),
      ],
      limit: 1,
    })
    expect(round[0]?.context.blipId).toBe('new')
  })

  test('what you suggested on, and what you waved away, is not offered again', () => {
    const round = buildFriendsRound({
      asks: [],
      shares: [
        share('sam', 'done', '2026-05-03T00:00:00Z'),
        share('sam', 'waved', '2026-05-02T00:00:00Z'),
        share('sam', 'fresh', '2026-05-01T00:00:00Z'),
      ],
      suggested: new Set([friendShareKey('sam', 'done')]),
      dismissed: new Set([friendShareKey('sam', 'waved')]),
    })
    expect(round.map((item) => item.context.blipId)).toEqual(['fresh'])
  })

  test('an Inkling asked about is not also listed as a share', () => {
    const round = buildFriendsRound({
      asks: [ask('sam', 'same', '2026-02-01T00:00:00Z')],
      shares: [share('sam', 'same', '2026-03-01T00:00:00Z')],
    })
    expect(round).toHaveLength(1)
    expect(round[0]?.kind).toBe('ask')
  })

  test('nothing shared, nothing asked: an empty round rather than an error', () => {
    expect(buildFriendsRound({ asks: [], shares: [] })).toEqual([])
  })
})
