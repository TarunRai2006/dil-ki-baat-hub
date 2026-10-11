// Creates (or reuses) a mentor login on a LOCAL Supabase started with
// `supabase start`, and grants it the admin role.
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=<from `supabase status`> \
//   ADMIN_EMAIL=mentor@local.test ADMIN_PASSWORD=... npm run seed:admin
//
// Refuses to run against anything that is not localhost: production roles are
// granted by an owner in the Supabase dashboard, never by a script.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL ?? "mentor@local.test";
const password = process.env.ADMIN_PASSWORD;

const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`Refusing to seed a non-local Supabase (${host}).`);
  process.exit(1);
}
if (!key || !password) {
  console.error("Set SUPABASE_SECRET_KEY (from `supabase status`) and ADMIN_PASSWORD.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
let userId;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  userId = data.users.find((u) => u.email === email)?.id;
  if (!userId) throw created.error;
  const reset = await admin.auth.admin.updateUserById(userId, { password });
  if (reset.error) throw reset.error;
} else {
  userId = created.data.user.id;
}
const { error } = await admin
  .from("user_roles")
  .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
if (error) throw error;
console.log(`Local mentor ready: ${email}`);
