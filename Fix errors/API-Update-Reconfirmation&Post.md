# Traveller Experience — Reconfirmation & Post-Tour (Update)

Two new **booking-bound** AI voice calls on top of the existing Traveller Experience
caller (see `API-Updated.md`). Same agent, same WhatsApp-voice plumbing, same
scheduler — two new **call purposes**:

| Call | When | What it does |
|---|---|---|
| **Reconfirmation** | a few days **before** the trip (default **−5 days** from arrival) | Warmly reconfirms travel **dates, flights, travellers, contact**, and — importantly — **captures any change the customer asks for** (date change, special request) to flag to the team. It never changes the booking; it collects the request. |
| **Post-tour feedback** | a few days **after** the trip (default **+3 days** from departure) | Thanks the customer, checks they **got home safely**, gathers honest feedback, and captures an **overall 0–10 rating** (+ derived 1–5 stars). Stored so the **holidays-booking portal can read it back** per booking. |

Both are **opt-in per booking**, coexist with the daily check-ins, and are fully
editable (enable/disable, days-before/after, call time). No new ElevenLabs agent
or SIP label — the **same** TE agent picks its playbook from the `mode` returned by
`get_day_context`.

> **Base path:** `/v1/traveller-experience` (unchanged). Auth/headers, WhatsApp
> approval, booking source (holidays portal), and the scheduler tick all work
> exactly as in `API-Updated.md`. Reconfirmation + post-tour calls **respect the
> call window** (never ring at night), even on an interval-mode service.

---

## 1. Enable them at intake

`POST /intake` (unchanged fields plus two opt-in blocks). Each block may be an
object, a bare `true`, or omitted.

```json
{
  "bookingRef": "VN19662",
  "phone": "94771234567",
  "schedule": {
    "mode": "agenda",
    "call_time": "18:00",

    "reconfirm": {
      "enabled": true,
      "days_before": 5,          // OPTIONAL — default 5. Call this many days before arrival.
      "call_time": "10:00"        // OPTIONAL — defaults to the service call_time.
    },
    "post_tour": {
      "enabled": true,
      "days_after": 3,           // OPTIONAL — default 3. Call this many days after departure.
      "call_time": "17:00"        // OPTIONAL — defaults to the service call_time.
    }
  }
}
```

Shorthand also accepted: `"reconfirm": true` (enable with defaults), and the two
blocks may sit at the **top level** instead of inside `schedule`.

**What happens:** intake lays out the usual per-day (or interval) schedule **and**
adds up to two extra scheduled calls:

- a **reconfirmation** row dated `arrival − days_before` (phase `reconfirm`), and
- a **post-tour** row dated `departure + days_after` (phase `post_tour`).

If the reconfirmation date has already passed but the trip is still ahead (booking
registered late), it is **scheduled for today** instead of being missed.

Response is the standard intake response; the two rows appear in `GET /schedule`
and `GET /services/:ref` with `phase: "reconfirm"` / `"post_tour"`.

### Editing later — `PATCH /services/:ref`

All timing is editable after the fact, either as objects or flat fields:

```json
{ "reconfirm": { "enabled": false } }
```
```json
{ "post_tour_enabled": true, "post_tour_days_after": 2, "post_tour_call_time": "16:00" }
```

Turning a plan **off** removes its **pending** row; a row that has already produced
a call (and its captured result) is kept.

The **service** object now also carries:
`reconfirm_enabled`, `reconfirm_days_before`, `reconfirm_call_time`,
`post_tour_enabled`, `post_tour_days_after`, `post_tour_call_time`.

---

## 2. How the agent runs each call

At the start of every call the agent calls `get_day_context`, which now returns a
`mode` telling it which playbook to run:

| `mode` | Meaning |
|---|---|
| `reconfirm` | Pre-trip reconfirmation (they have **not** travelled yet). |
| `post_tour` | Post-trip feedback (the trip is **over**; past tense). |
| `check_in` | The existing during-trip daily check-in. |
| `campaign` | A custom job call (unchanged). |

For `reconfirm` / `post_tour`, `get_day_context` still returns the full grounding
(`customer_name`, `trip_label`, `arrival_date`, `departure_date`, `days[]`,
`flights[]`, `booking`) so the agent can be specific about dates, flights, hotels
and passengers.

### New agent tool webhooks (`POST /tools/:tool`)

Called by the agent mid-call — you don't call these. Both are **best-effort** and
**upsert one row per call** (keyed to the schedule row), so the live capture and
the post-call transcript pass merge into the same record.

- **`capture_reconfirmation`** — pre-trip. Fields: `dates_ok`, `flight_ok`,
  `pax_ok`, `contact_ok` (`yes|no|unsure`), `requested_change` (exactly what they
  want changed, e.g. *"move arrival 15 Oct → 18 Oct"*), `special_requests`,
  `notes`, `sentiment`.
- **`capture_post_tour_feedback`** — post-trip. Fields: `rating` (0–10),
  `reached_home_safely` (`yes|no`), `would_recommend` (`yes|no`), `best_moment`,
  `improvements`, `comment`, `sentiment`.
- **`log_experience_outcome`** — final outcome (as before). Reconfirmation uses
  `confirmed | changes_requested | not_reached | callback | other`; post-tour uses
  `all_good | minor_note | issue_raised | not_reached | callback | other`.

After `log_experience_outcome`, a ChatGPT pass reads the verbatim transcript and
**enriches** the same row (summary + any fields still empty + full transcript).

> **Re-provision the agent** after deploying, so the two new tools are created and
> attached: `node scripts/apply-traveller-experience-agent.mjs`. The tool specs and
> prompt live in `src/modules/traveller-experience/campaigns/traveller-experience.js`.

---

## 3. Reading the results

### Dashboard lists

```
GET /v1/traveller-experience/reconfirmations?serviceId=3
GET /v1/traveller-experience/reconfirmations?ref=VN19662
GET /v1/traveller-experience/post-tour?serviceId=3
GET /v1/traveller-experience/post-tour?ref=VN19662
```

`GET /services/:ref` also now returns `reconfirmations[]` and `post_tour[]`
alongside `schedule` and `feedback`.

**Reconfirmation row**
```json
{
  "id": 4, "service_id": 3, "schedule_id": 61, "booking_ref": "VN19662",
  "conversation_id": "conv_...",
  "dates_ok": false, "flight_ok": true, "pax_ok": true, "contact_ok": true,
  "requested_change": "Wants to move arrival from 15 Oct to 18 Oct (3 nights later).",
  "special_requests": "Ground-floor room; celebrating an anniversary.",
  "notes": null,
  "outcome": "changes_requested", "sentiment": "happy",
  "summary": "Happy and excited. Flights/pax fine, but asked to push arrival to 18 Oct and requested a ground-floor room for their anniversary.",
  "transcript": [ { "role": "ai", "text": "…" }, { "role": "user", "text": "…" } ],
  "at": "2026-10-10T04:30:00.000Z"
}
```

**Post-tour row**
```json
{
  "id": 7, "service_id": 3, "schedule_id": 62, "booking_ref": "VN19662",
  "conversation_id": "conv_...",
  "rating": 9, "stars": 5,
  "reached_home_safely": true, "would_recommend": true,
  "best_moment": "Sunset at the temple and the driver's local food recommendations.",
  "improvements": "Breakfast variety at the second hotel.",
  "comment": "Fantastic trip overall, would definitely travel with us again.",
  "outcome": "all_good", "sentiment": "happy",
  "summary": "Got home safely, rated the trip 9/10, loved the temple sunset; minor note on breakfast variety.",
  "transcript": [ … ],
  "at": "2026-10-25T11:30:00.000Z"
}
```

`stars` is a derived **1–5** display value from the 0–10 `rating` (never stored;
computed on read). Booleans are `true | false | null` (null = not established).

### Portal pull — the holidays-booking side

The holidays portal reads a booking's experience on demand (we **never write** to
the portal's tables — read-only rule preserved):

```
GET /v1/traveller-experience/bookings/{ref}/experience
```
```json
{
  "booking_ref": "VN19662",
  "registered": true,
  "customer_name": "Nimal",
  "trip_label": "Kandy · Galle",
  "arrival_date": "2026-10-15",
  "departure_date": "2026-10-22",
  "reconfirmation": { … latest reconfirmation row, or null … },
  "post_tour":      { … latest post-tour row (with rating + stars), or null … }
}
```

The portal can surface the **rating/review** on the booking screen and act on any
`requested_change` / `special_requests` raised during reconfirmation.

---

## 4. Storage (our own tables in the portal `apple_holidays` DB)

Two new `tbl_te_*` tables (created automatically by `ensureSchema`; the portal's
own tables are never touched):

- **`tbl_te_reconfirmation`** — one row per reconfirmation call (`uk_schedule` on
  `schedule_id`): the `dates_ok/flight_ok/pax_ok/contact_ok` flags,
  `requested_change`, `special_requests`, `outcome`, `sentiment`, `summary`,
  `transcript`, `raw`.
- **`tbl_te_post_tour`** — one row per post-tour call (`uk_schedule`): `rating`
  (0–10), `reached_home_safely`, `would_recommend`, `best_moment`, `improvements`,
  `comment`, `outcome`, `sentiment`, `summary`, `transcript`, `raw`.

The schedule table gains two reserved rows per service (via new `phase` values):
`reconfirm` (day_no `0`) and `post_tour` (day_no `9999`).

Service settings columns added: `reconfirm_enabled`, `reconfirm_days_before`,
`reconfirm_call_time`, `post_tour_enabled`, `post_tour_days_after`,
`post_tour_call_time`.

---

## 5. Endpoint summary (new/changed)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/intake` | + `schedule.reconfirm` / `schedule.post_tour` opt-in blocks |
| `PATCH` | `/services/:ref` | + reconfirm/post-tour enable + timing (object or flat) |
| `GET` | `/services/:ref` | + `reconfirmations[]`, `post_tour[]` |
| `GET` | `/reconfirmations?serviceId=&ref=` | Reconfirmation captures |
| `GET` | `/post-tour?serviceId=&ref=` | Post-tour feedback + ratings |
| `GET` | `/bookings/:ref/experience` | **Portal pull**: latest reconfirmation + rating |
| `POST` | `/tools/capture_reconfirmation` | Agent webhook (mid-call) |
| `POST` | `/tools/capture_post_tour_feedback` | Agent webhook (mid-call) |

Everything else — approval, scheduler tick, quick calls, jobs, campaigns,
knowledge, feedback — is unchanged from `API-Updated.md`.
