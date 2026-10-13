# Setup: database, admin login, running and testing

The app's backend is Supabase (Postgres + Auth + Realtime). Everything that
matters is in `supabase/migrations/`: tables, row-level security, the
functions the site calls, realtime, chat expiry. Any Supabase project that has
those migrations applied works.

The app is connected to the hosted project **`iytqunvpnubbttppoepe`**
(`.env`), with all migrations applied. `npm run dev` uses it.

There are two ways to run it:

- **A. Against a local Supabase in Docker** (`npm run dev:docker`): a private
  sandbox with sample data, for development and tests
- **B. Against the hosted project** (`npm run dev`, and the real site)

---

## A. Local (Docker)

You need Docker Desktop running and Node 20+.

```sh
npm install
npx supabase start          # first run downloads the images (a few minutes)
npx supabase db reset       # applies every migration + supabase/seed.sql (sample data)
npx supabase status -o env  # prints API_URL and PUBLISHABLE_KEY for the next step
```

Create `.env.docker.local` in the project root. It is git-ignored, and Vite
loads it only in `docker` mode, where it overrides `.env`:

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

Then `npm run dev:docker` and open:

| URL                         | What                                              |
| --------------------------- | ------------------------------------------------- |
| http://localhost:8080/      | the site: film in the background, the form on top |
| http://localhost:8080/auth  | mentor sign-in                                    |
| http://localhost:8080/admin | dashboard: submissions, **Chats**, stats          |
| http://127.0.0.1:54323      | Supabase Studio: browse the tables directly       |

Restart the dev server after changing any env file. Never create a plain
`.env.local`: it would override `.env` in every mode.

---

## B. Hosted Supabase (production)

1. Create a project at https://supabase.com/dashboard (the free tier is fine).
   Note its **project ref**, the `xxxx` in `https://xxxx.supabase.co`.
2. Apply the schema from this repository (already done for `iytqunvpnubbttppoepe`;
   run `db push` again whenever a new migration is added):

   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   Do not run `supabase/seed.sql` here; it is sample data for local use only.
   `npx supabase migration list --linked` shows local and remote side by side.

   If `db push` says **"IPv6 is not supported on your current network"** and
   names a different project: the CLI takes the project from
   `SUPABASE_PROJECT_ID` in `.env` and `project_id` in `supabase/config.toml`
   before the link. Make both the new ref; `link` then connects through the
   IPv4 pooler.

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
- **Push Notifications** tab: aggregate subscriber count and an admin-only
  broadcast composer. Confirm the title, message, destination and approximate
  recipient count before sending. Delivery is best effort.

## Returning to an anonymous chat

An active chat is restored from a secret kept in the visitor's browser storage.
After a refresh or reopening the site in the same browser profile and origin,
use the prominent **Continue your chat** button above the form. The default
chat lifetime is 24 hours; the selected expiry and the server decide when it
ends. The form appearing again does not remove an active chat.

There is no account or cross-device recovery. Changing browser profiles or
switching between `localhost` and `127.0.0.1` uses different storage. Clearing
site data or using a private window loses the chat access secret.

## Browser push setup and manual test

1. Generate one VAPID pair with `npx web-push generate-vapid-keys`. Keep the
   private key out of Git and browser variables. Configure
   `VITE_VAPID_PUBLIC_KEY` at build time and `VAPID_PUBLIC_KEY` at server runtime
   with the same public value. Configure `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT=mailto:your-admin-contact@example.com` as server secrets.
2. Configure `SUPABASE_SERVICE_ROLE_KEY` and a random 32-byte-or-longer
   `PUSH_RATE_LIMIT_SECRET` as **server-only** secrets. The service key bypasses
   RLS, so restrict it to the server runtime. For local PowerShell testing,
   set these in the shell that starts `npm run dev`; do not prefix them `VITE_`.
   `VITE_VAPID_PUBLIC_KEY` may go in the local Vite env file. Restart/rebuild
   after changing build-time env vars. Set the same secrets in the deployment
   provider before testing a deployed build.
3. Apply `supabase/migrations/20261012120000_push_subscriptions.sql` with
   `npx supabase db push` against the intended project. The migration creates
   a service-role-only subscription table and an independent abuse-rate bucket.
4. Serve the app on HTTPS or `localhost`. In a fresh Chrome/Edge/Firefox
   profile, fill the form and press **Let it go**. Choose **Allow**. Confirm
   the confession success view and a row in `push_subscriptions` in Supabase
   Studio. The subscription row contains endpoint and encryption keys only;
   do not copy those values into screenshots or support messages.
5. Sign in to `/admin`, open **Push Notifications**, enter a short message,
   use `/` as the destination path, confirm the broadcast, and verify the
   OS/browser notification. **Refresh count** must show at least one active
   subscription before sending; zero means there are no recipients. Click it:
   the site should open or focus. Repeat with the site tab closed while keeping
   the browser running. Delivery after browser/device restart depends on the
   platform and is not guaranteed.
6. In another fresh browser profile, choose **Block** on the form prompt.
   The confession must still succeed and no subscription row should be added.
   Submit again in the allowed profile: no second permission prompt and no
   duplicate endpoint row. If the browser lacks Push API support, the form
   still works. Browser site settings can reset permission for repeat testing.
   On iPhone or iPad, add the site to the Home Screen, open that installed app,
   and submit there; ordinary Safari tabs cannot subscribe to iOS Web Push.

Push subscriptions are independent of submissions, chats, accounts and IPs.
No notification open tracking is collected. A broadcast removes endpoints only
when the push service returns 404 or 410; temporary failures remain subscribed.
The server records an aggregate admin broadcast audit (admin ID, time and
delivery counts) without recipient identifiers or message content.

---

## Tests

```sh
npm test            # unit + component (Vitest) and database (PGlite) suites
npm run test:e2e    # browser tests, desktop + mobile, Supabase mocked
npm run test:live   # full stack against local Supabase (see tests/README.md)
npm run lint && npm run typecheck && npm run build
```
