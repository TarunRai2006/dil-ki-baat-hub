import { expect, test } from "@playwright/test";
import { mockSupabase } from "./support/supabase";

for (const [path, heading] of [
  ["/terms", /disclaimer & terms of service/i],
  ["/auth", /mentor access/i],
  ["/no-such-page", /404/],
] as const) {
  test(`${path}: title visible below the header, no sideways scroll`, async ({ page }) => {
    await mockSupabase(page);
    await page.goto(path);
    const h1 = page.locator("h1").first();
    await expect(h1).toHaveText(heading, { timeout: 120_000 });
    // the title is not covered by the floating header
    const covered = await h1.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
      return !el.contains(hit);
    });
    expect(covered).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}

test("robots.txt keeps crawlers off private pages; sitemap uses absolute URLs", async ({
  request,
  baseURL,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/admin/);
  expect(robots).toMatch(/Disallow: \/auth/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>${new URL(baseURL!).origin}/</loc>`);
});
