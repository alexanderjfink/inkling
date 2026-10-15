/**
 * Are we inside the native shell rather than a browser tab?
 *
 * Capacitor injects a global, so this needs no import and works before anything is
 * loaded. Kept in one place because the answer changes two things that are easy to
 * get subtly wrong: whether to register a service worker, and whether a relative
 * `/api` can possibly be right.
 */
export function isNative(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  try {
    return capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/**
 * Where the API lives when nothing has been saved yet.
 *
 * In a browser this is the same origin, which is why opening the server's own address
 * needs no configuration at all. In a native shell the app is served from the device
 * (`https://localhost`), so a relative path would resolve to the device itself — the
 * one case where it has to be absolute, and therefore the one case that is baked in
 * at build time.
 */
export function defaultServerUrl(): string {
  const baked = (import.meta.env?.VITE_INKLING_SERVER as string | undefined)?.trim()
  return baked && baked.length > 0 ? baked : '/api'
}

/** True when this build cannot work until a server is chosen. */
export function needsServerUrl(serverUrl: string): boolean {
  return isNative() && !/^https?:\/\//i.test(serverUrl.trim())
}
