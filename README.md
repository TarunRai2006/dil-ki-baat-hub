# Dil Ki Baat

Dil Ki Baat is an anonymous story and private chat site by aapkamentor.ai. A visitor can share what is weighing on them without creating an account or entering a real name. Approved counsellors and therapists can review stories and respond through an admin dashboard. The service is not an emergency service, and a reply is not guaranteed.

This repository contains the visitor site, admin dashboard, Supabase migrations, server routes for browser push, and automated tests. The current intake and chat behavior is described below; older database rows may contain fields from previous versions of the form.

## Visitor experience

1. The visitor answers **three written questions** about what happened, when it feels hardest, and what they would like understood or helped with. Only the first answer is required. They can optionally choose a topic and a 1–5 feeling rating.
2. They choose **I want advice** or **I want to be heard**. The `*` beside advice explains that a verified counsellor or therapist may read and reply, but replies are not immediate or guaranteed. Choosing advice reveals a chat duration: one hour, 24 hours, or no expiry. Choosing to be heard hides the timer and creates a chat without an expiry time.
3. Submitting creates one private story and a token-protected chat. The completion dialog puts “Congratulations!!!!!” and “You let it go.” on separate lines. The counsellor note appears only for the advice choice.
4. While a chat is active, it replaces the form. The browser stores the room token locally, so the visitor can reopen that chat after refreshing or returning in the **same browser profile and origin**. There is no account, recovery code, or access from another device. Ending the chat deletes its live messages and returns the form; the original story remains for moderation.

New stories are **private by default**. The current form has no public sharing choice. Historical stories may still be eligible for public excerpts if they had the earlier consent and were approved and featured. The Terms of Service state a minimum age of 13 and require parent or guardian permission for visitors aged 13–17; the application does not verify that permission. Review those safeguards before a public launch.

## Admin dashboard

| Area                 | What it does                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`              | Email/password sign-in and, where supported, Google sign-in. Creating an account does not grant admin access.                                                     |
| `/admin` submissions | Search, filter, review, approve or reject, feature, archive, restore, add private notes, and inspect a story's chat.                                              |
| `/admin` chats       | Read and reply in token-protected visitor rooms, see new activity, hide messages, and close rooms. Realtime updates have a polling fallback.                      |
| `/admin` statistics  | Aggregate counts, feeling ratings, categories, and active chats.                                                                                                  |
| `/admin` push        | See active subscription count and send a confirmed general browser notification with a same-origin destination path, such as `/`. Delivery results are aggregate. |

The UI checks the authenticated user's role, and database row-level security and guarded functions enforce admin access independently. Only an owner-created `public.user_roles` row with role `admin` grants access. The organization is responsible for verifying professionals before granting that role; the database role alone is not proof of a clinical qualification.

## Architecture and repository map

| Path                                                  | Purpose                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/routes/`                                         | Visitor page, terms, sign-in, guarded dashboard, and push API routes.      |
| `src/components/city/`                                | Intake form and active-chat view.                                          |
| `src/components/admin/`                               | Dashboard lists, details, chat, statistics, and push composer.             |
| `src/lib/confession.ts`, `src/hooks/use-room-chat.ts` | Input validation, room storage, chat calls, and reconnect behavior.        |
| `src/lib/push-*.ts`, `public/push-sw.js`              | Browser subscription, server-side push, and service worker.                |
| `supabase/migrations/`                                | Postgres tables, constraints, functions, permissions, and expiry behavior. |
| `supabase/seed.sql`                                   | **Local test data only. Do not load into production.**                     |
| `tests/`, `supabase/tests/`                           | Unit, browser, live-stack, security, and seed tests.                       |
| `SETUP.md`, `tests/README.md`                         | Full setup, manual push test, and test fixture instructions.               |

The frontend uses React, TypeScript, TanStack Start/Router, Vite, Tailwind CSS, and Supabase JS. Supabase provides Postgres, Auth, PostgREST, and Realtime. The background film has a poster fallback so the form remains usable if video playback fails.

## Run locally

You need Node.js 20 or newer, npm, Docker Desktop, and the Supabase CLI (available through `npx`). The page can render without a backend, but story submission, chat, admin, and push need a reachable Supabase project.

```sh
npm install
npx supabase start
npx supabase db reset
npx supabase status -o env
```

Copy the local `API_URL` and `PUBLISHABLE_KEY` from the status output into a git-ignored `.env.docker.local`:

```dotenv
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<local publishable key>"
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_PUBLISHABLE_KEY="<same local publishable key>"
```

Then run `npm run dev:docker` and open `http://localhost:8080/`. Use `http://localhost:8080/auth` for admin sign-in and `http://127.0.0.1:54323` for local Supabase Studio. The exact local ports may differ if your Supabase configuration changes. Keep the browser hostname consistent: `localhost` and `127.0.0.1` have separate browser storage, so a chat saved under one will not reopen under the other.

To create a **local-only** admin account, set `SUPABASE_SECRET_KEY`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in your shell and run `npm run seed:admin`. The script rejects non-local Supabase URLs. Do not commit the password or secret key. For a hosted project, create a user in Supabase Auth and grant its UID the `admin` role as documented in [SETUP.md](SETUP.md).

### Environment variables

| Variable                                             | Location                 | Purpose                                                |
| ---------------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser/build            | Public Supabase API connection.                        |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`           | Server                   | Public Supabase connection for server routes.          |
| `VITE_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`          | Browser/build and server | Matching public Web Push key.                          |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                 | Server secret            | Signs browser push messages.                           |
| `SUPABASE_SERVICE_ROLE_KEY`                          | Server secret            | Saves subscriptions and broadcast audit; bypasses RLS. |
| `PUSH_RATE_LIMIT_SECRET`                             | Server secret            | Keys the push subscription abuse limiter.              |

See [.env.example](.env.example) and [SETUP.md](SETUP.md) for the full list and hosted setup. Never prefix a private value with `VITE_`, put it in a tracked env file, or expose it in browser code. Restart or rebuild after changing build-time variables.

## Browser push notifications

Push is **optional** and separate from chat. The site may ask for browser permission after the visitor's first interaction. If allowed and configured, it stores a push endpoint and encryption keys; the subscription is not linked to the visitor's story, room, account, or browser ID. Admin broadcasts are general announcements, not automatic alerts for every chat reply. The browser or operating system displays them; delivery and visibility depend on permission, device settings, and the push service.

For a manual test, configure a VAPID key pair and the server secrets above, run the site on HTTPS or localhost, allow notifications in a fresh browser profile, and confirm that `/admin` shows **at least one active subscription**. Send a short broadcast with `/` as the destination path and check the browser or operating system notification. A count of zero means there is nobody to send to. The browser may need to remain running, and some platforms require installing the web app. [SETUP.md](SETUP.md#browser-push-setup-and-manual-test) has the full procedure and troubleshooting steps.

## Database at a glance

All application tables are in the `public` schema. Supabase Auth maintains its own `auth.users` table. The main relationships are:

```text
auth.users ── user_roles
submissions (one story) ── chat_rooms (zero or one room, same UUID)
        │                         └── chat_messages (room ID)
        └── moderation_log (submission ID)

push_subscriptions       independent of stories, rooms, and users
push_request_limits      independent abuse-rate buckets
push_broadcast_audit     aggregate admin send counts
rate_limits              submission/message abuse-rate buckets
```

| Table                  | Main contents                                                                                                                               | Access model                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `submissions`          | Story text, optional topic/feeling, advice-or-heard choice, alias, status, moderation flags, browser/request IDs, and legacy intake fields. | Admin read; anonymous creation through a validated function only. |
| `chat_rooms`           | One room per submission, token hash, status, optional expiry, activity time.                                                                | Admin read; visitor access through a matching room token.         |
| `chat_messages`        | Room ID, sender, plain-text message, timestamp, hidden flag.                                                                                | Admin read; visitor read/write through guarded functions.         |
| `user_roles`           | Auth user ID and app role.                                                                                                                  | User can read own role; role changes require owner privileges.    |
| `moderation_log`       | Submission ID, admin actor, action, timestamp, limited detail.                                                                              | Admin read.                                                       |
| `rate_limits`          | Hashed/bucketed abuse counters.                                                                                                             | Internal only.                                                    |
| `push_subscriptions`   | Endpoint and browser encryption keys, delivery timestamps.                                                                                  | Server/service role only.                                         |
| `push_request_limits`  | Independent subscription request counters.                                                                                                  | Server/service role only.                                         |
| `push_broadcast_audit` | Admin ID and aggregate delivery counts, without recipient identities or message body.                                                       | Server/service role only.                                         |

Every public table has row-level security enabled. Visitor functions validate content, enforce rate limits, prevent duplicate requests and simultaneous active chats per browser ID, and require the room token for chat operations. The token is stored in this browser and only its hash is kept with the room. Admin functions check the caller's role. The push API checks origin, input size, rate limits, and admin status. See the migrations and `supabase/tests/security.test.mjs` for executable details.

Timed rooms stop accepting reads and writes when they expire. Ending a chat deletes its live messages, but the original submission remains for moderation. Stories and moderation records have no automatic deletion date at present; see the [Terms of Service and Privacy Policy](src/routes/terms.tsx) for retention and contact details. Browser storage loss removes a visitor's ability to reopen their chat, even if a server copy still exists. Chats are not end-to-end encrypted.

## Verification

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:db
npm run build
npm run test:e2e
```

`test:unit` covers UI and client logic. `test:db` applies the migrations twice in an isolated Postgres-compatible test database and checks roles, RLS, chat tokens, rate limits, moderation, push tables, and seed data. `test:e2e` checks desktop and mobile flows with mocked Supabase responses. `npm run test:live` exercises a **local** Supabase stack and needs the environment described in [tests/README.md](tests/README.md); it should never target production. The browser tests require an installed Chrome browser.

## Deploying safely

1. Choose the intended Supabase project and verify its ref in `supabase/config.toml` and your local environment before linking or pushing migrations. Apply migrations in order with `npx supabase db push`. Do not load `supabase/seed.sql` into production.
2. Configure the public Supabase values and VAPID public key for the build. Configure the service-role key, VAPID private key, subject, and rate-limit secret **only** in the server runtime.
3. Create approved professional accounts and grant `admin` through the owner-controlled Supabase process. Disable public account sign-up if it is not needed.
4. Review the 13–17 guardian-permission process, retention policy, crisis copy, Terms, and any regional legal requirements before opening the site publicly. The current form does not verify age or guardian permission.
5. Test a real submission, return to chat in the same browser, End chat, admin moderation, and a browser push notification on the deployed HTTPS origin.

This project was built with [Lovable](https://lovable.dev). Pushing a commit to a connected branch can sync it back into Lovable; preserve published Git history.
