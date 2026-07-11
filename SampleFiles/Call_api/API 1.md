# Traveller Experience — REST API

Outbound AI voice-call APIs for your dashboard. Base path: **`/v1/traveller-experience`**
(e.g. `https://travel-parser-live.aahaas.com/v1/traveller-experience/...`).

The dashboard is organised as **four tabs**. Each tab maps to one group of endpoints:

| Tab | What it does | Endpoints |
|---|---|---|
| **1 · Setup & Service** | Register a booking and schedule the **day-wise itinerary call** (one call per trip day). | `/intake`, `/services*`, `/schedule*` — see §4 |
| **2 · Custom Jobs** | Schedule **any** call — one-off or **recurring every N min/hour/day** — with a reusable "why we're calling" campaign. | `/jobs*`, `/campaigns*` — see §5 |
| **3 · Quick Call** | Place an **immediate one-off call**. Optionally attach a **booking** (the agent speaks to that real itinerary) and a **description of why we're calling**. | `/quick-call` (`/test-call`) — see §6 |
| **4 · Feedback** | Read back everything captured on calls (sentiment, hotel/meal/driver/vehicle, issues, full transcript). | `/feedback` — see §7 |

Every call first requests **WhatsApp call permission** ("approval"); a call only connects once the customer taps *Allow* (§3).

### Auth / headers
- Content-Type: `application/json`.
- Intake + scheduler-tick endpoints honour an optional shared secret: send header `x-te-secret: <TE_WEBHOOK_SECRET>` when it's set. All other endpoints are open on this service.
- Times are ISO-8601 (UTC). Phone numbers are international digits, e.g. `94771234567`.

---

## 1. Status

### `GET /config`
Returns feature/config status.
```json
{
  "configured": true, "outbound_configured": true, "booking_source": "portal-db",
  "ai_configured": true, "campaign": "aahaas-traveller-experience",
  "call_window": { "start": 9, "end": 19 },
  "default_call_time": "18:00", "tz_offset_min": 330,
  "max_retries": 3, "retry_gap_min": 40,
  "retry_until_answered": true, "retry_window_days": 1
}
```

---

## 2. Call approval (WhatsApp permission)

### `POST /approval`
Send the "Allow calling" request to a customer (or confirm they already allowed).
```json
// body
{ "to": "94771234567", "name": "Nimal" }
// response
{ "ok": true, "to": "94771234567", "already_allowed": false,
  "message": "Approval request sent — the customer must tap \"Allow\" before a call will connect." }
```
> Every call endpoint below also sends this automatically before dialling. If the customer hasn't allowed, the call response is `{ "ok": false, "approval_pending": true, "message": "Customer didn't allow the approval..." }`.

---

## 3. Where the itinerary comes from (the holidays portal)

Everything that references a **real trip** — the day-wise schedule (Tab 1) and a Quick Call with a booking (Tab 3) — is built from a **booking snapshot** pulled from the Apple Holidays portal:

- **DB reader (default)** — reads the booking straight from the portal's `apple_holidays` DB, **read-only**, no token. Used whenever it's available.
- **Public API (fallback)** — `GET {PORTAL}/api/bookings/full/{ref}` (default `https://holidays-booking.aahaas.com`). Needs `TE_BOOKING_API_TOKEN` if the portal has auth on.
- **Pushed snapshot** — the portal can also POST the full snapshot to `/intake` directly (`"snapshot": {…}`), skipping the fetch.

The snapshot carries: booking ref, arrival/departure, pax, **passengers** (names + lead), **flights** (with times), **accommodations** (hotel, city, check-in/out, room & meal type), the **day-by-day itinerary**, and the **agenda** (per-day driver + vehicle allocation). The agent reads all of it mid-call, so it can answer *"what time's my pickup?"*, *"which hotel on day 4?"*, *"what's my booking reference?"*, *"who's on the booking?"* — see §8.

> A bad/unknown ref returns `404`; a portal outage or auth wall returns `502` (never `401`, so the dashboard session isn't logged out).

---

## 4. Tab 1 — Setup & Service (day-wise itinerary calls)

The main flow: **add a booking by its number** (e.g. `VN19662`), pick **who to call**, **when**, and **how often**, and it lays out **one call per trip day** automatically.

### `POST /intake` — register + schedule a booking
```json
{
  "bookingRef": "VN19662",
  "phone": "94771234567",        // OPTIONAL — the number to call. Defaults to the booking's
                                  // customer contact; always editable later (see PATCH below).
  "schedule": {
    "mode": "agenda",             // "agenda" (one call per trip day) | "interval" (every N…)
    "call_time": "18:00",         // agenda mode: local time each day. Default 18:00 (6 PM).
    "interval_count": 10,          // interval mode: e.g. every 10 minutes
    "interval_unit": "minute",     // minute | hour | day
    "start_at": "now",             // interval mode: when to start ("now" or ISO time)
    "retry_gap_min": 15            // if unanswered, re-call within X minutes (agenda mode)
  }
}
```
- Reads the booking from the portal (§3), or accepts a pushed `"snapshot": {…}`. Honours `x-te-secret`.
- **`mode: "agenda"`** → one call **per trip/agenda day**, each at `call_time` (default **6 PM**, local). If unanswered, retries within `retry_gap_min` **again and again** until answered (per `retry_until_answered` / `retry_window_days`).
- **`mode: "interval"`** → **calls every `interval_count × interval_unit` from `start_at`** ("call from now, every 10 minutes") until the customer answers.
- Times in `call_time` are **local** (timezone `TE_UTC_OFFSET_MIN`, default Sri Lanka +5:30).

Response: `{ "ok": true, "service": {...}, "schedule_mode": "agenda", "days": 6, "schedule_inserted": 6, "call_phone": "94771234567" }`.

### `PATCH /services/:ref` — edit the number / timing (all editable)
```json
{
  "phone": "94779999999",         // change the number we call
  "call_time": "17:30",           // change the daily time
  "mode": "interval",             // switch agenda ⇄ interval
  "interval_count": 10, "interval_unit": "minute", "start_at": "now",
  "retry_gap_min": 10
}
```
Re-lays-out the schedule with the new settings. Returns the updated `service`.

The **service** object carries these settings: `call_phone`, `call_time`, `schedule_mode`, `interval_count`, `interval_unit`, `interval_start_at`, `retry_gap_min`.

### Services & schedule
`intake` lays out one call **per agenda / trip day** (arrival → departure). You can then **manage** that schedule — reschedule a day, set its exact time, skip it, add or remove one.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/services?status=&limit=` | Registered bookings |
| `GET` | `/services/:ref` | One booking + its schedule + feedback |
| `PATCH` | `/services/:ref` | Edit call number / timing (above) |
| `PATCH` | `/services/:ref/status` | `{ "status": "active\|completed\|cancelled" }` |
| `GET` | `/schedule?serviceId=&status=` | Per-day calls |
| `POST` | `/schedule/:id/call` | Dial a day now — `{ "force": true, "to": "9477..." }` (`to` optional override) |
| `PATCH` | `/schedule/:id` | **Manage a day-call** (see below) |
| `POST` | `/schedule/:id/skip` | Skip this day (status → `skipped`) |
| `DELETE` | `/schedule/:id` | Remove this day-call |
| `POST` | `/services/:ref/schedule` | **Add** a day-call |
| `POST` | `/scheduler/run` | Trip-day scheduler tick (honours `x-te-secret`) |

**`PATCH /schedule/:id`** — any of:
```json
{
  "call_date": "2026-08-03",             // move to a different day
  "scheduled_at": "2026-08-03T10:30:00Z",// exact time the call should go (omit/null = call_date + call window)
  "day_brief": "Kandy — Temple of the Tooth in the afternoon",
  "status": "pending"                     // pending (re-enable, resets attempts) | skipped | done | ...
}
```
**`POST /services/:ref/schedule`** — add a call: `{ "call_date": "2026-08-05", "scheduled_at": "2026-08-05T09:00:00Z", "brief": "Extra check-in", "day_no": 7 }` (`day_no` optional — next free number is used).

A day-call is **due** when its `call_date` has arrived (or `scheduled_at` has passed, if set) and it's inside the call window. Unanswered day-calls retry per `retry_until_answered` / `retry_window_days` / `retry_gap_min` (see `/config`). On each day-call the agent has that booking's **whole** itinerary + booking details, not just that day.

---

## 5. Tab 2 — Custom Jobs (any call, one-off or recurring)

A **job** dials a number starting at `start_at`, then repeats every `interval_count × interval_unit`
(`minute` | `hour` | `day`) until `end_at` or `max_runs`, or forever if neither is set.
Omit the interval fields for a **one-off** call. Attach a **campaign** to say *why* we're calling.

### `POST /jobs` — create
```json
// Recurring: call every 5 minutes starting at a time
{
  "name": "Feedback drive",
  "phone": "94771234567",
  "customer_name": "Nimal",
  "campaign_id": 2,                     // optional: what to ask (see Campaigns below)
  "start_at": "2026-07-04T09:00:00Z",   // or "now"
  "interval_count": 5,
  "interval_unit": "minute",            // minute | hour | day
  "max_runs": 12,                        // optional cap (omit = unlimited)
  "end_at": "2026-07-04T10:00:00Z",     // optional stop time
  "respect_window": false                // true = only dial inside the call window
}
```
Other cadence examples: `"interval_count": 1, "interval_unit": "day"` (daily), `"interval_count": 10, "interval_unit": "minute"` (every 10 min), `"interval_count": 2, "interval_unit": "hour"` (every 2 h). One-off: omit `interval_count`/`interval_unit`.

Response `201`: `{ "job": { "id": 7, "status": "scheduled", "next_run_at": "...", ... } }`.

### `GET /jobs?status=&limit=` — list  ·  `GET /jobs/:id` — one
`status` ∈ `scheduled|paused|done|cancelled`.

### `PATCH /jobs/:id` — edit
Any create field, plus `status` and `next_run_at`. e.g. reschedule: `{ "start_at": "...", "interval_count": 10, "interval_unit": "minute" }`.

### Job actions
| Method | Path | Effect |
|---|---|---|
| `POST` | `/jobs/:id/run` | Dial **now**, then advance to the next slot |
| `POST` | `/jobs/:id/pause` | Stop firing (keeps the job) |
| `POST` | `/jobs/:id/resume` | Resume a paused job |
| `POST` | `/jobs/:id/cancel` | Cancel permanently |
| `DELETE` | `/jobs/:id` | Delete the job |

### `POST /jobs/run-due` — scheduler tick
Dials every job whose `next_run_at` has passed and advances it. Drive this from cron (or use the in-process ticker — see §9). Honours `x-te-secret`.
Response: `{ "ok": true, "placed": 2, "failed": 0, "done": 1 }`.

**Job object**
```json
{ "id": 7, "name": "Feedback drive", "phone": "94771234567", "customer_name": "Nimal",
  "campaign_id": 2, "booking_ref": null,
  "start_at": "...", "interval_count": 5, "interval_unit": "minute",
  "end_at": null, "max_runs": 12, "next_run_at": "...", "last_run_at": "...",
  "runs": 3, "status": "scheduled", "respect_window": false,
  "last_result": "called", "conversation_id": "...", "context": { "captured": [ ... ] } }
```
`context.captured` holds what the agent gathered on each call.

### Campaigns — the reusable "why we're calling"
A **campaign** is how the agent should open/steer the call and what to gather. Attach one to a job (`campaign_id`) and the agent follows it instead of the trip check-in.

### `POST /campaigns` — create
```json
{
  "name": "Post-tour NPS",
  "approach": "Warmly thank them for travelling with Apple Holidays and ask how their overall experience was. Be brief and friendly.",
  "collect": "Overall rating out of 10; the single best moment; anything that could be improved; whether they'd travel with us again.",
  "first_message": "Hi! This is Apple Holidays with a quick thank-you call — do you have a moment?",
  "is_active": true
}
```
`collect` can be free text or a JSON list (stringified). Response `201`: `{ "campaign": { "id": 2, "slug": "post-tour-nps", ... } }`.

### `GET /campaigns?active_only=` · `GET /campaigns/:id` · `PATCH /campaigns/:id` · `DELETE /campaigns/:id`

---

## 6. Tab 3 — Quick Call (immediate one-off call)

Place a single call **right now**. Three ways, increasingly specific:

1. **Bare** — just hear the agent's voice/persona (no trip attached).
2. **+ description** — add `reason` so the agent knows *why* it's calling and opens around it.
3. **+ booking** — add `bookingRef` and the agent gets that customer's **real, full itinerary + booking details** (pulled live from the holidays portal, §3), so it can talk about their actual trip and answer booking questions.

### `POST /quick-call`  (alias: `POST /test-call`)
```json
{
  "to": "94771234567",
  "name": "Nimal",                       // optional — greet them by name
  "bookingRef": "VN19662",               // optional — attach a REAL booking (agent references its itinerary)
  "reason": "Confirm their airport pickup time moved to 6:00 AM and that they're happy with it."
                                          // optional — WHY we're calling; the agent opens around this
}
```
Field aliases accepted: `phone` (for `to`), `booking_ref`/`ref` (for `bookingRef`), `description`/`why` (for `reason`).

**Response**
```json
{ "ok": true, "to": "94771234567", "channel_id": "...",
  "booking_ref": "VN19662",              // echoed when attached (null if bare)
  "references_itinerary": true,          // true when a booking was attached and loaded
  "note": "Quick call originated against booking VN19662 — the agent has the full day-by-day itinerary and booking details. It only connects if the number granted WhatsApp call permission." }
```
- When `bookingRef` is given, the booking is **fetched before dialling**, so a bad ref fails fast (`404`) with **no wasted call**.
- If the number hasn't allowed WhatsApp calling yet: `{ "ok": false, "approval_pending": true, "approval_sent": true, ... }` — the approval request is sent; place the call again once they tap *Allow*.
- Quick calls are **ephemeral**: the agent has the full itinerary during the call, but nothing is written to Services or Feedback. For a persisted, feedback-capturing flow use Tab 1 (a booking service) or Tab 2 (a job).

> **Fixed:** a Quick Call with `bookingRef` now genuinely calls the holidays portal and hands the agent the real trip. Previously the test call carried no booking, so the agent had nothing to say when asked about the itinerary or booking details.

---

## 7. Tab 4 — Feedback

### `GET /feedback?serviceId=`
Everything captured on a booking's calls — sentiment, the hotel/meals/driver/vehicle flags, highlights, issues, and the full verbatim `transcript` (AI-distilled from the ElevenLabs conversation after each call).

```json
{ "feedback": [
  { "id": 12, "service_id": 3, "booking_ref": "VN19662", "day_no": 2, "call_date": "2026-08-02",
    "sentiment": "happy", "hotel_ok": "good", "meals_ok": "ok", "driver_ok": "good", "vehicle_ok": "good",
    "highlights": "Loved the temple visit; driver was very friendly.", "issues": null,
    "summary": "Day 2 going well — minor note on breakfast variety.",
    "transcript": [ { "role": "ai", "text": "..." }, { "role": "user", "text": "..." } ],
    "created_at": "..." }
] }
```
Feedback is written by the agent's `capture_experience_feedback` / `log_experience_outcome` tools during Tab 1 (booking) and Tab 2 (job) calls, then enriched by a ChatGPT pass over the transcript. Quick Calls (Tab 3) do **not** produce feedback rows.

---

## 8. Agent knowledge & how the agent answers mid-call

### Agent knowledge base
Shared facts that shape the agent's brain.
`GET /knowledge` · `POST /knowledge` `{ category, title, content, keywords }` · `PATCH /knowledge/:id` · `DELETE /knowledge/:id`.

### Agent tool webhooks (called by the ElevenLabs agent during a call)
`POST /tools/:tool`. You don't call these — the agent does. They're documented so you know what the agent can answer.

- **`get_day_context`** — called once at the start. Returns the grounding for the whole call:
  - `customer_name`, `trip_label`, `arrival_date`, `departure_date`, `pax`, `total_days`
  - `today_day_no`, `today_phase`, `today_brief` (trip check-ins only)
  - `reason` — the "why we're calling" note (Quick Calls with a description)
  - `days[]` — the **full day-by-day itinerary**: `city`, `hotel`, `room_type`, `meal_plan`, `activity`, `meeting_time`, `transfer`, `driver`, `vehicle`, that day's `flights`, `brief`
  - `flights[]` — every flight with times: `flight_no`, `airline`, `date`, `from`, `dep_time`, `to`, `arr_time`
  - **`booking`** — the booking header so the agent can answer booking-detail questions: `booking_ref`, `status`, `currency`, `pax_adults`, `pax_children`, `passengers[]` (name + lead), `hotels[]` (hotel, city, check-in/out, room & meal type)
- **`capture_experience_feedback`** — records how each area is going (good/ok/bad + highlights + issues + sentiment).
- **`log_experience_outcome`** — records the final outcome of the call.

> **Fixed:** `get_day_context` now includes the `booking` header, and the agent prompt tells it to answer any "what are my booking details / who's on the booking / which hotels?" question straight from it. Previously the agent had the day plan and flights but no passenger/hotel/booking header, so those questions went unanswered.

---

## 9. Driving the schedulers

Calls fire only when a scheduler tick runs (Tabs 1 & 2; Tab 3 quick calls dial immediately). Two options:
- **In-process ticker** — set `TE_POLL_INTERVAL_MIN` in `.env` (e.g. `1` for minute-level jobs). Each tick runs both the trip-day check-ins and the call jobs. Set to a small value if you use minute intervals.
- **External cron** — `POST /jobs/run-due` (jobs) and `POST /scheduler/run` (trip-day check-ins) on your own schedule, with `x-te-secret` if configured.

> For a job that fires "every 5 minutes", the tick must run at least that often — use `TE_POLL_INTERVAL_MIN=1` or a 1-minute cron.

---

## Config keys (`.env`)
| Key | Meaning |
|---|---|
| `TE_POLL_INTERVAL_MIN` | In-process tick cadence (minutes). `0` = off (use cron). Set `1` for minute-level intervals. |
| `TE_DEFAULT_CALL_TIME` | Default agenda-day call time (HH:MM local). `18:00` = 6 PM. |
| `TE_UTC_OFFSET_MIN` | Minutes offset of local time from UTC (`call_time`/window are local). Sri Lanka = `330`. |
| `TE_CALL_WINDOW_START` / `_END` | Allowed hours (local) for agenda check-ins. Interval calls ignore the window. |
| `TE_RETRY_UNTIL_ANSWERED` | Keep retrying unanswered trip-day calls until answered. |
| `TE_RETRY_WINDOW_DAYS` | Days past a call's date to keep retrying before "missed". |
| `TE_RETRY_GAP_MIN` | Minutes between trip-day retries. |
| `TE_WEBHOOK_SECRET` | Shared secret for `/intake`, `/scheduler/run`, `/jobs/run-due`. |
| `TE_BOOKING_API_TOKEN` | Bearer/API token for the holidays portal API (only needed when the DB reader is unavailable and the API has auth on). |
| `ELEVENLABS_TRAVELLER_EXPERIENCE_DIAL` | SIP label routing to the TE agent. |
