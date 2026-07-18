# New Booking Create — JSON Structure (Internal Ops App)

This documents the **internal** JSON payloads used by the AppleHolidays Ops app
(`https://ops.aahaas.com`), **not** the external Postman API.

- Booking create: `src/app/api/bookings/route.ts` → `POST`
- P&L create:     `src/app/api/bookings/[ref]/pnl/route.ts` → `POST`

All endpoints require an authenticated NextAuth session (cookie-based). No Bearer
token — the browser session drives auth. Country is resolved from the explicit
`operationCountry` field → booking ref prefix (`IS/VN/SG/MY`) → the user's assigned
country.

---

## 1. Create Booking

### Endpoint

```
POST /api/bookings
Content-Type: application/json
```

Sent by the New Booking page: `src/app/dashboard/bookings/new/page.tsx`
(`https://ops.aahaas.com/dashboard/bookings/new`).

### Required fields

`bookingRef`, `arrivalDate`, `departureDate`. A destination country must resolve
(via `operationCountry`, the ref prefix, or the user's country) or the request is
rejected.

### Request Body — Structure

```jsonc
{
  // ── Core identifiers ────────────────────────────────────────────
  "bookingRef":      "IS123456",      // REQUIRED, must be unique
  "agentBookingId":  "AGT-0099",      // agent's own booking id (optional)
  "cntlNumber":      "CNTL-771",      // control number (optional)
  "isNumber":        "IS123456",      // auto-filled from ref if it matches IS/VN/SG/MY
  "operationCountry":"SRILANKA",      // VIETNAM | SRILANKA | SINGAPORE_MALAYSIA | SINGAPORE | MALAYSIA

  // ── Who handles it ──────────────────────────────────────────────
  "agent":           "GlobalTravel",  // agent / source name
  "fileHandler":     "Sasindu",       // internal file handler

  // ── Dates & pax ─────────────────────────────────────────────────
  "arrivalDate":     "2025-12-30",    // REQUIRED, ISO date (yyyy-mm-dd)
  "departureDate":   "2026-01-05",    // REQUIRED, ISO date
  "paxAdults":       2,               // number
  "paxChildren":     1,               // number

  // ── Money ───────────────────────────────────────────────────────
  "quotedTotal":     1850.00,         // number or null
  "currency":        "USD",           // defaults to "USD"

  // ── TC free-text sections (all optional) ────────────────────────
  "terms":              "…",
  "exclusions":         "…",
  "policyNotes":        "…",
  "amendmentNote":      "…",
  "valueAddedServices": "…",
  "packageIncludes":    "…",
  "packageExcludes":    "…",
  "importantNotes":     "…",
  "tips":               "…",
  "otherNote":          "…",
  "clientRequest":      "…",

  // ── Contact details (agent side) ────────────────────────────────
  "agentEmail":     "agent@example.com",
  "agentPhone":     "+94112233445",
  "agentWhatsapp":  "+94112233445",
  "agentCountry":   "Sri Lanka",

  // ── Contact details (traveller side) ────────────────────────────
  "contactEmail":    "lead@example.com",
  "contactPhone":    "+441234567890",
  "contactWhatsapp": "+441234567890",
  "contactCountry":  "United Kingdom",

  // ── Child collections (each entry created with the booking) ─────
  "passengers":        [ /* see below */ ],
  "flights":           [ /* see below */ ],
  "accommodations":    [ /* see below */ ],
  "itineraryItems":    [ /* see below */ ],
  "emergencyContacts": [ /* see below */ ]
}
```

### Child collection shapes

```jsonc
// passengers[]
{
  "name":           "John Smith",     // required
  "type":           "ADULT",          // "ADULT" (default) | "CHILD" | "INFANT"
  "age":            34,               // number or null
  "isLead":         true,             // boolean
  "passport":       "N1234567",
  "nationality":    "British",
  "contact":        "+441234567890",
  "mealPreference": "Vegetarian"
}

// flights[]
{
  "flightNo": "UL504",                // required
  "date":     "2025-12-30",           // ISO date
  "fromApt":  "LHR",
  "depTime":  "21:15",
  "toApt":    "CMB",
  "arrTime":  "11:45",
  "airline":  "SriLankan Airlines"
}

// accommodations[]
{
  "city":     "Kandy",                // required
  "hotel":    "Earl's Regency",       // required (rows without a hotel are dropped client-side)
  "checkIn":  "2025-12-31",           // ISO date
  "checkOut": "2026-01-02",           // ISO date
  "address":  "Tennekumbura, Kandy",
  "contact":  "+94812000000",
  "nights":   2,                      // number
  "roomType": "Deluxe Double",
  "mealType": "Half Board"
}

// itineraryItems[]
{
  "dayNo":       1,                   // number
  "date":        "2025-12-30",        // ISO date
  "title":       "Airport pickup & transfer to Kandy",  // required, max 1000 chars
  "description": "Private A/C vehicle, English-speaking driver",
  "inclusions":  ["Water bottles", "Tolls"],   // stored as JSON string
  "exclusions":  ["Lunch"]                      // stored as JSON string
}

// emergencyContacts[]
{
  "name":  "Local Ops Desk",          // required
  "phone": "+94770000000",
  "role":  "24/7 Emergency"
}
```

> Notes
> - The New Booking page filters empty rows before submitting: passengers without a
>   `name`, flights without a `flightNo`, accommodations without a `hotel`,
>   itinerary items without a `title`, and emergency contacts without a `name` are
>   dropped.
> - `cancellationDeadline` is derived server-side from `arrivalDate`.
> - `createdById` is taken from the session — never send it.

### Success response

```jsonc
{
  "success": true,
  "data": {
    "id": "clx…",
    "bookingRef": "IS123456",
    "operationCountry": "SRILANKA",
    "passengers": [ … ],
    "flights": [ … ],
    "accommodations": [ … ],
    "itineraryItems": [ … ],
    "emergencyContacts": [ … ]
    // …full booking record
  }
}
```

---

## 2. Create / Save P&L

### Endpoint

```
POST /api/bookings/{bookingRef}/pnl
Content-Type: application/json
```

Upserts the P&L for a booking: if a P&L already exists, its line items are
**replaced** (old lines deleted, un-activated auto-tickets unlinked) and the core
pax data updated. Otherwise a new P&L is created.

P&L line totals are **always computed**, never stored. Formula:

```
lineTotal = (sicRate + pvtRatePP + otherRate) × (adults + children)
          + (adEntrance × adults)
          + (chEntrance × children)
```

### Request Body — Structure

```jsonc
{
  "paxAdults":   2,          // optional — defaults to the booking's paxAdults
  "paxChildren": 1,          // optional — defaults to the booking's paxChildren
  "isPnlData":   { … },      // optional raw source blob (any JSON) or null
  "lineItems": [
    {
      "activity":   "Sigiriya Rock Fortress entrance",  // required
      "category":   "TICKETS",   // see category enum below (default "OTHER")
      "mmtRate":    0,           // number (net/cost rate)
      "sicRate":    25,          // per-pax seat-in-coach rate
      "pvtRatePP":  0,           // per-pax private rate
      "adEntrance": 30,          // adult entrance fee (× adults)
      "chEntrance": 15,          // child entrance fee (× children)
      "otherRate":  0,           // per-pax other rate
      "notes":      "Includes museum"
    }
  ]
}
```

### Category enum (`PNLCategory`)

```
HOTEL | TICKETS | GUIDES | MEALS | CRUISE | WATER | TRANSPORT | TAX_FEES | FLIGHT_TICKETS | OTHER
```

**Ticketable categories** auto-generate an inactive DRAFT ticket per line
(Ground Team must activate before purchase):

| Category         | Ticket label     |
|------------------|------------------|
| `HOTEL`          | Hotel Voucher    |
| `TRANSPORT`      | Transfer Voucher |
| `TICKETS`        | Entrance Ticket  |
| `GUIDES`         | Guide Service    |
| `CRUISE`         | Cruise Ticket    |
| `WATER`          | Water Activity   |
| `FLIGHT_TICKETS` | Flight Ticket    |
| `OTHER`          | Service          |

(`MEALS` and `TAX_FEES` are **not** ticketable.)

### Success response

```jsonc
{
  "success": true,
  "message": "P&L saved",
  "data": {
    "id": "…",
    "paxAdults": 2,
    "paxChildren": 1,
    "lineItems": [ { "…": "…", "lineTotal": 145 } ],
    "grandTotal": 000.00   // computed
  }
}
```

---

## 3. Full Sample — with real-looking data

### 3.1 Create Booking payload

```json
{
  "bookingRef": "IS250731",
  "agentBookingId": "NL43634688213",
  "cntlNumber": "878654376946CNTL",
  "operationCountry": "SRILANKA",
  "agent": "Global Travel Partners",
  "fileHandler": "Sasindu",
  "arrivalDate": "2025-12-30",
  "departureDate": "2026-01-05",
  "paxAdults": 2,
  "paxChildren": 1,
  "InfantChildren": 1,
  "quotedTotal": 1850.00,
  "currency": "USD",
  "packageIncludes": "Accommodation on HB basis, private A/C transport, English-speaking chauffeur guide, all entrance tickets listed.",
  "packageExcludes": "International airfare, personal expenses, tips, early check-in.",
  "importantNotes": "Standard check-in 14:00, check-out 12:00. Peak season surcharge applies 24 Dec–02 Jan.",
  "clientRequest": "One vegetarian traveller. Requesting connecting rooms in Kandy.",
  "agentEmail": "ops@globaltravel.example.com",
  "agentPhone": "+94112233445",
  "agentWhatsapp": "+94112233445",
  "agentCountry": "Sri Lanka",
  "contactEmail": "j.smith@example.co.uk",
  "contactPhone": "+441234567890",
  "contactWhatsapp": "+441234567890",
  "contactCountry": "United Kingdom",
  "passengers": [
    {
      "name": "John Smith",
      "type": "ADULT",
      "age": 41,
      "isLead": true,
      "passport": "N1234567",
      "nationality": "British",
      "contact": "+441234567890",
      "mealPreference": "Non-Veg"
    },
    {
      "name": "Emma Smith",
      "type": "Infant",
      "age": 39,
      "isLead": false,
      "passport": "N7654321",
      "nationality": "British",
      "mealPreference": "Vegetarian"
    },
    {
      "name": "Lily Smith",
      "type": "CHILD",
      "age": 8,
      "isLead": false,
      "nationality": "British"
    }
  ],
  "flights": [
    {
      "flightNo": "UL504",
      "date": "2025-12-30",
      "fromApt": "LHR",
      "depTime": "21:15",
      "toApt": "CMB",
      "arrTime": "11:45",
      "airline": "SriLankan Airlines"
    },
    {
      "flightNo": "UL503",
      "date": "2026-01-05",
      "fromApt": "CMB",
      "depTime": "09:30",
      "toApt": "LHR",
      "arrTime": "15:20",
      "airline": "SriLankan Airlines"
    }
  ],
  "accommodations": [
    {
      "city": "Negombo",
      "hotel": "Jetwing Blue",
      "checkIn": "2025-12-30",
      "checkOut": "2025-12-31",
      "address": "Ethukala, Negombo",
      "contact": "+94312279000",
      "nights": 1,
      "roomType": "Deluxe Sea View",
      "mealType": "Half Board"
    },
    {
      "city": "Kandy",
      "hotel": "Earl's Regency",
      "checkIn": "2025-12-31",
      "checkOut": "2026-01-02",
      "address": "Tennekumbura, Kandy",
      "contact": "+94812000000",
      "nights": 2,
      "roomType": "Deluxe Double",
      "mealType": "Half Board"
    },
    {
      "city": "Colombo",
      "hotel": "Cinnamon Grand",
      "checkIn": "2026-01-02",
      "checkOut": "2026-01-05",
      "address": "77 Galle Rd, Colombo 03",
      "contact": "+94112437437",
      "nights": 3,
      "roomType": "Superior Room",
      "mealType": "Bed & Breakfast"
    }
  ],
  "itineraryItems": [
    {
      "dayNo": 1,
      "date": "2025-12-30",
      "title": "Airport pickup & transfer to Negombo",
      "description": "Meet & greet at CMB, transfer to Jetwing Blue.",
      "inclusions": ["Bottled water", "Garlands"],
      "exclusions": ["Lunch"]
    },
    {
      "dayNo": 2,
      "date": "2025-12-31",
      "title": "Transfer to Kandy via Pinnawala",
      "description": "Visit Pinnawala Elephant Orphanage en route.",
      "inclusions": ["Entrance tickets", "Water bottles"],
      "exclusions": ["Elephant bathing fee"]
    },
    {
      "dayNo": 3,
      "date": "2026-01-01",
      "title": "Kandy city tour & Temple of the Tooth",
      "description": "Cultural show in the evening.",
      "inclusions": ["Guide", "Entrance tickets"],
      "exclusions": ["Dinner"]
    }
  ],
  "emergencyContacts": [
    {
      "name": "AppleHolidays Ops Desk",
      "phone": "+94770000000",
      "role": "24/7 Emergency"
    },
    {
      "name": "Chauffeur — Nimal",
      "phone": "+94771111111",
      "role": "Assigned Driver"
    }
  ]
}
```

### 3.2 Create P&L payload (for `POST /api/bookings/IS250731/pnl`)

```json
{
  "paxAdults": 2,
  "paxChildren": 1,
  "lineItems": [
    {
      "activity": "Jetwing Blue — 1 night HB (Deluxe Sea View)",
      "category": "HOTEL",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 90,
      "notes": "Double + child sharing"
    },
    {
      "activity": "Earl's Regency — 2 nights HB (Deluxe Double)",
      "category": "HOTEL",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 220,
      "notes": "2 nights"
    },
    {
      "activity": "Private A/C transport (6 days) + chauffeur guide",
      "category": "TRANSPORT",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 150,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 0,
      "notes": "Full itinerary, incl. fuel & driver allowance"
    },
    {
      "activity": "Pinnawala Elephant Orphanage entrance",
      "category": "TICKETS",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 15,
      "chEntrance": 8,
      "otherRate": 0,
      "notes": "Adult + child rates differ"
    },
    {
      "activity": "Temple of the Tooth entrance + cultural show",
      "category": "TICKETS",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 12,
      "chEntrance": 6,
      "otherRate": 0,
      "notes": ""
    },
    {
      "activity": "Government tax & service charges",
      "category": "TAX_FEES",
      "mmtRate": 0,
      "sicRate": 0,
      "pvtRatePP": 8,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 0,
      "notes": "Per pax"
    }
  ]
}
```

**Worked total for the Pinnawala line** (adults = 2, children = 1):

```
(sicRate 0 + pvtRatePP 0 + otherRate 0) × (2 + 1)
  + (adEntrance 15 × 2 adults)   = 30
  + (chEntrance 8  × 1 child)    = 8
= 38.00
```
