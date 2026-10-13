import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./support/supabase";

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
