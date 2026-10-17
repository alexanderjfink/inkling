import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { Spinner } from './Spinner'

/**
 * A picture on somebody else's Inkling.
 *
 * Not from this device's store: it is theirs, it may never have been here, and it is only
 * served at all because the Inkling it is on was shared with friends. So it is fetched from
 * the one route that will hand it over, with the session, and turned into an object URL —
 * the same shape as `StoredImage`, for the same reason: a hash is not a URL, and the app
 * never puts a bare `<img src>` on something it has not been given.
 */
export function FriendImage({
  serverUrl,
  userId,
  hash,
  className,
}: {
  serverUrl: string
  userId: string
  hash: string
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [problem, setProblem] = useState(false)

  useEffect(() => {
    let cancelled = false
    let made: string | null = null
    setUrl(null)
    setProblem(false)

    void (async () => {
      try {
        // `serverUrl` is the API prefix itself — `/api`, or a full address ending in it — so the
        // path goes on the end without another one. Putting `/api` here as well asked the
        // server for `/api/api/social/...`, which is a 404 and reads as "not shared".
        const base = serverUrl.replace(/\/+$/, '')
        const res = await apiFetch(`${base}/social/friends/${userId}/blobs/${hash}`)
        if (!res.ok) throw new Error('not allowed')
        const blob = await res.blob()
        if (cancelled) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      } catch {
        if (!cancelled) setProblem(true)
      }
    })()

    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [serverUrl, userId, hash])

  if (problem) {
    return <span className="text-xs text-ink-faint">picture not shared</span>
  }
  if (!url) return <Spinner className="h-3.5 w-3.5" />
  return <img src={url} alt="" className={className} />
}
