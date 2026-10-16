import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AskContext,
  type BlipEvent,
  type Friend,
  type FriendStatus,
  type ISODate,
  type MoveSpec,
  type SocialMessage,
  askContextFor,
  FRIEND_MOVE_MAX_SEC,
  defaultColor,
  isSocialMessageKind,
  parseLog,
  project,
} from '@inkling/domain'
import type { Store } from './store'

/**
 * Friends, and the postbox between them.
 *
 * Two append-only files and no rewriting, for the same reason as everything else here: a
 * backup is a copy of the directory, and a bug can lose at most the last append.
 *
 *   social/friends.jsonl        every request, acceptance and removal, folded
 *   social/inbox/<userId>.jsonl the messages addressed to one person
 *
 * The server carries messages and does not interpret them. The recipient turns each into
 * an event in their own log, which is where it becomes real — so a message that arrives
 * twice is harmless, and a server that loses one loses a message rather than a fact.
 */

export interface FriendEventBody {
  t: 'requested' | 'accepted' | 'declined' | 'removed'
  from: string
  to: string
}

export interface FriendEvent extends FriendEventBody {
  at: ISODate
}

/** The pair, order-independent: a friendship is one thing seen from two ends. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':')
}

/**
 * Fold the friendship log to one state per pair.
 *
 * Latest event wins, which is what makes "ask again after removing" work without a state
 * machine: a request after a removal is simply the newest thing that happened.
 */
export function foldFriendships(events: FriendEvent[]): Map<string, FriendEvent> {
  const out = new Map<string, FriendEvent>()
  for (const event of [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    out.set(pairKey(event.from, event.to), event)
  }
  return out
}

/** One person's friends, as they would see them. */
export function friendsOf(
  userId: string,
  events: FriendEvent[],
  usernames: Map<string, string>,
  colors: Map<string, string> = new Map(),
  avatars: Map<string, string> = new Map(),
): Friend[] {
  const out: Friend[] = []
  for (const event of foldFriendships(events).values()) {
    if (event.from !== userId && event.to !== userId) continue
    // Removed and declined are not friendships, and not a kind of pending state either —
    // they are the absence of one, so they are simply not listed.
    if (event.t === 'removed' || event.t === 'declined') continue

    const other = event.from === userId ? event.to : event.from
    const status: FriendStatus =
      event.t === 'accepted' ? 'accepted' : event.from === userId ? 'asked' : 'asked-of-you'
    out.push({
      userId: other,
      username: usernames.get(other) ?? 'someone',
      status,
      at: event.at,
      color: colors.get(other) ?? defaultColor(other),
      avatar: avatars.get(other),
    })
  }
  return out.sort((a, b) => a.username.localeCompare(b.username))
}

/** Whether two people are friends, which is the only question the routes need answered. */
export function areFriends(a: string, b: string, events: FriendEvent[]): boolean {
  return foldFriendships(events).get(pairKey(a, b))?.t === 'accepted'
}

export interface SocialStore {
  friendships(): Promise<FriendEvent[]>
  addFriendEvent(event: FriendEventBody): Promise<FriendEvent>
  /** Messages addressed to somebody, from a byte offset. Append-only, so the offset holds. */
  readInbox(userId: string, offset: number): Promise<{ messages: SocialMessage[]; size: number }>
  send(message: SocialMessage): Promise<void>
  /** How many unread messages each account has, for the dashboard. */
  inboxSizes(): Promise<Map<string, number>>
}

const SAFE_USER_ID = /^[A-Za-z0-9_-]{4,64}$/

export function isSafeUserId(id: string): boolean {
  return SAFE_USER_ID.test(id)
}

export class FileSocialStore implements SocialStore {
  readonly #root: string
  /** Serialises appends, so two requests cannot interleave into one file. */
  #queue: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.#root = join(dataDir, 'social')
  }

  #friendsPath(): string {
    return join(this.#root, 'friends.jsonl')
  }

  #inboxPath(userId: string): string {
    if (!isSafeUserId(userId)) throw new Error('unsafe user id')
    return join(this.#root, 'inbox', `${userId}.jsonl`)
  }

  async #append(path: string, line: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${line}\n`)
  }

  /** One append at a time, in the order they were asked for. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work)
    this.#queue = next.catch(() => {})
    return next
  }

  async friendships(): Promise<FriendEvent[]> {
    try {
      const text = await readFile(this.#friendsPath(), 'utf8')
      const out: FriendEvent[] = []
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as FriendEvent
          if (parsed.from && parsed.to && parsed.t) out.push(parsed)
        } catch {
          // A half-written line is not a reason to lose the friendships around it.
        }
      }
      return out
    } catch {
      return []
    }
  }

  addFriendEvent(event: FriendEventBody): Promise<FriendEvent> {
    const full: FriendEvent = { ...event, at: new Date().toISOString() }
    return this.#serial(async () => {
      await this.#append(this.#friendsPath(), JSON.stringify(full))
      return full
    })
  }

  async readInbox(
    userId: string,
    offset: number,
  ): Promise<{ messages: SocialMessage[]; size: number }> {
    const path = this.#inboxPath(userId)
    let text = ''
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return { messages: [], size: 0 }
    }
    const size = Buffer.byteLength(text, 'utf8')
    // The offset is a byte offset into a UTF-8 file, so it is applied to the bytes and not
    // to the string — a message with an accent in it would otherwise land mid-character.
    const bytes = Buffer.from(text, 'utf8')
    const slice = offset > 0 && offset <= bytes.length ? bytes.subarray(offset) : bytes
    const messages: SocialMessage[] = []
    for (const line of slice.toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as SocialMessage
        if (parsed.id && isSocialMessageKind(parsed.kind)) messages.push(parsed)
      } catch {
        // As above: one bad line does not invalidate the rest.
      }
    }
    return { messages, size }
  }

  send(message: SocialMessage): Promise<void> {
    return this.#serial(async () => {
      await this.#append(this.#inboxPath(message.to), JSON.stringify(message))
    })
  }

  async inboxSizes(): Promise<Map<string, number>> {
    const dir = join(this.#root, 'inbox')
    const out = new Map<string, number>()
    try {
      for (const entry of await readdir(dir)) {
        if (!entry.endsWith('.jsonl')) continue
        const size = await stat(join(dir, entry)).catch(() => null)
        if (size) out.set(entry.slice(0, -'.jsonl'.length), size.size)
      }
    } catch {
      // No inbox directory yet is simply nobody having been sent anything.
    }
    return out
  }
}

/**
 * A move as suggested by a person, cleaned up.
 *
 * Never trusted as sent: it arrives over the network from another account, and it is
 * going to be shown to somebody as a suggestion. Everything is bounded and nothing that
 * is not a field of a move survives.
 */
export function sanitizeFriendMove(raw: unknown): MoveSpec | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>
  const title = text(input.title, 120)
  const goal = text(input.goal, 200)
  if (!title || !goal) return null

  const seconds = typeof input.timeLimitSec === 'number' ? input.timeLimitSec : 300
  const lookUp = Array.isArray(input.lookUp)
    ? input.lookUp
        .filter((phrase): phrase is string => typeof phrase === 'string')
        .map((phrase) => phrase.trim())
        .filter((phrase) => phrase.length > 0 && phrase.length <= 120)
        .slice(0, 3)
    : undefined

  return {
    id: `friend.${slug(title)}`,
    title,
    why: text(input.why, 200) ?? 'because a friend thought of it',
    timeLimitSec: Math.max(30, Math.min(FRIEND_MOVE_MAX_SEC, Math.round(seconds))),
    goal,
    playbook: 'friend',
    generatedBy: 'friend',
    ...(lookUp && lookUp.length > 0 ? { lookUp } : {}),
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'one'
  )
}

/**
 * A person's Inklings that they have chosen to share.
 *
 * Read by folding their logs, which is the only honest answer: the server stores the
 * events and does not otherwise know what an Inkling is, and a second place keeping track
 * of what is shared would be a second place to be wrong.
 */
export async function readSharedInklings(store: Store): Promise<AskContext[]> {
  const events: BlipEvent[] = []
  for (const device of await store.devices()) {
    const bytes = await store.readLog(device.deviceId, 0)
    if (bytes.byteLength === 0) continue
    events.push(...parseLog(new TextDecoder().decode(bytes)))
  }
  return project(events)
    .filter((blip) => !blip.deleted && !blip.demo)
    .filter((blip) => blip.visibility === 'friends')
    .filter((blip) => blip.status === 'active' || blip.status === 'snoozed')
    .map(askContextFor)
    .sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Whether this Inkling is really theirs, and really shared.
 *
 * Checked at the boundary rather than only in the app: "private means private" has to be
 * true of what the server will pass on, not only of what a button will let you press.
 */
export async function ownsSharedBlip(store: Store, blipId: string): Promise<boolean> {
  const events: BlipEvent[] = []
  for (const device of await store.devices()) {
    const bytes = await store.readLog(device.deviceId, 0)
    if (bytes.byteLength === 0) continue
    events.push(...parseLog(new TextDecoder().decode(bytes)))
  }
  const blip = project(events).find((candidate) => candidate.id === blipId)
  return Boolean(blip && !blip.deleted && blip.visibility === 'friends')
}
