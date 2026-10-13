/* Dil Ki Baat push worker. No cache, analytics, or visitor identity. */
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const title = typeof payload.title === "string" ? payload.title.slice(0, 80) : "Dil Ki Baat";
  const body =
    typeof payload.body === "string"
      ? payload.body.slice(0, 240)
      : "Something new is waiting for you.";
  const path =
    typeof payload.url === "string" &&
    payload.url.startsWith("/") &&
    !payload.url.startsWith("//") &&
    !/[\\\r\n]/.test(payload.url) &&
    !/^\/(?:api|auth|admin)(?:\/|$)/i.test(payload.url)
      ? payload.url
      : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/dil-ki-baat-logo.png",
      badge: "/dil-ki-baat-logo.png",
      tag: "dil-ki-baat",
      data: { path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  const safePath =
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\\r\n]/.test(path) &&
    !/^\/(?:api|auth|admin)(?:\/|$)/i.test(path)
      ? path
      : "/";
  const target = new URL(safePath, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.navigate(target);
        return open.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// Some browsers fire this when rotating a subscription. Other browsers are
// reconciled when an opted-in visitor next opens the site.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch("/api/push/subscribe");
        if (!response.ok) return;
        const { publicKey } = await response.json();
        if (typeof publicKey !== "string" || !publicKey) return;
        const bytes = Uint8Array.from(
          atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
          (char) => char.charCodeAt(0),
        );
        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.getSubscription()) ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes,
          }));
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch {
        /* The next granted visit retries. */
      }
    })(),
  );
});
