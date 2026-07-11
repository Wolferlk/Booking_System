
# Traveller Experience — REST API (Updated)

Outbound AI voice-call APIs for the Traveller Experience dashboard.
**Base path:** `/v1/traveller-experience`
(e.g. `https://travel-parser-live.aahaas.com/v1/traveller-experience/...`)

The agent calls an Apple Holidays customer over **WhatsApp voice**, grounded in that
customer's **real booking** (itinerary, flights, hotels, passengers) pulled live from
the holidays portal, and captures structured feedback.

---

## The dashboard — four tabs

| Tab | Purpose | Endpoints |
|---|---|---|
| **1 · Setup & Service** | Register a booking and schedule the **day-wise itinerary call** (one call per trip day, or a recurring interval). | `/intake`, `/services*`, `/schedule*` — §4 |
| **2 · Custom Jobs** | Schedule **any** call — one-off or **recurring every N min/hour/day** — driven by a reusable "why we're calling" campaign. | `/jobs*`, `/campaigns*` — §5 |
| **3 · Quick Call** | Place an **immediate one-off call**. Optionally attach a **booking** (agent speaks to that real itinerary) and a **description of why we're calling**. | `/quick-call` (`/test-call`) — §6 |
| **4 · Feedback** | Read everything captured on calls — sentiment, hotel/meal/driver/vehicle, issues, full transcript. | `/feedback` — §7 |

> **Every** outbound call first requests **WhatsApp call permission** ("approval").
> A call only connects once the customer taps **Allow** (§3).

### Auth / headers
- `Content-Type: application/json`.
- Intake + scheduler-tick endpoints honour an optional shared secret: send
  `x-te-secret: <TE_WEBHOOK_SECRET>` when it's set. All other endpoints are open.
- Times are ISO-8601 (UTC). Phone numbers are international digits, e.g. `94771234567`.

---

## What changed in this update

| Area | Before | Now |
|---|---|---|
| **Quick Call** | Test call had no booking; agent had nothing to say about the trip. | Optional `bookingRef` pulls the **real itinerary** from the holidays portal; optional `reason` steers the call. |
| **Booking details mid-call** | Agent had the day plan + flights but **no** passengers/hotels/booking header. | `get_day_context` now returns a `booking` block (ref, status, pax, passengers, hotels). |
| **Which booking a call talks about** | Resolved to "the latest calling row" — grabbed the **wrong** booking for quick/concurrent calls. | Each call **binds to the record it was originated for** (per conversation), so it always references the right booking. |
| **Interval calls not firing** | `TE_POLL_INTERVAL_MIN=0` — the scheduler tick was off, so nothing dialled. | Set to `1` (tick every minute). Interval bookings + jobs now fire. |
| **`start_at`** | Unclear if required. | Optional — omitting it starts the interval **now**. |

---

## 1. Status

### `GET /config`
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
```json
// body
{ "to": "94771234567", "name": "Nimal" }
// response
{ "ok": true, "to": "94771234567", "already_allowed": false,
  "message": "Approval request sent — the customer must tap \"Allow\" before a call will connect." }
```
> Every call endpoint below also sends this automatically before dialling. If the
> customer hasn't allowed, the call response is
> `{ "ok": false, "approval_pending": true, "message": "Customer didn't allow the approval..." }`.

---

## 3. Where the itinerary comes from (the holidays portal)

Anything that references a **real trip** — the day-wise schedule (Tab 1) and a Quick
Call with a booking (Tab 3) — is built from a **booking snapshot**:

- **DB reader (default)** — reads the booking from the portal's `apple_holidays` DB,
  **read-only**, no token. Used whenever available.
- **Public API (fallback)** — `GET {PORTAL}/api/bookings/full/{ref}`
  (default `https://holidays-booking.aahaas.com`). Needs `TE_BOOKING_API_TOKEN` if the
  portal has auth on.
- **Pushed snapshot** — the portal can POST the full snapshot to `/intake`
  (`"snapshot": {…}`), skipping the fetch.

The snapshot carries booking ref, arrival/departure, pax, **passengers** (names + lead),
**flights** (with times), **accommodations** (hotel, city, check-in/out, room & meal),
the **day-by-day itinerary**, and the **agenda** (per-day driver + vehicle). The agent
reads it mid-call, so it can answer *"what time's my pickup?"*, *"which hotel on day 4?"*,
*"what's my booking reference?"*, *"who's on the booking?"* — see §8.

> A bad/unknown ref returns `404`; a portal outage or auth wall returns `502`
> (never `401`, so the dashboard session isn't logged out).

---

## 4. Tab 1 — Setup & Service (day-wise itinerary calls)

Add a booking by its number (e.g. `VN19662`), choose **who to call**, **when**, and
**how often**. Two modes:

- **`agenda`** — one call **per trip day** at `call_time` (default 6 PM, local). Unanswered
  days retry within `retry_gap_min` until answered (per `retry_until_answered` /
  `retry_window_days`). Agenda calls respect the call window (9am–7pm local).
- **`interval`** — **one recurring call** every `interval_count × interval_unit` from
  `start_at` ("call from now, every 10 minutes") until the customer answers. **Interval
  calls ignore the call window** (fire any time — handy for testing).

### `POST /intake` — register + schedule
```json
{
  "bookingRef": "VN19662",
  "phone": "94771234567",        // OPTIONAL — number to call. Defaults to booking contact; editable later.
  "schedule": {
    "mode": "agenda",             // "agenda" | "interval"
    "call_time": "18:00",         // agenda: local time each day (default 18:00)
    "interval_count": 10,          // interval: e.g. every 10
    "interval_unit": "minute",     // minute | hour | day
    "start_at": "now",             // interval: "now" or ISO time — OMIT = now
    "retry_gap_min": 15            // agenda: re-call gap if unanswered
  }
}
```
Response:
```json
{ "ok": true, "service": {…}, "schedule_mode": "agenda", "days": 6,
  "schedule_inserted": 6, "call_phone": "94771234567" }
```

> **Interval mode fires only when the scheduler tick runs.** Set `TE_POLL_INTERVAL_MIN=1`
> (or drive `/scheduler/run` from cron) — see §9. With the tick off, rows are created but
> never dialled.

### `PATCH /services/:ref` — edit number / timing (all editable)
```json
{
  "phone": "94779999999",
  "call_time": "17:30",
  "mode": "interval",
  "interval_count": 10, "interval_unit": "minute", "start_at": "now",
  "retry_gap_min": 10
}
```
Re-lays-out the schedule with the new settings. The **service** object carries:
`call_phone`, `call_time`, `schedule_mode`, `interval_count`, `interval_unit`,
`interval_start_at`, `retry_gap_min`.

### Services & schedule

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/services?status=&limit=` | Registered bookings |
| `GET` | `/services/:ref` | One booking + schedule + feedback |
| `PATCH` | `/services/:ref` | Edit call number / timing |
| `PATCH` | `/services/:ref/status` | `{ "status": "active\|completed\|cancelled" }` |
| `GET` | `/schedule?serviceId=&status=` | Per-day calls |
| `POST` | `/schedule/:id/call` | Dial a day now — `{ "force": true, "to": "9477..." }` |
| `PATCH` | `/schedule/:id` | Manage a day-call (below) |
| `POST` | `/schedule/:id/skip` | Skip this day (→ `skipped`) |
| `DELETE` | `/schedule/:id` | Remove this day-call |
| `POST` | `/services/:ref/schedule` | Add a day-call |
| `POST` | `/scheduler/run` | Trip-day scheduler tick (honours `x-te-secret`) |

**`PATCH /schedule/:id`**
```json
{
  "call_date": "2026-08-03",
  "scheduled_at": "2026-08-03T10:30:00Z",
  "day_brief": "Kandy — Temple of the Tooth in the afternoon",
  "status": "pending"
}
```
**`POST /services/:ref/schedule`** — `{ "call_date": "2026-08-05", "scheduled_at": "…", "brief": "Extra check-in", "day_no": 7 }`.

A day-call is **due** when its `call_date` has arrived (or `scheduled_at` passed) and it's
inside the call window. On each call the agent has the **whole** itinerary + booking
details, not just that day.

---

## 5. Tab 2 — Custom Jobs (any call, one-off or recurring)

A **job** dials a number from `start_at`, then repeats every
`interval_count × interval_unit` (`minute` | `hour` | `day`) until `end_at`/`max_runs`,
or forever. Omit the interval fields for a one-off. Attach a **campaign** to say *why*.

### `POST /jobs`
```json
{
  "name": "Feedback drive",
  "phone": "94771234567",
  "customer_name": "Nimal",
  "campaign_id": 2,                     // optional — what to ask (Campaigns below)
  "start_at": "2026-07-04T09:00:00Z",   // or "now"
  "interval_count": 5,
  "interval_unit": "minute",            // minute | hour | day
  "max_runs": 12,                        // optional cap
  "end_at": "2026-07-04T10:00:00Z",     // optional stop
  "respect_window": false                // true = only dial inside the call window
}
```
Response `201`: `{ "job": { "id": 7, "status": "scheduled", "next_run_at": "…" } }`.

### List / read / edit
- `GET /jobs?status=&limit=` · `GET /jobs/:id`
- `PATCH /jobs/:id` — any create field, plus `status`, `next_run_at`.

### Actions

| Method | Path | Effect |
|---|---|---|
| `POST` | `/jobs/:id/run` | Dial **now**, then advance |
| `POST` | `/jobs/:id/pause` | Stop firing (keeps the job) |
| `POST` | `/jobs/:id/resume` | Resume a paused job |
| `POST` | `/jobs/:id/cancel` | Cancel permanently |
| `DELETE` | `/jobs/:id` | Delete the job |
| `POST` | `/jobs/run-due` | Scheduler tick — dial all due jobs (honours `x-te-secret`) |

**Job object**
```json
{ "id": 7, "name": "Feedback drive", "phone": "94771234567", "customer_name": "Nimal",
  "campaign_id": 2, "booking_ref": null,
  "start_at": "…", "interval_count": 5, "interval_unit": "minute",
  "end_at": null, "max_runs": 12, "next_run_at": "…", "last_run_at": "…",
  "runs": 3, "status": "scheduled", "respect_window": false,
  "last_result": "called", "conversation_id": "…", "context": { "captured": [ … ] } }
```

### Campaigns — the reusable "why we're calling"

### `POST /campaigns`
```json
{
  "name": "Post-tour NPS",
  "approach": "Warmly thank them for travelling with Apple Holidays and ask how their overall experience was. Be brief and friendly.",
  "collect": "Overall rating out of 10; the single best moment; anything to improve; whether they'd travel with us again.",
  "first_message": "Hi! This is Apple Holidays with a quick thank-you call — do you have a moment?",
  "is_active": true
}
```
`collect` may be free text or a stringified JSON list.
`GET /campaigns?active_only=` · `GET /campaigns/:id` · `PATCH /campaigns/:id` · `DELETE /campaigns/:id`

---

## 6. Tab 3 — Quick Call (immediate one-off call)

Place a single call **right now**. Three ways, increasingly specific:

1. **Bare** — hear the agent (no trip attached).
2. **+ description** — add `reason` so the agent knows *why* it's calling and opens around it.
3. **+ booking** — add `bookingRef` and the agent gets that customer's **real, full
   itinerary + booking details** (pulled live from the holidays portal, §3).

### `POST /quick-call`  (alias: `POST /test-call`)
```json
{
  "to": "94771234567",
  "name": "Nimal",                       // optional — greet by name
  "bookingRef": "VN19662",               // optional — attach a REAL booking
  "reason": "Confirm their airport pickup time moved to 6:00 AM and that they're happy with it."
                                          // optional — WHY we're calling
}
```
Field aliases accepted: `phone`→`to`, `booking_ref`/`ref`→`bookingRef`,
`description`/`why`→`reason`.

**Response**
```json
{ "ok": true, "to": "94771234567", "channel_id": "…",
  "booking_ref": "VN19662",
  "references_itinerary": true,
  "note": "Quick call originated against booking VN19662 — the agent has the full day-by-day itinerary and booking details. It only connects if the number granted WhatsApp call permission." }
```
- With `bookingRef`, the booking is **fetched before dialling** — a bad ref fails fast
  (`404`) with **no wasted call**.
- If not yet allowed: `{ "ok": false, "approval_pending": true, "approval_sent": true, … }` —
  place the call again once they tap **Allow**.
- Quick calls are **one-off**: the agent has the full itinerary during the call, but
  nothing is written to Services or Feedback. For a persisted, feedback-capturing flow use
  Tab 1 (a booking) or Tab 2 (a job).

---

## 7. Tab 4 — Feedback

### `GET /feedback?serviceId=`
Everything captured on a booking's calls — sentiment, the hotel/meals/driver/vehicle
flags, highlights, issues, and the full verbatim `transcript` (AI-distilled after each call).
```json
{ "feedback": [
  { "id": 12, "service_id": 3, "booking_ref": "VN19662", "day_no": 2, "call_date": "2026-08-02",
    "sentiment": "happy", "hotel_ok": "good", "meals_ok": "ok", "driver_ok": "good", "vehicle_ok": "good",
    "highlights": "Loved the temple visit; driver was very friendly.", "issues": null,
    "summary": "Day 2 going well — minor note on breakfast variety.",
    "transcript": [ { "role": "ai", "text": "…" }, { "role": "user", "text": "…" } ],
    "created_at": "…" }
] }
```
Feedback comes from the agent's `capture_experience_feedback` / `log_experience_outcome`
tools during Tab 1 (booking) and Tab 2 (job) calls, enriched by a ChatGPT pass over the
transcript. Quick Calls (Tab 3) do **not** produce feedback rows.

---

## 8. Agent knowledge & how the agent answers mid-call

### Agent knowledge base
`GET /knowledge` · `POST /knowledge` `{ category, title, content, keywords }` ·
`PATCH /knowledge/:id` · `DELETE /knowledge/:id`.

### Agent tool webhooks (`POST /tools/:tool`)
Called by the ElevenLabs agent during a call — you don't call these.

- **`get_day_context`** — called once at the start. Returns the grounding for the call:
  - `customer_name`, `trip_label`, `arrival_date`, `departure_date`, `pax`, `total_days`
  - `today_day_no`, `today_phase`, `today_brief` (trip check-ins)
  - `reason` — the "why we're calling" note (Quick Calls with a description)
  - `days[]` — the **full day-by-day itinerary**: `city`, `hotel`, `room_type`, `meal_plan`,
    `activity`, `meeting_time`, `transfer`, `driver`, `vehicle`, that day's `flights`, `brief`
  - `flights[]` — every flight with times: `flight_no`, `airline`, `date`, `from`,
    `dep_time`, `to`, `arr_time`
  - **`booking`** — the booking header: `booking_ref`, `status`, `currency`, `pax_adults`,
    `pax_children`, `passengers[]` (name + lead), `hotels[]` (hotel, city, check-in/out,
    room & meal). Answers "what are my booking details / who's on the booking / which hotels?"
- **`capture_experience_feedback`** — records how each area is going (good/ok/bad +
  highlights + issues + sentiment).
- **`log_experience_outcome`** — records the final outcome.

### How a call binds to the right booking
Each call is originated with the record it's *for*. When the agent's tool webhook fires,
the service resolves it to **that** originated call (pinned per conversation), rather than
guessing "the latest call" — so quick calls and concurrent calls always reference the
correct booking. Every tool call also logs its payload
(`[traveller-exp] tool webhook payload`) for diagnostics.

---

## 9. Operations — driving the schedulers

Calls fire only when a scheduler tick runs (Tabs 1 & 2). Tab 3 quick calls dial immediately.

- **In-process ticker (recommended)** — set `TE_POLL_INTERVAL_MIN` in `.env`. Each tick runs
  both the trip-day check-ins and the call jobs. **Must be `> 0`**, and `≤` the smallest
  interval you schedule. Use `1` for minute-level intervals.
- **External cron** — `POST /scheduler/run` (bookings) and `POST /jobs/run-due` (jobs) on
  your own schedule, with `x-te-secret` if configured.

**Trigger a tick manually (no restart needed):**
```bash
curl -X POST https://travel-parser-live.aahaas.com/v1/traveller-experience/scheduler/run
curl -X POST https://travel-parser-live.aahaas.com/v1/traveller-experience/jobs/run-due
# → { "ok": true, "placed": 1, "failed": 0, ... }   ("placed" = calls dialled)
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Interval booking / job never calls | `TE_POLL_INTERVAL_MIN=0` (tick off) | Set it to `1`, restart — or drive `/scheduler/run` + `/jobs/run-due`. |
| Quick call doesn't mention the trip | Booking not attached | Send `bookingRef`; confirm `references_itinerary: true` in the response. |
| Agent references the **wrong** booking | Stale/concurrent calls | Fixed — each call binds to its originated record; check the `tool webhook payload` log. |
| `404` on intake / quick-call | Unknown booking ref | Verify the ref exists in the holidays portal. |
| `502` on intake | Portal unreachable / auth-walled | Check the portal; set `TE_BOOKING_API_TOKEN` if the API needs auth. |
| Call never connects | Customer hasn't allowed WhatsApp calling | `approval_pending` — they must tap **Allow**, then re-place. |

---

## Config keys (`.env`)

| Key | Meaning |
|---|---|
| `TE_POLL_INTERVAL_MIN` | In-process tick cadence (minutes). `0` = off. **Set `1`** for minute-level intervals. |
| `TE_DEFAULT_CALL_TIME` | Default agenda-day call time (HH:MM local). `18:00` = 6 PM. |
| `TE_UTC_OFFSET_MIN` | Minutes offset of local time from UTC. Sri Lanka = `330`. |
| `TE_CALL_WINDOW_START` / `_END` | Allowed hours (local) for agenda check-ins. Interval calls ignore the window. |
| `TE_RETRY_UNTIL_ANSWERED` | Keep retrying unanswered trip-day calls until answered. |
| `TE_RETRY_WINDOW_DAYS` | Days past a call's date to keep retrying before "missed". |
| `TE_RETRY_GAP_MIN` | Minutes between trip-day retries. |
| `TE_WEBHOOK_SECRET` | Shared secret for `/intake`, `/scheduler/run`, `/jobs/run-due`. |
| `TE_BOOKING_API_TOKEN` | Portal API token (only when the DB reader is unavailable and the API has auth on). |
| `ELEVENLABS_TRAVELLER_EXPERIENCE_DIAL` | SIP label routing to the TE agent. |
