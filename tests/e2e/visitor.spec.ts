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
  await page
    .getByLabel("What happened, and what feels hardest right now?")
    .fill("I have been pretending to be okay at work for months.\nIt is wearing me down.");
  await page
    .getByLabel("When does it feel hardest, and what have you tried?")
    .fill("I cannot focus at work. I tried taking a day off.");
  await page
    .getByLabel("What would you like us to understand or help with?")
    .fill("I need help deciding whether to talk to my manager. I am not ready to quit.");
  await page.getByRole("button", { name: "Career" }).click();
  const slider = page.getByRole("slider", { name: "How heavy is today?" });
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await page.getByRole("button", { name: "I want advice" }).click();
  await page.getByRole("button", { name: "Disappear in 1 hour" }).click();
}

test.describe("visitor journey", () => {
  test("new branding and submission consent are visible without creating a story", async ({
    page,
  }) => {
    const calls = await mockSupabase(page);
    await openForm(page);
    const logo = page.getByRole("img", { name: "Dil Ki Baat Haven logo" });
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "I am 18 or older" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText(/by submitting, you confirm you are at least 16/i)).toBeVisible();
    await page.getByRole("button", { name: /let it go/i }).click();
    await expect(page.getByRole("alert")).toContainText(/one honest sentence/i);
    expect(calls.filter((call) => call.fn === "submit_confession_v6")).toHaveLength(0);
  });

  test("ticker shows ten illustrative thoughts instead of private words", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    const ticker = page.locator('[data-marquee="top"]');
    await expect(ticker.locator(".header-marquee-thought")).toHaveCount(10);
    await expect(ticker).toContainText("I miss who I used to be.");
    await expect(ticker).not.toContainText("I finally told my sister");
    expect(
      await ticker
        .locator(".header-marquee-track")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    const footerTicker = page.locator('[data-marquee="bottom"]');
    await footerTicker.scrollIntoViewIfNeeded();
    await expect(footerTicker).toBeVisible();
    await expect(footerTicker.locator(".header-marquee-thought")).toHaveCount(10);
  });

  test("header, logo and consent sentence fit common screen sizes", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    for (const [width, height] of [
      [375, 812],
      [390, 844],
      [768, 1024],
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("img", { name: "Dil Ki Baat Haven logo" })).toBeVisible();
      await expect(
        page.getByText(/by submitting, you confirm you are at least 16/i),
      ).toBeAttached();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        `${width}x${height}`,
      ).toBe(0);
    }
  });

  test("fill every field, double-click submit: one request, real success", async ({ page }) => {
    const calls = await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).dblclick();
    const welcome = page.getByRole("dialog", { name: "Congratulations!!!!! You let it go." });
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText(/counsellor or therapist can read your story/i);
    await expect(welcome).toContainText(/not immediate or guaranteed/i);
    await welcome.getByRole("button", { name: "Open my chat" }).click();
    await expect(welcome).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    const submits = calls.filter((c) => c.fn === "submit_confession_v6");
    expect(submits).toHaveLength(1);
    expect(submits[0].body).toMatchObject({
      _consent_confirmed: true,
      _intent: "Advice",
      _emotional_state: 2,
      _category: "Career",
      _community_question: "",
      _nickname: "",
      _chat_ttl: "1h",
    });
    expect(Object.keys(submits[0].body).sort()).toEqual([
      "_anon_user_id",
      "_category",
      "_chat_ttl",
      "_client_request_id",
      "_community_question",
      "_consent_confirmed",
      "_content",
      "_emotional_state",
      "_intent",
      "_nickname",
    ]);
    for (const answer of [
      "I have been pretending to be okay at work for months.",
      "I cannot focus at work.",
      "I tried taking a day off.",
      "I am not ready to quit.",
    ])
      expect(submits[0].body._content).toContain(answer);
  });

  test("advice terms appear on hover; being heard has no timer or counsellor note", async ({
    page,
  }) => {
    const calls = await mockSupabase(page);
    await openForm(page);
    const star = page.getByRole("button", { name: "Advice terms" });
    await expect(star).toBeVisible();
    await star.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "A verified counsellor or therapist can read your story",
    );
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await page.getByRole("button", { name: "I want advice" }).click();
    await expect(page.getByRole("button", { name: "Disappear in 1 hour" })).toBeVisible();
    await page.getByRole("button", { name: "I want to be heard" }).click();
    await expect(page.getByRole("button", { name: "Disappear in 1 hour" })).toHaveCount(0);
    await expect(page.getByLabel("One question for your counsellor or therapist")).toHaveCount(0);
    await expect(page.getByLabel("A name that is not yours")).toHaveCount(0);
    await page
      .getByLabel("What happened, and what feels hardest right now?")
      .fill("I need someone to hear what happened today without giving me advice.");
    await page.getByRole("button", { name: /let it go/i }).click();
    const welcome = page.getByRole("dialog", { name: "Congratulations!!!!! You let it go." });
    await expect(welcome).toBeVisible();
    await expect(welcome).not.toContainText("A verified counsellor or therapist");
    await welcome.getByRole("button", { name: "Open my chat" }).click();
    await expect(page.getByRole("region", { name: "Your active chat" })).not.toContainText(
      "disappear",
    );
    const submit = calls.find((call) => call.fn === "submit_confession_v6");
    expect(submit?.body).toMatchObject({ _intent: "Express", _chat_ttl: "never" });
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
    await expect(page.getByLabel("What would you like us to understand or help with?")).toHaveValue(
      "I need help deciding whether to talk to my manager. I am not ready to quit.",
    );
    await page.getByRole("button", { name: /let it go/i }).click();
    await page.getByRole("button", { name: "Open my chat" }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    const ids = calls
      .filter((c) => c.fn === "submit_confession_v6")
      .map((c) => c.body._client_request_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test("chat replaces the form and can be reopened after refresh", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).click();
    await page.getByRole("button", { name: "Open my chat" }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await expect(page.getByLabel("What happened, and what feels hardest right now?")).toHaveCount(
      0,
    );
    const panel = page.getByRole("region", { name: "Your active chat" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("I'm here. Take your time.");
    await page.reload();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Congratulations!!!!! You let it go." }),
    ).toHaveCount(0);
    await panel.getByLabel("Message", { exact: true }).fill("  <b>hello</b>  ");
    await panel.getByLabel("Message", { exact: true }).press("Enter");
    await expect(panel).toContainText("<b>hello</b>");
    await expect(panel.locator("b")).toHaveCount(0);
    await page.getByRole("button", { name: "End chat" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "End chat and delete messages" })
      .click();
    await expect(page.getByLabel("What happened, and what feels hardest right now?")).toBeVisible();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toHaveCount(0);
  });

  test("a server outage never claims the chat or messages were deleted", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    await page
      .getByLabel("What happened, and what feels hardest right now?")
      .fill("I would like a private place to share what has been happening.");
    await page.getByRole("button", { name: "I want to be heard" }).click();
    await page.getByRole("button", { name: /let it go/i }).click();
    await page.getByRole("button", { name: "Open my chat" }).click();
    await page.route("**/rest/v1/rpc/end_chat_room", (route) => route.abort());
    await page.getByRole("button", { name: "End chat" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "End chat and delete messages" })
      .click();
    await expect(page.getByRole("alert")).toContainText("messages were not deleted");
    await expect(page.getByRole("region", { name: "Your active chat" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("dkb_chat_rooms"))).toContain("roomId");
  });

  test("crisis help always opens above the chat", async ({ page }) => {
    await mockSupabase(page);
    await openForm(page);
    await fillEverything(page);
    await page.getByRole("button", { name: /let it go/i }).click();
    await page.getByRole("button", { name: "Open my chat" }).click();
    await expect(page.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    await page.getByRole("button", { name: /get help/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("14416");
    // the helpline number is the topmost element at its own position
    const topmost = await dialog.getByText("14416", { exact: true }).evaluate((el) => {
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
      "What happened, and what feels hardest right now?",
      "When does it feel hardest, and what have you tried?",
      "What would you like us to understand or help with?",
    ]) {
      const size = await page
        .getByLabel(label)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size, label).toBeGreaterThanOrEqual(16);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
