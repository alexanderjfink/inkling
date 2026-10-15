import type { PublicUser, Role } from '@inkling/domain'
import { apiFetch } from './api'

/**
 * The admin API.
 *
 * Every call here needs an admin session; the server enforces that, so the app only
 * has to decide what to show. Errors come back as words rather than status codes
 * because the server's reasons are specific — "this is the only admin" is worth
 * showing, and "400" is not.
 */

export type Outcome<T = null> = { ok: true; value: T } | { ok: false; error: string }

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

async function call<T>(url: string, path: string, init: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await apiFetch(`${base(url)}${path}`, init)
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const detail = body?.error
      return {
        ok: false,
        error: typeof detail === 'string' ? detail : `the server said ${res.status}`,
      }
    }
    return { ok: true, value: (body ?? {}) as T }
  } catch {
    return { ok: false, error: 'could not reach the server' }
  }
}

const json = (body: unknown, method: string): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function listUsers(url: string): Promise<Outcome<PublicUser[]>> {
  const result = await call<{ users: PublicUser[] }>(url, '/admin/users', { method: 'GET' })
  return result.ok ? { ok: true, value: result.value.users ?? [] } : result
}

export function addUser(
  url: string,
  user: { username: string; password: string; role: Role },
): Promise<Outcome<PublicUser>> {
  return call<PublicUser>(url, '/admin/users', json(user, 'POST'))
}

export function removeUser(url: string, id: string): Promise<Outcome> {
  return call(url, `/admin/users/${id}`, { method: 'DELETE' })
}

export function setUserPassword(url: string, id: string, password: string): Promise<Outcome> {
  return call(url, `/admin/users/${id}/password`, json({ password }, 'POST'))
}

export function setUserRole(url: string, id: string, role: Role): Promise<Outcome> {
  return call(url, `/admin/users/${id}`, json({ role }, 'PATCH'))
}

/** Change your own password, from the settings screen. */
export function changeOwnPassword(
  url: string,
  current: string,
  password: string,
): Promise<Outcome> {
  return call(url, '/auth/password', json({ current, password }, 'POST'))
}
