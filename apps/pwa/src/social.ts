import type { AskContext, Friend, MoveSpec, SocialMessage } from '@inkling/domain'
import { apiFetch } from './api'

/**
 * The social API.
 *
 * Errors come back as words rather than status codes, because the server's reasons are
 * specific — "that Inkling is not shared with friends" is worth showing, and "403" is not.
 */

export type SocialOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; socialOff?: boolean }

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

async function call<T>(
  url: string,
  path: string,
  init: RequestInit = {},
): Promise<SocialOutcome<T>> {
  try {
    const res = await apiFetch(`${base(url)}/social${path}`, init)
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const detail = body?.error
      return {
        ok: false,
        error: typeof detail === 'string' ? detail : `the server said ${res.status}`,
        socialOff: body?.socialOff === true,
      }
    }
    return { ok: true, value: (body ?? {}) as T }
  } catch {
    return { ok: false, error: 'could not reach the server' }
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function listFriends(url: string): Promise<SocialOutcome<Friend[]>> {
  const result = await call<{ friends: Friend[] }>(url, '/friends')
  return result.ok ? { ok: true, value: result.value.friends ?? [] } : result
}

export async function addFriend(url: string, username: string): Promise<SocialOutcome<Friend[]>> {
  const result = await call<{ friends: Friend[] }>(url, '/friends', json({ username }))
  return result.ok ? { ok: true, value: result.value.friends ?? [] } : result
}

async function friendAction(
  url: string,
  id: string,
  action: 'accept' | 'decline',
): Promise<SocialOutcome<Friend[]>> {
  const result = await call<{ friends: Friend[] }>(url, `/friends/${id}/${action}`, {
    method: 'POST',
  })
  return result.ok ? { ok: true, value: result.value.friends ?? [] } : result
}

export const acceptFriend = (url: string, id: string) => friendAction(url, id, 'accept')
export const declineFriend = (url: string, id: string) => friendAction(url, id, 'decline')

export async function removeFriend(url: string, id: string): Promise<SocialOutcome<Friend[]>> {
  const result = await call<{ friends: Friend[] }>(url, `/friends/${id}`, { method: 'DELETE' })
  return result.ok ? { ok: true, value: result.value.friends ?? [] } : result
}

export async function friendInklings(
  url: string,
  id: string,
): Promise<SocialOutcome<AskContext[]>> {
  const result = await call<{ inklings: AskContext[] }>(url, `/friends/${id}/inklings`)
  return result.ok ? { ok: true, value: result.value.inklings ?? [] } : result
}

/**
 * Anything new addressed to me, from a byte offset into my own postbox.
 *
 * The offset is the server's, not a timestamp: clocks disagree between two people's
 * phones, and an inbox that loses a message because somebody's clock was fast is worse
 * than one that occasionally reads a line twice — which is harmless, because the fold
 * keys a received move on the message it came from.
 */
export function pullInbox(
  url: string,
  offset: number,
): Promise<SocialOutcome<{ messages: SocialMessage[]; size: number; friends: Friend[] }>> {
  return call(url, `/inbox?offset=${Math.max(0, Math.floor(offset))}`)
}

export function askForMove(
  url: string,
  input: { to: string; context: AskContext; note?: string },
): Promise<SocialOutcome<{ message: SocialMessage }>> {
  return call(url, '/ask', json(input))
}

export function sendMove(
  url: string,
  input: { to: string; askId: string; blipId: string; move: MoveSpec; note?: string },
): Promise<SocialOutcome<{ message: SocialMessage }>> {
  return call(url, '/move', json(input))
}

export function sendNote(
  url: string,
  input: {
    to: string
    blipId: string
    kind: 'kudos' | 'thanks'
    moveTitle?: string
    text: string
  },
): Promise<SocialOutcome<{ message: SocialMessage }>> {
  return call(url, '/note', json(input))
}
