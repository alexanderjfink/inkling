/**
 * Settings about this device, rather than about an account.
 *
 * The per-account database cannot be opened until we know who is signed in, and we
 * cannot know that until we know where the server is. So the server address lives here,
 * like the session token: it is a fact about this browser, not about a person. Two
 * people on one laptop share it, which is correct — there is one server.
 *
 * Everything that belongs to a person (their log, their watermarks, their model, their
 * vault) stays in their own database.
 */

const PREFIX = 'inkling:'

export function getDeviceSetting(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    // Private mode, or storage disabled. Everything still works for this session.
    return null
  }
}

export function setDeviceSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, value)
  } catch {
    // Nothing to do — the value is still in memory for this session.
  }
}
