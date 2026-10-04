# Setup: database, admin login, running and testing

The app's backend is Supabase (Postgres + Auth + Realtime). Everything that
matters is in `supabase/migrations/`: tables, row-level security, the
functions the site calls, realtime, chat expiry. Any Supabase project that has
those migrations applied works.

There are two ways to run it:

- **A. On your computer** with a local Supabase in Docker (for development and tests)
- **B. On a hosted Supabase project you own** (for the real site)

> Why the form said "We could not reach the server": `.env` points at the
> Lovable-hosted project `fazyaaptvenwzdllirer.supabase.co`, and that address
> no longer exists, so the browser can't reach any database. Use A or B below.

---

## A. Local (Docker)

You need Docker Desktop running and Node 20+.

```sh
npm install
npx supabase start          # first run downloads the images (a few minutes)
npx supabase db reset       # applies every migration + supabase/seed.sql (sample data)
npx supabase status -o env  # prints API_URL and PUBLISHABLE_KEY for the next step
```

Create `.env.local` in the project root (it is git-ignored and overrides `.env`):

```sh
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<PUBLISHABLE_KEY from supabase status>"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_PUBLISHABLE_KEY="<same key>"
```

Create a mentor (admin) login. The script only works against localhost:

```sh
SUPABASE_SECRET_KEY="<SECRET_KEY from supabase status>" ADMIN_EMAIL="mentor@local.test" ADMIN_PASSWORD="<choose one>" npm run seed:admin
```

Then `npm run dev` and open:

| URL                         | What                                              |
| --------------------------- | ------------------------------------------------- |
| http://localhost:8080/      | the site: film in the background, the form on top |
| http://localhost:8080/auth  | mentor sign-in                                    |
| http://localhost:8080/admin | dashboard: submissions, **Chats**, stats          |
| http://127.0.0.1:54323      | Supabase Studio: browse the tables directly       |

Restart `npm run dev` after creating or changing `.env.local`.

---

## B. Hosted Supabase (production)

1. Create a project at https://supabase.com/dashboard (the free tier is fine).
   Note its **project ref**, the `xxxx` in `https://xxxx.supabase.co`.
2. Apply the schema from this repository:
   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   Do not run `supabase/seed.sql` here; it is sample data for local use only.
3. **Project Settings → API**: copy the Project URL and the publishable (anon)
   key into `.env`, replacing the old values:
   ```sh
   VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="<publishable key>"
   SUPABASE_URL="https://<project-ref>.supabase.co"
   SUPABASE_PUBLISHABLE_KEY="<publishable key>"
   VITE_SUPABASE_PROJECT_ID="<project-ref>"
   SUPABASE_PROJECT_ID="<project-ref>"
   ```
   These keys are public by design: every permission is enforced in the
   database. **Never** put the secret / service_role key in `.env` or anywhere
   in the frontend. Set the same variables in your hosting provider.
4. Create your mentor login: **Authentication → Users → Add user** (email +
   password, tick _Auto Confirm User_), copy the new user's UID, then in the
   **SQL Editor** run:
   ```sql
   insert into public.user_roles (user_id, role) values ('<user uid>', 'admin');
   ```
   Only accounts with this row can read anything in `/admin`. Anyone else who
   signs in gets "access required" and the database refuses their requests.
5. Recommended: **Authentication → Sign In / Providers → Email**, turn off
   _Allow new users to sign up_ so the only accounts are the ones you create.
   The "Continue with Google" button uses Lovable's auth broker and only works
   when the site is served by Lovable.

No other dashboard settings are needed. The migrations enable realtime on the
tables, and schedule chat expiry with `pg_cron` where the project has it.
Expiry is also enforced on every read and write, so it holds either way.

---

## Using the admin portal

- **Submissions** tab: every confession, with server-side search, filters,
  sorting and pagination. New ones appear live. Open one to see every field,
  set the status (Pending / Reviewed / Approved / Rejected), feature it, add
  private notes, archive it, or **Open chat** if the writer asked for one.
- **Chats** tab: every chat room, live or ended, with the latest message, an
  unread dot when the visitor spoke last, and a badge on the tab. Open a room
  to read the conversation, see **What they wrote**, reply (or use a quick
  reply), hide a message, close the chat, or jump to **View submission**.
  Everything is realtime in both directions.

---

## Tests

```sh
npm test            # unit + component (Vitest) and database (PGlite) suites
npm run test:e2e    # browser tests, desktop + mobile, Supabase mocked
npm run test:live   # full stack against local Supabase (see tests/README.md)
npm run lint && npm run typecheck && npm run build
```
