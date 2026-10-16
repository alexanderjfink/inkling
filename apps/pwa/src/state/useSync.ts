import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ModelHealth, ProxyProvider } from '../llm/proxy'
import { type SyncReport, Syncer } from '../sync/syncer'
import { HttpTransport } from '../sync/transport'
import { storage } from './useInkling'

/**
 * Sync is a background loop, not a mode. It runs on load, on an interval, and
 * whenever the app is focused or the network returns — always idempotent, so
 * running it more often than necessary is harmless.
 *
 * It waits until there is a session: before signing in, every request would be a 401,
 * and the app would report a broken server when it simply is not signed in yet.
 */
export function useSync({
  serverUrl,
  enabled = true,
  accountId = null,
}: {
  serverUrl: string
  enabled?: boolean
  /** Part of the identity of the store being synced, so switching accounts re-syncs. */
  accountId?: string | null
}) {
  const [report, setReport] = useState<SyncReport | null>(null)
  const [syncing, setSyncing] = useState(false)
  /**
   * A sync has finished, success or failure.
   *
   * Distinct from `report`, which stays null when the server is unreachable: callers that
   * need to know "is the local store as complete as it is going to get" must not hang on
   * a server that is simply down.
   */
  const [attempted, setAttempted] = useState(false)

  /**
   * Sync state belongs to the account that was synced, so a switch clears it.
   *
   * More than cosmetic: `attempted` left true would claim a sync had already happened for
   * an account that has never synced, and `report` would carry the previous person's
   * event counts — which is the difference between offering the walkthrough and not, and
   * between Settings telling the truth and telling somebody else's.
   *
   * Reset during render, not in an effect. An effect runs after this render has been
   * committed, so whatever reads these would already have read the stale values.
   */
  const [syncedAccount, setSyncedAccount] = useState(accountId)
  if (syncedAccount !== accountId) {
    setSyncedAccount(accountId)
    setReport(null)
    setAttempted(false)
    setSyncing(false)
  }

  const sync = useCallback(async (): Promise<SyncReport> => {
    const store = storage()
    await store.init()
    setSyncing(true)
    try {
      const result = await new Syncer(store, new HttpTransport(serverUrl)).sync()
      setReport(result)
      return result
    } finally {
      setSyncing(false)
      setAttempted(true)
    }
  }, [serverUrl])

  useEffect(() => {
    if (!enabled) return
    void sync()
    const interval = setInterval(() => void sync(), 60_000)
    const wake = () => void sync()
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
  }, [enabled, accountId, sync])

  // The model lives behind the server, so the provider is just a URL.
  const provider = useMemo(() => new ProxyProvider(serverUrl), [serverUrl])

  const [model, setModel] = useState<ModelHealth | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void provider.health().then((health) => {
      if (!cancelled) setModel(health)
    })
    return () => {
      cancelled = true
    }
  }, [provider, enabled])

  /** Re-read the model after the settings screen changed something. */
  const refreshModel = useCallback(async () => {
    provider.forget()
    setModel(await provider.health())
  }, [provider])

  return {
    report,
    syncing,
    attempted,
    sync,
    serverUrl,
    loaded: true,
    provider,
    model,
    refreshModel,
    modelConfigured: model?.configured ?? false,
  }
}
