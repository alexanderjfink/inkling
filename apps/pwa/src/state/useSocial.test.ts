import { describe, expect, test } from 'bun:test'
import type { AskContext, BlipEvent, BlipEventBody } from '@inkling/domain'
import { openAsks } from './useSocial'

const CONTEXT: AskContext = {
  blipId: 'ink-1',
  type: 'quest',
  title: 'learn a few chords on the keyboard',
  topics: ['keyboard'],
  entries: [],
  offered: [],
}

let seq = 0
function ev(body: BlipEventBody): BlipEvent {
  seq += 1
  return { ...body, deviceId: 'phone', seq, at: `2026-10-16T0${(seq % 9) + 1}:00:00Z` }
}

/** An ask somebody sent me. A fresh id, because the Inkling in it is not mine. */
function receivedAsk(messageId: string, username = 'priya'): BlipEvent {
  return ev({
    t: 'friendAsk',
    id: `ask-${messageId}`,
    messageId,
    direction: 'in',
    userId: `u-${username}`,
    username,
    context: CONTEXT,
    note: 'I do not know where to start',
  })
}

/** A move I sent somebody. */
function sentMove(options: { blipId?: string; askId?: string; to?: string }): BlipEvent {
  return ev({
    t: 'friendMoveSent',
    id: `sent-${seq}`,
    messageId: `msg-${seq}`,
    to: options.to ?? 'u-priya',
    toUsername: 'priya',
    moveSpec: {
      id: 'friend.x',
      title: 'Play one chord badly, twice',
      why: 'because',
      timeLimitSec: 240,
      goal: 'one chord, both times',
      playbook: 'friend',
      generatedBy: 'friend',
    },
    ...options,
  })
}

describe('what is still waiting on you', () => {
  test('an ask nobody has answered is waiting', () => {
    expect(openAsks([receivedAsk('a1')])).toHaveLength(1)
  })

  test('answering it from the ask itself clears it', () => {
    // The path that always worked: the composer opened from the ask knows its id.
    const asks = openAsks([receivedAsk('a1'), sentMove({ askId: 'a1', blipId: 'ink-1' })])
    expect(asks).toHaveLength(0)
  })

  test('answering it by browsing their Inklings clears it too', () => {
    // The path that did not: sending a move from a friend's shared Inklings never knew
    // which ask it answered, so the question stayed in the list.
    const asks = openAsks([receivedAsk('a1'), sentMove({ blipId: 'ink-1' })])
    expect(asks).toHaveLength(0)
  })

  test('a move for a different Inkling does not clear it', () => {
    const asks = openAsks([receivedAsk('a1'), sentMove({ blipId: 'something-else' })])
    expect(asks).toHaveLength(1)
  })

  test('an ask you sent yourself is not in the list at all', () => {
    // Asking is not being asked. Only one direction needs a person.
    const mine = ev({
      t: 'friendAsk',
      id: 'ink-1',
      messageId: 'out-1',
      direction: 'out',
      userId: 'u-sam',
      username: 'sam',
    })
    expect(openAsks([mine])).toHaveLength(0)
  })

  test('answering one friend does not clear another friend’s ask for the same Inkling', () => {
    // Two friends can be asked about the same Inkling — sharing is per Inkling, not per
    // person — and answering one of them is not answering the other.
    const sams = { ...receivedAsk('a1', 'sam'), at: '2026-10-14T09:00:00Z' }
    const zoes = { ...receivedAsk('a2', 'zoe'), at: '2026-10-15T09:00:00Z' }
    const toSam = ev({
      t: 'friendMoveSent',
      id: 'sent-1',
      messageId: 'msg-1',
      to: 'u-sam',
      toUsername: 'sam',
      moveSpec: {
        id: 'friend.x',
        title: 'Play one chord badly, twice',
        why: 'because',
        timeLimitSec: 240,
        goal: 'one chord, both times',
        playbook: 'friend',
        generatedBy: 'friend',
      },
      blipId: 'ink-1',
    })
    expect(openAsks([sams, zoes, toSam]).map((ask) => ask.messageId)).toEqual(['a2'])
  })

  test('the newest ask comes first', () => {
    const older = { ...receivedAsk('a1'), at: '2026-10-14T09:00:00Z' }
    const newer = { ...receivedAsk('a2', 'zoe'), at: '2026-10-16T09:00:00Z' }
    expect(openAsks([older, newer]).map((ask) => ask.messageId)).toEqual(['a2', 'a1'])
  })
})
