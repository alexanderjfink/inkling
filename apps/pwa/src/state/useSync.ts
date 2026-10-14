import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ModelHealth, ProxyProvider } from '../llm/proxy'
import { DEFAULT_SERVER_URL, SERVER_URL_KEY, type SyncReport, Syncer } from '../sync/syncer'
import { HttpTransport } from '../sync/transport'
import { storage } from './useInkling'

/**
 * Sync is a background loop, not a mode. It runs on load, on an interval, and
 * whenever the app is focused or the network returns — always idempotent, so
 * running it more often than necessary is harmless.
 */
export function useSync() {
  const [report, setReport] = useState<SyncReport | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      const store = storage()
      await store.init()
      setServerUrl((await store.getSetting(SERVER_URL_KEY)) ?? DEFAULT_SERVER_URL)
      setLoaded(true)
    })()
  }, [])

  const sync = useCallback(async (): Promise<SyncReport> => {
    const store = storage()
    await store.init()
    const url = (await store.getSetting(SERVER_URL_KEY)) ?? DEFAULT_SERVER_URL
    setSyncing(true)
    try {
      const result = await new Syncer(store, new HttpTransport(url)).sync()
      setReport(result)
      return result
    } finally {
      setSyncing(false)
    }
  }, [])

  const saveServerUrl = useCallback(async (url: string) => {
    const store = storage()
    await store.init()
    const clean = url.trim() || DEFAULT_SERVER_URL
    await store.setSetting(SERVER_URL_KEY, clean)
    setServerUrl(clean)
  }, [])

  useEffect(() => {
    if (!loaded) return
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
  }, [loaded, sync])

  // The model lives behind the server, so the provider is just a URL.
  const provider = useMemo(() => new ProxyProvider(serverUrl), [serverUrl])

  const [model, setModel] = useState<ModelHealth | null>(null)
  useEffect(() => {
    let cancelled = false
    void provider.health().then((health) => {
      if (!cancelled) setModel(health)
    })
    return () => {
      cancelled = true
    }
  }, [provider])

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
    saveServerUrl,
    loaded,
    provider,
    model,
    refreshModel,
    modelConfigured: model?.configured ?? false,
  }
}
