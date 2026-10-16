/**
 * What the server can say about how the app is actually being used.
 *
 * The shape lives here rather than on the server because both ends need it: the server
 * fills it in, and the admin screen draws it. The app cannot import the server's own
 * module — that would drag the filesystem into a browser bundle — so the contract is
 * shared and the implementation is not.
 */

export interface BadMove {
  user: string
  at: string
  move: string
  reason: string | null
  note: string | null
  blipTitle: string
  blipType: string
}

export interface FeedbackReport {
  user: string
  at: string
  text: string
  screen: string
  blipTitle?: string
  blipType?: string
  move?: string
  app: string
  server: string
}

export interface Overview {
  generatedAt: string
  users: { total: number; admins: number; joinedLast7Days: number }
  inklings: {
    total: number
    active: number
    snoozed: number
    retired: number
    promoted: number
    deleted: number
    examples: number
    abandoned: number
    withEntries: number
  }
  moves: { offered: number; done: number; skipped: number; rejected: number; kept: number }
  /** Everything marked bad, newest first. Capped, because a dashboard is not an archive. */
  badMoves: BadMove[]
  /** Everything said about the app itself, newest first. Capped. */
  feedback: FeedbackReport[]
  /** Events per day, so a flat line is visible as a flat line. */
  activity: Array<{ day: string; events: number; captures: number }>
  devices: number
  /** Accounts whose logs could not be read, so a wrong number is not mistaken for a fact. */
  unreadable: string[]
}
