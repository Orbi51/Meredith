# Capacity

A single-user workload scheduling app. The calendar is capacity, not a to-do
list: appointments consume hours, tasks are poured into what remains, and the
app's job is to say — weeks early — when the committed work does not fit.

The specification is [productivity-app-plan.md](productivity-app-plan.md). Read
it before changing anything; this README only covers how to run the thing.

## Status

| Phase | State |
|---|---|
| 0 — Plumbing | Code complete, **needs your Google Cloud + Neon credentials** to be verified end to end |
| 1 — Scheduler | **Done.** Pure module, 45 tests passing, including determinism and DST |
| 2 — Core app | Not started |
| 3 — Ritual and calibration | Calibration maths done and tested; the Monday flow is not built |
| 4 — PWA and freelance layer | Not started |

## Running it

```bash
npm install
npm test          # the scheduler suite — needs no credentials
npm run dev       # http://localhost:5173
```

`/debug` runs the scheduler over a fixture scenario and renders the result. It
needs no database, so it works before any of the setup below.

## Setup still to do

Everything here needs accounts and consoles that only you can log into.

1. **Neon.** Create a Postgres database, put the connection string in
   `DATABASE_URL`, then `npm run db:push`.
2. **Google Cloud.** Create an OAuth client (type: Web application) with the
   redirect URI `http://localhost:5173/auth/callback/google`, and enable the
   Google Calendar API. Put the id and secret in `.env`.
3. **Publish the OAuth consent screen to "In Production"** — even unverified.
   In "Testing" mode Google revokes refresh tokens after seven days and the app
   breaks silently a week after it starts working. Unverified production is
   fine below 100 users; you click through the warning once.
4. **Secrets.** Generate the two keys:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   one for `AUTH_SECRET`, one for `TOKEN_ENCRYPTION_KEY`.

Copy `.env.example` to `.env` and fill it in. Nothing there is committed.

## Layout

```
src/lib/scheduler/     pure — no I/O, no clock, no imports from db or google
src/lib/server/db/     drizzle schema and client
src/lib/server/google/ oauth, calendar read, calendar write
src/routes/debug/      renders scheduler output over fixture data
```

The hard rule is that `src/lib/scheduler/` stays pure. `schedule(input)` takes
the current time as an argument and returns blocks; that is what makes the
whole of it testable against fixtures in milliseconds. Every change to it comes
with a test.

## Two things worth knowing about the scheduler

**Slack, not deadlines, drives priority.** A task is ordered by how many
*working* hours remain before its deadline minus the work still to do. A
deadline three weeks out with four working days in between is not comfortable,
and only this measure says so.

**Calibration is never silent.** Estimates are multiplied by a learned,
per-kind (and per-project) factor, but the raw and calibrated numbers are
always shown together — in the UI and in the calendar event description. A
silent multiplier destroys trust in the tool.
