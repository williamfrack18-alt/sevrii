/* Sevrii service worker: shows the owner's notifications (new chat messages). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Sevrii", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Sevrii";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url).catch(() => w) : w)).catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// The browser replaced the subscription: tell Sevrii the new one so alerts keep arriving.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription ? event.oldSubscription.endpoint : "";
        let sub = event.newSubscription;
        if (!sub && event.oldSubscription && event.oldSubscription.options) {
          sub = await self.registration.pushManager.subscribe(event.oldSubscription.options);
        }
        if (!sub) return;
        await fetch("/api/push", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ old, sub: sub.toJSON() }),
        });
      } catch (e) {}
    })()
  );
});
