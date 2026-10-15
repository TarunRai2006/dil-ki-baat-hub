import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./support/supabase";

test("first story interaction requests browser permission and saves one subscription", async ({
  page,
}) => {
  test.skip(!process.env.VITE_VAPID_PUBLIC_KEY, "requires a public VAPID key in the dev build");
  await mockSupabase(page);
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    let promptCount = 0;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        get permission() {
          return permission;
        },
        requestPermission: () => {
          promptCount += 1;
          permission = "granted";
          return Promise.resolve(permission);
        },
      },
    });
    Object.defineProperty(window, "__pushPromptCount", { get: () => promptCount });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    const subscription = {
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
        expirationTime: null,
        keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
      }),
    };
    const registration = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => subscription,
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => registration, ready: Promise.resolve(registration) },
    });
  });
  const saved: unknown[] = [];
  await page.route("**/api/push/subscribe", async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/?film=blocked");
  const story = page.getByLabel("What happened, and what feels hardest right now?");
  await expect(story).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { __pushPromptCount: number }).__pushPromptCount),
  ).toBe(0);
  await story.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __pushPromptCount: number }).__pushPromptCount),
    )
    .toBe(1);
  await expect.poll(() => saved.length).toBe(1);
  await story.fill("I want to talk about something that has been weighing on me.");
  await page.getByRole("button", { name: "I want to be heard" }).click();
  await page.getByRole("button", { name: /let it go/i }).click();
  await page.getByRole("button", { name: "Open my chat" }).click();
  await expect(
    page.getByRole("dialog", { name: "Congratulations!!!!! You let it go." }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your active chat" })).toBeVisible();
  await expect(page.getByText("Enable browser alerts")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { __pushPromptCount: number }).__pushPromptCount),
  ).toBe(1);
  if (process.env.CAPTURE_PUSH_SCREENSHOT) {
    mkdirSync(resolve("artifacts"), { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve("artifacts", "push-chat-updated.png"), fullPage: true });
  }
});

test("admin confirms a broadcast and sees aggregate results", async ({ page }) => {
  await signIn(page);
  await mockSupabase(page, { user: "admin" });
  const sent: unknown[] = [];
  await page.route("**/api/push/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { count: 12 } });
    } else {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: { total: 12, successful: 11, removedInvalid: 1, failedTemporary: 0 },
      });
    }
  });
  await page.goto("/admin");
  await page.getByRole("tab", { name: /push/i }).click();
  await expect(page.getByText("Active subscriptions: 12")).toBeVisible();
  await page.getByLabel("Message").fill("A gentle update is here.");
  await page.getByRole("button", { name: "Send notification" }).click();
  expect(sent).toHaveLength(0);
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("12 browsers");
  await confirmation.getByRole("button", { name: "Send notification" }).click();
  await expect(page.getByRole("status")).toContainText("Successful: 11");
  expect(sent).toEqual([{ title: "Dil Ki Baat ❤️", body: "A gentle update is here.", url: "/" }]);
});
