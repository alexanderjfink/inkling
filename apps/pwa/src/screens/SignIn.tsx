import {
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  validatePassword,
  validateUsername,
} from '@inkling/domain'
import { useState } from 'react'
import { ButtonLabel, Spinner } from '../components/Spinner'
import { needsServerUrl } from '../native'
import type { Auth } from '../state/useAuth'

/**
 * Signing in, and the one time there is no account to sign in with.
 *
 * The server address is editable here on purpose. In the Android build the app is
 * served from the device, so the first thing you must do is tell it where the server
 * is — and that has to be possible before you can sign in, or you are stuck.
 */
export function SignIn({
  auth,
  serverUrl,
  onSaveServerUrl,
  reachable,
}: {
  auth: Auth
  serverUrl: string
  onSaveServerUrl: (url: string) => Promise<void>
  /** False when the last check could not reach the server at all. */
  reachable: boolean
}) {
  const first = auth.needsSetup
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState(false)
  const [draftServer, setDraftServer] = useState(serverUrl)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (first) {
      const nameProblem = validateUsername(username)
      if (nameProblem) return setError(`username: ${nameProblem}`)
      const passwordProblem = validatePassword(password)
      if (passwordProblem) return setError(`password: ${passwordProblem}`)
      if (password !== confirm) return setError('the two passwords do not match')
    }

    setBusy(true)
    try {
      const problem = first
        ? await auth.createAccount(username, password)
        : await auth.signIn(username, password)
      if (problem) setError(problem)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-4">
      <div className="mb-2">
        <img
          src="/icon-192.png"
          alt=""
          width={72}
          height={72}
          className="mx-auto mb-4 h-18 w-18 rounded-2xl"
        />
        <h1 className="text-center text-3xl font-semibold tracking-tight">Inkling</h1>
        <p className="mt-1 text-center text-sm text-ink-faint">
          {first
            ? 'This server has no accounts yet. The one you make now is the admin.'
            : 'Sign in to reach your Inklings.'}
        </p>
      </div>

      {!reachable ? (
        <div className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          Could not reach the server at <span className="font-medium">{serverUrl}</span>. Check the
          address below — on a phone it is usually the machine's Tailscale name.
        </div>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wide text-ink-faint uppercase">username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            className="w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs tracking-wide text-ink-faint uppercase">password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={first ? 'new-password' : 'current-password'}
            className="w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
          />
        </label>

        {first ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs tracking-wide text-ink-faint uppercase">password again</span>
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
            />
          </label>
        ) : null}

        {error ? <p className="text-xs text-warn">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy}>
            {busy ? 'Just a moment…' : first ? 'Create the admin account' : 'Sign in'}
          </ButtonLabel>
        </button>
      </form>

      {first ? (
        <p className="text-center text-xs text-ink-faint">
          {USERNAME_MIN}–{USERNAME_MAX} characters, letters and digits, dot, dash or underscore. A
          password needs {PASSWORD_MIN} or more — length is the only rule.
        </p>
      ) : null}

      <div className="mt-4 border-t border-line pt-3">
        {editingServer ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs tracking-wide text-ink-faint uppercase">server</span>
            <input
              value={draftServer}
              onChange={(event) => setDraftServer(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://your-machine.ts.net/api"
              className="w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraftServer(serverUrl)
                  setEditingServer(false)
                }}
                className="quiet text-xs"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void onSaveServerUrl(draftServer).then(() => setEditingServer(false))
                }}
                className="ml-auto rounded-full border border-line px-4 py-2 text-xs font-medium"
              >
                Save address
              </button>
            </div>
          </div>
        ) : /* Only where it is needed. In the browser the app is served by the server it talks
             to, so its address is not something to put in front of anyone; the Android build is
             served from the device and cannot work until it is told where to look. */
        needsServerUrl(serverUrl) ? (
          <button
            type="button"
            onClick={() => setEditingServer(true)}
            className="quiet w-full text-center text-xs underline"
          >
            server: {serverUrl}
          </button>
        ) : null}
      </div>

      {auth.ready ? null : (
        <p className="flex items-center justify-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3.5 w-3.5" />
          checking the server…
        </p>
      )}
    </div>
  )
}
