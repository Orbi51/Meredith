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

`000` means nothing is listening.

### Do not run the app on a dev server you did not start yourself

The dev server kept dying during development, seemingly at random. It was not
random: it had been started by an assistant's tooling, and its lifetime was
tied to that session. Nothing was wrong with the app.

The app now runs as its own detached process — `scripts/Meredith.cmd`, or the
`.vbs` from the Startup folder — serving the **production build** on port 5173.
That build starts in a second, has no file watcher, and is not attached to
anyone's terminal.

`npm run dev` is for editing code, and it wants the same port, so stop the
running app first with `scripts/Stop-Meredith.cmd`.

### ORIGIN is required, or every form POST is refused

adapter-node cannot know the address it is served on. Without `ORIGIN`,
SvelteKit's CSRF check compares the browser's `Origin` header against a
guess, they disagree, and every POST comes back:

```
Cross-site POST form submissions are forbidden
```

Which reads like a security problem with the app and is in fact a missing
environment variable. It breaks **everything** that submits — deleting a task,
saving an edit, confirming a block, replanning — while the pages themselves
load perfectly, so it looks like one broken button rather than a broken build.

`ORIGIN=http://localhost:5173`. It must match the address actually used. The
dev server never has the problem, so this only appears once the app is run for
real.

Check both directions after changing it — a same-origin POST must pass and a
foreign one must still be refused:

```bash
curl -s -X POST "http://localhost:5173/tasks?/replan"   -H "Origin: http://localhost:5173" | grep -c "forbidden"   # 0
curl -s -X POST "http://localhost:5173/tasks?/replan"   -H "Origin: http://evil.example" | grep -c "forbidden"     # 1
```

### AUTH_URL is required when the production build runs over http

Auth.js issues `__Secure-` prefixed cookies when it believes it is in
production. The browser refuses to send those over `http://`, so the app looks
permanently signed out — no error, just a sign-in link that never sticks.

Setting `AUTH_URL=http://localhost:5173` tells it the truth and it uses
ordinary cookies. This only bites the production build; the dev server never
had the problem.

### Native <select> needs an explicit background

Tailwind's reset makes form controls transparent. On Windows the dropdown popup
paints with the element's own background, so transparent gives a white popup
while the text inherits the page's light colour — grey on white, unreadable in
dark mode. Set once in `app.css` for every `select` and `option`, so a new one
cannot be added wrong.

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

### Publishing an External consent screen needs public URLs

Google asks for a homepage and a privacy policy before it will publish, and an
*authorised domain* — which is a **domain**, not a URL. `github.com`, not
`github.com/user/repo`. The repository serves all three:

```
authorised domain : github.com
homepage          : https://github.com/Orbi51/Meredith
privacy policy    : https://github.com/Orbi51/Meredith/blob/main/PRIVACY.md
terms of service  : https://github.com/Orbi51/Meredith/blob/main/TERMS.md
```

You do not need to own the authorised domain — ownership is only checked during
*verification*, which an app with one user does not need.

The repository must be **public**, or those links 404 for everyone including
Google. GitHub returns 404 rather than 403 for a private repository, so it
looks like a typo rather than a permissions problem.

### A refresh token belongs to the OAuth client that issued it

Changing the client — a new Cloud project, new credentials — kills every stored
token with `unauthorized_client`. Publishing the consent screen does not rescue
a token issued while in Testing either; that one still carries the seven-day
expiry.

**Both are fixed the same way: sign out, sign in again.** Nothing else is
needed, and nothing is lost. Verified twice by fingerprinting the stored token
before and after.

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

### A kind preference competes within a day, not across the horizon

Mornings marked "creative" used to be filled for the whole horizon before an
afternoon was touched: a creative task took every morning for three weeks and
never used an afternoon at all. Working one job in two-hour bites across
fifteen days is not a preference being honoured.

Slots are now chosen by earliest DAY first, and only within that day by
preference. Mornings still win — against the same day's afternoon, not against
next week.

### A split never strands a crumb

A 4h task meeting a 3h30 morning used to place 3h30 and then a 30-minute
fragment. Half an hour of modelling achieves nothing, which is the whole reason
§5 has minimum block sizes.

The scheduler now takes LESS from the first slot so that what remains is still
a usable block: 4h becomes 2h + 2h, not 3h30 + 30min. A task smaller than its
own minimum block is still placed whole — a one-hour creative task must not
become unschedulable because two hours is preferred.

### A bare date is due at the end of YOUR working day

`extractDeadline` took a hardcoded 18:00, so someone whose day ends at 19:00
was told a task was due an hour before it was — and the scheduler then had an
hour less to fit it in. It now takes the latest end from the configured working
hours, falling back to 18:00 only when none are set.

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

### A working day is one number

`settings.hoursPerDay` (default 7) is used for two things that must agree:

- turning `2j` into hours when parsing a capture;
- turning an hourly rate into the **day rate** shown on the projects page.

Two separate definitions would drift, which is exactly how a 30 000 JPY fee
once came out labelled `30000€`. The parser takes it as an argument rather than
importing a constant, so there is nowhere for a second value to hide.

Rates are shown per day first, hourly underneath: a day rate is what gets
quoted and compared against the next offer, and it is the unit an invoice is
written in. Hours remain the unit the scheduler thinks in.

### Fixed price and day rate are not two ways of writing the same thing

A project is billed one of two ways, and the arithmetic differs:

- **fixed** — the fee is a cap. Every extra day lowers what the job earned per
  day, and the total never moves, so the overrun is invisible unless you look
  at the day rate. This is the case worth watching.
- **day_rate** — you invoice the days you work. The rate is constant by
  definition; an extra day is extra money. What matters here is expected
  revenue (rate × days worked and planned), not "what did this work out at".

`settings.defaultDayRateEur` is the rate you normally ask for. It is used for
nothing except comparison — it is what turns "this forfait is earning 500/day"
into "…against your usual 600", which is the number that decides whether to
take the next one.

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

### Dark mode is a class, set before the page paints

The theme is a `dark` class on `<html>`, toggled by a small inline script in
`app.html` that runs *before* first paint. Doing it in a component paints white
and then repaints dark — the flash that makes a dark mode feel bolted on. It is
the one place a blocking inline script earns its place.

"System" is stored as the *absence* of a stored preference, so a machine that
switches to dark in the evening takes the app with it unless the user has said
otherwise.

`color-scheme` is set alongside the class. That single line is what makes the
native date, time, colour and select controls render dark — and this app is
full of them. Without it they stay glaring white rectangles in a dark page.

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
- **Mobile layout.** Largely moot now: the phone surface is Google Calendar and
  the `Meredith inbox` task list, so the app only has to be good on the desktop.
- **A considered visual design.** Dark mode and project colours are in; the
  typography, spacing and hierarchy are still whatever Tailwind's defaults gave
  us. Worth doing after a week of real use, when it is clear which screens
  actually get looked at.
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

## 5. The phone, without hosting

Hosting existed to solve one problem: using this away from the machine. Both
halves of that turned out to be available through apps Google already ships.

**Seeing the plan** — the app writes blocks to its own `Planned work` calendar,
which appears in the Google Calendar app on the phone with no further work.
This has been true since Phase 0.

**Capturing** — anything typed into the **Google Tasks** app is drained into
the inbox here on the next replan, parsed by the same parser as the quick-add
bar (the dash format works from the phone too). The task is then *completed* in
Google Tasks rather than deleted, so a misparse is still recoverable from the
"completed" view, and the phone list stays an inbox rather than an archive.

Dates resolve against **when the task was typed**, not when it was drained.
"demain", captured on Monday and picked up on Wednesday, still means Tuesday.

The list is called **`Meredith inbox`** and the app creates it itself. It reads
and writes **that list only** — the same rule as the calendar. The first
version drained every list, which against the real account would have swallowed
30 personal items from `My Tasks` and `Work` into the plan and marked them
completed. Not a mistake anyone could undo by hand.

### Setup

1. Enable the **Google Tasks API** in the Cloud Console (separate from the
   Calendar API, same as before).
2. Add the scope `https://www.googleapis.com/auth/tasks` on the consent screen.
3. **Sign out and back in.** A refresh token carries the scopes it was granted
   with; an existing one will keep returning `403 Insufficient Permission`
   until it is replaced. The app reports this as a setup step rather than an
   error.

### What this costs

Nothing is planned while the machine is off, and there are no push
notifications. For someone who works at that machine, a capture waiting until
the app is next opened costs nothing — and it removes hosting, a database in
the cloud, VAPID keys, and a build pipeline from the setup.

The Netlify port is still in the repository and still works, if the trade ever
stops being worth it.

## 6. Hosting

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
