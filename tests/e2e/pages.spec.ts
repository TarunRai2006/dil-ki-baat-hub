import { expect, test } from "@playwright/test";
import { hydrated, mockSupabase } from "./support/supabase";

for (const [path, heading] of [
  ["/terms", /terms and privacy/i],
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

test("visitor, terms and missing-page links reach their intended pages", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/");
  await hydrated(page, "#release textarea");
  await page.getByRole("link", { name: "Terms & Privacy" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Terms and Privacy" })).toBeVisible();
  await page.getByRole("link", { name: /back to dil ki baat/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("What is on your mind?")).toBeVisible();
  await page.getByRole("link", { name: "Terms and Privacy" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await page.goto("/no-such-page");
  await page.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("small phone has no sideways scroll on form or terms", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockSupabase(page);
  for (const path of ["/", "/terms"]) {
    await page.goto(path);
    if (path === "/") await hydrated(page, "#release textarea");
    else await expect(page.getByRole("heading", { name: "Terms and Privacy" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBe(
      0,
    );
  }
});
