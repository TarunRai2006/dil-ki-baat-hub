// Run with: npm test  (no Supabase project or Docker needed)
// Applies every project migration to an in-process Postgres with Supabase-like
// roles/defaults, then exercises the security model as anon, a plain signed-in
// user and an admin.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIG = fileURLToPath(new URL("../migrations", import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

// ---- Supabase platform stand-ins
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA realtime;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE realtime.sent (topic text, event text, payload jsonb, private boolean);
  CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.sent VALUES (topic, event, payload, private) $$;
  CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public, auth, extensions, realtime TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  -- Supabase grants everything in public to the API roles by default
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`);

const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort();
// the original Lovable migrations are "legacy"; everything from 2026-10 is ours
const legacy = files.filter((f) => f < "20261002");
const ours = files.filter((f) => f >= "20261002");
for (const f of legacy) await db.exec(readFileSync(`${MIG}/${f}`, "utf8"));

// legacy data that must survive the migration
await db.exec(`
  INSERT INTO public.submissions (id, content, category, chat_enabled, chat_ttl, status)
  VALUES ('11111111-1111-1111-1111-111111111111', 'An old archived story from before', 'Family, Career', true, '24h', 'Archived'),
         ('22222222-2222-2222-2222-222222222222', 'An old approved story here', 'Anxiety', false, 'never', 'Approved');
  INSERT INTO public.chat_messages (room_id, message) VALUES ('11111111-1111-1111-1111-111111111111', 'legacy hello');
`);

let migratedOk = true;
try {
  for (const f of ours) await db.exec(readFileSync(`${MIG}/${f}`, "utf8"));
  for (const f of ours) await db.exec(readFileSync(`${MIG}/${f}`, "utf8")); // idempotency
} catch (e) {
  migratedOk = false;
  console.log("MIGRATION FAILED:", e.message, e.where ?? "");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};

async function as(role, sub, fn, headers = { "x-forwarded-for": "203.0.113.7" }) {
  await db.exec(`RESET ROLE`);
  await db.query(
    `SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.headers', $2, false)`,
    [sub ?? "", JSON.stringify(headers)],
  );
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}
const err = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e.message;
  }
};

check("migration applies on top of legacy schema, twice", migratedOk);

const legacyRow = (
  await db.query(
    `SELECT status, is_archived FROM public.submissions WHERE id = '11111111-1111-1111-1111-111111111111'`,
  )
).rows[0];
check(
  "legacy 'Archived' status became is_archived flag",
  legacyRow.is_archived === true && legacyRow.status === "Reviewed",
  JSON.stringify(legacyRow),
);
const legacyRoom = (await db.query(`SELECT count(*)::int n FROM public.chat_rooms`)).rows[0].n;
check("legacy chat room backfilled", legacyRoom === 1);
check(
  "legacy messages kept",
  (await db.query(`SELECT count(*)::int n FROM public.chat_messages`)).rows[0].n === 1,
);

// ---------------------------------------------------------------- anonymous
const submit = (o = {}) =>
  db.query(`SELECT * FROM public.submit_confession_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
    o.content ?? "I have been carrying this for a long while now.",
    o.category ?? "Relationship",
    o.intent ?? "Both",
    o.mood ?? 2,
    o.question ?? "Was I wrong?",
    o.highlight ?? "Maybe",
    o.nickname ?? "Gumnam Dost",
    o.chat ?? true,
    o.ttl ?? "24h",
    o.anon ?? "anon-browser-1",
    o.req ?? crypto.randomUUID(),
    o.ageGroup ?? "18+",
  ]);

await as("anon", null, async () => {
  check(
    "anon cannot call the unchecked legacy submission function",
    /permission denied/.test(
      await err(
        db.query(
          `SELECT * FROM public.submit_confession('safe text long enough','Career','Both',2,'','No','',false,'24h','browser',gen_random_uuid())`,
        ),
      ),
    ),
  );
  check(
    "16–17 declaration cannot enable public sharing",
    /minor_public_sharing_disabled/.test(
      await err(submit({ ageGroup: "16-17", highlight: "Yes", chat: false })),
    ),
  );
  check(
    "anon cannot SELECT submissions",
    /permission denied/.test(await err(db.query(`SELECT * FROM public.submissions`))),
  );
  check(
    "anon cannot INSERT submissions directly",
    /permission denied/.test(
      await err(db.query(`INSERT INTO public.submissions (content) VALUES ('x')`)),
    ),
  );
  check(
    "anon cannot UPDATE submissions",
    /permission denied/.test(
      await err(db.query(`UPDATE public.submissions SET status='Approved'`)),
    ),
  );
  check(
    "anon cannot DELETE submissions",
    /permission denied/.test(await err(db.query(`DELETE FROM public.submissions`))),
  );
  check(
    "anon cannot read chat_messages",
    /permission denied/.test(await err(db.query(`SELECT * FROM public.chat_messages`))),
  );
  check(
    "anon cannot insert chat_messages directly",
    /permission denied/.test(
      await err(
        db.query(
          `INSERT INTO public.chat_messages (room_id, message) VALUES ('11111111-1111-1111-1111-111111111111','hi')`,
        ),
      ),
    ),
  );
  check(
    "anon cannot read chat_rooms (token hashes)",
    /permission denied/.test(await err(db.query(`SELECT * FROM public.chat_rooms`))),
  );
  check(
    "anon cannot read moderation_log",
    /permission denied/.test(await err(db.query(`SELECT * FROM public.moderation_log`))),
  );
  check(
    "anon cannot read rate_limits",
    /permission denied/.test(await err(db.query(`SELECT * FROM public.rate_limits`))),
  );
  check(
    "anon cannot call admin_update_submission",
    /permission denied/.test(
      await err(
        db.query(
          `SELECT public.admin_update_submission('22222222-2222-2222-2222-222222222222', 'Rejected')`,
        ),
      ),
    ),
  );
  check(
    "anon cannot call admin_dashboard_stats",
    /permission denied/.test(await err(db.query(`SELECT public.admin_dashboard_stats()`))),
  );
  check(
    "anon cannot call has_role",
    /permission denied/.test(
      await err(db.query(`SELECT public.has_role(gen_random_uuid(), 'admin')`)),
    ),
  );
  check(
    "anon cannot call internal hit_rate_limit",
    /permission denied/.test(
      await err(db.query(`SELECT public.hit_rate_limit('x', 1, interval '1 minute')`)),
    ),
  );
  check(
    "old token-less get_room_messages(uuid) is gone",
    /does not exist/.test(
      await err(
        db.query(
          `SELECT * FROM public.get_room_messages('11111111-1111-1111-1111-111111111111'::uuid)`,
        ),
      ),
    ),
  );

  check(
    "rejects too-short content",
    /invalid_content/.test(await err(submit({ content: "short" }))),
  );
  check(
    "rejects unknown category",
    /invalid_category/.test(await err(submit({ category: "Hacking" }))),
  );
  check("rejects bad intent", /invalid_intent/.test(await err(submit({ intent: "Admin" }))));
  check(
    "rejects mood out of range",
    /invalid_emotional_state/.test(await err(submit({ mood: 9 }))),
  );
  check(
    "rejects bad highlight",
    /invalid_highlight/.test(await err(submit({ highlight: "Sure" }))),
  );
  check(
    "rejects long nickname",
    /invalid_nickname/.test(await err(submit({ nickname: "x".repeat(41) }))),
  );
  check("rejects bad ttl", /invalid_chat/.test(await err(submit({ ttl: "forever" }))));
});

const req = crypto.randomUUID();
const first = await as("anon", null, () =>
  submit({
    req,
    anon: "anon-A",
    content: "  <script>alert(1)</script> trimmed and stored as plain text  ",
  }),
);
const r1 = first.rows[0];
check(
  "valid submission returns id, alias, room + token",
  !!r1.submission_id &&
    !!r1.alias &&
    r1.room_id === r1.submission_id &&
    /^[0-9a-f]{48}$/.test(r1.room_token),
);
const replay = await as("anon", null, () =>
  submit({
    req,
    anon: "anon-A",
    content: "  <script>alert(1)</script> trimmed and stored as plain text  ",
  }),
);
check(
  "double submit with same request id returns the same row",
  replay.rows[0].submission_id === r1.submission_id,
);
check(
  "only one row stored for the duplicate",
  (
    await db.query(`SELECT count(*)::int n FROM public.submissions WHERE client_request_id = $1`, [
      req,
    ])
  ).rows[0].n === 1,
);
const stored = (
  await db.query(
    `SELECT content, status, admin_notes, is_featured FROM public.submissions WHERE id = $1`,
    [r1.submission_id],
  )
).rows[0];
check(
  "stored trimmed, status Pending, admin fields untouched",
  stored.content.startsWith("<script>") &&
    stored.status === "Pending" &&
    stored.admin_notes === null &&
    stored.is_featured === false,
  JSON.stringify(stored),
);
const token = replay.rows[0].room_token; // replay rotated the token: the newest one is valid
check("replay rotates the chat token", token !== r1.room_token);
const minor = (
  await as("anon", null, () =>
    submit({ anon: "minor-test", ageGroup: "16-17", highlight: "No", chat: false }),
  )
).rows[0];
check(
  "16–17 declaration is stored with private sharing",
  (
    await db.query(
      `SELECT age_group, highlight_on_instagram FROM public.submissions WHERE id = $1`,
      [minor.submission_id],
    )
  ).rows[0].age_group === "16-17" &&
    (
      await db.query(`SELECT highlight_on_instagram FROM public.submissions WHERE id = $1`, [
        minor.submission_id,
      ])
    ).rows[0].highlight_on_instagram === "No",
);
check(
  "another browser cannot use a request id to rotate the token",
  /invalid_request/.test(await as("anon", null, () => err(submit({ req, anon: "other-browser" })))),
);
check(
  "same browser cannot start a second active chat",
  /active_chat_exists/.test(await as("anon", null, () => err(submit({ anon: "anon-A" })))),
);
const endRoom = (await as("anon", null, () => submit({ anon: "end-test" }))).rows[0];
await as("anon", null, () =>
  db.query(`SELECT public.send_chat_message($1,$2,$3,$4)`, [
    endRoom.room_id,
    endRoom.room_token,
    "Please erase this chat message",
    crypto.randomUUID(),
  ]),
);
check(
  "wrong token cannot end a chat",
  /room_not_found/.test(
    await as("anon", null, () =>
      err(db.query(`SELECT public.end_chat_room($1,$2)`, [endRoom.room_id, token])),
    ),
  ),
);
check(
  "valid token ends its chat",
  (
    await as("anon", null, () =>
      db.query(`SELECT public.end_chat_room($1,$2) ended`, [endRoom.room_id, endRoom.room_token]),
    )
  ).rows[0].ended === true,
);
check(
  "ending chat purges its live messages",
  (
    await db.query(`SELECT count(*)::int n FROM public.chat_messages WHERE room_id = $1`, [
      endRoom.room_id,
    ])
  ).rows[0].n === 0,
);
const endedSignal =
  (
    await db.query(
      `SELECT count(*)::int n FROM realtime.sent WHERE event = 'room' AND payload->>'status' = 'closed'`,
    )
  ).rows[0].n > 0;
check(
  "same browser can submit again after ending its chat",
  !!(await as("anon", null, () => submit({ anon: "end-test", chat: false }))).rows[0].submission_id,
);

// rate limit: 5 per 10 min per browser id
const rl = [];
for (let i = 0; i < 6; i++)
  rl.push(
    await as("anon", null, () => err(submit({ anon: "spammer", chat: false })), {
      "x-forwarded-for": `198.51.100.${i}`,
    }),
  );
check(
  "6th submission from one browser is rate limited",
  rl.slice(0, 5).every((e) => e === null) && /rate_limited/.test(rl[5] ?? ""),
  JSON.stringify(rl),
);
const ipRl = [];
for (let i = 0; i < 6; i++)
  ipRl.push(
    await as("anon", null, () => err(submit({ anon: "ip-" + i, chat: false })), {
      "x-forwarded-for": "192.0.2.50",
    }),
  );
check(
  "6th submission from one address is rate limited",
  /rate_limited/.test(ipRl[5] ?? ""),
  JSON.stringify(ipRl),
);

// chat
const room = r1.room_id;
await as("anon", null, async () => {
  check(
    "wrong token cannot open room",
    /room_not_found/.test(
      await err(db.query(`SELECT * FROM public.get_chat_room($1, $2)`, [room, "f".repeat(48)])),
    ),
  );
  check(
    "stale token from before rotation is rejected",
    /room_not_found/.test(
      await err(db.query(`SELECT * FROM public.get_chat_room($1, $2)`, [room, r1.room_token])),
    ),
  );
  const meta = (await db.query(`SELECT * FROM public.get_chat_room($1, $2)`, [room, token]))
    .rows[0];
  check(
    "room metadata for token holder",
    meta.status === "open" && meta.topic.startsWith("room:"),
    JSON.stringify(meta),
  );
  check(
    "rejects empty message",
    /message_empty/.test(
      await err(
        db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
          room,
          token,
          "   \n ",
          crypto.randomUUID(),
        ]),
      ),
    ),
  );
  check(
    "rejects 1001-char message",
    /message_too_long/.test(
      await err(
        db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
          room,
          token,
          "x".repeat(1001),
          crypto.randomUUID(),
        ]),
      ),
    ),
  );
  const cid = crypto.randomUUID();
  const m1 = (
    await db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
      room,
      token,
      "  hello there  ",
      cid,
    ])
  ).rows[0];
  const m2 = (
    await db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
      room,
      token,
      "  hello there  ",
      cid,
    ])
  ).rows[0];
  check("message trimmed and stored", m1.message === "hello there");
  check("resend with same client id does not duplicate", m1.id === m2.id);
  const msgs = (await db.query(`SELECT * FROM public.get_room_messages($1,$2)`, [room, token]))
    .rows;
  check(
    "token holder reads own room only",
    msgs.length === 1 && msgs.every((m) => !("room_id" in m) && !("anon_user_id" in m)),
  );
});
const sent = (await db.query(`SELECT * FROM realtime.sent WHERE event = 'message'`)).rows;
check(
  "insert broadcasts a content-free signal on the room topic",
  sent.length >= 1 &&
    sent.every((signal) => signal.topic.startsWith("room:") && !("message" in signal.payload)),
  JSON.stringify(sent[0]),
);

// chat rate limit: 12/min per room
const burst = [];
await as("anon", null, async () => {
  for (let i = 0; i < 13; i++)
    burst.push(
      await err(
        db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
          room,
          token,
          "msg " + i,
          crypto.randomUUID(),
        ]),
      ),
    );
});
check(
  "chat burst beyond 12/min is rate limited",
  burst.filter((e) => /rate_limited/.test(e ?? "")).length >= 1,
  JSON.stringify(burst.slice(-3)),
);

// ---------------------------------------------------------------- non-admin user
const plain = crypto.randomUUID();
await as("authenticated", plain, async () => {
  const rows = (await db.query(`SELECT * FROM public.submissions`)).rows;
  check("signed-in non-admin sees zero submissions", rows.length === 0);
  check(
    "signed-in non-admin sees zero messages",
    (await db.query(`SELECT * FROM public.chat_messages`)).rows.length === 0,
  );
  check(
    "is_admin() false for non-admin",
    (await db.query(`SELECT public.is_admin() a`)).rows[0].a === false,
  );
  check(
    "non-admin cannot moderate",
    /not_authorized/.test(
      await err(
        db.query(`SELECT public.admin_update_submission($1, 'Approved')`, [r1.submission_id]),
      ),
    ),
  );
  check(
    "non-admin cannot read stats",
    /not_authorized/.test(await err(db.query(`SELECT public.admin_dashboard_stats()`))),
  );
  check(
    "non-admin cannot reply in chat",
    /not_authorized/.test(
      await err(db.query(`SELECT public.admin_send_chat_message($1, 'hi', null)`, [room])),
    ),
  );
  check(
    "non-admin cannot UPDATE directly",
    /permission denied/.test(
      await err(db.query(`UPDATE public.submissions SET status = 'Approved'`)),
    ),
  );
  check(
    "non-admin cannot grant itself admin",
    /permission denied|row-level security/.test(
      await err(
        db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [plain]),
      ),
    ),
  );
});

// ---------------------------------------------------------------- admin
const admin = crypto.randomUUID();
await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [admin]);
await as("authenticated", admin, async () => {
  check(
    "is_admin() true for admin",
    (await db.query(`SELECT public.is_admin() a`)).rows[0].a === true,
  );
  const page = await db.query(
    `SELECT id, status FROM public.submissions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
  );
  check("admin reads submissions", page.rows.length >= 3);
  const search = await db.query(
    `SELECT id FROM public.submissions WHERE search_text ILIKE '%carrying this%'`,
  );
  check("admin search via search_text", search.rows.length >= 1);
  let r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, 'Reviewed')`, [
      r1.submission_id,
    ])
  ).rows[0];
  check("mark reviewed", r.status === "Reviewed" && r.reviewed_by === admin && r.reviewed_at);
  r = (
    await db.query(
      `SELECT * FROM public.admin_update_submission($1, _admin_notes => 'Called back, doing ok')`,
      [r1.submission_id],
    )
  ).rows[0];
  check(
    "add admin note keeps status",
    r.admin_notes === "Called back, doing ok" && r.status === "Reviewed",
  );
  r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, _is_featured => true)`, [
      r1.submission_id,
    ])
  ).rows[0];
  check("feature", r.is_featured === true);
  check(
    "reject invalid status",
    /invalid_status/.test(
      await err(
        db.query(`SELECT public.admin_update_submission($1, 'Deleted')`, [r1.submission_id]),
      ),
    ),
  );
  const reply = (
    await db.query(`SELECT * FROM public.admin_send_chat_message($1, 'You are not alone.', $2)`, [
      room,
      crypto.randomUUID(),
    ])
  ).rows[0];
  check("admin replies in live room", reply.sender_type === "admin");
  r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, _is_archived => true)`, [
      r1.submission_id,
    ])
  ).rows[0];
  check("archive", r.is_archived === true && r.status === "Reviewed");
  r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, _is_archived => false)`, [
      r1.submission_id,
    ])
  ).rows[0];
  check("restore from archive keeps status", r.is_archived === false && r.status === "Reviewed");
  r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, _deleted => true)`, [
      "22222222-2222-2222-2222-222222222222",
    ])
  ).rows[0];
  check("soft delete sets deleted_at, row kept", !!r.deleted_at);
  r = (
    await db.query(`SELECT * FROM public.admin_update_submission($1, _deleted => false)`, [
      "22222222-2222-2222-2222-222222222222",
    ])
  ).rows[0];
  check("restore from trash", r.deleted_at === null);
  const log = (
    await db.query(`SELECT action, detail FROM public.moderation_log WHERE submission_id = $1`, [
      r1.submission_id,
    ])
  ).rows;
  check(
    "every admin change is logged per field with old/new",
    JSON.stringify(log.map((l) => l.action).sort()) ===
      JSON.stringify(["ARCHIVED", "FEATURED", "NOTE_UPDATED", "RESTORED", "STATUS_CHANGED"]) &&
      log.find((l) => l.action === "STATUS_CHANGED").detail.old === "Pending" &&
      log.find((l) => l.action === "STATUS_CHANGED").detail.new === "Reviewed",
    JSON.stringify(log.map((l) => [l.action, l.detail])),
  );
  check("note text never copied into the audit log", !JSON.stringify(log).includes("Called back"));
  const stats = (await db.query(`SELECT public.admin_dashboard_stats() s`)).rows[0].s;
  check(
    "stats aggregate in database",
    stats.total >= 3 &&
      stats.reviewed >= 1 &&
      stats.today >= 1 &&
      stats.week >= 1 &&
      stats.moods.length === 5 &&
      typeof stats.rejected === "number" &&
      Array.isArray(stats.categories) &&
      stats.categories.some((c) => c.name === "Career"),
    JSON.stringify(stats),
  );
  check(
    "admin still cannot UPDATE content directly",
    /permission denied/.test(
      await err(db.query(`UPDATE public.submissions SET content = 'rewritten'`)),
    ),
  );
  check(
    "admin cannot hard delete",
    /permission denied/.test(await err(db.query(`DELETE FROM public.submissions`))),
  );
});

// ---- chat moderation: hide a message
const hideRoom = (await as("anon", null, () => submit({ anon: "hide-test" }))).rows[0];
await as("anon", null, () =>
  db.query(`SELECT public.send_chat_message($1,$2,$3,$4)`, [
    hideRoom.room_id,
    hideRoom.room_token,
    "Message for moderation",
    crypto.randomUUID(),
  ]),
);
const hideTarget = (
  await db.query(
    `SELECT id FROM public.chat_messages WHERE room_id = $1 AND sender_type = 'user' ORDER BY created_at LIMIT 1`,
    [hideRoom.room_id],
  )
).rows[0].id;
await as("anon", null, async () => {
  check(
    "anon cannot hide messages",
    /permission denied/.test(
      await err(db.query(`SELECT public.admin_set_message_hidden($1, true)`, [hideTarget])),
    ),
  );
});
await as("authenticated", plain, async () => {
  check(
    "non-admin cannot hide messages",
    /not_authorized/.test(
      await err(db.query(`SELECT public.admin_set_message_hidden($1, true)`, [hideTarget])),
    ),
  );
});
await db.exec("DELETE FROM realtime.sent");
await as("authenticated", admin, async () => {
  const h = (
    await db.query(`SELECT * FROM public.admin_set_message_hidden($1, true)`, [hideTarget])
  ).rows[0];
  check("admin hides a message", h.is_hidden === true);
});
const modSignal = (await db.query(`SELECT * FROM realtime.sent WHERE event = 'moderated'`)).rows;
check(
  "hiding sends a content-free moderated signal",
  modSignal.length === 1 && !("message" in modSignal[0].payload),
  JSON.stringify(modSignal),
);
await as("anon", null, async () => {
  const visible = (
    await db.query(`SELECT id FROM public.get_room_messages($1, $2)`, [
      hideRoom.room_id,
      hideRoom.room_token,
    ])
  ).rows.map((r) => r.id);
  check("hidden message is gone for the anonymous holder", !visible.includes(hideTarget));
});
await as("authenticated", admin, () =>
  db.query(`SELECT public.admin_update_submission($1, _is_archived => true)`, [r1.submission_id]),
);

// archiving closed the room: anonymous holder is told it's over
await as("anon", null, async () => {
  const meta = (await db.query(`SELECT * FROM public.get_chat_room($1, $2)`, [room, token]))
    .rows[0];
  check("archived confession closed its chat", meta.status === "closed");
});

// expiry is enforced by the database
await db.query(
  `UPDATE public.chat_rooms SET status = 'open', expires_at = now() - interval '1 minute' WHERE id = $1`,
  [room],
);
await as("anon", null, async () => {
  const meta = (await db.query(`SELECT * FROM public.get_chat_room($1, $2)`, [room, token]))
    .rows[0];
  check("expired room reports expired", meta.status === "expired");
  check(
    "expired room rejects new messages",
    /room_expired/.test(
      await err(
        db.query(`SELECT * FROM public.send_chat_message($1,$2,$3,$4)`, [
          room,
          token,
          "late",
          crypto.randomUUID(),
        ]),
      ),
    ),
  );
  check(
    "expired room rejects reads",
    /room_expired/.test(
      await err(db.query(`SELECT * FROM public.get_room_messages($1,$2)`, [room, token])),
    ),
  );
});
await as("authenticated", admin, async () => {
  check(
    "expired room rejects admin replies too",
    /room_expired/.test(
      await err(db.query(`SELECT public.admin_send_chat_message($1, 'late', null)`, [room])),
    ),
  );
});
const roomSignals = (
  await db.query(`SELECT payload FROM realtime.sent WHERE event = 'room'`)
).rows.map((r) => r.payload.status);
check(
  "closing a room signals the anonymous holder",
  endedSignal || roomSignals.includes("closed"),
  JSON.stringify(roomSignals),
);
const expired = (await db.query(`SELECT public.expire_chat_rooms() n`)).rows[0].n;
check("expire_chat_rooms marks rooms expired", expired === 1);

// ---- public whispers: consent + approval + feature, excerpt only
let ipn = 0;
const mk = async (content, highlight, status, featured, archived = false) => {
  ipn++;
  const r = (
    await as("anon", null, () => submit({ content, highlight, chat: false, anon: "w-" + ipn }), {
      "x-forwarded-for": "10.9.9." + ipn,
    })
  ).rows[0];
  await as("authenticated", admin, () =>
    db.query(`SELECT public.admin_update_submission($1, $2, $3, $4)`, [
      r.submission_id,
      status,
      featured,
      archived,
    ]),
  );
};
await mk("Consented approved featured whisper number one.", "Yes", "Approved", true);
await mk("No consent but approved and featured, must stay private.", "No", "Approved", true);
await mk("Maybe consent, approved and featured, must stay private.", "Maybe", "Approved", true);
await mk("Consented but only pending, must stay private for now.", "Yes", "Pending", true);
await mk("Consented approved but not featured stays private.", "Yes", "Approved", false);
await mk("Consented approved featured but archived stays private.", "Yes", "Approved", true, true);
const whispers = await as("anon", null, () =>
  db.query(`SELECT * FROM public.get_public_whispers(50)`),
);
check(
  "anon sees only consented + approved + featured whispers",
  whispers.rows.length === 1 && whispers.rows[0].excerpt.startsWith("Consented approved featured"),
  JSON.stringify(whispers.rows),
);
check(
  "whispers expose only an excerpt column",
  JSON.stringify(Object.keys(whispers.rows[0])) === '["excerpt"]',
);
await as("anon", null, async () => {
  check(
    "anon cannot call internal room_is_live",
    /permission denied/.test(
      await err(
        db.query(`SELECT public.room_is_live(r) FROM (SELECT NULL::public.chat_rooms r) x`),
      ),
    ),
  );
});

// ---- audit hardening: rate-limit key cannot be dodged by forging X-Forwarded-For
const spoof = [];
for (let i = 0; i < 6; i++)
  spoof.push(
    await as("anon", null, () => err(submit({ anon: "spoof-" + i, chat: false })), {
      "cf-connecting-ip": "198.18.0.1",
      "x-forwarded-for": `10.66.${i}.1, 198.18.0.1`,
    }),
  );
check(
  "forged X-Forwarded-For does not reset the per-address limit",
  /rate_limited/.test(spoof[5] ?? ""),
  JSON.stringify(spoof),
);

// ---- long rooms: the widget gets the newest 500, oldest first
const long = (
  await as("anon", null, () => submit({ anon: "long-room", chat: true, ttl: "never" }), {
    "x-forwarded-for": "10.77.0.1",
  })
).rows[0];
await db.query(
  `INSERT INTO public.chat_messages (room_id, sender_type, message) SELECT $1, 'user', 'line ' || g FROM generate_series(1, 520) g`,
  [long.room_id],
);
const newest = await as("anon", null, () =>
  db.query(`SELECT message FROM public.get_room_messages($1, $2)`, [long.room_id, long.room_token]),
);
check(
  "long room returns newest 500, oldest first",
  newest.rows.length === 500 &&
    newest.rows.at(-1).message === "line 520" &&
    newest.rows[0].message === "line 21",
  `${newest.rows.length} ${newest.rows[0]?.message} .. ${newest.rows.at(-1)?.message}`,
);

// ---- idempotent paths still behave after the locks were added
const reqA = crypto.randomUUID();
const a1 = (
  await as("anon", null, () => submit({ req: reqA, anon: "idem-a", chat: false }), {
    "x-forwarded-for": "10.88.0.1",
  })
).rows[0];
const a2 = (
  await as("anon", null, () => submit({ req: reqA, anon: "idem-a", chat: false }), {
    "x-forwarded-for": "10.88.0.1",
  })
).rows[0];
check(
  "replayed submission after hardening returns same row",
  a1.submission_id === a2.submission_id,
);

// publication
const pub = (
  await db.query(
    `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`,
  )
).rows.map((r) => r.tablename);
check(
  "realtime publication covers submissions, chat_rooms, chat_messages",
  ["chat_messages", "chat_rooms", "submissions"].every((t) => pub.includes(t)),
  pub.join(","),
);

// RLS audit
check(
  "anon cannot read push subscriptions",
  !!(await as("anon", null, () => err(db.query("SELECT * FROM public.push_subscriptions")))),
);
check(
  "anon cannot insert push subscriptions",
  !!(await as("anon", null, () =>
    err(
      db.query(
        "INSERT INTO public.push_subscriptions(endpoint,p256dh,auth) VALUES ('https://fcm.googleapis.com/fcm/send/test', 'x', 'x')",
      ),
    ),
  )),
);
check(
  "anon cannot call push rate limiter",
  !!(await as("anon", null, () => err(db.query("SELECT public.push_check_rate_limit('test')")))),
);
check(
  "anon cannot read broadcast audit",
  !!(await as("anon", null, () => err(db.query("SELECT * FROM public.push_broadcast_audit")))),
);
const pushColumns = (
  await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions'",
  )
).rows.map((row) => row.column_name);
check(
  "push table has no identity or confession link",
  !["user_id", "confession_id", "chat_id", "ip_address", "ip_hash", "name", "email", "phone"].some(
    (column) => pushColumns.includes(column),
  ),
);
const auditColumns = (
  await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='push_broadcast_audit'",
  )
).rows.map((row) => row.column_name);
check(
  "broadcast audit has no recipient secrets or message content",
  !["endpoint", "p256dh", "auth", "title", "body", "subscription_id"].some((column) =>
    auditColumns.includes(column),
  ),
);
const rls = (
  await db.query(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`,
  )
).rows;
check(
  "RLS enabled on every public table",
  rls.every((r) => r.relrowsecurity),
  JSON.stringify(rls),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
