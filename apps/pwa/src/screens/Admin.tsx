import {
  type Overview,
  type PublicUser,
  type Role,
  validatePassword,
  validateUsername,
} from '@inkling/domain'
import { useCallback, useEffect, useState } from 'react'
import {
  addUser,
  listUsers,
  overview as fetchOverview,
  removeUser,
  setUserPassword,
  setUserRole,
} from '../admin'
import { Dashboard } from '../components/Dashboard'
import { ButtonLabel, Spinner } from '../components/Spinner'

const field =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'
const quietButton = 'quiet text-xs underline disabled:opacity-40'

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

/**
 * Who has an account on this server.
 *
 * Every rule here is also enforced by the server — the last admin cannot be removed,
 * you cannot delete yourself, and a password is checked for length. This screen repeats
 * them only so the refusal appears before the round trip, not instead of it.
 */
export function Admin({ serverUrl, me }: { serverUrl: string; me: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')

  /** Which row is showing its change-password field. */
  const [changing, setChanging] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  /** Which row is asking to be deleted. */
  const [confirming, setConfirming] = useState<string | null>(null)

  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await listUsers(serverUrl)
    if (result.ok) {
      setUsers(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [serverUrl])

  /**
   * Separate from `refresh`, and not called by it: this one reads every account's whole
   * log, which is real work on a server with history in it. Refreshing the account list
   * after adding someone should not re-read a year of events.
   */
  const loadOverview = useCallback(async () => {
    setOverviewBusy(true)
    try {
      const result = await fetchOverview(serverUrl)
      if (result.ok) {
        setOverview(result.value)
        setOverviewError(null)
      } else {
        setOverviewError(result.error)
      }
    } finally {
      setOverviewBusy(false)
    }
  }, [serverUrl])

  useEffect(() => {
    void refresh()
    void loadOverview()
  }, [refresh, loadOverview])

  async function act(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key)
    setError(null)
    try {
      const result = await work()
      if (!result.ok) setError(result.error ?? 'that did not work')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const nameProblem = validateUsername(username)
    if (nameProblem) return setError(`username: ${nameProblem}`)
    const passwordProblem = validatePassword(password)
    if (passwordProblem) return setError(`password: ${passwordProblem}`)

    await act('add', async () => {
      const result = await addUser(serverUrl, { username, password, role })
      if (result.ok) {
        setUsername('')
        setPassword('')
        setRole('member')
      }
      return result
    })
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <Dashboard
        overview={overview}
        loading={overviewBusy}
        error={overviewError}
        onRefresh={() => void loadOverview()}
      />

      <p className="text-xs text-ink-soft">
        Everyone here has their own Inklings, their own model settings and their own vault. Nothing
        is shared between accounts.
      </p>

      {error ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {users === null ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3.5 w-3.5" />
          loading accounts…
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {users.map((user) => {
            const isMe = user.id === me.id
            const admins = users.filter((entry) => entry.role === 'admin').length
            const lastAdmin = user.role === 'admin' && admins <= 1
            return (
              <li key={user.id} className="rounded-2xl border border-line bg-surface/60 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.username}
                      {isMe ? <span className="ml-2 text-[11px] text-ink-faint">you</span> : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      <span
                        className={
                          user.role === 'admin' ? 'font-medium text-accent' : 'text-ink-faint'
                        }
                      >
                        {user.role}
                      </span>
                      {when(user.createdAt) ? ` · since ${when(user.createdAt)}` : ''}
                    </p>
                  </div>
                </div>

                {changing === user.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="a new password"
                      autoComplete="new-password"
                      className={field}
                    />
                    <p className="text-[11px] text-ink-faint">
                      Their other devices will be signed out. This one keeps working.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setChanging(null)
                          setNewPassword('')
                        }}
                        className={quietButton}
                      >
                        cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`pw:${user.id}`, async () => {
                            const problem = validatePassword(newPassword)
                            if (problem) return { ok: false, error: `password: ${problem}` }
                            const result = await setUserPassword(serverUrl, user.id, newPassword)
                            if (result.ok) {
                              setChanging(null)
                              setNewPassword('')
                            }
                            return result
                          })
                        }
                        className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
                      >
                        <ButtonLabel busy={busy === `pw:${user.id}`}>
                          {busy === `pw:${user.id}` ? 'Saving…' : 'Set password'}
                        </ButtonLabel>
                      </button>
                    </div>
                  </div>
                ) : confirming === user.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs text-warn">Delete {user.username}?</p>
                    <p className="text-[11px] text-ink-faint">
                      They lose access straight away. Their Inklings are left on disk, not erased —
                      deleting an account should not be able to destroy years of notes in one tap.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={quietButton}
                      >
                        keep the account
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`rm:${user.id}`, async () => {
                            const result = await removeUser(serverUrl, user.id)
                            if (result.ok) setConfirming(null)
                            return result
                          })
                        }
                        className="ml-auto text-xs font-medium text-warn underline disabled:opacity-40"
                      >
                        <ButtonLabel busy={busy === `rm:${user.id}`}>
                          {busy === `rm:${user.id}` ? 'Deleting…' : 'yes, delete'}
                        </ButtonLabel>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setChanging(user.id)
                        setNewPassword('')
                      }}
                      className={quietButton}
                    >
                      change password
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || isMe}
                      title={isMe ? 'You cannot change your own role' : undefined}
                      onClick={() =>
                        void act(`role:${user.id}`, () =>
                          setUserRole(
                            serverUrl,
                            user.id,
                            user.role === 'admin' ? 'member' : 'admin',
                          ),
                        )
                      }
                      className={quietButton}
                    >
                      {user.role === 'admin' ? 'make a member' : 'make an admin'}
                    </button>
                    {isMe ? null : (
                      <button
                        type="button"
                        disabled={busy !== null || lastAdmin}
                        title={lastAdmin ? 'The last admin cannot be deleted' : undefined}
                        onClick={() => setConfirming(user.id)}
                        className={`${quietButton} ml-auto`}
                      >
                        delete
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <form
        onSubmit={(event) => void add(event)}
        className="flex flex-col gap-3 border-t border-line pt-4"
      >
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">add someone</p>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={field}
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="a password for them"
          autoComplete="new-password"
          className={field}
        />
        <div className="flex flex-wrap gap-1.5">
          {(['member', 'admin'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRole(option)}
              className={`rounded-full px-3 py-1.5 text-[11px] capitalize ${
                role === option ? 'bg-accent text-surface' : 'border border-line text-ink-faint'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="self-start rounded-full bg-ink px-5 py-2.5 text-xs font-semibold text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy === 'add'}>
            {busy === 'add' ? 'Adding…' : 'Add account'}
          </ButtonLabel>
        </button>
        <p className="text-[11px] text-ink-faint">
          They will start with their own settings, and their own Inklings. Give them the password
          yourself — there is no email here.
        </p>
      </form>
    </div>
  )
}
