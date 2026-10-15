import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationSchema, subscriptionSchema } from "@/lib/push-shared";
import { installPushPromptOnFirstInteraction, subscribeToPush } from "@/lib/push-client";

const payload = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
  expirationTime: null,
  keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("push boundaries", () => {
  it("accepts a browser subscription and rejects non-push and private endpoints", () => {
    expect(subscriptionSchema.safeParse(payload).success).toBe(true);
    expect(
      subscriptionSchema.safeParse({
        ...payload,
        endpoint: "https://jmt17.google.com/fcm/send/test-endpoint",
      }).success,
    ).toBe(true);
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/test",
      "https://127.0.0.1/private",
      "https://example.com/push",
      "https://fcm.googleapis.com.evil.test/push",
      "https://jmt17.google.com/private",
    ]) {
      expect(subscriptionSchema.safeParse({ ...payload, endpoint }).success).toBe(false);
    }
    expect(
      subscriptionSchema.safeParse({ ...payload, keys: { p256dh: "bad", auth: "x" } }).success,
    ).toBe(false);
  });

  it("rejects external, script and admin notification destinations", () => {
    for (const url of [
      "https://evil.test",
      "//evil.test",
      "/admin",
      "/api/push/admin",
      "/\\evil.test",
    ])
      expect(notificationSchema.safeParse({ title: "Hi", body: "Hello", url }).success).toBe(false);
    expect(
      notificationSchema.safeParse({ title: "Hi", body: "Hello", url: "/terms" }).success,
    ).toBe(true);
  });
});

describe("optional browser subscription", () => {
  function supported(permission: NotificationPermission = "default") {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "AQAB");
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", { permission, requestPermission });
    vi.stubGlobal("PushManager", class {});
    const getSubscription = vi.fn().mockResolvedValue(null);
    const subscribe = vi.fn().mockResolvedValue({ toJSON: () => payload });
    const register = vi.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    return { requestPermission, getSubscription, subscribe, register, fetchMock };
  }

  it("requests permission during a user gesture and saves only after allow", async () => {
    const mock = supported();
    const attempt = subscribeToPush();
    expect(mock.requestPermission).toHaveBeenCalledOnce();
    expect(await attempt).toBe("enabled");
    expect(mock.subscribe).toHaveBeenCalledOnce();
    expect(mock.fetchMock).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("asks on the first story interaction, never on load or after dismissal", async () => {
    const mock = supported();
    mock.requestPermission.mockResolvedValue("default");
    document.body.innerHTML =
      '<main id="release"><textarea aria-label="Your story"></textarea></main>';
    const cleanup = installPushPromptOnFirstInteraction();
    expect(mock.requestPermission).not.toHaveBeenCalled();
    document.querySelector("textarea")!.click();
    expect(mock.requestPermission).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(localStorage.getItem("dkb_push_prompted_v1")).toBe("1"));
    document.querySelector("textarea")!.click();
    cleanup();
    const cleanupNextVisit = installPushPromptOnFirstInteraction();
    document.querySelector("textarea")!.click();
    expect(mock.requestPermission).toHaveBeenCalledOnce();
    cleanupNextVisit();
  });

  it("does not ask when clicking outside the story or chat", () => {
    const mock = supported();
    document.body.innerHTML = '<button id="help">Get help</button><main id="release"></main>';
    const cleanup = installPushPromptOnFirstInteraction();
    document.querySelector("#help")!.click();
    expect(mock.requestPermission).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not prompt again or resubscribe when already granted", async () => {
    const mock = supported("granted");
    mock.getSubscription.mockResolvedValue({ toJSON: () => payload });
    expect(await subscribeToPush()).toBe("enabled");
    expect(mock.requestPermission).not.toHaveBeenCalled();
    expect(mock.subscribe).not.toHaveBeenCalled();
  });

  it("skips denied, unsupported and failed saves without throwing", async () => {
    const denied = supported("denied");
    expect(await subscribeToPush()).toBe("blocked");
    expect(denied.requestPermission).not.toHaveBeenCalled();
    const allowed = supported("granted");
    allowed.fetchMock.mockResolvedValue({ ok: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await subscribeToPush()).toBe("failed");
    warn.mockRestore();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    expect(await subscribeToPush()).toBe("unsupported");
  });

  it("absorbs a browser permission API exception", async () => {
    const mock = supported();
    mock.requestPermission.mockImplementation(() => {
      throw new Error("permission unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await subscribeToPush()).toBe("failed");
    expect(mock.fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
