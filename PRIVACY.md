# Privacy policy

**Meredith** (also referred to as "the app") is a personal workload-planning
tool built and run by one person for their own freelance work. It is not a
product, it is not sold, and it has no users other than its author.

Last updated: 3 September 2026.

---

## What the app accesses

The app signs in with Google and asks for three things:

| Scope | What it is used for |
|---|---|
| `openid`, `email`, `profile` | To know which Google account is signed in. Only the email address is stored. |
| `https://www.googleapis.com/auth/calendar` | To **read** existing events across the account's calendars, so the app knows which hours are already taken, and to **write** planned work blocks. |
| `https://www.googleapis.com/auth/tasks` | To **read** items captured on a phone and **write** back to the app's own task list. |

## What the app writes, and where it refuses to

The app writes to exactly two places, both of which it creates itself:

- a secondary calendar named **`Planned work`**;
- a Google Tasks list named **`Meredith inbox`**.

It never modifies, moves or deletes anything on any other calendar or task
list. This is enforced in code: an attempt to write elsewhere raises an error
rather than proceeding, and the guarantee is verified by an automated check
that fingerprints every other calendar before and after a full write cycle and
fails if anything changed.

## What is stored, and for how long

Stored in a private, access-controlled Postgres database:

- the account's email address;
- a Google refresh token, **encrypted at rest** (AES-256-GCM);
- tasks, projects and planned blocks created in the app;
- the start and end times of events read from the calendar, used to work out
  free capacity. Event titles are stored only for events the user has chosen to
  adopt as tasks.

Data is kept until deleted. There is no backup to any third party beyond the
database provider's own routine backups.

## What is not done with it

- It is **not sold, rented or shared** with anyone.
- There is **no advertising, no analytics, no tracking** of any kind.
- Google user data is **not used to train any machine-learning model**.
- No data is transferred to any third party except as described below.

## Text sent outside the app

The app can use a language model to tidy up the wording of a captured task.
As configured, this runs **locally on the author's own machine** (Ollama), and
no text leaves it.

The app can optionally be configured to use the Anthropic API instead, in which
case the text of a captured task — and the names of the user's own projects —
would be sent to Anthropic for processing. That option is not enabled. Dates,
durations and deadlines are never sent to any language model under either
configuration; they are parsed locally in all cases.

## Revoking access and deleting data

Access can be withdrawn at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).
Revoking it immediately and permanently stops the app from reading or writing
anything in the Google account.

Events already written to the `Planned work` calendar remain in the calendar
and can be deleted there, like any other event. To have stored data erased,
contact the address below.

## Compliance with Google's requirements

The app's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Contact

quentin.pointillart@gmail.com
