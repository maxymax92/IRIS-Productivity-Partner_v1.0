/// <reference lib="webworker" />

/**
 * Iris PWA Service Worker
 *
 * Handles push notifications and notification click events.
 * This is a static JS file served from /public — not bundled by Next.js.
 */

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', function (event) {
  if (!event.data) return

  /** @type {{ title: string, body: string, icon?: string, data?: { url?: string } }} */
  var payload
  try {
    payload = event.data.json()
  } catch (_e) {
    payload = { title: 'Iris', body: event.data.text() }
  }

  var options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192x192.png',
    badge: '/favicon-32x32.png',
    data: {
      url: (payload.data && payload.data.url) || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Iris', options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus existing window if one is open
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i]
        if (new URL(client.url).pathname.startsWith(targetUrl) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open a new window
      return clients.openWindow(targetUrl)
    }),
  )
})
