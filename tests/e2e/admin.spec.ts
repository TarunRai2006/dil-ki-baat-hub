import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./support/supabase";

const ADMIN_DATA = /submissions|moderation_log|chat_rooms|chat_messages|admin_dashboard_stats/;

test.describe("admin access", () => {
  test("logged out: /admin redirects to sign-in and fetches no admin data", async ({ page }) => {
    const calls = await mockSupabase(page, { user: null });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth$/, { timeout: 180_000 });
    expect(calls.filter((c) => ADMIN_DATA.test(c.fn))).toHaveLength(0);
  });

  test("signed-in non-admin: access-required page, no admin data", async ({ page }) => {
    const calls = await mockSupabase(page, { user: "plain" });
    await signIn(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /mentor access required/i })).toBeVisible({
      timeout: 180_000,
    });
    expect(calls.filter((c) => ADMIN_DATA.test(c.fn))).toHaveLength(0);
  });
});

test.describe("admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("overview, server-side filters, sort and numbered pagination", async ({ page }) => {
    const calls = await mockSupabase(page, { user: "admin" });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Mentor Dashboard" })).toBeVisible({
      timeout: 180_000,
    });
    for (const tile of [
      "Total",
      "Today",
      "This week",
      "Pending",
      "Approved",
      "Archived",
      "Featured",
    ])
      await expect(page.getByText(tile, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /tired owl/i })).toBeVisible();

    const lastList = () =>
      calls.filter((c) => c.fn === "submissions" && !c.query.get("id")).at(-1)!.query;
    expect(lastList().get("select")).not.toMatch(/admin_notes/);
    const pager = page.getByRole("navigation", { name: "Pagination" });
    await pager.getByRole("button", { name: "2", exact: true }).click();
    await expect.poll(() => lastList().get("offset")).toBe("20");

    await page.getByRole("combobox", { name: "Request type" }).click();
    await page.getByRole("option", { name: "I want advice" }).click();
    await expect.poll(() => lastList().get("intent")).toBe("eq.Advice");
    expect(lastList().get("offset")).toBe("0"); // filters reset to page 1

    await page.getByRole("combobox", { name: "Sort" }).click();
    await page.getByRole("option", { name: "Recently updated" }).click();
    await expect.poll(() => lastList().get("order")).toMatch(/^updated_at\.desc/);

    await page.getByLabel("Search submissions").fill("manager");
    await expect.poll(() => lastList().get("search_text")).toBe("ilike.%manager%");
  });

  test("open a submission: full record, status change and notes persist through the guarded function", async ({
    page,
  }) => {
    const calls = await mockSupabase(page, { user: "admin" });
    await page.goto("/admin");
    await page.getByRole("button", { name: /tired owl/i }).click({ timeout: 180_000 });
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("It is wearing me down.");
    await expect(sheet).toContainText("Should I talk to my manager?");

    await sheet.getByRole("button", { name: "Approve" }).click();
    await expect(sheet.getByText("Approved", { exact: true }).first()).toBeVisible();
    await sheet.getByLabel("Admin notes").fill("Follow up gently.");
    await sheet.getByRole("button", { name: "Save notes" }).click();
    await expect(sheet).toContainText("Notes edited");
    const updates = calls.filter((c) => c.fn === "admin_update_submission").map((c) => c.body);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _status: "Approved" }),
        expect.objectContaining({ _admin_notes: "Follow up gently." }),
      ]),
    );
  });

  test("a refused change rolls back and says why", async ({ page }) => {
    await mockSupabase(page, { user: "admin", failNextUpdate: true });
    await page.goto("/admin");
    await page.getByRole("button", { name: /tired owl/i }).click({ timeout: 180_000 });
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Feature", exact: true }).click();
    await expect(page.getByText(/you do not have permission/i)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Feature", exact: true })).toBeVisible();
  });

  test("archive asks for confirmation first", async ({ page }) => {
    const calls = await mockSupabase(page, { user: "admin" });
    await page.goto("/admin");
    await page.getByRole("button", { name: /tired owl/i }).click({ timeout: 180_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Archive this confession?");
    expect(calls.filter((c) => c.fn === "admin_update_submission")).toHaveLength(0);
    await confirm.getByRole("button", { name: "Archive" }).click();
    await expect
      .poll(() => calls.filter((c) => c.fn === "admin_update_submission").at(-1)?.body._is_archived)
      .toBe(true);
  });

  test("chats fit the screen and can hide a message", async ({ page }) => {
    const calls = await mockSupabase(page, { user: "admin" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: /^chats/i }).click({ timeout: 180_000 });
    const row = page.getByRole("button", { name: /gumnam dost #101/i });
    // the list previews the latest message and flags the visitor's unread words
    await expect(row).toContainText("hello, is anyone there?");
    await expect(row.getByRole("img", { name: "Unread" })).toBeVisible();
    await row.click();
    await expect(page.getByRole("log").getByText("hello, is anyone there?")).toBeVisible();
    await expect(page.getByRole("tab", { name: /^chats/i })).not.toContainText("unread");
    // what they originally wrote sits above the conversation
    await page.getByText("What they wrote").click();
    await expect(page.getByText(/what they wrote/i).locator("..")).toContainText(
      "I have been pretending",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole("button", { name: "Hide message" }).first().click({ force: true });
    await expect
      .poll(() => calls.filter((c) => c.fn === "admin_set_message_hidden").length)
      .toBe(1);
  });
});
