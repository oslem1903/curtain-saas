/* PerdePRO Service Worker
 * - Web Push (FCM uyumlu) bildirimleri: uygulama kapalı / telefon kilitliyken de gösterilir.
 * - Bildirime tıklanınca uygulama açılır ve ilgili sayfaya gidilir.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push payload formatı (FCM data mesajı veya Web Push JSON):
// { "title": "...", "body": "...", "url": "/#/dashboard", "tag": "..." }
self.addEventListener("push", (event) => {
  let payload = { title: "PerdePRO", body: "Yeni bildiriminiz var.", url: "/", tag: undefined };
  try {
    if (event.data) {
      const json = event.data.json();
      // FCM "notification" sarmalayıcısı veya düz data
      const src = json.notification || json.data || json;
      payload = {
        title: src.title || payload.title,
        body: src.body || src.message || payload.body,
        url: src.url || src.click_action || payload.url,
        tag: src.tag,
      };
    }
  } catch {
    /* metin payload — varsayılan kullan */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && url !== "/") client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
