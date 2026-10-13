export type PushOptInStatus = "enabled" | "blocked" | "dismissed" | "unsupported" | "failed";

/** Called directly from a validated Submit click. Never blocks confession submission. */
export async function subscribeToPush(): Promise<PushOptInStatus> {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (
    !publicKey ||
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return "unsupported";

  if (Notification.permission === "denied") return "blocked";

  try {
    // This is deliberately before the first await: browsers require user activation.
    const permission =
      Notification.permission === "default"
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);
    const choice = await permission;
    if (choice !== "granted") return choice === "denied" ? "blocked" : "dismissed";
    await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
        char.charCodeAt(0),
      );
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
    }
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) {
      console.warn("Push subscription could not be saved.");
      return "failed";
    }
    return "enabled";
  } catch {
    console.warn("Push subscription is unavailable.");
    return "failed";
  }
}
