import { useSavedTick } from '../state/useSavedTick'

/**
 * A big green check, and then nothing.
 *
 * Deliberately not a toast, and deliberately not in the corner: the things it confirms are
 * the ones you hand to somebody else, and confirmation that has to be found is not
 * confirmation. It does not take touches — `pointer-events-none` — so it cannot trap anybody
 * who is already typing the next thing, and it removes itself after a second and a half.
 */
export function SavedTick() {
  const shown = useSavedTick()
  if (!shown) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span className="saved-tick flex h-36 w-36 items-center justify-center rounded-full bg-good shadow-card">
        {/* A glyph, not an SVG path with a stroke-dash draw-on.
            The drawn version was the nicer idea and it did not paint: a white stroke on a
            `path` inside a 48-unit viewBox, with the dash animation underneath it, rendered as
            an empty green disc — twice, in two configurations, with nothing in the computed
            styles to say why. A character cannot do that. The animation the moment needs is
            the pop and the hold, and this keeps both. */}
        <span
          className="saved-tick__mark text-7xl leading-none font-semibold text-white"
          aria-hidden="true"
        >
          ✓
        </span>
        <span className="sr-only">saved</span>
      </span>
    </div>
  )
}
