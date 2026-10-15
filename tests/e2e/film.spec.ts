import { expect, test, type Page } from "@playwright/test";
import { hydrated, mockSupabase } from "./support/supabase";

/** Types into the form and checks the keystrokes land (the film never blocks input). */
async function formWorks(page: Page) {
  await hydrated(page, "#release textarea");
  const box = page.getByLabel("What happened, and what feels hardest right now?");
  await box.fill("typing while the film plays");
  await expect(box).toHaveValue("typing while the film plays");
}

const paused = (page: Page) =>
  page.locator(".film-bg video").evaluate((v: HTMLVideoElement) => v.paused);

test.describe("background film", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
  });

  test("the poster and muted looping video ship in HTML while chat storage is checked", async ({
    request,
    page,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).toMatch(/<img[^>]+src="\/media\/city-film-poster-v2\.webp"/);
    const video = html.match(/<video[^>]*>/)![0];
    for (const attr of [/muted/, /autoPlay|autoplay/, /loop/, /playsInline|playsinline/])
      expect(video).toMatch(attr);
    // The server cannot inspect this browser's private room key. Hold the form
    // until hydration checks storage so it cannot flash over an active chat.
    expect(html).toMatch(/<main[^>]+id="release"/);
    expect(html).toContain("Checking for your chat");
    await page.goto("/");
    await hydrated(page, "#release textarea");
  });

  test("film plays behind the form, covers the viewport, and never takes input", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>(".film-bg video");
        return !!v && !v.paused && v.currentTime > 0;
      },
      undefined,
      { timeout: 180_000 },
    );
    const selectedVideo = await page
      .locator(".film-bg video")
      .evaluate((v: HTMLVideoElement) => v.currentSrc);
    expect(selectedVideo).toContain(isMobile ? "city-film-mobile-v2.mp4" : "city-film-v2.mp4");
    const box = (await page.locator(".film-bg video").boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeLessThanOrEqual(0);
    expect(box.y).toBeLessThanOrEqual(0);
    expect(box.x + box.width).toBeGreaterThanOrEqual(vp.width);
    expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height);
    expect(await page.locator(".film-bg video").evaluate((v: HTMLVideoElement) => v.loop)).toBe(
      true,
    );
    // the form is what sits under the pointer, not the film
    const ta = (await page
      .getByLabel("What happened, and what feels hardest right now?")
      .boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.tagName,
      [ta.x + ta.width / 2, ta.y + ta.height / 2],
    );
    expect(hit).toBe("TEXTAREA");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await formWorks(page);
  });

  test("the film keeps playing across a loop", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => (document.querySelector<HTMLVideoElement>(".film-bg video")?.currentTime ?? 0) > 8,
      undefined,
      { timeout: 60_000 },
    );
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>(".film-bg video");
        return !!v && v.currentTime < 2 && !v.paused;
      },
      undefined,
      { timeout: 30_000 },
    );
    await expect(page.locator(".film-frame[data-ready]")).toBeVisible();
  });

  test("a film that cannot load leaves the poster and a working form", async ({ page }) => {
    await page.goto("/?film=error");
    await formWorks(page);
    await expect(page.locator(".film-bg img")).toBeVisible();
    expect(await paused(page)).toBe(true);
  });

  test("refused autoplay needs no Play button: the form works over the poster", async ({
    page,
  }) => {
    await page.goto("/?film=blocked");
    await formWorks(page);
    await expect(page.getByRole("button", { name: /play/i })).toHaveCount(0);
  });

  test("reduced motion: a still poster, the form unaffected", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await formWorks(page);
    expect(await paused(page)).toBe(true);
  });
});
