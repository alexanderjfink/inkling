/**
 * Account rules, shared by the server and the app.
 *
 * The server enforces them; the app shows them. One copy means the message you read
 * when a password is refused is the message the server would have given, rather than a
 * second, subtly different one.
 */

export type Role = 'admin' | 'member'

/** A user as everyone else is allowed to see them: never a hash, never a token. */
export interface PublicUser {
  id: string
  username: string
  role: Role
  createdAt: string
  /**
   * How this person appears to other people, one of {@link PROFILE_COLORS}.
   *
   * Never a picture: the point of it is that a friend's suggestion is recognisably *theirs*
   * at a glance, and a colour plus an initial does that. It travels with the account rather
   * than the device, because it is about them, not about where they are.
   */
  color?: string
}

/** The palette a person can be. Enough to tell people apart, few enough that they do not clash. */
export const PROFILE_COLORS = [
  '#7c5cff',
  '#2f9e6f',
  '#c2410c',
  '#0e7490',
  '#a21caf',
  '#4d7c0f',
  '#b91c1c',
  '#1d4ed8',
] as const

/**
 * The colour for somebody who has not chosen one.
 *
 * From the id, so it is stable, and from the name, so two people on one server are unlikely
 * to match — which is the whole point of having one.
 */
export function defaultColor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PROFILE_COLORS[hash % PROFILE_COLORS.length] as string
}

export function colorOf(user: { id: string; color?: string }): string {
  return user.color && PROFILE_COLORS.includes(user.color as never)
    ? user.color
    : defaultColor(user.id)
}

export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 1024

const USERNAME_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Null when the username is acceptable, otherwise why it is not. */
export function validateUsername(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'a username is required'
  if (trimmed.length < USERNAME_MIN) return `needs at least ${USERNAME_MIN} characters`
  if (trimmed.length > USERNAME_MAX) return `needs at most ${USERNAME_MAX} characters`
  if (!USERNAME_SHAPE.test(trimmed)) {
    return 'letters, digits, dot, dash and underscore only, starting with a letter or digit'
  }
  return null
}

/**
 * Null when the password is acceptable.
 *
 * Length only, deliberately. Composition rules ("one symbol, one capital") push people
 * towards predictable substitutions and are no longer recommended; length is what
 * actually helps, and this is a self-hosted tool rather than a bank.
 */
export function validatePassword(value: string): string | null {
  if (value.length === 0) return 'a password is required'
  if (value.length < PASSWORD_MIN) return `needs at least ${PASSWORD_MIN} characters`
  if (value.length > PASSWORD_MAX) return 'that is too long to be a password'
  return null
}

/** Usernames are compared case-insensitively, so "Sam" and "sam" are one account. */
export function usernameKey(value: string): string {
  return value.trim().toLowerCase()
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'member'
}

/** How long a session lasts before it must be signed in again. */
export const SESSION_DAYS = 30
