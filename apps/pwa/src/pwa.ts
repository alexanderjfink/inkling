/** Service worker, share-target intake, and notifications. */

import { isNative } from './native'

export type ServiceWorkerStatus = 'unknown' | 'pending' | 'ready' | 'failed'

let swStatus: ServiceWorkerStatus = 'unknown'
let swError: string | null = null

export function serviceWorkerStatus(): { status: ServiceWorkerStatus; error: string | null } {
  return { status: swStatus, error: swError }
}

/**
 * Register the service worker, keeping the outcome.
 *
 * The failure is recorded rather than swallowed: a service worker will not
 * register on an origin whose certificate the browser does not trust, which is
 * exactly what a self-signed dev certificate is. Silently doing nothing would make
 * "why will it not install?" unanswerable.
 */
export function registerServiceWorker(): void {
  // Inside a native shell the app is already on the device, so a service worker would
  // be caching a bundle that is not going anywhere — and registering one under
  // `https://localhost` is how a stale asset survives a rebuild.
  if (isNative()) {
    swStatus = 'ready'
    return
  }
  if (!('serviceWorker' in navigator)) {
    swStatus = 'failed'
    swError = 'this browser has no service worker support'
    return
  }
  swStatus = 'pending'
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        swStatus = 'ready'
      })
      .catch((error: unknown) => {
        swStatus = 'failed'
        swError = error instanceof Error ? error.message : String(error)
      })
  })
}

export interface SharedContent {
  text?: string
  url?: string
  title?: string
}

/**
 * What the OS share sheet handed us.
 *
 * Android's share target sends `text`, `url` and `title` as query parameters. Apps
 * are inconsistent about which they fill in — many put the URL inside `text` too —
 * so the URL is only used when it is not already present in the text.
 */
export function readSharedContent(search: string = window.location.search): SharedContent | null {
  const params = new URLSearchParams(search)
  const text = params.get('text')?.trim() ?? ''
  const url = params.get('url')?.trim() ?? ''
  const title = params.get('title')?.trim() ?? ''
  if (!text && !url && !title) return null

  const body = text || (url && url !== title ? '' : title)
  return {
    text: body && body !== url ? body : undefined,
    url: url || undefined,
    title: title || undefined,
  }
}

/** Drop the share parameters so a reload does not re-capture the same thing. */
export function clearSharedQuery(): void {
  if (window.location.pathname === '/share' || window.location.search) {
    window.history.replaceState(null, '', '/')
  }
}

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator
}

/** Settings keys, shared between the app shell and the sync panel. */
export const NUDGE_KEY = 'notify:nudge'
export const NUDGE_LAST_KEY = 'notify:lastNudge'

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

/**
 * Show a notification through the service worker where possible, so it behaves
 * like an app notification rather than a page one.
 *
 * Honest limit: the web cannot wake itself in the background, so this fires when
 * the app is opened with something waiting — not at a time you choose. A true
 * scheduled reminder needs the native wrap.
 */
export async function notify(title: string, body: string, tag = 'inkling'): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      })
      return true
    }
    new Notification(title, { body, tag })
    return true
  } catch {
    return false
  }
}
