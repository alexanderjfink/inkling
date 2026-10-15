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
    sync,
    serverUrl,
    loaded: true,
    provider,
    model,
    refreshModel,
    modelConfigured: model?.configured ?? false,
  }
}
