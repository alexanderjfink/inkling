import { useCallback, useEffect, useState } from 'react'
import { getDeviceSetting, setDeviceSetting } from '../deviceSettings'
import { DEFAULT_SERVER_URL, SERVER_URL_KEY } from '../sync/syncer'

/**
 * Where the server is.
 *
 * Lifted out of `useSync` and put in device storage because two things now need it and
 * one of them decides whether the other may run: auth has to ask the server who you are
 * before sync is allowed to ask it for anything else.
 */
export function useServerUrl() {
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setServerUrl(getDeviceSetting(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL)
    setLoaded(true)
  }, [])

  const save = useCallback(async (url: string) => {
    const clean = url.trim() || DEFAULT_SERVER_URL
    setDeviceSetting(SERVER_URL_KEY, clean)
    setServerUrl(clean)
  }, [])

  return { serverUrl, save, loaded }
}
