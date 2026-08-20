# Daily Work Update — 19 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 19 Aug 2026 (Booking System / Ops)

---

Hi [Name],

Today's work was entirely on the **Booking System (Ops)**. Three headline items: the new **Journey Map** on every booking (a real route on a real map, for both staff and guests), the **Live Confirmation Watch** (new Apple System confirmations imported within minutes instead of the next morning), and the new **Live Ops dashboard hero** (an animated map of everyone who is on the ground and every flight in the air right now). Alongside those: Word-document delivery for agendas and booking confirmations, free-text entry in the agenda dropdowns, and a call-approval filter on the Daily Update Sheet.

No Accounts System changes were required today.

---

## 1. Journey Map — new component (largest item of the day)

A booking was a list of rows; nobody could see *where* the trip actually goes. The booking page now carries a map panel that draws the whole file as a route.

### 1.1 The map itself
- **`lib/journey-map.ts` + `components/bookings/journey-map.tsx`** — every place on the file becomes a pin: arrivals, departures, transfers, tours, attractions, beaches, cultural sites, cruises, hotels.
- **Two sources, one component.** `source="itinerary"` reads the marketing itinerary and asks the model *where does each day actually happen*; `source="agenda"` reads the AI movement chart, which already carries from-point, to-point, service type and times, so the model is only used to turn place names into coordinates. The MC source was added after review because the itinerary text alone could not place a day reliably.
- **Places → coordinates** via the model, then refined against **Nominatim (OpenStreetMap)** — free, no API key, and cached process-wide so repeated places never touch the network twice. Each pin records whether the position came from OSM or the model, shown as a confidence dot.
- **Hotels** are pinned separately with the hotel name and the number of nights.

### 1.2 Real roads, not straight lines (`lib/road-route.ts`)
- Each leg is routed through **OSRM** and drawn as the road the coach actually drives, labelled with **driving distance (km) and driving time**. A straight arc crosses reservoirs and makes a four-hour mountain transfer look like a hop.
- A routing outage falls that leg back to a bowed arc — the map never breaks, it just gets less precise.

### 1.3 Flights woven into the route
- The movement chart books the car *to* the airport but never the sector itself, so a Vietnam file would teleport from Ho Chi Minh to Da Nang. The map now reads the **flight list** and weaves every sector in as **inbound / internal / outbound**, drawn as a dashed air corridor with an animated plane and contrail.
- Airport codes are resolved to real airports; transfer rows that feed a flight are tagged "to-airport" / "from-airport" with the flight number. Verified against booking **VN40859**, which has internal sectors.

### 1.4 Animation and controls
- **Vehicle icons ride the line** by service type — 🚗 private, 🚌 SIC, ✈️ flight, 🚶 own arrangement, 🎫 ticket only, 🏨 hotel only, 🍽️ meal — oriented along the direction of travel. When nothing is playing an **idle rider** drives the finished route continuously, so you can see which way the trip flows.
- **Play / Pause fly-through**, **day picker** (scope the playback to one day), **reset**, **legend-as-filter**, **basemap switcher** (Voyager / Terrain / Midnight), **fullscreen**, and a **day strip** of cards under the map (date, from → to, service chip, road km and drive time, hotel of the night, or the full flight card).
- **Pin detail card** — clicking a pin opens a researched brief: headline, summary, highlights, best time to visit, operator tips for staff / traveller tips for guests, and real photographs. Cached server-side for 12 h per place and audience.

### 1.5 Guest portal + layout fixes (from review feedback)
- The same map is now on the **client portal** and **trip page**, gated by the signed portal-link token instead of a session, written in guest voice, and built for mobile — including an **Explore / Done** control so a vertical swipe scrolls the page instead of panning the map.
- Map moved **above the QC Status component** on the booking page as requested; the detail card now opens as a **right-hand half panel** with the map holding the other half; nav-bar and scrollbar UI issues fixed.

### 1.6 Cost and failure behaviour
- Route, geocode, road-leg and brief results are all cached; the route cache is keyed on the booking version, so an amendment rebuilds it automatically. **Nothing is written to the database** — no table, no column, no migration.
- Every model call is logged through `logAiUsage`. A model outage means fewer pins, not a broken page.
- Documented in full for the team: **`docs/journey-map.md`**.

---

## 2. Live Confirmation Watch — new component

**The problem, confirmed with the team today:** the 06:00 import brings in *yesterday's* confirmations, so a quotation confirmed at 09:00 in the Apple System only appeared in Ops the next morning.

- **`lib/as-watch.ts` + `lib/as-watch-scheduler.ts`** — every N minutes the system asks the Apple System for recently created confirmations and imports whatever is not here yet, typically **within minutes of the confirmation happening**.
- **It cannot duplicate or modify an existing booking.** It reuses the exact same idempotent import pipeline as every other path; a known booking reference short-circuits and is returned untouched.
- **Rolling window, not "since last check"** — the upstream filter is the quotation's *create date*, not its confirm time, which is precisely how the daily job loses late confirmations. Re-sweeping the last few days catches them.
- **Cheap by design** — each tick normalises the list rows into booking references and asks our own DB in one query which already exist, fetching the expensive detail endpoint only for the remainder. A quiet tick costs one upstream list call and one indexed local SELECT, so a 5-minute interval is affordable.
- **Interval is configurable in Settings** (New AS Booking → Live Watch), honoured exactly by a self-rescheduling timer and picked up without a restart.
- **"Fetch Now" button on the All Bookings page** (`as-fetch-now.tsx`) with the **last-fetch time** shown, plus a watch tab with the check log.
- **No schema change and no migration** — settings, the last-check marker and the log live in the existing settings store, deliberately, so the live database is not touched.

---

## 3. Live Ops Dashboard Hero — new component

The dashboard could say *how big the book is*; it could not say *who is out there right now*.

- **`/api/dashboard/live-ops`** — a strictly **read-only** single read across bookings, agenda items, ground assignments and flights, so the picture is consistent.
- **`live-ops-hero.tsx` + `live-ops-map.tsx`** — a Leaflet map (free, no API key) showing **on-ground files pinned where they are today**, **today's arrivals and departures**, and **animated flight arcs**. If the user is scoped to one country the map shows that country only; otherwise it shows all operating countries.
- **`vehicle-art.tsx`** — vehicles drawn by class, later refined to classify more vehicle types correctly so the allocation shown on the map matches what was actually assigned.
- **`lib/ops-geo.ts`** — an offline gazetteer of the airports our files fly through and the towns they sleep in. The journey map can afford a network geocode per pin; the landing page cannot, so this resolves instantly with a hard cap on how many pins and arcs are drawn.

---

## 4. Agenda & Delivery Improvements

### 4.1 Free-text entry in the agenda dropdowns
- New **`combo-input.tsx`** component plus an **agenda suggestions API** (`/api/agenda/suggestions`, `lib/agenda-suggestions.ts`) — the dropdowns are now suggestion lists: if the value the operator needs is not in the list they can type it in directly, without breaking the existing option set or the downstream logic.

### 4.2 Word (DOCX) delivery over WhatsApp
- **Agenda** — `lib/generate-agenda-docx.ts` produces the movement chart as a Word document with the booking summary; the send dialog now lets the user choose **PDF or Word** and delivers the chosen format over WhatsApp.
- **Booking confirmation / full details** — `lib/generate-booking-docx.ts` does the same for the booking confirmation and full-detail documents, wired into both the WhatsApp send route and the WhatsApp queue.

### 4.3 Daily Update Sheet — call approval filter
- The **Call Approval** column is now filterable: *approved*, *not sent*, *sent – not approved*, and *no contact number to send* (`lib/daily-update-approval.ts`), so the team can work the exceptions rather than scanning the whole sheet.

---

## 5. Code Volume

| Commit | Item |
|---|---|
| `6490686` | Journey map module — geocoding, mapping, booking page panel (1,897 +) |
| `7170f61` | Vehicle icons and route animations |
| `be0626f` | Public/portal journey-map endpoints + pin detail briefs |
| `03c760e` | Agenda-journey (movement chart) route builder and endpoints (1,032 +) |
| `a59a6f7`, `f089cb9` | Layout: map above QC status, side detail card, nav/scrollbar fixes |
| `7af5a9f` | Combo input + agenda suggestions API |
| `96b240d`, `0cb2bdf`, `826f269` | Word generation for agenda and booking confirmations |
| `cd453de`, `73a5da6` | Flight sectors woven into the route |
| `e24c723` | OSRM road routing, driving distance and time |
| `5d1aaa5` | Daily Update Sheet call-approval filter |
| `7d76d83` | Live Confirmation Watch + Fetch Now + docs (1,726 +) |
| `4f92fd7`, `22a1d25` | Live Ops hero, map, vehicle art, geo gazetteer (2,156 +) |

**Total: ~10,772 lines added, ~665 removed** across **17 commits** (`6490686` → `22a1d25`, branch `Main_v7_DEV`). Working tree clean.

---

## 6. Claude Code History — 19 Aug 2026

Sessions run today (times are Asia/Colombo), with the instruction that drove each:

| Time | System | Request |
|---|---|---|
| 09:47 | Booking | On the booking details page, show the **route on a map** for the country — travel dates, travel time, stays, hotels, attractions, all of it |
| 10:23 | Booking | Add the map component to the **client portal** too — creatively, and suitable for mobile |
| 10:38 | Booking | Build the map from the **AI-generated agenda (MC)**, not the itinerary — every agenda item has a from and a to; identify the date correctly |
| 11:17 | Booking | Move the map **above the QC Status** component; open the description as a **right-side half panel** with the map on the rest; fix the nav-bar and scrollbar UI |
| 12:48 | Booking | In the agenda, if an option is **not in the dropdown**, allow entering it manually without affecting anything else |
| 13:15 | Booking | When sending the agenda over WhatsApp, allow choosing **PDF or Word**, and send the Word file |
| 13:21 | Booking | Booking details must also send in **Word format over WhatsApp** |
| 14:41 | Booking | The agenda map does not identify **airport-to-airport / internal flights** — show them clearly with flight details and creative animation (example: **VN40859**) |
| 15:19 | Booking | Add a **filter on the Call Approval column**: approved / not sent / sent – not approved / no contact number |
| 16:01 | Booking | Explain the API booking-creation process — is a booking confirmed today only created in Ops tomorrow morning? |
| 16:05 | Booking | Build a component that **checks the Apple System for new confirmations on a timer** and auto-creates them in realtime; interval configurable in settings; **Fetch Now** button and last-fetch time on the All Bookings page. *Do this accurately; do not touch live data* |
| 16:11 | Booking | Write an **md file explaining** what the booking-system map does and what it shows → `docs/journey-map.md` |
| 17:08 | Booking | Build a **more modern, animated hero** for the Ops dashboard using Leaflet — one country's map when scoped, all countries otherwise; animated flights; today's arrivals and departures; who is on the ground |

Standing constraints applied in every session: **do not touch live data, do not lose any records.** Nothing built today added a table, column or migration — the journey map is derived on read and cached in memory, the confirmation watch stores its settings and log in the existing settings store, and the live-ops endpoint is read-only.

---

## Summary

| Area | Items Delivered |
|---|---|
| Booking System | **Journey Map** (staff + guest portal, itinerary and movement-chart sources, OSRM road routing with km and drive time, internal flight sectors, vehicle animation, fly-through and day picker, AI pin briefs with photos, full docs); **Live Confirmation Watch** (near-realtime Apple System import, configurable interval, Fetch Now, idempotent and migration-free); **Live Ops dashboard hero** (Leaflet map of on-ground files, arrivals/departures and animated flights, offline gazetteer, vehicle art); Word delivery of agenda and booking confirmations over WhatsApp; free-text combo inputs for the agenda; call-approval filter on the Daily Update Sheet |
| Accounts System | No changes today |

Happy to walk through any of the above — particularly the **Live Confirmation Watch**, which removes the overnight delay between a confirmation in the Apple System and the booking existing in Ops, and the **Journey Map**, which now gives both the ground team and the guest the same picture of where the trip actually goes.

Best regards,
**Sasindu Diluranga**
