# Movement Chart Generation Rules — AppleHolidays MMT Vietnam

---

## 1. Airport Transfers

### Arrival
- International flight: meetingTime = flight arrTime + 45 minutes  
  Example: flight arrives 14:20 → meetingTime = "15:05"
- Domestic flight: meetingTime = flight arrTime + 30 minutes  
  Example: flight arrives 10:00 → meetingTime = "10:30"
- **serviceType = PVT_TRANSFER — ALWAYS. Airport transfers are NEVER SIC_TRANSFER or OWN_ARRANGEMENT.**

### Departure
- meetingTime = flight depTime − 3 hours  
  Example: flight departs 09:30 → meetingTime = "06:30"
- fromPoint = hotel name
- **serviceType = PVT_TRANSFER — ALWAYS.**

---

## 2. Meeting Time Defaults by Tour Type

When exact time is not given in the document, apply these defaults:

| Tour type                  | Default meetingTime |
|----------------------------|---------------------|
| Full-day tour (SIC)        | 07:30               |
| Half-day morning (SIC)     | 08:00               |
| Half-day afternoon (SIC)   | 13:00               |
| Night show / evening tour  | 18:30               |
| Cruise embarkation         | 07:30               |
| Private full-day tour      | 08:00               |
| Private half-day morning   | 08:30               |
| City transfer (PVT)        | Use departure time from itinerary or 08:00 |
| Overnight train / sleeper  | Set to train departure time from itinerary |

**IMPORTANT:** meetingTime must ALWAYS be filled (HH:MM format). Never leave it null or empty except for "Ticket Only" or "Leisure Day" items (see rules 3 and 7).

---

## 3. Ticket-Only Items

If the activity is entrance tickets, passes, or own-arrangement activities (no guide, no transfer):
- mealPlan = null (leave blank)
- meetingTime = null (leave blank)
- serviceType = OWN_ARRANGEMENT

---

## 4. Meal Plan

- Only set mealPlan if meals are explicitly included in the package for that day.
- Use: B = Breakfast, L = Lunch, D = Dinner, BL, BD, LD, BLD as applicable.
- If meals not included → leave mealPlan blank/null.

---

## 5. Service Type Selection — STRICT RULES

Apply in this exact priority order:

1. **Airport transfer (any item where fromPoint or toPoint is an airport, terminal, or flight)** → `PVT_TRANSFER` always, no exceptions.
2. **Leisure day / free day / at leisure / own arrangement / hotel stay with no scheduled activity** → `OWN_ARRANGEMENT`. Set meetingTime = null.
3. **Explicitly labelled "SIC" or "shared" tour/transfer** → `SIC_TRANSFER`.
4. **Private tour, private transfer, cruise, inter-city transfer with a guide or vehicle** → `PVT_TRANSFER`.
5. **Ticket only, entrance only, self-guided** → `OWN_ARRANGEMENT`.

**Never guess PVT vs SIC for leisure/free days — always use OWN_ARRANGEMENT.**

---

## 6. General Rules

- Generate one item per significant activity or transfer each day.
- Always include arrival day transfer and departure day transfer.
- Split multi-city days into separate items (e.g. "Hanoi to Halong" is separate from "Halong Cruise").
- fromPoint = exact hotel name or airport code.
- toPoint = destination name, hotel name, pier, attraction name.
- details = include timing, vehicle type, specific instructions (e.g. "SIC pickup 07:30 from hotel lobby").

---

## 7. Leisure Days

A leisure day is any day where the itinerary says "at leisure", "free time", "own arrangement", "relax", or has no scheduled guided activity:
- serviceType = OWN_ARRANGEMENT
- meetingTime = null
- details = describe what the guest can do at leisure (e.g. "Free day to explore the city at leisure. No guided activities scheduled.")
- mealPlan = only if explicitly included

---

## 8. Details Field — Rich Operational Content (MANDATORY)

The `details` field must be a complete operational briefing — **never a one-liner**. Every item needs 2–4 sentences (50–100 words) covering:

1. **Exact pickup time and spot** — "Meet at hotel lobby at 07:30", "Driver waiting at arrivals hall HAN with name board"
2. **Vehicle / transport mode** — "Air-conditioned private car", "SIC shared minibus", "Overnight sleeper train seat 12B", "Halong cruise"
3. **Journey time / distance** — "Approx. 40 min to city centre", "3.5 hour drive to Halong Bay pier"
4. **Guest instructions** — name board at airport, luggage limit, passport ready, be in lobby 5 min early for SIC, check-in time, what to bring
5. **Drop-off context** — hotel name, pier name, area, terminal number

### Quick templates:

**Airport arrival:**
> "Private airport pickup at [meetingTime] (45 min after landing at [airport]). Driver waits at arrivals hall with name board. Air-conditioned private car to [hotel], approx. [X] min. Driver assists with all luggage."

**Airport departure:**
> "Hotel pickup at [meetingTime] (3 hrs before [depTime] departure). Air-conditioned private car to [airport]. Passengers should have passports and boarding passes ready. Drop-off at [terminal]."

**SIC tour:**
> "SIC pickup from hotel lobby at [meetingTime] — please be ready 5 min early. Shared air-conditioned minibus. Tour of [activity] with English-speaking guide, approx. [X] hrs. Drop-off at hotel by [end time]."

**Private city transfer:**
> "Private pickup from [fromPoint] at [meetingTime]. Air-conditioned private vehicle to [toPoint], approx. [X] hrs. Rest stop en route. Driver assists with luggage on arrival."

**Leisure day:**
> "Free day at leisure in [city]. No transport or guide arranged. Guests may explore [highlights] independently. Hotel concierge available for recommendations and bookings."
