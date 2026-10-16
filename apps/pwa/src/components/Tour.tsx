import { useEffect, useState } from 'react'
import type { TourStep } from '../tour'

/**
 * The walkthrough.
 *
 * A ring is drawn around the real control and the dimming is done by that ring's own
 * shadow, rather than by a scrim with the control raised above it. One element means the
 * highlighted thing cannot end up behind the thing that is supposed to be dimming it —
 * which is the usual way this kind of overlay breaks, and it breaks differently in every
 * browser's stacking rules.
 */
export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const step = steps[index]
  const last = index === steps.length - 1

  useEffect(() => {
    const element = step?.anchor
      ? document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
      : null
    if (!element) {
      setRect(null)
      return
    }

    // Instant rather than smooth: the ring is measured from this element, and a scroll
    // still in flight would leave the highlight pointing at where the control used to be.
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    const measure = () => setRect(element.getBoundingClientRect())
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone()
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(value + 1, steps.length - 1))
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(value - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone, steps.length])

  if (!step) return null

  // Above the control when there is not room beneath it, so the card is never cut off by
  // the bottom of the screen — which on a phone is also where the keyboard appears.
  const roomBelow = rect ? window.innerHeight - rect.bottom : 0
  const placeAbove = rect ? roomBelow < 280 : false

  return (
    <div className="fixed inset-0 z-50">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: (step.radius ?? 20) + 8,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.62)',
            transition: 'all 160ms ease',
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/62" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label="How Inkling works"
        className="card fixed left-4 right-4 z-50 p-4"
        style={
          rect
            ? placeAbove
              ? { top: rect.top - 16, transform: 'translateY(-100%)' }
              : { top: rect.bottom + 16 }
            : { top: '50%', transform: 'translateY(-50%)' }
        }
      >
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">
          {index + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-sm text-ink-soft">{step.body}</p>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={onDone} className="quiet text-xs underline">
            skip
          </button>
          <div className="ml-auto flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((value) => value - 1)}
                className="rounded-full border border-line px-4 py-2 text-xs"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (last ? onDone() : setIndex((value) => value + 1))}
              className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
            >
              {last ? 'Start writing' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
