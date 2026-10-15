import type { PublicUser } from '@inkling/domain'
import { useCallback, useEffect, useState } from 'react'
import {
  type AuthState,
  createFirstAccount,
  fetchAuthState,
  onSignedOut,
  signIn as apiSignIn,
  signOut as apiSignOut,
} from '../api'

export interface Auth {
  /** False until the server has been asked, so nothing flashes the wrong screen. */
  ready: boolean
  state: AuthState | null
  user: PublicUser | null
  /** False on a server with no accounts at all — the login screen is skipped. */
  accounts: boolean
  needsSetup: boolean
  signedOut: boolean
  refresh: () => Promise<void>
  /** Null on success, or the reason it failed. */
  signIn: (username: string, password: string) => Promise<string | null>
  createAccount: (username: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

/**
 * Who is signed in.
 *
 * The server is the authority: this asks it, rather than trusting a token that is
 * merely present. A token can be expired, revoked, or belong to an account that has
 * since been deleted, and the app should not behave as though it works until a request
 * happens to fail.
 */
export function useAuth(serverUrl: string): Auth {
  const [state, setState] = useState<AuthState | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const next = await fetchAuthState(serverUrl)
    setState(next)
    setReady(true)
  }, [serverUrl])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Sync runs in the background, so a session can be rejected between screens. When it
  // is, ask the server again rather than waiting for something else to notice.
  useEffect(() => onSignedOut(() => void refresh()), [refresh])

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await apiSignIn(serverUrl, username, password)
      if (!result.ok) return result.error
      await refresh()
      return null
    },
    [serverUrl, refresh],
  )

  const createAccount = useCallback(
    async (username: string, password: string) => {
      const result = await createFirstAccount(serverUrl, username, password)
      if (!result.ok) return result.error
      await refresh()
      return null
    },
    [serverUrl, refresh],
  )

  const signOut = useCallback(async () => {
    await apiSignOut(serverUrl)
    await refresh()
  }, [serverUrl, refresh])

  return {
    ready,
    state,
    user: state?.user ?? null,
    accounts: state?.accounts ?? false,
    needsSetup: state?.needsSetup ?? false,
    signedOut: state?.signedOut ?? true,
    refresh,
    signIn,
    createAccount,
    signOut,
  }
}
