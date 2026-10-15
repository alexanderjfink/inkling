import type { BlipEvent, BlipEventBody, BlipType, CaptureInput, MoveSpec } from '@inkling/domain'
import { newId, project, snoozeUntil } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { type CaptureDraft, extractTopics, guessType, inferBody } from '../capture'
import { AppendOnlyLog } from '../storage/appendOnlyLog'

let singleton: AppendOnlyLog | null = null

/** Process-wide storage instance (a single device log). */
export function storage(): AppendOnlyLog {
  singleton ??= new AppendOnlyLog()
  return singleton
}

export type SnoozeReason = 'engaged' | 'skipped' | 'shown'

export interface InklingActions {
  capture(draft: CaptureDraft): Promise<BlipEvent>
  addNote(id: string, text: string): Promise<BlipEvent>
  snooze(id: string, until?: string, triggers?: string[]): Promise<BlipEvent>
  snoozeAfter(id: string, reason: SnoozeReason, streak?: number): Promise<BlipEvent>
  retire(id: string, reason?: string): Promise<BlipEvent>
  revive(id: string): Promise<BlipEvent>
  pinToDesktop(id: string): Promise<BlipEvent>
  unpinFromDesktop(id: string): Promise<BlipEvent>
  /** Record that a move was put in front of the user, so it is not repeated blindly. */
  recordMoveShown(id: string, moveSpec: MoveSpec): Promise<BlipEvent>
  /** Keep this move for later, or let it go. */
  saveMove(id: string, moveSpec: MoveSpec): Promise<BlipEvent>
  unsaveMove(id: string, moveId: string): Promise<BlipEvent>
  /** Remove something you added. A tombstone, so nothing is really rewritten. */
  removeEntry(id: string, entryId: string): Promise<BlipEvent>
  /** Correct the Inkling itself. */
  editBlip(id: string, patch: { title?: string; body?: string }): Promise<BlipEvent>
  /** Finish a move: keep the result, log the move with its completion time, and
   * stretch the interval. */
  completeMove(id: string, moveSpec: MoveSpec, text: string): Promise<BlipEvent>
  /** A blip has been written out as a note; the path is where it landed. */
  promote(id: string, notePath: string): Promise<BlipEvent>
  classify(id: string, type: BlipType): Promise<BlipEvent>
  link(id: string, otherId: string, reason?: string): Promise<BlipEvent>
}

export function useInkling() {
  const [events, setEvents] = useState<BlipEvent[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
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
  }, [])

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
        }
        return store.append(emitted)
      },
      addNote(id, text) {
        return storage().append({
          t: 'entry',
          id,
          entry: { id: newId(), kind: 'note', text, at: new Date().toISOString() },
        })
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
      pinToDesktop(id) {
        return storage().append({ t: 'promoteToDesktop', id })
      },
      unpinFromDesktop(id) {
        return storage().append({ t: 'unpinFromDesktop', id })
      },
      promote(id, notePath) {
        return storage().append({ t: 'promoted', id, notePath })
      },
      recordMoveShown(id, moveSpec) {
        return storage().append({ t: 'moveShown', id, moveId: moveSpec.id, moveSpec })
      },
      saveMove(id, moveSpec) {
        return storage().append({ t: 'moveSaved', id, moveId: moveSpec.id, moveSpec })
      },
      unsaveMove(id, moveId) {
        return storage().append({ t: 'moveUnsaved', id, moveId })
      },
      removeEntry(id, entryId) {
        return storage().append({ t: 'entryRemoved', id, entryId })
      },
      editBlip(id, patch) {
        return storage().append({ t: 'edited', id, ...patch })
      },
      async completeMove(id, moveSpec, text) {
        const store = storage()
        const before = project(await store.allEvents()).find((blip) => blip.id === id)
        const streak = before?.schedule.timesEngaged ?? 0

        // A move can be completed without having been recorded as shown, so make sure
        // the history has an entry for it — otherwise the log would miss it.
        const alreadyShown = before?.moves.some((move) => move.moveId === moveSpec.id) ?? false
        if (!alreadyShown) {
          await store.append({ t: 'moveShown', id, moveId: moveSpec.id, moveSpec })
        }

        if (text.trim()) {
          await store.append({
            t: 'entry',
            id,
            moveId: moveSpec.id,
            entry: { id: newId(), kind: 'note', text: text.trim(), at: new Date().toISOString() },
          })
        }
        await store.append({ t: 'moveDone', id, moveId: moveSpec.id })
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
