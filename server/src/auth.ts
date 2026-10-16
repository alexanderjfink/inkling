import {
  type PublicUser,
  type Role,
  SESSION_DAYS,
  usernameKey,
  validatePassword,
  validateUsername,
  PROFILE_COLORS,
} from '@inkling/domain'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Accounts and sessions.
 *
 * Deliberately small: a username, a password, and a role. Everything else about a
 * person lives in their own directory (`users/<id>/`), so adding an account is adding
 * a folder and a line here — there is no per-user schema to keep in step.
 *
 * Two things are never stored in the clear: passwords (argon2id, via Bun) and session
 * tokens (SHA-256). A copy of these files therefore does not hand over a live session,
 * and it does not hand over a password.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

interface StoredUser extends PublicUser {
  passwordHash: string
}

interface StoredSession {
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
}

interface UsersFile {
  version: number
  users: StoredUser[]
}

interface SessionsFile {
  version: number
  sessions: StoredSession[]
}

const USERS_VERSION = 1
const SESSIONS_VERSION = 1

function toPublic(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    color: user.color,
  }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class Auth {
  readonly #dir: string
  #users: StoredUser[] | null = null
  #sessions: StoredSession[] | null = null
  /** Writes are serialised: two logins at once must not lose one of the sessions. */
  #lock: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'auth')
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(work, work)
    this.#lock = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async #readJson<T>(name: string): Promise<T | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.#dir, name), 'utf8')) as unknown
      return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null
    } catch {
      return null
    }
  }

  async #writeJson(name: string, body: unknown): Promise<void> {
    await mkdir(this.#dir, { recursive: true })
    await writeFile(join(this.#dir, name), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }

  async #loadUsers(): Promise<StoredUser[]> {
    if (this.#users) return this.#users
    const file = await this.#readJson<UsersFile>('users.json')
    this.#users = Array.isArray(file?.users) ? file.users : []
    return this.#users
  }

  async #loadSessions(): Promise<StoredSession[]> {
    if (this.#sessions) return this.#sessions
    const file = await this.#readJson<SessionsFile>('sessions.json')
    const all = Array.isArray(file?.sessions) ? file.sessions : []
    // Expired sessions are dropped on load rather than left to accumulate forever.
    const now = Date.now()
    this.#sessions = all.filter((session) => Date.parse(session.expiresAt) > now)
    return this.#sessions
  }

  async #saveUsers(): Promise<void> {
    await this.#writeJson('users.json', {
      version: USERS_VERSION,
      users: this.#users ?? [],
    } satisfies UsersFile)
  }

  async #saveSessions(): Promise<void> {
    await this.#writeJson('sessions.json', {
      version: SESSIONS_VERSION,
      sessions: this.#sessions ?? [],
    } satisfies SessionsFile)
  }

  /** A hash to verify against when no user was found, so a missing account and a wrong
   * password take the same time and cannot be told apart by a stopwatch. */
  #decoy: string | null = null
  async #decoyHash(): Promise<string> {
    this.#decoy ??= await Bun.password.hash(newToken())
    return this.#decoy
  }

  /** True until the first account exists. */
  async needsSetup(): Promise<boolean> {
    return (await this.#loadUsers()).length === 0
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.#loadUsers()
    return [...users]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((user) => toPublic(user))
  }

  async count(): Promise<number> {
    return (await this.#loadUsers()).length
  }

  #find(username: string): StoredUser | undefined {
    const key = usernameKey(username)
    return (this.#users ?? []).find((user) => usernameKey(user.username) === key)
  }

  async #issue(userId: string): Promise<string> {
    const token = newToken()
    const now = new Date()
    const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
    const sessions = await this.#loadSessions()
    sessions.push({
      tokenHash: await tokenHash(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    })
    await this.#saveSessions()
    return token
  }

  /**
   * Create the first account, which is always an admin.
   *
   * Refuses once any account exists: otherwise the first person to reach an idle server
   * could make themselves the owner of it.
   */
  async setup(
    username: string,
    password: string,
  ): Promise<Result<{ token: string; user: PublicUser }>> {
    return this.#serial(async () => {
      const users = await this.#loadUsers()
      if (users.length > 0) return { ok: false, error: 'this server already has an account' }

      const nameProblem = validateUsername(username)
      if (nameProblem) return { ok: false, error: nameProblem }
      const passwordProblem = validatePassword(password)
      if (passwordProblem) return { ok: false, error: passwordProblem }

      const user: StoredUser = {
        id: crypto.randomUUID(),
        username: username.trim(),
        passwordHash: await Bun.password.hash(password),
        role: 'admin',
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      await this.#saveUsers()
      return { ok: true, value: { token: await this.#issue(user.id), user: toPublic(user) } }
    })
  }

  /** Add an account. Admin only; the caller checks that. */
  async add(username: string, password: string, role: Role): Promise<Result<PublicUser>> {
    return this.#serial(async () => {
      const users = await this.#loadUsers()

      const nameProblem = validateUsername(username)
      if (nameProblem) return { ok: false, error: nameProblem }
      const passwordProblem = validatePassword(password)
      if (passwordProblem) return { ok: false, error: passwordProblem }
      if (this.#find(username)) return { ok: false, error: 'that username is taken' }

      const user: StoredUser = {
        id: crypto.randomUUID(),
        username: username.trim(),
        passwordHash: await Bun.password.hash(password),
        role,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      await this.#saveUsers()
      return { ok: true, value: toPublic(user) }
    })
  }

  async login(
    username: string,
    password: string,
  ): Promise<Result<{ token: string; user: PublicUser }>> {
    return this.#serial(async () => {
      await this.#loadUsers()
      const user = this.#find(username)
      if (!user) {
        // Still do the work, so a missing account is not faster than a wrong password.
        await Bun.password.verify(password, await this.#decoyHash())
        return { ok: false, error: 'that username and password do not match' }
      }
      if (!(await Bun.password.verify(password, user.passwordHash))) {
        return { ok: false, error: 'that username and password do not match' }
      }
      return { ok: true, value: { token: await this.#issue(user.id), user: toPublic(user) } }
    })
  }

  /** The user behind a token, or null. */
  async resolve(token: string | null): Promise<PublicUser | null> {
    if (!token) return null
    const hash = await tokenHash(token)
    const sessions = await this.#loadSessions()
    const session = sessions.find((entry) => entry.tokenHash === hash)
    if (!session) return null
    if (Date.parse(session.expiresAt) <= Date.now()) return null
    const user = (await this.#loadUsers()).find((entry) => entry.id === session.userId)
    return user ? toPublic(user) : null
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return
    await this.#serial(async () => {
      const hash = await tokenHash(token)
      const sessions = await this.#loadSessions()
      this.#sessions = sessions.filter((entry) => entry.tokenHash !== hash)
      await this.#saveSessions()
    })
  }

  /** Drop every session for a user, optionally sparing the one making the request. */
  async #revokeAll(userId: string, exceptToken?: string): Promise<void> {
    const keep = exceptToken ? await tokenHash(exceptToken) : null
    const sessions = await this.#loadSessions()
    this.#sessions = sessions.filter(
      (entry) => entry.userId !== userId || (keep !== null && entry.tokenHash === keep),
    )
    await this.#saveSessions()
  }

  /** Change your own password, proving you know the old one. */
  async changeOwnPassword(
    userId: string,
    current: string,
    next: string,
    keepToken?: string,
  ): Promise<Result<null>> {
    return this.#serial(async () => {
      const user = (await this.#loadUsers()).find((entry) => entry.id === userId)
      if (!user) return { ok: false, error: 'no such account' }
      if (!(await Bun.password.verify(current, user.passwordHash))) {
        return { ok: false, error: 'that is not your current password' }
      }
      const problem = validatePassword(next)
      if (problem) return { ok: false, error: problem }

      user.passwordHash = await Bun.password.hash(next)
      await this.#saveUsers()
      // Other devices are signed out; this one stays.
      await this.#revokeAll(userId, keepToken)
      return { ok: true, value: null }
    })
  }

  /** Set someone else's password. Admin only; signs their other devices out. */
  /** How this account appears to other people. One of PROFILE_COLORS, or unset to be given one. */
  async setColor(userId: string, color: string | null): Promise<Result<null>> {
    return this.#serial(async () => {
      const user = (await this.#loadUsers()).find((entry) => entry.id === userId)
      if (!user) return { ok: false, error: 'no such account' }
      if (color !== null && !PROFILE_COLORS.includes(color as never)) {
        return { ok: false, error: 'that is not one of the colours' }
      }
      if (color) user.color = color
      else delete user.color
      await this.#saveUsers()
      return { ok: true, value: null }
    })
  }

  async setPassword(userId: string, password: string): Promise<Result<null>> {
    return this.#serial(async () => {
      const user = (await this.#loadUsers()).find((entry) => entry.id === userId)
      if (!user) return { ok: false, error: 'no such account' }
      const problem = validatePassword(password)
      if (problem) return { ok: false, error: problem }

      user.passwordHash = await Bun.password.hash(password)
      await this.#saveUsers()
      await this.#revokeAll(userId)
      return { ok: true, value: null }
    })
  }

  async setRole(userId: string, role: Role, actorId: string): Promise<Result<null>> {
    return this.#serial(async () => {
      const users = await this.#loadUsers()
      const user = users.find((entry) => entry.id === userId)
      if (!user) return { ok: false, error: 'no such account' }
      if (user.role === role) return { ok: true, value: null }

      // Never leave the server without an admin — that is an unrecoverable state
      // without editing files by hand.
      if (user.role === 'admin' && users.filter((entry) => entry.role === 'admin').length <= 1) {
        return { ok: false, error: 'this is the only admin — make someone else an admin first' }
      }
      if (userId === actorId && role !== 'admin') {
        return { ok: false, error: 'you cannot remove your own admin access' }
      }

      user.role = role
      await this.#saveUsers()
      return { ok: true, value: null }
    })
  }

  /**
   * Delete an account and everything it owns.
   *
   * The caller removes the data directory; this only removes the account. Refuses to
   * delete the last admin, or yourself — either would lock the server.
   */
  async remove(userId: string, actorId: string): Promise<Result<null>> {
    return this.#serial(async () => {
      const users = await this.#loadUsers()
      const user = users.find((entry) => entry.id === userId)
      if (!user) return { ok: false, error: 'no such account' }
      if (userId === actorId) return { ok: false, error: 'you cannot delete your own account' }
      if (user.role === 'admin' && users.filter((entry) => entry.role === 'admin').length <= 1) {
        return { ok: false, error: 'this is the only admin' }
      }

      this.#users = users.filter((entry) => entry.id !== userId)
      await this.#saveUsers()
      await this.#revokeAll(userId)
      return { ok: true, value: null }
    })
  }
}
