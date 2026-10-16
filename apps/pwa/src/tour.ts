/**
 * The walkthrough, as data.
 *
 * The steps point at real controls rather than describing screens, because what a new
 * person lacks is not a description of the app — it is knowing which part of the screen
 * in front of them does what. `anchor` names a `data-tour` attribute.
 *
 * A step whose anchor is not on screen is shown as a centred card rather than dropped:
 * Review only exists once something is waiting, and a walkthrough that is five steps for
 * one person and four for another is a walkthrough that cannot be relied on.
 */
export interface TourStep {
  anchor?: string
  /** Corner radius of the highlight in px, matched to the control so the ring reads as around it. */
  radius?: number
  title: string
  body: string
}

/**
 * Per account, and per device — settings are not synced, so a second device decides for
 * itself. That is fine here because the other guard (having nothing yet) is what actually
 * keeps it away from someone who already uses the app: a new phone syncs the Inklings
 * before anything is decided.
 */
export const TOUR_KEY = 'tour:done'

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Inkling is for what you notice',
    body: 'A photo, a link, an idea, a question, a quest. Not a to-do list — you are not supposed to finish it. What you notice comes back to you later, a couple of minutes at a time, and you decide each time whether it still matters.',
  },
  {
    anchor: 'field',
    radius: 16,
    title: 'Start here',
    body: 'Write it in whatever words you have. Add a link or a photo if there is one. It is written to this device the moment you keep it, so nothing is ever lost to a bad connection.',
  },
  {
    anchor: 'keep',
    radius: 999,
    title: 'Keep it',
    body: 'That is the whole of capture. ⌘↵ or Ctrl+↵ does the same from the keyboard. The count underneath is there so you can see for yourself that nothing went missing.',
  },
  {
    anchor: 'review',
    radius: 28,
    title: 'Then it comes back',
    body: 'When something is ready to return it waits here — one at a time, and never more than you could get through in a sitting. You can put it down again, add to it, or let it go for good.',
  },
  {
    anchor: 'settings',
    radius: 999,
    title: 'Everything else lives here',
    body: 'Theme, sync, the model, your notes, backups. And Help — where this walkthrough is waiting whenever you want it again.',
  },
]
