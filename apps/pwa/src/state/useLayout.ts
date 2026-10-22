import { useEffect, useState } from 'react'

/**
 * How much room the app has, in three sizes rather than two.
 *
 * `compact` is the phone, and it is the layout that matters: one card, one page, gestures and
 * a tray, because there is nowhere else to put anything.
 *
 * `medium` is a tablet — two columns, no rail. Still a touch device, still likely held.
 *
 * `wide` is a desktop, where a mouse, a keyboard and a thousand pixels of unused space make
 * paging by swipe look like a missing feature.
 *
 * Width decides the layout, not the pointer. A tablet with a trackpad should get the two-column
 * layout it has room for, and a narrow window on a desktop should get the phone's.
 */
export type Layout = 'compact' | 'medium' | 'wide'

/** Tailwind's `md`, and a width where a third column starts to fit rather than squeeze. */
const MEDIUM = '(min-width: 768px)'
const WIDE = '(min-width: 1180px)'

function measure(): Layout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'compact'
  if (window.matchMedia(WIDE).matches) return 'wide'
  if (window.matchMedia(MEDIUM).matches) return 'medium'
  return 'compact'
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(measure)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [window.matchMedia(MEDIUM), window.matchMedia(WIDE)]
    const update = () => setLayout(measure())
    for (const query of queries) query.addEventListener('change', update)
    // The query can change between the first render and this effect — a rotation, or a window
    // dragged across the breakpoint before mount.
    update()
    return () => {
      for (const query of queries) query.removeEventListener('change', update)
    }
  }, [])

  return layout
}
