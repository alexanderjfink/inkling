import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

/**
 * Somebody's face, when they have put one there.
 *
 * Fetched rather than pointed at with `<img src>`: the route needs a session, and an image
 * tag cannot send one. The object URL is cached by hash, because the same people appear on
 * every card and re-fetching a face per render is how a list starts to feel slow.
 */
const cached = new Map<string, string>()

export function useAvatar(ownerId: string | undefined, hash: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (hash ? (cached.get(hash) ?? null) : null))

  useEffect(() => {
    if (!ownerId || !hash) {
      setSrc(null)
      return
    }
    const known = cached.get(hash)
    if (known) {
      setSrc(known)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/avatar/${encodeURIComponent(ownerId)}`)
        if (!res.ok) return
        const url = URL.createObjectURL(await res.blob())
        cached.set(hash, url)
        if (!cancelled) setSrc(url)
      } catch {
        // No picture is a perfectly ordinary state, not an error worth showing.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId, hash])

  return src
}
