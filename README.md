# Capacity

A single-user workload scheduling app. The calendar is capacity, not a to-do
list: appointments consume hours, tasks are poured into what remains, and the
app's job is to say — weeks early — when the committed work does not fit.

The specification is [productivity-app-plan.md](productivity-app-plan.md). Read
it before changing anything; this README only covers how to run the thing.

## Status

| Phase | State |
|---|---|
| 0 — Plumbing | **Done.** Verified against the real account: block created, moved and deleted, every other calendar byte-identical |
| 1 — Scheduler | **Done.** Pure module, 53 tests, including determinism and DST |
| 2 — Core app | **Built**, awaiting a real week of use — that is the threshold |
| 3 — Ritual and calibration | **Built.** The six-step Monday flow at `/plan`; threshold is four weeks of samples showing calibrated estimates beating raw ones |
| 4 — PWA and freelance layer | Not started |

Phase 2 gives you: quick capture with LLM parsing (`Ctrl+K`), task and project
CRUD, working-hours settings, the today and week views, one-tap block
confirmation, and automatic replanning to the calendar on every change.

## Running it

```bash
npm install
npm test          # the scheduler suite — needs no credentials
npm run dev       # http://localhost:5173
```

### The language model is optional

`LLM_PROVIDER` is `none`, `ollama` or `anthropic`. It defaults to `ollama` with
`qwen3:4b`, so the app costs nothing to run and nothing leaves the machine.

Dates, durations and kind are **never** sent to a model — they are extracted in
code (`src/lib/server/parse/deterministic.ts`, 24 tests). Local 7B models were
measured getting weekdays wrong by a week and inventing deadlines that were
never typed, and a wrong deadline is worse than none when the whole app rests
on deadlines being true.

That leaves the model two jobs: tidy the title, spot a project name. Measured
on ten real captures:

| model | titles | project (after validation) | avg |
|---|---|---|---|
| qwen3:4b | 10/10 | 10/10 | 0.3s |
| mistral:7b | 10/10 | 10/10 | 0.4s |

The aggregate hides the deciding factor: **mistral translates French captures
into English** (5 of 6 rewritten, accents dropped), while qwen3:4b returns them
verbatim. Hence the default.

Both models hallucinate a project roughly half the time — they will cheerfully
attach the first project on the list to "fix the thing". The app only believes
a suggested project whose name actually appears in what you typed, which is
what turns a raw 4/10 into 10/10.

With `LLM_PROVIDER=none` capture still works; you lose title tidying only.

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

## Three things worth knowing about the scheduler

**Slack, not deadlines, drives priority.** A task is ordered by how many
*working* hours remain before its deadline minus the work still to do. A
deadline three weeks out with four working days in between is not comfortable,
and only this measure says so.

**One impossible task cannot eat the calendar.** Placement runs in three
rounds: work that fits before its own deadline, then leftovers that can still
be finished inside the horizon, then leftovers that cannot. A 400-hour task due
on Friday is not getting done whatever the app does, so it yields to the
9-hour job that would have fitted. It is still scheduled, still reported as
unplaced, and still flagged as past its deadline.

**Calibration is never silent.** Estimates are multiplied by a learned,
per-kind (and per-project) factor, but the raw and calibrated numbers are
always shown together — in the UI and in the calendar event description. A
silent multiplier destroys trust in the tool.
