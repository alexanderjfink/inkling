import { useEffect, useState } from 'react'
import { storage } from '../state/useInkling'
import { Spinner } from './Spinner'

/**
 * An image from the content-addressed store, resolved to a displayable URL.
 *
 * The blob may not have arrived yet — an event can reach this device before its media
 * does — so "not here yet" is a real state rather than an error.
 */
export function StoredImage({ hash, className }: { hash: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setMissing(false)
    void storage()
      .blobUrl(hash)
      .then((found) => {
        if (cancelled) return
        if (found) setUrl(found)
        else setMissing(true)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [hash])

  if (missing) {
    return <span className="text-[11px] text-ink-faint">image not here yet</span>
  }
  if (!url) return <Spinner className="h-3.5 w-3.5" />
  return <img src={url} alt="" className={className} />
}
