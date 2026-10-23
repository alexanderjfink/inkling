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
  /**
   * A switch this step is about, offered where it is explained.
   *
   * The two things a new person should decide for themselves, asked at the moment they
   * understand what they are deciding — not buried in Settings for them to find later, and
   * not decided for them silently. The label follows the current state, so a step is never
   * offering to turn on something that is already on.
   */
  action?: 'ai' | 'social'
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
    body: 'An Inkling is more than a to-do list item and less than a project — an idea, a question, or a problem you do not have the time, the energy, or the know-how to get moving.\n\nA photo, a link, an idea, a question, a quest. Not a to-do list — you are not supposed to finish it. What you notice comes back to you later, a couple of minutes at a time, and you decide each time whether it still matters.',
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
    title: 'Then it comes back, with a move',
    // The word the whole app is built on, introduced where it is actually met. Everything
    // else — the slogan, the playbook, asking a friend — assumes it, and nothing said it.
    body: 'When something is ready to return it waits here — one at a time, and never more than you could get through in a sitting. Each one comes with a move: a single small thing to do with it, a couple of minutes long, made out of your own words rather than invented for you. Do it, ask for a different one, or put it down and come back to it.',
  },
  {
    title: 'A model can help find the move',
    body: 'Generate asks a model to write that move for you, out of what you have already written — and when a move is not obvious, it can offer help with the next step.\n\nIt starts off on a new account, and you can change your mind here or in Settings → Moves. Turn it on and the model re-words a move for this particular Inkling, and can help with the next step; turn it off and Generate still works, picking from the playbook’s own list instead. A friend can suggest one either way.',
    action: 'ai',
  },
  {
    anchor: 'friends',
    radius: 999,
    title: 'A friend can suggest a move too',
    body: 'Add somebody by their username — they have to say yes, and nothing of yours is visible until they do. Then when a suggestion is not it, you can ask them for one. Their move arrives on the Inkling with their name on it, and comes first until you have done something with it.\n\nThis half is on unless you turn it off. Nothing leaves this device for a friend until they have accepted, and every Inkling keeps its own switch.',
    action: 'social',
  },
  {
    title: 'And you can help them',
    body: 'When a friend asks you, their Inkling turns up in Notifications — with what they have written about it and what has already been suggested, so you can think of something they have not. You send it, and it lands on their card. You can say thank you back, or tell them it worked.',
  },
  {
    anchor: 'settings',
    radius: 999,
    title: 'Everything else lives here',
    body: 'Theme, sync, your notes, backups, and the two switches: the social half, and whether the model thinks of moves. Both can be changed whenever you like — the model lives under Moves, the friends half under Friends. And Help — where this walkthrough is waiting whenever you want it again.',
  },
]
