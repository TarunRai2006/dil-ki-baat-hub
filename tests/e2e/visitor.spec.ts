import { expect, test, type Page } from "@playwright/test";
import { hydrated, mockSupabase } from "./support/supabase";

test.use({ reducedMotion: "reduce" });

async function openForm(page: Page) {
  // Film behavior is covered separately. Keep interaction tests still so the
  // long background animation does not consume the test machine's GPU.
  await page.goto("/?film=blocked");
  await hydrated(page, "#release textarea");
}

async function fillEverything(page: Page) {
  await page.getByRole("button", { name: "I am 18 or older" }).click();
  await page
    .getByLabel("What is on your mind?")
    .fill("I have been pretending to be okay at work for months.\nIt is wearing me down.");
  await page.getByRole("button", { name: "Career", exact: true }).click();
  await page.getByRole("button", { name: "I want advice" }).click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.getByLabel("One question for the community").fill("Should I talk to my manager?");
  await page.getByLabel("A name that is not yours").fill("Tired Owl");
}

test.describe("visitor journey", () => {
  test("ticker shows only real, consented words", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    const ticker = page.locator(".animate-\\[marquee_38s_linear_infinite\\]");
    await expect(ticker).toContainText("I finally told my sister");
    await expect(ticker).not.toContainText(/Someone in \w+ just released/);
  });

  test("fill every field, double-click submit: one request, real success", async ({ page }) => {
    const calls = await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).dblclick();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    const submits = calls.filter((c) => c.fn === "submit_confession_v2");
    expect(submits).toHaveLength(1);
    expect(submits[0].body).toMatchObject({
      _content: "I have been pretending to be okay at work for months.\nIt is wearing me down.",
      _category: "Career",
      _intent: "Advice",
      _highlight_on_instagram: "Yes",
      _nickname: "Tired Owl",
      _community_question: "Should I talk to my manager?",
      _chat_enabled: true,
      _age_group: "18+",
    });
  });

  test("a server failure keeps every word and the retry reuses the request id", async ({
    page,
  }) => {
    const calls = await mockSupabase(page, {
      failFirstSubmit: { status: 500, message: "PostgrestError: boom" },
    });
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).click();
    const alert = page.locator("#release [role=alert]");
    await expect(alert).toHaveText(/something went wrong while sending your confession/i);
    await expect(alert).not.toContainText(/postgrest|boom/i);
    await expect(page.getByLabel("A name that is not yours")).toHaveValue("Tired Owl");
    await page.getByRole("button", { name: /let it go/i }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    const ids = calls
      .filter((c) => c.fn === "submit_confession_v2")
      .map((c) => c.body._client_request_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test("chat replaces the form and can be reopened after refresh", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await expect(page.getByLabel("What is on your mind?")).toHaveCount(0);
    const panel = page.getByRole("region", { name: "Your active chat" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("I'm here. Take your time.");
    await page.reload();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await panel.getByLabel("Message", { exact: true }).fill("  <b>hello</b>  ");
    await panel.getByLabel("Message", { exact: true }).press("Enter");
    await expect(panel).toContainText("<b>hello</b>");
    await expect(panel.locator("b")).toHaveCount(0);
    await page.getByRole("button", { name: "End chat" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "End chat and delete messages" })
      .click();
    await expect(page.getByLabel("What is on your mind?")).toBeVisible();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toHaveCount(0);
  });

  test("crisis help always opens above the chat", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await page.getByRole("button", { name: /get help/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("14416");
    // the helpline number is the topmost element at its own position
    const topmost = await page.getByText("14416", { exact: true }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(topmost).toBe(true);
  });

  test("phone inputs are 16px (no iOS focus zoom) and nothing scrolls sideways", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "phone-only check");
    await mockSupabase(page);
    await openForm(page);
    for (const label of [
      "What is on your mind?",
      "One question for the community",
      "A name that is not yours",
    ]) {
      const size = await page
        .getByLabel(label)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size, label).toBeGreaterThanOrEqual(16);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
