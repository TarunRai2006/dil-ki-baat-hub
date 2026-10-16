import { readFileSync } from "node:fs";
import type { Page, Request } from "@playwright/test";
import { messages, stats, submissions, toRow, whispers } from "../../fixtures/data";
import type { AdminSubmission } from "@/lib/admin";

/** The Supabase URL the dev server was built with (same precedence as Vite). */
export function supabaseUrl(): string {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL;
  // .env.local (a local stack) wins over .env
  for (const file of [".env.local", ".env"]) {
    let env = "";
    try {
      env = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    } catch {
      continue;
    }
    const m = env.match(/^VITE_SUPABASE_URL="?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error("VITE_SUPABASE_URL not found");
}
/** supabase-js stores the session under sb-<first host label>-auth-token */
export const authStorageKey = () =>
  `sb-${new URL(supabaseUrl()).hostname.split(".")[0]}-auth-token`;

export type Recorded = {
  fn: string;
  method: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
};

export type MockOptions = {
  /** answer the visitor submission RPC with this error once (then succeed) */
  failFirstSubmit?: { status: number; message: string };
  /** admin session state for /admin tests */
  user?: "admin" | "plain" | null;
  /** fail the next admin_update_submission */
  failNextUpdate?: boolean;
};

/**
 * Answers every Supabase call from the shared fixtures; realtime sockets are
 * closed so the app exercises its reconnecting / polling fallback. Nothing
 * ever reaches the real project. Returns the recorded requests.
 */
export async function mockSupabase(page: Page, opts: MockOptions = {}) {
  const calls: Recorded[] = [];
  const db: AdminSubmission[] = submissions.map((s) => ({ ...s }));
  const audit: {
    id: number;
    created_at: string;
    action: string;
    detail: Record<string, unknown>;
  }[] = [];
  let failFirstSubmit = opts.failFirstSubmit;
  let failNextUpdate = opts.failNextUpdate ?? false;
  let roomExpiresAt: string | null = null;
  const origin = new URL(supabaseUrl()).origin;

  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => ws.close());
  await page.route(`${origin}/**`, async (route, req: Request) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Expose-Headers": "Content-Range",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>;
    const fn = url.pathname.match(/\/rpc\/([a-z0-9_]+)/)?.[1] ?? url.pathname.split("/").pop()!;
    calls.push({ fn, method: req.method(), query: url.searchParams, body });
    const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
      route.fulfill({
        status,
        headers: { ...cors, ...extra },
        contentType: "application/json",
        body: JSON.stringify(data),
      });

    // ---- auth
    if (url.pathname.endsWith("/auth/v1/user"))
      return opts.user
        ? json({
            id: `user-${opts.user}`,
            aud: "authenticated",
            role: "authenticated",
            email: `${opts.user}@example.com`,
          })
        : json({ code: 401, msg: "invalid JWT" }, 401);
    if (url.pathname.includes("/auth/v1/")) return json({ error: "invalid_grant" }, 400);

    // ---- visitor functions
    switch (fn) {
      case "get_public_whispers":
        return json(whispers.map((excerpt) => ({ excerpt })));
      case "submit_confession_v6":
        if (failFirstSubmit) {
          const f = failFirstSubmit;
          failFirstSubmit = undefined;
          return json({ code: "XX000", message: f.message }, f.status);
        }
        roomExpiresAt = null;
        return json([
          {
            submission_id: "new-1",
            alias: "Gumnam Dost #123",
            room_id: submissions[0].id,
            room_token: "a".repeat(48),
            room_expires_at: roomExpiresAt,
          },
        ]);
      case "get_chat_room":
        return json([
          {
            room_id: body._room_id,
            alias: "Gumnam Dost #123",
            status: "open",
            expires_at: roomExpiresAt,
            topic: "room:test",
          },
        ]);
      case "get_room_messages":
        return json(messages);
      case "send_chat_message":
        return json([
          {
            id: `srv-${calls.length}`,
            sender_type: "user",
            message: String(body._message).trim(),
            created_at: new Date().toISOString(),
            client_msg_id: body._client_msg_id,
          },
        ]);
      case "end_chat_room":
        return json(true);
    }

    // ---- admin functions (the database enforces these; here we model an admin)
    if (fn === "is_admin") return json(opts.user === "admin");
    if (
      opts.user !== "admin" &&
      /^admin_|submissions|moderation_log|chat_rooms|chat_messages/.test(fn)
    )
      return json({ code: "42501", message: "permission denied" }, 401);
    if (fn === "admin_dashboard_stats") return json(stats);
    if (fn === "admin_update_submission") {
      if (failNextUpdate) {
        failNextUpdate = false;
        return json({ code: "P0001", message: "not_authorized" }, 400);
      }
      const row = db.find((r) => r.id === body._id)!;
      if (typeof body._status === "string") {
        audit.unshift({
          id: audit.length + 1,
          created_at: new Date().toISOString(),
          action: "STATUS_CHANGED",
          detail: { old: row.status, new: body._status },
        });
        row.status = body._status as AdminSubmission["status"];
      }
      if (typeof body._is_featured === "boolean") row.is_featured = body._is_featured;
      if (typeof body._is_archived === "boolean") row.is_archived = body._is_archived;
      if (typeof body._admin_notes === "string") {
        row.admin_notes = body._admin_notes || null;
        audit.unshift({
          id: audit.length + 1,
          created_at: new Date().toISOString(),
          action: "NOTE_UPDATED",
          detail: {},
        });
      }
      return json(row);
    }
    if (fn === "admin_set_message_hidden") return json({ ...messages[0], is_hidden: body._hidden });
    if (fn === "moderation_log") return json(audit);
    if (fn === "chat_rooms")
      return json([
        {
          id: submissions[0].id,
          status: "open",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          last_message_at: messages[1].created_at,
          submissions: {
            alias: submissions[0].alias,
            content: submissions[0].content,
            category: submissions[0].category,
          },
          chat_messages: [{ count: messages.length }],
          last: [messages[0]],
        },
      ]);
    if (fn === "chat_messages") return json(messages.map((m) => ({ ...m, is_hidden: false })));
    if (fn === "submissions") {
      const id = url.searchParams.get("id");
      if (id) return json(db.find((r) => `eq.${r.id}` === id));
      const archived = url.searchParams.get("is_archived") === "eq.true";
      let list = db.filter((r) => r.is_archived === archived && !r.deleted_at);
      const intent = url.searchParams.get("intent");
      if (intent) list = list.filter((r) => `eq.${r.intent}` === intent);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const page = list.slice(offset, offset + limit).map(toRow);
      return json(page, 200, {
        "Content-Range": `${offset}-${offset + page.length - 1}/${list.length}`,
      });
    }
    return json({ message: `not mocked: ${fn}` }, 404);
  });
  return calls;
}

/** Puts a (fake, locally answered) signed-in session in storage before the app loads. */
export async function signIn(page: Page) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: "user-admin",
    aud: "authenticated",
    role: "authenticated",
    email: "admin@example.com",
    app_metadata: {},
    user_metadata: {},
  };
  const session = {
    access_token: `${b64({ alg: "HS256" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.sig`,
    refresh_token: "r",
    expires_at: exp,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [authStorageKey(), JSON.stringify(session)],
  );
}

/** Dev mode on a busy machine hydrates slowly: never interact before React owns the node. */
export async function hydrated(page: Page, selector: string) {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    },
    selector,
    { timeout: 180_000 },
  );
}
