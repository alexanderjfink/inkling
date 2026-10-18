import { useEffect, useState } from 'react'

/**
 * Whether to get out of the way of somebody who is reading.
 *
 * The usual phone behaviour, and worth copying: the thing that floats over the content hides
 * when you are going down a page and comes back the moment you go up at all — because scrolling
 * up is what you do when you have lost your place or want somewhere else to be, and scrolling
 * down is what you do when you are reading and want the text.
 *
 * It listens in the *capture* phase, because scroll events do not bubble: the thing that scrolls
 * is sometimes the page and sometimes a card inside it, and this has to hear both without either
 * of them knowing about it.
 */
export function useHiddenWhileReadingDown(revealAfter = 64): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = 0
    /** How far down we have come since the last time we went up. */
    let since = 0

    const onScroll = (event: Event): void => {
      const target = event.target
      const top =
        target instanceof HTMLElement && target !== document.documentElement
          ? target.scrollTop
          : window.scrollY

      const delta = top - last
      last = top
      if (Math.abs(delta) < 2) return

      // Any upward movement at all brings it back; going down has to amount to something.
      since = delta < 0 ? 0 : since + delta
      setHidden(since > revealAfter)
    }

    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [revealAfter])

  return hidden
}
