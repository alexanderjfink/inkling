import type { BlipType, CaptureInput, MoveSpec } from './events'

/**
 * The example Inkling.
 *
 * A real Inkling, written through the same door as any other, because what is being
 * demonstrated is what happens *after* you notice something. A separate demo mode would
 * show a version of the app that does not exist, and teach the wrong thing.
 *
 * Chosen to be nobody's life: the person using it has never told the app anything, and an
 * example that pretended otherwise would read as the app knowing more than it does.
 */
export const DEMO_INPUT: CaptureInput = {
  kind: 'text',
  text: 'Learn a few chords on the keyboard instead of just owning one',
}

export const DEMO_TYPE: BlipType = 'quest'

/**
 * The move that comes with it, written out rather than generated.
 *
 * So the example works before any model is configured, which is the point: a new person
 * should be able to make a move and see what one looks like without setting anything up
 * first. It carries two places to look on purpose — one real page, one search — because
 * that is what a move usually looks like, and the difference between them is the thing
 * worth showing.
 *
 * `generatedBy: 'playbook'` is the truth: nobody's model wrote this.
 */
export const DEMO_MOVE: MoveSpec = {
  id: 'reference.firstLook',
  title: 'Find out what a starter MIDI keyboard actually needs',
  why: 'so you can tell whether the one you have is already enough, before buying anything else',
  timeLimitSec: 240,
  goal: 'one sentence naming the feature that actually matters for playing into a phone app',
  playbook: 'reference',
  generatedBy: 'playbook',
  lookUp: ['MIDI keyboard', 'best starter MIDI keyboard for a phone app'],
}
