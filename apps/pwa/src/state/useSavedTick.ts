import { useEffect, useState } from 'react'

/**
 * The tick that says it went.
 *
 * Saving something is quiet by design — an Inkling appears, a count goes up, and nothing
 * announces that anything happened. That is right for the tenth capture of an afternoon and
 * wrong for the moment you hand something over: a move you thought of for a friend, an
 * answer, a note. Those are worth a beat of confirmation, so there is exactly one of them,
 * it is unmissable, and it is over in a second and a half.
 *
 * Module state rather than context, like the move suggestion and its session caches: the
 * thing that flashes it is often a few layers below the thing that draws it, and threading a
 * callback through every screen to say "a green tick, please" is more wiring than the feature.
 */
const HOLD_MS = 1500

let timer: ReturnType<typeof setTimeout> | null = null
let visible = false
const listeners = new Set<(value: boolean) => void>()

function publish(next: boolean): void {
  visible = next
  for (const listener of listeners) listener(next)
}

/**
 * Show the tick. Calling it again while one is up restarts the clock rather than queueing a
 * second tick — two saves in quick succession are one thing that happened, twice.
 */
export function flashSaved(): void {
  if (timer) clearTimeout(timer)
  publish(true)
  timer = setTimeout(() => publish(false), HOLD_MS)
}

/** For tests and for anything that needs to know how long the moment lasts. */
export const SAVED_TICK_MS = HOLD_MS

export function useSavedTick(): boolean {
  const [shown, setShown] = useState(visible)

  useEffect(() => {
    listeners.add(setShown)
    setShown(visible)
    return () => {
      listeners.delete(setShown)
    }
  }, [])

  return shown
}
