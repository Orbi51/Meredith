# Capacity-Based Productivity App — Build Plan

A single-user workload scheduling app for a freelance 3D/CG artist (French auto-entrepreneur). This document is the specification. Read it fully before writing code.

---

## 1. Core philosophy

**The calendar is capacity, not a to-do list.**

Appointments consume hours. Tasks are poured into what remains. The app's primary job is not to remind the user of tasks — it is to tell them, as early as possible, when the work they have committed to does not fit in the time they have.

Three principles that govern every design decision:

1. **Idempotent replanning.** The app owns a dedicated secondary Google Calendar and writes only there. It can wipe and rebuild every future block it owns without any risk of touching a real appointment.
2. **Minimum friction.** If capturing a task takes more than a few seconds, the user stops doing it and the app dies. No mandatory fields. No syntax to learn. No second app.
3. **Honest overcommitment.** The app must surface impossible deadlines weeks early, while the user can still renegotiate with a client. This is the feature that justifies the whole project.

**Explicit non-goals:** team features, sharing, collaboration, multi-user support, meeting scheduling, invoicing, a mobile native app, integrations with Telegram/Slack/Notion, voice input.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript, strict mode | Everywhere. No second runtime. |
| Framework | SvelteKit | Frontend + backend in one project. |
| Database | Postgres (Neon free tier) | Managed, backed up. |
| ORM | Drizzle | Schema is readable TypeScript. |
| Auth | Auth.js (`@auth/sveltekit`), Google provider | Calendar scope, offline access. |
| Hosting | Railway | Always-on Node process so cron works. |
| Calendar | Google Calendar API v3 (`googleapis`) | |
| NL parsing | Anthropic API (`@anthropic-ai/sdk`) | Server-side only. |
| Styling | Tailwind | |
| Testing | Vitest | |
| Dates | Temporal API polyfill, or `date-fns-tz` | Timezone: `Europe/Paris`. |

The user is a Python developer and a beginner outside Blender scripting. Favour explicit, readable code over clever abstractions. Comment the scheduler thoroughly.

---

## 3. Architecture

```
src/
  lib/
    scheduler/
      index.ts          # pure function — no I/O, no imports from db or google
      slack.ts
      intervals.ts
      calibration.ts
      types.ts
      *.test.ts
    server/
      db/               # drizzle schema + queries
      google/           # oauth, calendar read, calendar write, sync
      parse/            # LLM task parsing
    components/
  routes/
    +page.svelte              # today view
    week/
    plan/                     # Monday ritual
    tasks/
    projects/
    settings/
    api/
```

**Hard rule:** `lib/scheduler/` must be a pure function.

```ts
schedule(input: SchedulerInput): SchedulerOutput
```

No database access, no API calls, no `Date.now()` — the current time is passed in. This makes the entire scheduling logic testable against fixture data in milliseconds, which matters because every hard bug will live there.

---

## 4. Data model

```ts
Project {
  id, name, clientName,
  deadline: Date | null,
  agreedHours: number | null,
  agreedFee: number | null,        // for effective hourly rate
  status: 'active' | 'waiting' | 'done' | 'archived',
  color: string
}

Task {
  id, projectId: string | null,
  title: string,
  notes: string | null,
  estimateHours: number | null,     // null = infer from similar past tasks
  deadline: Date | null,
  earliestStart: Date | null,
  kind: 'creative' | 'admin' | 'machine',
  splittable: boolean,              // default true
  minBlockMinutes: number,          // default by kind — see §5
  dependsOnTaskId: string | null,
  status: 'inbox' | 'active' | 'waiting' | 'done',
  waitingReason: string | null,     // e.g. "client feedback"
  committedToWeek: string | null,   // ISO week, set during Monday ritual
  createdAt, completedAt
}

Block {
  id, taskId,
  start: Date, end: Date,
  googleEventId: string | null,     // stable mapping — update, never recreate
  status: 'planned' | 'confirmed' | 'skipped',
  actualMinutes: number | null
}

WorkingHours {
  dayOfWeek: 0-6,
  intervals: { start: "09:00", end: "12:30" }[],
  preferredKind: 'creative' | 'admin' | null   // optional per interval
}

Settings {
  timezone, targetCalendarId, syncToken,
  weeklyCapacityHours, defaultBufferPercent,
  calibrationEnabled: boolean
}

CalibrationSample {
  id, taskKind, projectId,
  estimateHours, actualHours, completedAt
}
```

---

## 5. The scheduler

### Inputs

```ts
type SchedulerInput = {
  now: Date
  horizonDays: number              // default 21
  tasks: Task[]
  busyIntervals: Interval[]        // from ALL calendars except the app's own
  workingHours: WorkingHours[]
  calibration: CalibrationTable
  timezone: string
}
```

### Algorithm

1. **Build free intervals.** Expand `workingHours` across the horizon into concrete intervals, subtract `busyIntervals`, subtract any interval shorter than the smallest `minBlockMinutes` in play. Result: an ordered list of usable gaps.

2. **Apply calibration.** For each task, compute an effective estimate:
   ```
   effectiveEstimate = estimateHours × multiplier(task.kind, task.projectId)
   ```
   See §6. If `estimateHours` is null, use the median actual of completed tasks with the same `kind` (and same project if ≥3 samples exist).

3. **Compute slack** for every task with a deadline:
   ```
   slack = (working hours available between now and deadline) − remainingEffectiveEstimate
   ```
   Note this is measured in *working* hours, not wall-clock hours. Negative slack = already impossible. Low slack = urgent regardless of how distant the deadline looks.

4. **Order tasks.** Ascending slack. Tasks with no deadline sort last, ordered by creation date. Respect `dependsOnTaskId`: a task cannot be placed before its dependency finishes.

5. **Place blocks.** Walk the ordered tasks, and for each, walk free intervals in chronological order:
   - Never place before `earliestStart`.
   - If `splittable`, place chunks of at least `minBlockMinutes` until the estimate is consumed.
   - If not `splittable`, find a single gap large enough or leave it unplaced.
   - Respect `preferredKind` on intervals when set: prefer matching intervals first, fall back to any interval rather than leaving work unplaced.
   - `kind: 'machine'` tasks (renders, bakes) do **not** consume human capacity — they schedule against a separate resource pool and may overlap human blocks. Overnight placement is allowed for these and only these.

6. **Report.** Anything unplaced, and every task with negative slack, goes into the overcommitment report. This is an output, not an error.

### Defaults for `minBlockMinutes`

| kind | default |
|---|---|
| creative | 120 |
| admin | 30 |
| machine | 60 |

Rationale: modelling and lookdev need uninterrupted stretches. A scheduler that chops creative work into 25-minute fragments produces a calendar that looks full and achieves nothing.

### Output

```ts
type SchedulerOutput = {
  blocks: PlannedBlock[]
  unplaced: { taskId, hoursShort, reason }[]
  atRisk: { taskId, slackHours }[]      // slack < 0, or slack < 20% of estimate
  capacityUsed: { weekIso, committedHours, availableHours }[]
}
```

### Tests to write first

Write these before the implementation. They define correctness.

- A single task fits an empty week.
- A task larger than remaining capacity appears in `unplaced` with the correct shortfall.
- A non-splittable 3h task is not placed into three 1h gaps.
- A task with `minBlockMinutes: 120` is never given a 90-minute block.
- Given two tasks, the one with lower slack is placed first even though its deadline is later.
- A dependent task is never placed before its dependency ends.
- Busy intervals are excluded; overlapping busy intervals merge correctly.
- A `machine` task overlaps a human block without reducing human capacity.
- Running the scheduler twice on identical input produces identical output.
- DST transition (last Sunday of October, `Europe/Paris`) does not produce a 23- or 25-hour day.

---

## 6. Estimation calibration

Creative work is systematically underestimated. The app should learn the user's personal multiplier rather than assume one.

On block confirmation, record a `CalibrationSample`. Compute:

```
multiplier(kind) = median(actualHours / estimateHours) over that kind
```

Requirements:
- Need at least 5 samples before applying a multiplier; before that, use 1.0.
- Compute per `kind`, and per `projectId` once a project has ≥5 samples of its own.
- Clamp to `[0.5, 4.0]` to avoid a runaway value from one bad sample.
- **Always show the raw estimate and the calibrated estimate side by side.** The user must be able to see that a 6h task is being scheduled as 9h and why. A silent multiplier destroys trust in the tool.
- Expose the current multipliers in Settings, with sample counts.

---

## 7. Google Calendar integration

### OAuth — read this carefully

- Scope: `https://www.googleapis.com/auth/calendar`
- Request `access_type: 'offline'` and `prompt: 'consent'` on first auth to obtain a refresh token.
- **Publish the OAuth consent screen to "In Production" in Google Cloud Console, even unverified.** While the app is in "Testing" mode, refresh tokens are revoked after 7 days and the app will silently break. Unverified production is fine below 100 users; the user clicks through the warning once.
- Refresh tokens also expire after ~6 months of non-use. The daily cron job naturally prevents this.
- Store the refresh token encrypted in the database.

### Reading

- Read busy intervals from all of the user's calendars **except** the app's own target calendar.
- Use `events.list` with `singleEvents: true` and `timeMin` / `timeMax` bounding the horizon.
- Use incremental sync via `syncToken`, stored in Settings. On `410 Gone`, discard the token and do a full resync.
- Keep `singleEvents` consistent between initial and incremental calls or sync breaks.
- Treat events with `transparency: 'transparent'` as free.
- All-day events: treat as busy for the whole of that day's working hours unless the user marks otherwise.

### Writing

- On first run, create a secondary calendar named `Planned work` and store its ID in Settings.
- **Never write to any other calendar.** Guard this in code, not just by convention.
- Persist `googleEventId` on each Block. On replan, diff against existing blocks: update events whose task or time changed, delete events for blocks that no longer exist, insert only genuinely new blocks. Do not delete-all-and-recreate — it destroys notification state and hammers the API.
- Event summary: `[Project] Task title`. Description: estimate, deadline, and a deep link back to the task in the app.
- Colour blocks by project.

### Quotas

1,000,000 queries/day and ~600/minute per user. A single user will not approach this. Incremental sync keeps it trivial.

---

## 8. Capture — the friction surface

Everything happens inside the app. No external services.

**Quick-add bar.** Always reachable: `Cmd/Ctrl+K` on desktop, persistent input at the top of the mobile view. Free text in, structured task out:

```
storyboard rev2 Studio X ~6h friday
```

Server-side Anthropic API call parses this into `{ title, projectId, estimateHours, deadline, kind }`. Rules:

- **No field is mandatory.** A task with only a title is valid and schedulable.
- Match project names fuzzily against existing projects; never silently create a new project — offer it as a confirmable chip.
- Show the parse result inline as editable chips before saving, so a misparse costs one click, not a trip to an edit screen.
- Ambiguous or unparseable input still saves as a title-only task in the inbox. Never reject input.
- Cache nothing; this is one cheap call per capture.

**PWA share target.** Register a `share_target` in the manifest so a reference image, email, or URL shared from the phone lands in the inbox. This stays within the app — no third-party routing.

---

## 9. The Monday ritual

A guided flow at `/plan`, the spine of the app. The user has said they will sit down for ten minutes on Monday morning. Design for exactly that.

The app opens directly to this on Monday mornings until it has been completed for the current week.

**Step 1 — Review last week.**
List every block from the past week. For each, one tap: *as planned / +30 / −30 / didn't happen*. Show the week's estimated vs actual total. This is what feeds calibration. Keep it fast — it must be possible to clear twenty blocks in under a minute.

**Step 2 — Fixed commitments.**
Show appointments already in the primary calendar for the coming week, plus recurring admin (monthly invoicing, URSSAF declaration). Read-only; this is context.

**Step 3 — Capacity.**
```
working hours − fixed commitments = real available hours
```
Display as a single prominent number. This is the budget for the rest of the ritual.

**Step 4 — Deadline pressure.**
Every task with a deadline in the next three weeks, sorted ascending by slack. Negative slack in red at the top. Include tasks in `waiting` status — a blocked task still consumes calendar time later and its deadline still approaches.

**Step 5 — Commit.**
Drag tasks into the week. A running total shows committed hours against available hours and turns red on overrun. Committed tasks get `committedToWeek` set.

This step is the point of the entire app. The user will want to commit to more than fits. Make the overrun impossible to miss, and show *which* deadline breaks as a consequence.

**Step 6 — Generate.**
Run the scheduler, show a preview of the resulting week, and only write to Google Calendar on explicit confirmation. Never write without a preview.

---

## 10. Daily use

No ritual. `/` shows the today view:

- Fixed appointments and planned blocks in chronological order.
- Committed vs remaining hours for today.
- The single highest-priority task, called out.
- Any deadline that became at-risk since yesterday.

Each finished block gets a one-tap confirm (*as planned / +30 / −30 / skipped*). A skipped block's task returns to the pool and is rescheduled on the next replan — never silently dropped.

Replan automatically when: a task is added or edited, a block is confirmed or skipped, a calendar sync detects a new appointment, or the daily cron fires. Replanning only ever affects future blocks; past and in-progress blocks are frozen.

**Interrupt the user only when the overcommitment report changes for the worse.** A push notification when a deadline becomes impossible is valuable. A notification because the calendar shuffled is noise, and noise is why people abandon these tools.

---

## 11. Layout

**Desktop.** Week calendar as the main surface. Task list in a left sidebar, draggable onto the calendar. Quick-add bar across the top. Project list collapsible below the tasks.

**Mobile.** Today view by default. Week view and task list one swipe away. Quick-add pinned at the top. Planning happens on desktop — do not try to fit the Monday ritual onto a phone screen; the drag-to-commit step needs the space.

**PWA requirements.**
- Web app manifest with icons, `display: standalone`, share target.
- Service worker: cache the shell, show today's blocks offline, queue captures made offline and flush on reconnect.
- Web push for the daily brief and at-risk alerts. On iOS this requires the PWA to be installed to the home screen — surface a one-time install prompt.

---

## 12. Build phases

Each phase has an acceptance threshold. Do not start the next phase until it is met.

### Phase 0 — Plumbing
SvelteKit project, Drizzle schema, Auth.js Google login, OAuth consent screen published to Production, secondary calendar created, read busy intervals, write/update/delete one test event.

*Threshold:* a block can be created, moved, and deleted on the secondary calendar with the primary calendar provably untouched.

### Phase 1 — Scheduler
The pure scheduler module with the full test suite from §5. No UI beyond a debug page that renders the output as JSON.

*Threshold:* all tests pass, including determinism and DST.

### Phase 2 — Core app
Quick-add with LLM parsing, task and project CRUD, working-hours settings, today view, week view, automatic replan, write to calendar.

*Threshold:* the user plans and works a real week end to end using only this app.

### Phase 3 — Ritual and calibration
The Monday flow, block confirmation, calibration samples and multipliers, the overcommitment report.

*Threshold:* after four weeks, calibrated estimates are measurably closer to actuals than raw estimates.

### Phase 4 — PWA and freelance layer
Manifest, service worker, offline capture queue, web push, share target. Then: effective hourly rate per project and client (`agreedFee ÷ total actual hours`, billable and non-billable), recurring admin tasks for invoicing and URSSAF, and the `waiting` state for client feedback.

*Threshold:* the phone is used daily for capture and check-off.

---

## 13. Conventions

- TypeScript strict. No `any`.
- All times stored as UTC timestamps; all display in `Europe/Paris`.
- ISO week numbers for week identifiers.
- Environment variables for all secrets. Never commit credentials. The Anthropic API key is server-side only and must never reach the client.
- Every scheduler change requires a test.
- Prefer clarity to brevity in the scheduler; that code will be read and modified by someone who does not write TypeScript daily.
