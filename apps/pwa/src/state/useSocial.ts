import type {
  AskContext,
  BlipEvent,
  Friend,
  FriendMoveNotice,
  MoveSpec,
  SocialMessage,
} from '@inkling/domain'
import { newId, unseenFriendMoves } from '@inkling/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptFriend,
  addFriend,
  askForMove,
  declineFriend,
  friendInklings,
  pullInbox,
  removeFriend,
  sendMove,
  sendNote,
} from '../social'
import { flashSaved } from './useSavedTick'
import { storage, type InklingActions } from './useInkling'

/** Where the postbox got to. A byte offset into this account's own inbox file. */
const INBOX_KEY = 'social:inboxOffset'

/** An ask somebody sent you, waiting to be answered. */
export interface ReceivedAsk {
  messageId: string
  userId: string
  username: string
  context: AskContext
  note?: string
  at: string
}

export interface SocialState {
  /** False when the server has social features off for this account, or there is none. */
  available: boolean
  off: boolean
  friends: Friend[]
  /** Asks from friends that have not been answered yet, newest first. */
  asks: ReceivedAsk[]
  /**
   * Moves from friends that have not been cleared yet, newest first.
   *
   * Announced rather than discovered: a person having thought about your Inkling is the whole
   * point of the social half, and a move that only turns up when you happen to open the right
   * card is a favour nobody notices. Clearing one ends the telling and nothing else.
   */
  moves: FriendMoveNotice[]
  /** Wave one away. The move stays on the Inkling. */
  clearMove: (input: { messageId: string; blipId: string }) => Promise<string | null>
  loading: boolean
  error: string | null
  refresh: () => void
  add: (username: string) => Promise<string | null>
  accept: (userId: string) => Promise<string | null>
  decline: (userId: string) => Promise<string | null>
  remove: (userId: string) => Promise<string | null>
  /** Ask a friend for a move on one of your Inklings. */
  ask: (input: { to: Friend; context: AskContext; note?: string }) => Promise<string | null>
  /** Suggest a move for a friend's Inkling. */
  suggest: (input: {
    to: Friend
    askId: string
    blipId: string
    move: MoveSpec
    note?: string
  }) => Promise<string | null>
  /** Encourage a friend, or thank one. */
  note: (input: {
    to: Friend
    blipId: string
    kind: 'kudos' | 'thanks'
    moveTitle?: string
    text: string
  }) => Promise<string | null>
  /** What a friend has chosen to share. */
  theirInklings: (userId: string) => Promise<AskContext[]>
}

/**
 * Friends, and the postbox between them.
 *
 * The server carries messages; this turns each one into an event in the local log, which
 * is where it becomes real. So a message that arrives twice is harmless — the fold keys a
 * received move on the message it came from — and one that never arrives is a missing
 * message rather than a missing fact.
 *
 * Pulling is on the same rhythm as sync: on load, on focus, on reconnect, and on a timer.
 * The web cannot be woken, so there is no such thing as a notification that arrives while
 * the app is closed; what there is instead is a count waiting the moment you open it.
 */
export function useSocial({
  serverUrl,
  accountId,
  enabled,
  actions,
  events,
}: {
  serverUrl: string
  accountId: string | null
  enabled: boolean
  actions: InklingActions
  /** The raw log, so a received ask can be read back after a reload. */
  events: BlipEvent[]
}): SocialState {
  const [friends, setFriends] = useState<Friend[]>([])
  const [off, setOff] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  /** Guards against a pull starting while the last one is still writing. */
  const pulling = useRef(false)
  /**
   * Whose pull is in flight.
   *
   * A pull that lands after a sign-out would otherwise write one person's messages into
   * another person's log. Cancelling on every dependency change was the first attempt at
   * this, and it cancelled the very first pull every time: the effect below bumps the
   * trigger that this one watches, so the run that had just started was torn down by its
   * own re-run and the messages were thrown away with it.
   */
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const active = enabled && accountId !== null && !off

  useEffect(() => {
    if (!active || pulling.current) return
    pulling.current = true
    const forAccount = accountId

    void (async () => {
      try {
        const store = storage()
        const offset = Number((await store.getSetting(INBOX_KEY)) ?? '0')
        const result = await pullInbox(serverUrl, offset)
        if (accountRef.current !== forAccount) return

        if (!result.ok) {
          // Off is a setting, not a failure, and saying so once is enough.
          if (result.socialOff) setOff(true)
          else setError(result.error)
          return
        }

        setError(null)
        setFriends(result.value.friends)

        for (const message of result.value.messages) {
          await ingest(message, actions)
        }
        if (result.value.messages.length > 0) {
          await store.setSetting(INBOX_KEY, String(result.value.size))
        }
      } finally {
        pulling.current = false
        setLoading(false)
      }
    })()
  }, [active, serverUrl, tick, accountId, actions])

  /**
   * The same rhythm as sync, because it is the same kind of thing: a background pull that
   * is harmless to run more often than necessary.
   *
   * Deliberately does not pull once immediately: the effect above already does that when
   * the account becomes known, and bumping the trigger here tore that first pull down
   * before it could write anything.
   */
  useEffect(() => {
    if (!active) return
    setLoading(true)
    const interval = setInterval(refresh, 60_000)
    const wake = () => refresh()
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
  }, [active, refresh])

  /**
   * Asks that have been sent to me and not yet answered.
   *
   * Read from the log rather than from memory, so a question somebody asked survives a
   * reload — which is the whole reason a received ask is written down at all.
   */
  const asks = useMemo(() => openAsks(events), [events])
  const moves = useMemo(() => unseenFriendMoves(events), [events])

  /** Run an action and turn a refusal into words rather than a thrown error. */
  const attempt = useCallback(
    async (work: () => Promise<{ ok: boolean; error?: string }>): Promise<string | null> => {
      setError(null)
      try {
        const result = await work()
        if (!result.ok) {
          setError(result.error ?? 'that did not work')
          return result.error ?? 'that did not work'
        }
        refresh()
        return null
      } catch {
        setError('could not reach the server')
        return 'could not reach the server'
      }
    },
    [refresh],
  )

  return {
    available: !off,
    off,
    friends,
    asks,
    moves,
    loading,
    error,
    refresh,

    add: (username) =>
      attempt(async () => {
        const result = await addFriend(serverUrl, username)
        if (result.ok) setFriends(result.value)
        if (result.ok) flashSaved()
        return result
      }),
    accept: (userId) =>
      attempt(async () => {
        const result = await acceptFriend(serverUrl, userId)
        if (result.ok) setFriends(result.value)
        if (result.ok) flashSaved()
        return result
      }),
    decline: (userId) =>
      attempt(async () => {
        const result = await declineFriend(serverUrl, userId)
        if (result.ok) setFriends(result.value)
        return result
      }),
    remove: (userId) =>
      attempt(async () => {
        const result = await removeFriend(serverUrl, userId)
        if (result.ok) setFriends(result.value)
        return result
      }),

    ask: ({ to, context, note }) =>
      attempt(async () => {
        const result = await askForMove(serverUrl, { to: to.userId, context, note })
        if (!result.ok) return result
        // Written down here as well as sent, so the card can say who was asked and when —
        // and so it survives the server being unreachable later.
        await actions.recordAsk({
          id: context.blipId,
          messageId: result.value.message.id,
          direction: 'out',
          userId: to.userId,
          username: to.username,
        })
        flashSaved()
        return { ok: true }
      }),

    suggest: ({ to, askId, blipId, move, note }) =>
      attempt(async () => {
        const result = await sendMove(serverUrl, { to: to.userId, askId, blipId, move, note })
        if (!result.ok) return result
        // A fresh id: the Inkling is theirs, so there is nothing here for the fold to
        // attach this to. It is a record of something you did, not of something you have.
        await actions.recordMoveSent({
          id: newId(),
          messageId: result.value.message.id,
          to: to.userId,
          toUsername: to.username,
          moveSpec: move,
          blipId,
          askId: askId || undefined,
        })
        flashSaved()
        return { ok: true }
      }),

    note: ({ to, blipId, kind, moveTitle, text }) =>
      attempt(async () => {
        const result = await sendNote(serverUrl, {
          to: to.userId,
          kind,
          moveTitle,
          text,
          blipId,
        })
        if (!result.ok) return result
        await actions.addFriendNote(newId(), {
          id: result.value.message.id,
          direction: 'out',
          kind,
          username: to.username,
          userId: to.userId,
          moveTitle,
          blipId: blipId || undefined,
          text,
          at: result.value.message.at,
        })
        flashSaved()
        return { ok: true }
      }),

    clearMove: async ({ messageId, blipId }) => {
      try {
        await actions.markMoveSeen(blipId, messageId)
        return null
      } catch {
        return 'could not clear that'
      }
    },

    theirInklings: async (userId) => {
      const result = await friendInklings(serverUrl, userId)
      if (!result.ok) {
        setError(result.error)
        return []
      }
      return result.value
    },
  }
}

/**
 * Turn one message into an event.
 *
 * Every kind lands in the log, including the ones the fold has no use for — a sent move
 * and a received ask are both records of something that happened, and the screens that
 * show them read the log directly. Writing them down is also what makes the offset safe to
 * advance: a message that has been recorded will not be needed again.
 */
async function ingest(message: SocialMessage, actions: InklingActions): Promise<void> {
  switch (message.kind) {
    case 'ask':
      await actions.recordAsk({
        id: newId(),
        messageId: message.id,
        direction: 'in',
        userId: message.from,
        username: message.fromUsername,
        context: message.context,
        note: message.note,
      })
      return

    case 'move':
      await actions.receiveFriendMove({
        id: message.blipId,
        messageId: message.id,
        from: message.from,
        fromUsername: message.fromUsername,
        moveSpec: message.move,
        note: message.note,
      })
      return

    case 'kudos':
    case 'thanks':
      await actions.addFriendNote(message.blipId, {
        id: message.id,
        direction: 'in',
        kind: message.kind,
        username: message.fromUsername,
        userId: message.from,
        moveTitle: message.kind === 'kudos' ? message.moveTitle : undefined,
        blipId: message.blipId || undefined,
        text: message.text,
        at: message.at,
      })
  }
}

/**
 * Asks from friends that nobody has answered yet, newest first.
 *
 * Pure, because the matching is the part that can be wrong and it was: an answer was
 * recognised only by the ask it named, and only one of the two ways of sending a move knows
 * that. Answering from the ask in Notifications names it; browsing a friend's Inklings and
 * suggesting one there does not, so the question stayed in the list.
 *
 * Matching by the Inkling as well makes it independent of how you got there — and matching
 * by who it went to keeps it honest: two friends can be asked about the same Inkling, and
 * answering one of them is not answering the other.
 */
export function openAsks(events: BlipEvent[]): ReceivedAsk[] {
  const sent = events.filter((event) => event.t === 'friendMoveSent')

  return events
    .filter(
      (event): event is Extract<BlipEvent, { t: 'friendAsk' }> =>
        event.t === 'friendAsk' && event.direction === 'in' && Boolean(event.context),
    )
    .filter(
      (ask) =>
        !sent.some((move) => {
          if (move.t !== 'friendMoveSent') return false
          if (move.askId && move.askId === ask.messageId) return true
          return (
            move.to === ask.userId && Boolean(move.blipId) && move.blipId === ask.context?.blipId
          )
        }),
    )
    .map((ask) => ({
      messageId: ask.messageId,
      userId: ask.userId,
      username: ask.username,
      context: ask.context as AskContext,
      note: ask.note,
      at: ask.at,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
}
