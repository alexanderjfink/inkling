/**
 * The session, and the one place that attaches it.
 *
 * A bearer header rather than a cookie. The Android build is served from the device
 * (`https://localhost`) while the server is elsewhere, so a cookie would be a
 * third-party cookie and silently dropped. The cost is that the token lives in
 * localStorage and script on this page can read it — acceptable for a self-hosted tool
 * on your own network, not acceptable in general.
 *
 * Every call that needs a session goes through `apiFetch`, so there is one place to get
 * this right and one place to see when a session has gone.
 */

const TOKEN_KEY = 'auth:token'

let token: string | null = null
let loaded = false
const signedOutListeners = new Set<() => void>()

/** Read the stored token once, before anything makes a request. */
export function loadToken(): string | null {
  if (loaded) return token
  loaded = true
  try {
    token = localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private mode, or storage disabled. You can still sign in; you just will not stay
    // signed in across a reload.
    token = null
  }
  return token
}

export function currentToken(): string | null {
  return loadToken()
}

export function setToken(value: string | null): void {
  token = value
  loaded = true
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to do: the in-memory token still works for this session.
  }
}

/**
 * Called when the server says the session is no longer good.
 *
 * Sync runs in the background, so a session can expire while you are looking at
 * something else. Without this the app would keep quietly failing to sync rather than
 * asking you to sign in again.
 */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener)
  return () => signedOutListeners.delete(listener)
}

function noteSignedOut(): void {
  setToken(null)
  for (const listener of signedOutListeners) listener()
}

export interface ApiOptions extends RequestInit {
  /** Skip the session handling — for signing in, where there is no session yet. */
  anonymous?: boolean
}

export async function apiFetch(url: string, init: ApiOptions = {}): Promise<Response> {
  const { anonymous, ...rest } = init
  const headers = new Headers(rest.headers)
  const active = anonymous ? null : loadToken()
  if (active) headers.set('authorization', `Bearer ${active}`)

  const response = await fetch(url, { ...rest, headers })

  // Only a rejection of a session we actually sent means the session is gone. A 401
  // from signing in is just a wrong password.
  if (response.status === 401 && active) noteSignedOut()
  return response
}

/** Whether a response is the server saying "sign in again". */
export async function isSignedOutResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  try {
    return (await response.clone().json()).signedOut === true
  } catch {
    return false
  }
}

export interface AuthState {
  /** False on a server with no accounts at all — the app skips the login screen. */
  accounts: boolean
  needsSetup: boolean
  signedOut: boolean
  user: { id: string; username: string; role: 'admin' | 'member'; createdAt: string } | null
  /** False when the server could not be reached at all, as opposed to saying no. */
  reachable: boolean
}

const NO_ACCOUNTS: AuthState = {
  accounts: false,
  needsSetup: false,
  signedOut: false,
  user: null,
  reachable: true,
}

export async function fetchAuthState(baseUrl: string): Promise<AuthState> {
  try {
    const res = await apiFetch(`${baseUrl.replace(/\/+$/, '')}/auth/state`)
    if (!res.ok) return NO_ACCOUNTS
    const body = (await res.json()) as Partial<AuthState>
    return {
      accounts: body.accounts === true,
      needsSetup: body.needsSetup === true,
      signedOut: body.signedOut !== false,
      user: body.user ?? null,
      reachable: true,
    }
  } catch {
    // The server is unreachable. Report "signed out" rather than pretending, so the
    // screen that explains how to reach it is the one you get — but say plainly that
    // the address is the problem, since that is the fix.
    return { ...NO_ACCOUNTS, accounts: true, signedOut: true, reachable: false }
  }
}

export async function signIn(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return post(baseUrl, '/auth/login', { username, password })
}

export async function createFirstAccount(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return post(baseUrl, '/auth/setup', { username, password })
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      anonymous: true,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null
      return { ok: false, error: detail?.error ?? `the server said ${res.status}` }
    }
    const result = (await res.json()) as { token?: string }
    if (!result.token) return { ok: false, error: 'the server did not return a session' }
    setToken(result.token)
    return { ok: true }
  } catch {
    return { ok: false, error: 'could not reach the server' }
  }
}

export async function signOut(baseUrl: string): Promise<void> {
  const active = loadToken()
  try {
    if (active) {
      await apiFetch(`${baseUrl.replace(/\/+$/, '')}/auth/logout`, { method: 'POST' })
    }
  } catch {
    // Signing out locally is what matters; the server will expire it anyway.
  }
  noteSignedOut()
}
