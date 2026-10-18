import type {
  BlipEvent,
  BlipEventBody,
  BlipType,
  Block,
  CaptureInput,
  AskContext,
  EntryContext,
  EntryKind,
  FeedbackContext,
  FriendNote,
  MoveSpec,
  Visibility,
  RejectionContext,
} from '@inkling/domain'
import { DEMO_INPUT, DEMO_MOVE, DEMO_TYPE, newId, project, snoozeUntil } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { type CaptureDraft, type EntryDraft, extractTopics, guessType, inferBody } from '../capture'
import { AppendOnlyLog } from '../storage/appendOnlyLog'
import { flashSaved } from './useSavedTick'

let singleton: AppendOnlyLog | null = null
let singletonKey: string | null = null

/**
 * Point storage at an account.
 *
 * The local database is per-*origin*, not per-person. Without this, signing out and
 * signing in as someone else on the same browser would open the first person's
 * Inklings — their log is still in this browser, and nothing about the origin says
 * whose it is. The account id becomes part of the database name, so two accounts on one
 * device are genuinely two stores rather than one shared by accident.
 */
export function setAccount(userId: string | null): void {
  const key = userId ?? 'local'
  if (key === singletonKey && singleton) return
  singletonKey = key
  singleton = new AppendOnlyLog(key === 'local' ? undefined : `inkling:${key}`)
}

/** Process-wide storage instance for the current account (a single device log). */
export function storage(): AppendOnlyLog {
  singleton ??= new AppendOnlyLog()
  return singleton
}

export type SnoozeReason = 'engaged' | 'skipped' | 'shown'

export interface InklingActions {
  capture(draft: CaptureDraft): Promise<BlipEvent>
  /**
   * Write the example Inkling, with its move already chosen.
   *
   * Two events, because that is what really happens: you notice something, and later a
   * move is put in front of you. Going through the same doors means the example is an
   * Inkling in every way that matters — it can be reviewed, written against, put down and
   * removed — and none of that is a special case that can rot.
   */
  seedDemo(): Promise<void>
  /**
   * Say something about the app itself.
   *
   * Written to the same log as everything else, because that is the only thing that syncs
   * and is never rewritten — so it reaches the server without a second mechanism, and it
   * cannot be lost by a failed request.
   */
  giveFeedback(text: string, context: FeedbackContext): Promise<BlipEvent>
  /** Change who may see this Inkling. Private is the default and can always be returned to. */
  share(id: string, visibility: Visibility): Promise<BlipEvent>
  /**
   * Keep a move a friend thought of.
   *
   * The message only carried it; this is the recipient deciding to keep it, which is what
   * makes it survive the server going away and reach their other devices.
   */
  receiveFriendMove(input: {
    id: string
    messageId: string
    from: string
    fromUsername: string
    moveSpec: MoveSpec
    note?: string
  }): Promise<BlipEvent>
  /** A record of having asked, so the card can say who was asked. */
  recordAsk(input: {
    id: string
    messageId: string
    direction: 'in' | 'out'
    userId: string
    username: string
    context?: AskContext
    note?: string
  }): Promise<BlipEvent>
  /** A record of having suggested a move for somebody else's Inkling. */
  recordMoveSent(input: {
    id: string
    messageId: string
    to: string
    toUsername: string
    moveSpec: MoveSpec
    blipId?: string
    askId?: string
  }): Promise<BlipEvent>
  /** A note from a friend, or one sent to one. */
  addFriendNote(id: string, note: FriendNote): Promise<BlipEvent>
  /**
   * Wave away the announcement for a move a friend sent.
   *
   * The Inkling and the move are untouched: this ends the telling, not the fact. Writing it
   * down rather than holding it in memory is what makes clearing a notification on the phone
   * clear it on the laptop as well.
   */
  markMoveSeen(id: string, messageId: string): Promise<BlipEvent>
  /** The same for a question: read, not answered. */
  markAskSeen(id: string, messageId: string): Promise<BlipEvent>
  /**
   * "Not this move", for a move a friend sent.
   *
   * Off the card for good, and still in the log and in the history with them. The fold marks
   * the move itself, so nothing downstream has to be told about it twice.
   */
  dismissFriendMove(id: string, messageId: string): Promise<BlipEvent>
  /**
   * Something written down.
   *
   * Takes whatever came with it as well as the words: a link, a picture, or both. An entry
   * used to be text and only text, so the things people actually collect — a photograph of
   * what they meant, a page they found — had nowhere to go after the first capture.
   */
  addEntry(id: string, draft: EntryDraft): Promise<BlipEvent>
  snooze(id: string, until?: string, triggers?: string[]): Promise<BlipEvent>
  snoozeAfter(id: string, reason: SnoozeReason, streak?: number): Promise<BlipEvent>
  retire(id: string, reason?: string): Promise<BlipEvent>
  revive(id: string): Promise<BlipEvent>
  /**
   * Take it out of the app entirely. Distinct from retiring on purpose: retiring says
   * "not now", deleting says "not this". Both are tombstones, so neither is a rewrite.
   */
  deleteBlip(id: string): Promise<BlipEvent>
  pinToDesktop(id: string): Promise<BlipEvent>
  unpinFromDesktop(id: string): Promise<BlipEvent>
  /**
   * Record that a move was put in front of the user, so it is not repeated blindly.
   *
   * Null when it was already there, which is the ordinary case: the card records a move whenever
   * it is put in front of somebody, and the card remounts every time the round pages.
   */
  recordMoveShown(id: string, moveSpec: MoveSpec): Promise<BlipEvent | null>
  /**
   * Mark a suggestion as bad, keeping the context it was made in.
   *
   * Deliberately not the same as "not this one", which means "not at the moment" and is
   * not recorded at all. This is the signal that says the algorithm got it wrong, so it
   * carries what the model was working from — which is the only thing that can make the
   * next version better.
   */
  rejectMove(
    id: string,
    moveSpec: MoveSpec,
    context: RejectionContext,
    reason?: string,
    note?: string,
  ): Promise<BlipEvent>
  /** Keep this move for later, or let it go. */
  saveMove(id: string, moveSpec: MoveSpec): Promise<BlipEvent>
  unsaveMove(id: string, moveId: string): Promise<BlipEvent>
  /**
   * Forget what has been offered, keeping what was done.
   *
   * For when the history is wrong — moves recorded that were never seen — which leaves
   * the Inkling being offered variations of the same prompt because everything looks
   * used up.
   */
  forgetMoves(id: string): Promise<BlipEvent>
  /** Remove something you added. A tombstone, so nothing is really rewritten. */
  removeEntry(id: string, entryId: string): Promise<BlipEvent>
  /** Correct the Inkling itself, including what kind of thing it turned out to be. */
  editBlip(
    id: string,
    patch: { title?: string; body?: string; type?: BlipType },
  ): Promise<BlipEvent>
  /** Malleable structure: add, change or drop a block. */
  addBlock(id: string, block: Block): Promise<BlipEvent>
  updateBlock(id: string, blockId: string, patch: Partial<Omit<Block, 'id'>>): Promise<BlipEvent>
  removeBlock(id: string, blockId: string): Promise<BlipEvent>
  /** Store an image and hand back what to put in a block item. */
  storeImage(file: File): Promise<{ hash: string; mime: string }>
  /** Finish a move: keep the result, log the move with its completion time, and
   * stretch the interval. */
  completeMove(
    id: string,
    moveSpec: MoveSpec,
    draft: EntryDraft,
    context?: EntryContext,
  ): Promise<BlipEvent>
  /** A blip has been written out as a note; the path is where it landed. */
  promote(id: string, notePath: string): Promise<BlipEvent>
  classify(id: string, type: BlipType): Promise<BlipEvent>
  link(id: string, otherId: string, reason?: string): Promise<BlipEvent>
}

/**
 * What an entry is, from what came with it.
 *
 * The kinds already existed; nothing ever produced anything but `note`. A picture is
 * `media` so the card can lay it out as one, and a link on its own is `link`.
 */
function entryKind(draft: EntryDraft): EntryKind {
  if (draft.file) return 'media'
  if (draft.url && !draft.text?.trim()) return 'link'
  return 'note'
}

export function useInkling(accountId: string | null = null) {
  const [events, setEvents] = useState<BlipEvent[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Switching accounts switches stores, so this starts over rather than showing the
    // previous account's Inklings for a moment.
    setAccount(accountId)
    setReady(false)
    const store = storage()
    let alive = true
    const refresh = () => {
      void store.allEvents().then((all) => {
        if (alive) setEvents(all)
      })
    }
    void store.init().then(async () => {
      if (!alive) return
      setEvents(await store.allEvents())
      setReady(true)
    })
    const unsubscribe = store.subscribe(refresh)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [accountId])

  const blips = useMemo(() => project(events), [events])

  const actions = useMemo<InklingActions>(
    () => ({
      async capture(draft) {
        const store = storage()
        let mediaId: string | undefined
        let mime: string | undefined
        if (draft.kind === 'image' && draft.file) {
          const stored = await store.putBlob(draft.file)
          mediaId = stored.hash
          mime = stored.mime
        }
        const input: CaptureInput = {
          kind: draft.kind,
          text: draft.text?.trim() || undefined,
          url: draft.url?.trim() || undefined,
          mediaId,
          mime,
          filename: draft.file?.name,
        }
        const body = inferBody(input)
        const emitted: BlipEventBody = {
          t: 'captured',
          id: newId(),
          input,
          type: draft.type ?? guessType(input),
          body,
          topics: extractTopics(body ?? '', input.url),
          mediaIds: mediaId ? [mediaId] : undefined,
          visibility: draft.visibility,
        }
        const event = await store.append(emitted)
        // The two writes that *keep* something get the tick — a capture and an entry. Editing
        // a title or putting something down is not a moment, and a green check for it would
        // make the check mean nothing.
        flashSaved()
        return event
      },
      async seedDemo() {
        const store = storage()
        const id = newId()
        const body = inferBody(DEMO_INPUT)
        await store.append({
          t: 'captured',
          id,
          input: DEMO_INPUT,
          type: DEMO_TYPE,
          body,
          topics: extractTopics(body ?? '', DEMO_INPUT.url),
          demo: true,
        })
        // A move you saved is the one to show, without asking a model — which is how the
        // example works before anything has been set up.
        await store.append({
          t: 'moveSaved',
          id,
          moveId: DEMO_MOVE.id,
          moveSpec: DEMO_MOVE,
        })
      },
      share(id, visibility) {
        return storage().append({ t: 'shared', id, visibility })
      },
      receiveFriendMove(input) {
        return storage().append({
          t: 'friendMove',
          id: input.id,
          messageId: input.messageId,
          from: input.from,
          fromUsername: input.fromUsername,
          moveSpec: input.moveSpec,
          note: input.note,
        })
      },
      recordAsk(input) {
        return storage().append({ t: 'friendAsk', ...input })
      },
      recordMoveSent(input) {
        return storage().append({ t: 'friendMoveSent', ...input })
      },
      addFriendNote(id, note) {
        return storage().append({ t: 'friendNote', id, note })
      },
      markMoveSeen(id, messageId) {
        return storage().append({ t: 'friendMoveSeen', id, messageId })
      },
      markAskSeen(id, messageId) {
        return storage().append({ t: 'friendAskSeen', id, messageId })
      },
      dismissFriendMove(id, messageId) {
        return storage().append({ t: 'friendMoveDismissed', id, messageId })
      },
      giveFeedback(text, context) {
        // A fresh id rather than a blip's: the fold ignores events for ids it has not
        // seen, which is exactly right for something that is not about an Inkling.
        return storage().append({ t: 'feedback', id: newId(), text, context })
      },
      async addEntry(id, draft) {
        const event = await storage().append({
          t: 'entry',
          id,
          fromMessageId: draft.fromMessageId,
          entry: {
            id: newId(),
            kind: entryKind(draft),
            text: draft.text?.trim() || undefined,
            url: draft.url,
            mediaId: draft.file ? (await storage().putBlob(draft.file)).hash : undefined,
            at: new Date().toISOString(),
          },
        })
        flashSaved()
        return event
      },
      snooze(id, until, triggers) {
        return storage().append({ t: 'snoozed', id, until, triggers })
      },
      snoozeAfter(id, reason, streak = 0) {
        return storage().append({
          t: 'snoozed',
          id,
          until: snoozeUntil(reason, new Date(), streak),
        })
      },
      retire(id, reason) {
        return storage().append({ t: 'retired', id, reason })
      },
      revive(id) {
        return storage().append({ t: 'revived', id })
      },
      deleteBlip(id) {
        return storage().append({ t: 'deleted', id })
      },
      addBlock(id, block) {
        return storage().append({ t: 'blockAdded', id, block })
      },
      updateBlock(id, blockId, patch) {
        return storage().append({ t: 'blockUpdated', id, blockId, patch })
      },
      removeBlock(id, blockId) {
        return storage().append({ t: 'blockRemoved', id, blockId })
      },
      async storeImage(file) {
        const stored = await storage().putBlob(file)
        return { hash: stored.hash, mime: stored.mime }
      },
      pinToDesktop(id) {
        return storage().append({ t: 'promoteToDesktop', id })
      },
      unpinFromDesktop(id) {
        return storage().append({ t: 'unpinFromDesktop', id })
      },
      promote(id, notePath) {
        return storage().append({ t: 'promoted', id, notePath })
      },
      async recordMoveShown(id, moveSpec) {
        // Checked against the log rather than against whatever the screen happens to be holding:
        // the card remounts every time the round pages, and a screen that has just mounted knows
        // nothing about what it recorded a moment ago. Without this the log filled up with the
        // same offering over and over.
        const store = storage()
        const before = project(await store.allEvents()).find((blip) => blip.id === id)
        const already = before?.moves.some(
          (entry) => entry.moveId === moveSpec.id && entry.spec.title === moveSpec.title,
        )
        if (already) return null
        return store.append({ t: 'moveShown', id, moveId: moveSpec.id, moveSpec })
      },
      rejectMove(id, moveSpec, context, reason, note) {
        return storage().append({
          t: 'moveRejected',
          id,
          moveId: moveSpec.id,
          moveSpec,
          reason,
          note,
          context,
        })
      },
      saveMove(id, moveSpec) {
        return storage().append({ t: 'moveSaved', id, moveId: moveSpec.id, moveSpec })
      },
      unsaveMove(id, moveId) {
        return storage().append({ t: 'moveUnsaved', id, moveId })
      },
      forgetMoves(id) {
        return storage().append({ t: 'movesForgotten', id })
      },
      removeEntry(id, entryId) {
        return storage().append({ t: 'entryRemoved', id, entryId })
      },
      editBlip(id, patch) {
        return storage().append({ t: 'edited', id, ...patch })
      },
      async completeMove(id, moveSpec, draft, context) {
        const store = storage()
        const before = project(await store.allEvents()).find((blip) => blip.id === id)
        const streak = before?.schedule.timesEngaged ?? 0

        /**
         * A move from a friend is not app move history.
         *
         * `moveShown` and `moveDone` record what the *app* suggested and what became of it,
         * and a friend's move logged there is how the log filled up with "offered" entries
         * for moves nobody was offered. What a friend's move keeps instead is the entry that
         * names it, which is what the queue reads.
         */
        const fromFriend = draft.fromMessageId

        if (!fromFriend) {
          // A move can be completed without having been recorded as shown, so make sure the
          // history has an entry for it — otherwise the log would miss it.
          const alreadyShown = before?.moves.some((move) => move.moveId === moveSpec.id) ?? false
          if (!alreadyShown) {
            await store.append({ t: 'moveShown', id, moveId: moveSpec.id, moveSpec })
          }
        }

        const text = draft.text?.trim() ?? ''
        if (text || draft.url || draft.file) {
          await store.append({
            t: 'entry',
            id,
            moveId: fromFriend ? undefined : moveSpec.id,
            fromMessageId: fromFriend,
            entry: {
              id: newId(),
              kind: entryKind(draft),
              text: text || undefined,
              url: draft.url,
              mediaId: draft.file ? (await store.putBlob(draft.file)).hash : undefined,
              at: new Date().toISOString(),
              // The prompt and the material that surrounded this, kept with it. Nothing
              // else in the log has them: they were fetched, shown once, and dropped.
              context,
            },
          })
        }
        if (!fromFriend) await store.append({ t: 'moveDone', id, moveId: moveSpec.id })
        return store.append({
          t: 'snoozed',
          id,
          until: snoozeUntil('engaged', new Date(), streak),
        })
      },
      classify(id, type) {
        return storage().append({ t: 'classified', id, type })
      },
      link(id, otherId, reason) {
        return storage().append({ t: 'linked', id, otherId, reason })
      },
    }),
    [],
  )

  return { ready, events, blips, actions }
}
