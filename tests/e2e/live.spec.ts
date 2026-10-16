/**
 * @live: the whole system against a REAL local Supabase (Postgres + Auth +
 * PostgREST + Realtime), no mocks. Skipped unless LIVE_SUPABASE_URL is set.
 * See tests/README.md for the three commands that start everything.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hydrated } from "./support/supabase";

const URL_ = process.env.LIVE_SUPABASE_URL;
const ANON = process.env.LIVE_SUPABASE_ANON_KEY;
const SECRET = process.env.LIVE_SUPABASE_SECRET_KEY;
const live = !!(URL_ && ANON && SECRET);

test.describe.configure({ mode: "serial" });
test.describe("@live full stack", () => {
  test.skip(!live, "set LIVE_SUPABASE_URL / _ANON_KEY / _SECRET_KEY to run against local Supabase");
  test.skip(({ isMobile }) => isMobile, "runs once, on desktop");
  test.setTimeout(600_000);

  const stamp = Date.now();
  const ADMIN = { email: `mentor${stamp}@local.test`, password: `Mentor-${stamp}!` };
  const PLAIN = { email: `plain${stamp}@local.test`, password: `Plain-${stamp}!` };
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let visitor: Page;
  let mentor: Page;
  let subId = "";
  let visitorAlias = "";
  let stored: { roomId: string; token: string; alias: string };

  const signInClient = async (who: typeof ADMIN) => {
    const c = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    await c.auth.signInWithPassword(who);
    return c;
  };
  const newPage = async (browser: Browser) => (await browser.newContext()).newPage();
  const chat = (p: Page) => p.getByRole("region", { name: "Your active chat" });

  test.beforeAll(async ({ browser }) => {
    service = createClient(URL_!, SECRET!, { auth: { persistSession: false } });
    anon = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    for (const [who, isAdmin] of [
      [ADMIN, true],
      [PLAIN, false],
    ] as const) {
      const { data, error } = await service.auth.admin.createUser({ ...who, email_confirm: true });
      if (error) throw error;
      if (isAdmin)
        await service.from("user_roles").insert({ user_id: data.user.id, role: "admin" });
    }
    visitor = await newPage(browser);
    mentor = await newPage(browser);
  });

  test("mentor signs in for real and the dashboard goes live", async () => {
    await mentor.goto("/auth");
    await hydrated(mentor, "#signin-email");
    await mentor.locator("#signin-email").fill(ADMIN.email);
    await mentor.locator("#signin-password").fill(ADMIN.password);
    await mentor.locator('form button[type="submit"]').click();
    await expect(
      mentor.getByRole("heading", { name: "Counsellor & Therapist Dashboard" }),
    ).toBeVisible({
      timeout: 180_000,
    });
    await expect(mentor.getByText("Live", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("visitor submits; exactly one row is stored with every field", async () => {
    await visitor.goto("/");
    await hydrated(visitor, "#release textarea");
    await visitor
      .getByLabel("What happened, and what feels hardest right now?")
      .fill(`Live ${stamp}: pretending to be okay.\nIt is wearing me down.`);
    await visitor
      .getByLabel("When does it feel hardest, and what have you tried?")
      .fill("I feel worn down at work.");
    await visitor
      .getByLabel("What would you like us to understand or help with?")
      .fill("I need someone to listen.");
    await visitor.getByRole("button", { name: "Career" }).click();
    const feeling = visitor.getByRole("slider", { name: "How heavy is today?" });
    await feeling.focus();
    await feeling.press("Home");
    await feeling.press("ArrowRight");
    await visitor.getByRole("button", { name: "I want advice" }).click();
    await visitor.getByRole("button", { name: "Disappear in 1 hour" }).click();
    await visitor.getByRole("button", { name: /let it go/i }).dblclick();
    const openChat = visitor.getByRole("button", { name: "Open my chat" });
    await expect(openChat).toBeVisible({ timeout: 45_000 });

    const { data, error } = await service
      .from("submissions")
      .select("*")
      .like("content", `Live ${stamp}%`);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      category: "Career",
      intent: "Advice",
      emotional_state: 2,
      community_question: null,
      nickname: null,
      chat_ttl: "1h",
      highlight_on_instagram: "No",
      age_group: null,
      status: "Pending",
    });
    subId = data![0].id;
    visitorAlias = data![0].alias;
    await openChat.click();
    await expect(visitor.getByRole("heading", { name: /your chat is here/i })).toBeVisible();
    stored = await visitor.evaluate(
      () => JSON.parse(localStorage.getItem("dkb_chat_rooms") || "[]")[0],
    );
  });

  test("the dashboard learns about it without a refresh (realtime)", async () => {
    await expect(mentor.getByRole("button", { name: /\d+ new/ })).toBeVisible({ timeout: 20_000 });
    await expect(mentor.getByRole("button", { name: visitorAlias }).first()).toBeVisible();
  });

  test("moderation persists, is audited and survives a reload", async () => {
    await mentor.getByRole("button", { name: visitorAlias }).first().click();
    const sheet = mentor.getByRole("dialog");
    await expect(sheet).toContainText("It is wearing me down.");
    await sheet.getByRole("button", { name: "Approve" }).click();
    await expect
      .poll(
        async () =>
          (await service.from("submissions").select("status").eq("id", subId).single()).data
            ?.status,
      )
      .toBe("Approved");
    await sheet.getByLabel("Admin notes").fill("Follow up gently.");
    await sheet.getByRole("button", { name: "Save notes" }).click();
    await expect
      .poll(
        async () =>
          (await service.from("submissions").select("admin_notes").eq("id", subId).single()).data
            ?.admin_notes,
      )
      .toBe("Follow up gently.");
    const { data: log } = await service
      .from("moderation_log")
      .select("action")
      .eq("submission_id", subId);
    expect(log!.map((l) => l.action)).toEqual(
      expect.arrayContaining(["STATUS_CHANGED", "NOTE_UPDATED"]),
    );
    await mentor.reload();
    await mentor.getByRole("button", { name: visitorAlias }).first().click({ timeout: 120_000 });
    await expect(mentor.getByRole("dialog").getByLabel("Admin notes")).toHaveValue(
      "Follow up gently.",
    );
    await mentor.keyboard.press("Escape");
  });

  test("chat both ways over realtime, no duplicates", async () => {
    await expect(chat(visitor)).toContainText(/connected/i, { timeout: 30_000 });
    await mentor.getByRole("tab", { name: /^chats/i }).click();
    await mentor.getByRole("button", { name: stored.alias }).first().click();
    await chat(visitor).getByLabel("Message", { exact: true }).fill("hello from the visitor");
    await chat(visitor).getByLabel("Message", { exact: true }).press("Enter");
    await expect(mentor.getByRole("log").getByText("hello from the visitor")).toBeVisible({
      timeout: 10_000,
    });
    await mentor.getByLabel("Reply", { exact: true }).fill("I'm here with you.");
    await mentor.getByLabel("Reply", { exact: true }).press("Enter");
    await expect(chat(visitor)).toContainText("I'm here with you.", { timeout: 6_000 }); // faster than the 8s fallback poll
    await expect(chat(visitor).getByText("I'm here with you.", { exact: true })).toHaveCount(1);
  });

  test("offline and back: the missed message arrives once", async () => {
    await visitor.context().setOffline(true);
    await mentor.getByLabel("Reply", { exact: true }).fill("sent while you were offline");
    await mentor.getByLabel("Reply", { exact: true }).press("Enter");
    await visitor.waitForTimeout(3_000);
    await visitor.context().setOffline(false);
    await expect(
      chat(visitor).getByText("sent while you were offline", { exact: true }),
    ).toHaveCount(1, { timeout: 40_000 });
    await expect(chat(visitor)).toContainText(/connected/i, { timeout: 40_000 });
  });

  test("the raw API refuses anonymous and non-admin access", async () => {
    const read = await anon.from("submissions").select("id, admin_notes");
    expect(read.error || read.data?.length === 0).toBeTruthy();
    const write = await anon
      .from("submissions")
      .update({ status: "Approved" })
      .eq("id", subId)
      .select();
    expect(write.error || write.data?.length === 0).toBeTruthy();
    expect(
      (await anon.rpc("admin_update_submission", { _id: subId, _status: "Rejected" })).error,
    ).toBeTruthy();
    expect(
      (await anon.rpc("get_room_messages", { _room_id: stored.roomId, _token: "f".repeat(48) }))
        .error,
    ).toBeTruthy();
    const plain = await signInClient(PLAIN);
    expect((await plain.from("submissions").select("id")).data ?? []).toHaveLength(0);
    expect((await plain.rpc("admin_dashboard_stats")).error).toBeTruthy();
  });

  test("bursts are rate limited, expiry is enforced by the database", async () => {
    const results: string[] = [];
    for (let i = 0; i < 14; i++)
      results.push(
        (
          await anon.rpc("send_chat_message", {
            _room_id: stored.roomId,
            _token: stored.token,
            _message: `burst ${i}`,
            _client_msg_id: crypto.randomUUID(),
          })
        ).error?.message ?? "ok",
      );
    expect(results).toContain("rate_limited");
    await service
      .from("chat_rooms")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", subId);
    const late = await anon.rpc("send_chat_message", {
      _room_id: stored.roomId,
      _token: stored.token,
      _message: "late",
      _client_msg_id: crypto.randomUUID(),
    });
    expect(late.error?.message).toBe("room_expired");
  });
});
