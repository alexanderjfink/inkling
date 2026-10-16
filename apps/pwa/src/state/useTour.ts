import { useEffect, useState } from 'react'
import { TOUR_KEY } from '../tour'
import { storage } from './useInkling'

/**
 * Whether to open the walkthrough by itself.
 *
 * Only for someone who has nothing yet. An account that has been used has already worked
 * out what the app is for, and explaining it again is the opposite of help.
 */
export function useTour({
  accountId,
  ready,
  synced,
  hasHistory,
}: {
  /** Whose store to read. The answer is per account, so it is re-decided when this changes. */
  accountId: string | null
  ready: boolean
  /** A sync has finished — success or failure. Nothing is decided before that. */
  synced: boolean
  /**
   * Evidence that this account has been used before.
   *
   * Two sources, because they cover opposite cases. The sync's `addedEvents` is the fresh
   * device — the Inklings are on the server, and they reach the local projection a beat
   * after the sync reports itself done, so counting them here would still say zero. The
   * local count is the device that already holds them, whose sync adds nothing at all.
   *
   * Not the local count alone: that is exactly what greets every established account as
   * brand new on a new phone, which is the case this guard exists for.
   */
  hasHistory: boolean
}) {
  const [open, setOpen] = useState(false)
  /**
   * Which account the question has been settled for, rather than a boolean.
   *
   * A boolean would be wrong the moment someone signs out and in as somebody else on the
   * same browser: this hook is not remounted by that, so a plain flag would leave the
   * second person never offered the walkthrough — and their store, which is a different
   * database, would never even be read.
   */
  const [settled, setSettled] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !synced || !accountId || settled === accountId) return
    const used = hasHistory
    void (async () => {
      const seen = await storage().getSetting(TOUR_KEY)
      setSettled(accountId)
      if (!seen && !used) setOpen(true)
    })()
  }, [accountId, ready, synced, settled, hasHistory])

  return { open, setOpen }
}
