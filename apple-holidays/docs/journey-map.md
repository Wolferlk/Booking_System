# Journey Map — what the map on a booking actually does

The Journey Map is the panel that turns a booking into a **route on a real
map**: pins for every place the guests go, the road between them, the hotels
they sleep in, the flights they take, and a fly-through that plays the trip.

It is a **read-only, derived view**. Nothing it produces is written to the
database — the route is rebuilt on read and held in a process-memory cache, so
an amendment to the booking invalidates it automatically and no column, table
or migration exists for it.

| Piece | File |
| --- | --- |
| Itinerary route builder | [journey-map.ts](../src/lib/journey-map.ts) |
| Movement-chart route builder | [agenda-journey.ts](../src/lib/agenda-journey.ts) |
| Road routing (OSRM) | [road-route.ts](../src/lib/road-route.ts) |
| Pin detail brief (AI + photos) | [journey-activity.ts](../src/lib/journey-activity.ts) |
| The map UI | [journey-map.tsx](../src/components/bookings/journey-map.tsx) |

---

## 1. Two maps, one component

The same component draws two different things, chosen by the `source` prop —
never as a fallback, always as a deliberate choice by the page.

### `source="itinerary"` — the marketing route
Reads `itineraryItems`. The rows are free marketing prose ("Sun World Ba Na
Hills Full Day Tour from Da Nang (Golden Bridge + …) | Shared Transfer"), so
there is nothing geographic on the row. The model is asked to read each day the
way an operator would — *what place is this day actually at* — and returns a
searchable place, city, country, kind and coordinates per day. Answers
"roughly where does each day happen".

### `source="agenda"` — the movement chart (MC)
Reads `tourAgenda.items`, the AI-generated movement chart. Nothing has to be
guessed: the row already carries `fromPoint`, `toPoint`, `serviceType`,
`timeFrom/timeTo`, `meetingTime` and `mealPlan`. The model is used for one job
only — turning place names into coordinates. Answers the operational question:
**where does the vehicle pick up, where does it drop, what is carrying them,
and which hotel do they sleep in that night**.

### Where each one appears
| Page | Source | Audience |
| --- | --- | --- |
| [dashboard/bookings/[ref]](../src/app/dashboard/bookings/[ref]/page.tsx) | agenda | staff |
| [dashboard/bookings/[ref]/agenda](../src/app/dashboard/bookings/[ref]/agenda/page.tsx) | agenda | staff |
| [portal/[ref]](../src/app/portal/[ref]/page.tsx) | itinerary/agenda | guest (token) |
| [trip/[ref]](../src/app/trip/[ref]/page.tsx) | itinerary/agenda | guest (token) |

Staff routes are session-gated (`/api/bookings/:ref/journey-map`). Guest routes
are gated by the signed portal-link token (`/api/public/journey-map/:ref?t=…`
and `/api/public/agenda-journey/:ref?t=…`) — same derived route, same cache, no
session. The only content difference is voice: guest copy is written in warm
second person, and operator-only affordances (the rebuild button) are hidden.

---

## 2. How a place becomes a pin

1. **Model extraction.** The whole itinerary/agenda goes to the model in one
   call (`OPENAI_JOURNEY_MODEL`, default `gpt-4o-mini`, temperature 0, JSON
   mode). It returns one stop per row: `place`, `city`, `country`, `kind`,
   `lat`, `lng`. It is told to prefer the most *specific* named thing —
   "Ba Na Hills" over "Da Nang", "Ha Long Bay" over "Hanoi".
2. **Geocode refinement.** Coordinates are then refined against
   **Nominatim** (OpenStreetMap, free, no key). Refinement never *blocks*:
   Nominatim asks for ≤1 request/second, so a 20-day file would otherwise stall
   the panel for half a minute. A process-wide geocode cache means repeated
   places ("Da Nang" is on every Vietnam file) never touch the network again.
3. **Fallbacks.** If the model gives nothing usable, the place is guessed from
   the row text (the words after "from", or the lead phrase before a `|`/`(`).
   If neither the model nor OSM produces coordinates, the stop is dropped.
4. **Confidence.** Each stop records `source: 'osm' | 'model'` — surfaced in the
   UI as a confidence dot.
5. **Degraded mode.** A model or geocoder outage produces *fewer pins*, never a
   broken page. The panel then shows: *"Some days could not be placed precisely
   — pins are approximate."*

---

## 3. What is drawn on the map

### Basemaps (all free, no API key, no billing)
- **Voyager** — CARTO light raster
- **Terrain** — OpenTopoMap
- **Midnight** — CARTO dark (default in the dark portal theme)

Leaflet is loaded by dynamic import inside the mount effect, so it never enters
the server bundle or the initial page payload.

### Stop pins
Every stop is a coloured pin with its own glyph, by **kind**:
`arrival`, `departure`, `transfer`, `flight`, `tour`, `attraction`, `beach`,
`nature`, `cultural`, `city`, `cruise`, `hotel`, `leisure`.

### Hotel pins
Each accommodation stay is pinned separately (orange), tagged with the hotel
name and the number of nights. Hotels are placed from the warm geocode cache
only, so they add no latency.

### The route line
- **Real roads, not arcs.** Each leg is routed through **OSRM** (public
  instance, or `OSRM_URL` for a self-hosted one) and drawn as the line the
  coach actually drives, with **driving distance in km and free-flow driving
  time**. An arc crosses reservoirs and makes a four-hour mountain transfer
  look like a hop.
- **Arc fallback.** A routing outage or timeout falls that leg back to a gently
  bowed arc; the whole batch runs under one deadline and legs that miss it stay
  arcs. Geometry travels as an encoded polyline (a few hundred bytes for a
  300 km leg instead of tens of kilobytes).
- **Air corridors.** Flight sectors are drawn as a separate dashed corridor
  with a looping plane trailing a contrail.

### Vehicles that ride the line
The **transport mode** of each leg is drawn as an emoji riding its own leg,
oriented along the bearing (and flipped for westbound travel so the car does
not drive backwards):

| Mode | Glyph | From service type |
| --- | --- | --- |
| Private | 🚗 | `PVT_*` |
| Seat-in-coach | 🚌 | `SIC_*` |
| Flight | ✈️ | `FLIGHT` |
| Own arrangement | 🚶 | `OWN_ARRANGEMENT` |
| Ticket only | 🎫 | `INTERNAL_TOUR` |
| Hotel only | 🏨 | `ACCOMMODATION` |
| Meal | 🍽️ | `MEAL_COUPON` |

When nothing is playing, an **idle rider** continuously drives the finished
route — a static polyline does not tell you which way the trip flows; a car
crawling from Sigiriya towards Kandy does, without anyone pressing anything.

### Flights woven in
The movement chart books the car *to* the airport but never the sector itself.
The flight list is the only record of an internal hop, so the map weaves booked
flights in as synthetic stops, classified as:
- **inbound** — brings the guests into the operating country
- **internal** — between two destinations on the same file (this is the one the
  chart cannot express; without it the route teleports from Ho Chi Minh to
  Da Nang instead of visibly flying)
- **outbound** — takes them home

Airport codes are resolved to real airports (name, city, coordinates), and
transfer rows that feed a flight are chip-tagged "to-airport" / "from-airport"
with the flight number.

---

## 4. Controls and interactions

| Control | What it does |
| --- | --- |
| **Play / Pause** | Fly-through: the camera flies leg by leg (1.5 s a leg, 1.1 s dwell on each stop) while a traveller marker walks the route and the finished stretch lights up behind it. |
| **Day picker** | Scopes the fly-through to one day. A 20-day route played end to end is a screensaver; one day answers "what does Day 4 actually involve". The run starts one stop *before* the day's first, so you see the movement into it. |
| **Reset** | Back to the whole route, cleared selection, refit bounds. |
| **Filter (legend)** | The legend doubles as a filter — click a kind to fade those pins out. |
| **Layers** | Switch basemap (Voyager / Terrain / Midnight). |
| **Explore / Done** | On touch devices the map does *not* own gestures by default, so a vertical swipe scrolls the trip page instead of panning Sri Lanka. "Explore" hands gestures over deliberately. |
| **Fullscreen** | Expands the panel over the page; Esc closes; wheel zoom is enabled only here. |
| **Rebuild map** | Staff only. Forces `?refresh=1` — bypasses the cache and re-runs extraction. |
| **Day strip** | A horizontal card row under the map: day number, date, time, from → to, service chip, road km + drive time, hotel of the night, or the full flight card (flight no, airline, both airports, dep/arr times). Clicking a card flies to that stop. |

### The header stats card (top-left)
- Countries on the file
- Day count and number of stops/moves
- **Total distance** — driving km where the legs routed, straight-line where
  they could not
- **Total drive time** (free-flow, no traffic)
- Number of hotel stays
- Number of flights, and how many are internal sectors
- **Transport mix** — "6 PVT, 3 SIC, 1 flight" — the first thing an operator
  wants off a mixed chart

---

## 5. The pin detail card

Clicking a pin (or a day-strip card) opens a detail drawer — a right-hand panel
on desktop (it owns half the panel, capped at 560px, and the map chrome pulls
back so nothing is hidden behind it) or a draggable bottom sheet on a phone.

It shows, researched on demand by the model and cached server-side for 12 h by
place *and* audience:
- an evocative **headline**
- a 2–3 sentence **summary** of what the place is and why people go
- 3–5 **highlights**
- **best time** to visit
- 2–3 **tips** — *operator* notes for staff (timing, dress code, queues, what
  guests complain about) vs *traveller* tips for guests (what to wear or bring)
- **real photographs** of the place, in a gallery

The write-up and the photo hunt run in parallel, so the card fills in once
rather than stuttering. Prev/next arrows step through the stops.

Two ideas are kept deliberately separate: `activeId` (which stop the map is
*looking at* — playback moves it constantly) and `selectedId` (the user asked
to read about this one, which opens the card and spends a model call). Merging
them made the fly-through open a card on every stop, covering the very map it
was flying over.

---

## 6. Caching, cost and failure

- **Route cache** — in process memory, 30-minute TTL, keyed by the booking's
  `version:updatedAt` (or the agenda's `updatedAt`). An amendment invalidates
  it; guests and staff share one entry, so whoever opens it first warms it for
  everyone.
- **Geocode cache** — process-wide, keyed by query + country hint. Negative
  results are cached too.
- **Road-leg cache** — process-wide, coordinates rounded to ~11 m before they
  become a key, so the same hotel resolved twice does not re-route the leg.
- **Brief cache** — 12 h, keyed by place + audience.
- **AI usage is logged** — every extraction and brief goes through
  `logAiUsage` with call type `journey_map_extract`, the model, the token
  usage and the booking ref.
- **Nothing throws.** Model outage → `degraded: true` and fewer pins. Geocoder
  outage → model coordinates stand. OSRM outage → arcs. Empty itinerary → an
  empty journey, not an error.

### External services used
| Service | Used for | Key needed |
| --- | --- | --- |
| OpenAI | place extraction, place briefs | yes |
| Nominatim (OSM) | forward geocoding | no |
| OSRM | road geometry, distance, duration | no |
| CARTO / OpenTopoMap | raster basemap tiles | no |
