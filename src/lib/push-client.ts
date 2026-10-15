export type PushOptInStatus = "enabled" | "blocked" | "dismissed" | "unsupported" | "failed";

const PROMPTED_KEY = "dkb_push_prompted_v1";

/**
 * Browsers require an actual user gesture for their permission dialog. Ask on
 * the first interaction with the story or chat, without adding an opt-in button.
 * A dismissed or denied choice is remembered so later visits do not nag.
 */
export function installPushPromptOnFirstInteraction(): () => void {
  if (typeof window === "undefined" || !("Notification" in window)) return () => {};
  if (Notification.permission !== "default") return () => {};
  try {
    if (localStorage.getItem(PROMPTED_KEY)) return () => {};
  } catch {
    // Storage may be unavailable in a private context; this visit is still safe to try once.
  }

  let attempted = false;
  const cleanup = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
  const begin = (target: EventTarget | null) => {
    if (attempted || !(target instanceof Element) || !target.closest("#release")) return;
    attempted = true;
    cleanup();
    // subscribeToPush calls requestPermission before its first await, preserving user activation.
    void subscribeToPush().then((status) => {
      if (status === "enabled" || status === "blocked" || status === "dismissed") {
        try {
          localStorage.setItem(PROMPTED_KEY, "1");
        } catch {
          // Permission is still honoured when storage is unavailable.
        }
      }
    });
  };
  const onClick = (event: MouseEvent) => begin(event.target);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.key.length === 1 || event.key === "Enter") begin(event.target);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  return cleanup;
}

/** Requests browser permission during a user gesture; never blocks the story form. */
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
