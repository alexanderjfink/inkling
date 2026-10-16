import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody, FeedbackContext, PublicUser } from '@inkling/domain'
import { serializeLog } from '@inkling/domain'
import { ABANDONED_AT, buildOverview } from './overview'
import type { Store } from './store'

const encoder = new TextEncoder()

function user(username: string, overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: `id-${username}`,
    username,
    role: 'member',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** A store backed by events in memory, one log per device. */
function fakeStore(logs: Record<string, BlipEvent[]>): Store {
  const sizes = new Map(Object.entries(logs).map(([device, events]) => [device, events.length]))
  return {
    async devices() {
      return Object.keys(logs).map((deviceId) => ({ deviceId, size: sizes.get(deviceId) ?? 0 }))
    },
    async readLog(deviceId) {
      const events = logs[deviceId]
      return events ? encoder.encode(serializeLog(events, deviceId)) : new Uint8Array(0)
    },
    async logSize(deviceId) {
      return sizes.get(deviceId) ?? 0
    },
    async appendLog() {
      return 0
    },
    async hasBlob() {
      return false
    },
    async putBlob() {},
    async getBlob() {
      return null
    },
    async putDigest() {},
    async digests() {
      return []
    },
  }
}

let seq = 0
function ev(body: BlipEventBody, at: string, deviceId = 'phone'): BlipEvent {
  seq += 1
  return { ...body, deviceId, seq, at }
}

function captured(
  id: string,
  at: string,
  text = 'something I noticed',
  deviceId = 'phone',
): BlipEvent {
  return ev({ t: 'captured', id, input: { kind: 'text', text }, type: 'idea' }, at, deviceId)
}

describe('the overview', () => {
  test('counts what is there, across accounts and devices', async () => {
    const result = await buildOverview([
      {
        user: user('admin', { role: 'admin' }),
        store: fakeStore({
          phone: [captured('a', '2026-02-01T10:00:00Z'), captured('b', '2026-02-01T11:00:00Z')],
          laptop: [captured('c', '2026-02-02T10:00:00Z', 'noticed on the laptop', 'laptop')],
        }),
      },
      { user: user('sam'), store: fakeStore({ phone: [captured('d', '2026-02-02T12:00:00Z')] }) },
    ])

    expect(result.users.total).toBe(2)
    expect(result.users.admins).toBe(1)
    expect(result.devices).toBe(3)
    expect(result.inklings.total).toBe(4)
    expect(result.inklings.active).toBe(4)
    expect(result.unreadable).toEqual([])
  })

  test('an Inkling that keeps coming back and never gets written against is abandoned', async () => {
    // Not the same as retired. Retiring is a decision, and a decision is a good outcome;
    // this is the thing that keeps returning and never gets anywhere.
    const skips = Array.from({ length: ABANDONED_AT }, (_, index) =>
      ev({ t: 'snoozed', id: 'stuck' }, `2026-02-0${index + 2}T10:00:00Z`),
    )
    const result = await buildOverview([
      {
        user: user('sam'),
        store: fakeStore({
          phone: [
            captured('stuck', '2026-02-01T10:00:00Z'),
            ...skips,
            captured('fine', '2026-02-01T10:00:00Z'),
            ev(
              {
                t: 'entry',
                id: 'fine',
                entry: {
                  id: 'e1',
                  kind: 'note',
                  text: 'wrote something',
                  at: '2026-02-02T10:00:00Z',
                },
              },
              '2026-02-02T10:00:00Z',
            ),
          ],
        }),
      },
    ])
    expect(result.inklings.abandoned).toBe(1)
    expect(result.inklings.withEntries).toBe(1)
  })

  test('the example is counted, and never counted as abandoned', async () => {
    const result = await buildOverview([
      {
        user: user('new'),
        store: fakeStore({
          phone: [
            ev(
              {
                t: 'captured',
                id: 'demo',
                input: { kind: 'text', text: 'learn a few chords' },
                type: 'quest',
                demo: true,
              },
              '2026-02-01T10:00:00Z',
            ),
            ...Array.from({ length: 5 }, (_, index) =>
              ev({ t: 'snoozed', id: 'demo' }, `2026-02-0${index + 2}T10:00:00Z`),
            ),
          ],
        }),
      },
    ])
    expect(result.inklings.examples).toBe(1)
    expect(result.inklings.abandoned).toBe(0)
  })

  test('moves are counted by what happened to them, and bad ones keep their reason', async () => {
    const spec = {
      id: 'any.read',
      title: 'Read a short summary',
      why: 'because',
      timeLimitSec: 240,
      goal: 'one sentence',
      playbook: 'any',
      generatedBy: 'llm' as const,
    }
    const context = {
      blipType: 'yearning' as const,
      blipTitle: 'why do starters behave differently',
      topics: ['starters'],
      entries: 0,
      alreadyOffered: [],
      related: [],
    }
    const result = await buildOverview([
      {
        user: user('sam'),
        store: fakeStore({
          phone: [
            captured('x', '2026-02-01T10:00:00Z', 'why do starters behave differently'),
            ev(
              { t: 'moveShown', id: 'x', moveId: 'any.read', moveSpec: spec },
              '2026-02-01T11:00:00Z',
            ),
            ev({ t: 'moveDone', id: 'x', moveId: 'any.read' }, '2026-02-01T12:00:00Z'),
            ev(
              {
                t: 'moveShown',
                id: 'x',
                moveId: 'any.other',
                moveSpec: { ...spec, id: 'any.other' },
              },
              '2026-02-01T13:00:00Z',
            ),
            ev(
              {
                t: 'moveRejected',
                id: 'x',
                moveId: 'any.other',
                moveSpec: { ...spec, id: 'any.other', title: 'Ask someone about it' },
                reason: 'too vague to act on',
                note: 'I want something I can do at the counter',
                context,
              },
              '2026-02-01T14:00:00Z',
            ),
          ],
        }),
      },
    ])

    expect(result.moves.offered).toBe(2)
    expect(result.moves.done).toBe(1)
    expect(result.moves.rejected).toBe(1)
    expect(result.badMoves).toHaveLength(1)
    expect(result.badMoves[0]?.reason).toBe('too vague to act on')
    expect(result.badMoves[0]?.note).toBe('I want something I can do at the counter')
    expect(result.badMoves[0]?.blipTitle).toBe('why do starters behave differently')
    expect(result.badMoves[0]?.user).toBe('sam')
  })

  test('feedback arrives with the context it was given', async () => {
    const context: FeedbackContext = {
      screen: 'review',
      blip: { id: 'x', type: 'quest', title: 'learn a few chords', topics: [], entries: 2 },
      move: {
        id: 'reference.firstLook',
        title: 'Find out what a MIDI keyboard needs',
        generatedBy: 'playbook',
      },
      provider: 'OpenCode Go',
      model: 'kimi-k2.6',
      app: 'dev',
      server: 'dev',
      viewport: { width: 390, height: 844 },
      userAgent: 'test',
      counts: { inklings: 3, events: 20, today: 1 },
    }
    const result = await buildOverview([
      {
        user: user('sam'),
        store: fakeStore({
          phone: [
            captured('x', '2026-02-01T10:00:00Z', 'learn a few chords'),
            ev(
              { t: 'feedback', id: 'f1', text: 'the links never open', context },
              '2026-02-02T10:00:00Z',
            ),
          ],
        }),
      },
    ])

    expect(result.feedback).toHaveLength(1)
    const row = result.feedback[0]
    expect(row?.text).toBe('the links never open')
    expect(row?.screen).toBe('review')
    expect(row?.blipTitle).toBe('learn a few chords')
    expect(row?.move).toBe('Find out what a MIDI keyboard needs')
    expect(row?.app).toBe('dev')
  })

  test('feedback is not an Inkling, and does not become one', async () => {
    // It carries a fresh id precisely so the fold ignores it — the log is the right place
    // for it, but it is not about an Inkling.
    const context: FeedbackContext = {
      screen: 'settings',
      app: 'dev',
      server: 'dev',
      viewport: { width: 390, height: 844 },
      userAgent: 'test',
      counts: { inklings: 0, events: 0, today: 0 },
    }
    const result = await buildOverview([
      {
        user: user('sam'),
        store: fakeStore({
          phone: [
            ev(
              { t: 'feedback', id: 'lonely', text: 'the app is good', context },
              '2026-02-02T10:00:00Z',
            ),
          ],
        }),
      },
    ])
    expect(result.feedback).toHaveLength(1)
    expect(result.inklings.total).toBe(0)
  })

  test('the newest bad moves and feedback come first', async () => {
    const spec = {
      id: 'any.read',
      title: 't',
      why: 'because',
      timeLimitSec: 240,
      goal: 'g',
      playbook: 'any',
      generatedBy: 'llm' as const,
    }
    const context = {
      blipType: 'idea' as const,
      blipTitle: 'x',
      topics: [],
      entries: 0,
      alreadyOffered: [],
      related: [],
    }
    const reject = (at: string, title: string) =>
      ev(
        {
          t: 'moveRejected',
          id: 'x',
          moveId: title,
          moveSpec: { ...spec, id: title, title },
          context,
        },
        at,
      )
    const result = await buildOverview([
      {
        user: user('sam'),
        store: fakeStore({
          phone: [
            captured('x', '2026-02-01T10:00:00Z'),
            reject('2026-02-02T10:00:00Z', 'older'),
            reject('2026-02-03T10:00:00Z', 'newer'),
          ],
        }),
      },
    ])
    expect(result.badMoves.map((row) => row.move)).toEqual(['newer', 'older'])
  })

  test('an unreadable account is named rather than quietly counted as empty', async () => {
    const broken: Store = {
      ...fakeStore({}),
      async devices() {
        throw new Error('permission denied')
      },
    }
    const result = await buildOverview([
      { user: user('sam'), store: fakeStore({ phone: [captured('a', '2026-02-01T10:00:00Z')] }) },
      { user: user('broken'), store: broken },
    ])
    expect(result.unreadable).toEqual(['broken'])
    expect(result.inklings.total).toBe(1)
  })
})
