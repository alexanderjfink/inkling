/**
 * Service worker: installability, an offline shell, and notification clicks.
 *
 * Deliberately conservative. Network-first for everything, with the cache as a
 * fallback, so it can never serve a stale asset while the server is reachable —
 * which matters because this app is under active development and a cache-first
 * worker would be a constant source of "why is my change not showing up".
 */

const CACHE = 'inkling-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never cache the API: sync and model traffic must always hit the server.
  if (url.pathname.startsWith('/api')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
        }
        return response
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match('/index.html')),
      ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
