// Run with: npm test  (part of test:db)
// Proves supabase/seed.sql loads on top of every migration (through the same
// validating triggers) and produces the fixture shapes the tests rely on.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA realtime;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public, auth, extensions, realtime TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`);
for (const f of readdirSync(`${root}/migrations`)
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(readFileSync(`${root}/migrations/${f}`, "utf8"));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};
const seed = readFileSync(`${root}/seed.sql`, "utf8");
let loaded = true;
try {
  await db.exec(seed);
  await db.exec(seed); // re-running must not duplicate anything
} catch (e) {
  loaded = false;
  console.log("seed error:", e.message);
}
check("seed.sql loads on top of all migrations, and re-runs cleanly", loaded);

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
check(
  "48 confessions (8 named + 40 for pagination)",
  (await one("SELECT count(*)::int n FROM public.submissions")).n === 48,
);
const shelves = await one(`SELECT
  count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived)::int active,
  count(*) FILTER (WHERE is_archived)::int archived,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)::int trashed,
  count(DISTINCT status)::int statuses FROM public.submissions`);
check(
  "every shelf and status is represented",
  shelves.archived === 1 &&
    shelves.trashed === 1 &&
    shelves.statuses === 4 &&
    shelves.active === 46,
  JSON.stringify(shelves),
);

await db.exec("SET ROLE anon");
const whispers = (await db.query("SELECT * FROM public.get_public_whispers(50)")).rows;
check(
  "exactly one public whisper: the consented, approved, featured one",
  whispers.length === 1 && whispers[0].excerpt.startsWith("I finally told my sister"),
  JSON.stringify(whispers),
);
const live = await one("SELECT * FROM public.get_chat_room($1, $2)", [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "a".repeat(48),
]);
check("the live room opens with its local token", live?.status === "open");
const msgs = (
  await db.query("SELECT message FROM public.get_room_messages($1, $2)", [
    "aaaaaaaa-0000-4000-8000-000000000001",
    "a".repeat(48),
  ])
).rows;
check(
  "live room has its two seeded messages, once",
  msgs.length === 2,
  msgs.map((m) => m.message).join(" | "),
);
const expired = await one("SELECT * FROM public.get_chat_room($1, $2)", [
  "aaaaaaaa-0000-4000-8000-000000000008",
  "b".repeat(48),
]);
check("the expired room reports expired", expired?.status === "expired");
let refused = "";
try {
  await db.query("SELECT * FROM public.send_chat_message($1, $2, 'late', gen_random_uuid())", [
    "aaaaaaaa-0000-4000-8000-000000000008",
    "b".repeat(48),
  ]);
} catch (e) {
  refused = e.message;
}
check("the expired room refuses messages", refused === "room_expired", refused);
await db.exec("RESET ROLE");

console.log(`\nseed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
