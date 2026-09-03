# Notes to keep in mind

Things that cost time to discover, decisions that are easy to undo by accident,
and what is genuinely not built yet. The specification is
[productivity-app-plan.md](productivity-app-plan.md); this is the field guide.

---

## 1. Development gotchas

### The service worker will serve you a stale page when the dev server dies

**Symptom:** you edit a file, reload, and the browser shows the old page. Edits
appear to do nothing. You start doubting the framework.

**Cause:** the dev server had stopped, and the service worker did exactly what
it was built to do — serve the last cached copy so the app works offline. A
dead server and a working cache look identical from the browser.

**Fixed:** in development the app now unregisters any service worker and drops
its caches on load, so this cannot recur. In production it registers normally.

**If you ever see it again** (another machine, an old tab, a stale profile):

```
DevTools → Application → Service workers → Unregister
DevTools → Application → Storage → Clear site data
```

And check the server is actually up before blaming your code:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

`000` means nothing is listening. The dev server died twice during development
for no visible reason; restarting it is the whole fix.

### `.env` versus `.env.example`

`.env.example` is **tracked by git**. Real values must go in `.env`, which is
ignored. Filling in the example file puts secrets on their way into a commit.

Related: a placeholder like `AUTH_SECRET=   # openssl rand -base64 32` reads as
a *value* (the comment) rather than as empty, so a "is it set?" check passes
while Auth.js fails with `MissingSecret`. The example file no longer has inline
comments on value lines.

### `drizzle-kit push` tries to rewrite primary keys

`npx drizzle-kit push` fails with `column "id" is in a primary key` on this
schema. It is a diffing quirk, not a real migration.

For a single column, apply the SQL directly:

```sql
alter table settings add column if not exists ritual_completed_week text;
```

For anything structural, use `drizzle-kit generate` and review the migration
before applying it. Do not fight `push`.

### Verify against the real thing, not fixtures

Every serious bug in this project was found by running against the real
calendar and database, never by the unit tests — which passed throughout. The
tests are worth having, but they only check what you thought to ask.

---

## 2. Google Calendar

Three settings in Google Cloud Console are separate and all required. Missing
any one produces a different, unhelpful error:

1. **Enable the Google Calendar API** — Library → Google Calendar API → Enable.
   Enabling an API and creating credentials are unrelated steps.
2. **Add the scope** `https://www.googleapis.com/auth/calendar` on the consent
   screen → Data access. It is a *restricted* scope, so it does not appear in
   the suggested list; paste it into the manual box.
3. **Publish the consent screen to "In production"**. In Testing mode Google
   revokes refresh tokens after **seven days** — the app works, then breaks a
   week later with `invalid_grant` and no obvious cause. Unverified production
   is fine for one user; you click past a warning once.

Refresh tokens also expire after ~6 months of disuse. The daily job prevents
that simply by running.

### Google stores event times to the second

Milliseconds are dropped on the round trip. A test that builds a time from
`Date.now()` and compares it to what comes back **can never pass** — it will be
off by however many milliseconds you started with. Round to the minute. This
cost an afternoon and looked exactly like "the move is broken".

### The app writes to exactly one calendar

`Planned work`, created on first run, and nothing else. This is enforced in
code, not by convention, and `/debug/calendar` proves it: it fingerprints every
other calendar before and after a full create/move/delete cycle and fails if a
single byte differs. It also deliberately attempts a write to `primary` and
asserts the guard refuses.

Run it after any change to `src/lib/server/google/`.

---

## 3. Decisions that look like bugs

Each of these is deliberate. Changing one without reading the reason will make
the app worse in a way that is not obvious for weeks.

### Placement runs in three rounds

Work that fits before its own deadline, then leftovers that can still be
finished in the horizon, then leftovers that cannot.

Without the third distinction, one impossible task eats everything: a 400-hour
task due Friday took all 29 blocks of the horizon and left a 9-hour task with
nothing. Its deadline is blown either way, so it yields to work that can
actually be done. It is still scheduled, still reported unplaced, still flagged
past its deadline.

### Slack is measured over the whole horizon, not the current week

A task due next Thursday can draw on next week's capacity. Measuring only this
week reported it as **already impossible** when it had 22 hours of slack. A
planner that cries wolf is worse than no planner.

### "vendredi prochain" is next week, not tomorrow

Said on a Thursday, "vendredi" is tomorrow and "vendredi prochain" is eight
days away. Anyone meaning tomorrow says "demain". Being wrong by a week here is
the failure that makes a planner untrustworthy.

### Dates and durations never go to a language model

They are regex work with one right answer. Every model tested — local 7B and
hosted — got weekdays wrong by a week and invented deadlines nobody typed. The
model's only jobs are tidying the title and spotting a project name, and even
then a suggested project is believed **only if the name appears in what you
typed** — models will confidently attach a real project to "fix the thing".

### Adopted calendar work is never scheduled again

An event adopted from your calendar already has its slot. Its mirrored block is
marked `external` and excluded in **four** places: the calendar sync, the
rewritable-future set, the frozen set (frozen at any time, not just once
started), and the schedulable-task list. Miss any one and a replan either
double-books the work or deletes an event the app does not own.

### Currency is converted in exactly one place

`projectEconomics`. When conversion lived in a page load as well, the settings
table showed a 30 000 JPY fee as "30000€" — a 20× error. Rates are reported in
euros only: comparing 5 000 JPY/h against 60 EUR/h is worse than showing
nothing.

The FX rate is **fetched once and frozen**, not recomputed. A fee whose euro
value drifts on every page load is not a number you can plan against, and for
the books the rate that counts is the one on the invoice date — which is why
the fetch takes a date, and a hand-entered rate always wins.

### Notifications are mostly about not sending things

Two messages exist: a morning brief when something is planned, and an alert
when a deadline has *newly* become impossible. The digest covers **which** tasks
are at risk, deliberately not where their blocks sit, so a reshuffled plan sends
nothing. Verified: first run alerts, second run on unchanged data is silent.

### Calibration says nothing until it has evidence

Below five samples the multiplier stays at 1.0, and the raw and calibrated
numbers are always shown together. A silent multiplier destroys trust in the
tool.

---

## 4. Not built yet

Honest list, in rough order of how much they matter.

- **Deployment.** Ported to Netlify and building cleanly, but not yet deployed
  — that needs your account. The checklist is in the README.
- **Incremental calendar sync.** §7 of the plan asks for `syncToken`-based
  sync. `detectChanges()` and the `settings.syncToken` column exist but nothing
  calls them — every replan does a full read of all calendars (~1.2s for 7
  calendars, 29 events). Correct, just wasteful, and it will get slower as the
  calendar grows.
- **Drag-to-commit.** §11 specifies dragging tasks onto the week; the ritual
  uses click-to-commit. The value is in the running total and the overrun
  warning, both of which work — but this is a real deviation.
- **Mobile layout.** §11 wants the today view by default with week and tasks a
  swipe away. The pages are responsive but not designed for a phone, and the
  ritual is explicitly desktop-only by design.
- **Files in the share target.** The manifest accepts images and PDFs; the
  handler currently keeps title, text and URL, and ignores attachments.
- **Per-project calibration.** The maths is there and tested; no project has
  five samples yet, so it has never applied.

### Thresholds still unmet

The plan defines these, and only time meets them:

- Phase 2: a real week planned and worked end to end.
- Phase 3: after four weeks, calibrated estimates measurably closer to actuals
  than raw ones. **You currently have zero calibration samples** — every block
  you confirm feeds this.
- Phase 4: the phone used daily for capture and check-off.

---

## 5. Hosting

The app needs three things: somewhere to run Node, a Postgres database, and
HTTPS (web push and installable PWAs both require it).

Neon's free tier covers the database and is already in use. It suspends after
about five minutes idle and wakes on the next connection, which adds a second
or so to the first request — harmless here.

The app deploys to **Netlify's free tier**, which permits commercial use —
unlike Vercel's Hobby plan, which is licensed for non-commercial projects and
would be the wrong home for a tool that runs your business.

Netlify is serverless, so there is no process to hold a timer: set
`ENABLE_DAILY_JOB=false` and let `netlify/functions/daily.mts` do it. It runs
at 05:00 UTC and calls `POST /api/cron/daily` with the `CRON_SECRET`.

### The ten-second limit is real

Netlify functions are killed at 10 seconds on the free tier, and the daily job
originally took **7 seconds** — one bad week of calendar growth from failing in
production every morning, silently.

It now takes about 3. The fix was to stop doing everything one round trip at a
time: reading every calendar in parallel, and applying calendar writes in
batches of eight rather than one after another. If you add work to the daily
job, measure it:

```bash
curl -s -o /dev/null -w "%{time_total}s
" -X POST   -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/cron/daily
```

Incremental sync (§4 above) is the next lever if it creeps up again.

### Cron is UTC only

`0 5 * * *` is 07:00 Paris in summer, 06:00 in winter. Netlify has no timezone
setting, so the brief drifts by an hour across the year. An hour either side of
seven is still the morning; if that ever matters, move the schedule to 06:00
UTC in winter or check the local hour inside the job.

### Environment variables for production

```
DATABASE_URL              Neon connection string
AUTH_SECRET               32 random bytes, base64
AUTH_TRUST_HOST           true
AUTH_URL                  https://your-domain   (needed once it is not localhost)
GOOGLE_CLIENT_ID          and add https://your-domain/auth/callback/google
GOOGLE_CLIENT_SECRET        to the OAuth client's redirect URIs
TOKEN_ENCRYPTION_KEY      32 random bytes, base64 — rotating it orphans the
                          stored Google token and forces a re-consent
VAPID_PUBLIC_KEY          web push
VAPID_PRIVATE_KEY
VAPID_SUBJECT             mailto:you@example.com
CRON_SECRET               only if driving the daily job over HTTP
LLM_PROVIDER              none | ollama | anthropic
ENABLE_DAILY_JOB          true on an always-on host, false on serverless
```

`TOKEN_ENCRYPTION_KEY` is the one that bites: change it and every stored
refresh token becomes undecryptable garbage. There is no error that says so —
the calendar simply stops working.
