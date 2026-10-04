# Tests

Four layers, from fastest to most complete. None of them touch the production
Supabase project.

| Command             | What it proves                                                                                                                                                                                   | Needs                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm test`          | unit + component tests, then the database suites                                                                                                                                                 | nothing                                                                 |
| `npm run test:unit` | validation, friendly errors, room storage, admin query building, the release form, chat hook + UI, admin list (Vitest + jsdom)                                                                   | nothing                                                                 |
| `npm run test:db`   | every migration on a real Postgres (PGlite): RLS, roles, validation, rate limits, idempotency, chat tokens + expiry, audit log, whispers privacy; and that `supabase/seed.sql` loads             | nothing                                                                 |
| `npm run test:e2e`  | the site in Chrome, desktop + phone: background film, form journey, chat, crisis help layering, admin dashboard, page layout. Supabase is answered from `tests/fixtures`                         | installed Chrome, dev server (started automatically or reused on :8080) |
| `npm run test:live` | the whole system against a **real local Supabase** (Auth, PostgREST, Realtime): real login, realtime to the dashboard, chat both ways, offline → reconnect, raw-API attacks, rate limits, expiry | Docker + Supabase CLI (below)                                           |

## Fixtures

- `tests/fixtures/data.ts` – typed records shared by unit, component and browser tests
  (`tiredOwl` is the fully filled confession; 45 rows for pagination; stats, room, messages).
- `tests/e2e/support/supabase.ts` – answers every Supabase call from those fixtures,
  closes the realtime socket, and records requests so tests can assert what was sent.
- `supabase/seed.sql` – local database fixtures: every status, archived and trashed
  rows, one consented featured whisper, a live chat room (token `a` × 48) and an
  expired one. Loaded automatically by `supabase start` / `supabase db reset`.
- `scripts/seed-admin.mjs` – creates a local mentor login. Refuses non-local URLs.

## Running the live suite

```bash
npx supabase start            # applies supabase/migrations + seed.sql
npx supabase status -o env    # note API_URL, PUBLISHABLE_KEY, SECRET_KEY
```

Start the app against the local stack (separate port, your .env is untouched):

```bash
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_URL=$API_URL SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY npx vite dev --port 8090
```

Then:

```bash
E2E_BASE_URL=http://localhost:8090 LIVE_SUPABASE_URL=$API_URL LIVE_SUPABASE_ANON_KEY=$PUBLISHABLE_KEY LIVE_SUPABASE_SECRET_KEY=$SECRET_KEY VITE_SUPABASE_URL=$API_URL npm run test:live
```

Optional local login for clicking around: `SUPABASE_URL=$API_URL SUPABASE_SECRET_KEY=$SECRET_KEY ADMIN_PASSWORD=... npm run seed:admin`.

## Dev-only switches

`/?film=error` (the video fails to load) and `/?film=blocked` (autoplay refused):
both leave the poster behind a working form. Ignored in production builds.
