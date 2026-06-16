# Apple Holidays — Booking System API Documentation

**Live System:** `https://holidays-booking.aahaas.com`  
**Example Booking:** `https://holidays-booking.aahaas.com/dashboard/bookings/VN19662`  
**API Base URL:** `https://holidays-booking.aahaas.com/api`

> All API endpoints require an authenticated session cookie (`next-auth.session-token`).  
> For server-to-server calls use the `Authorization: Bearer <CRON_SECRET>` header on cron routes,  
> or pass the session cookie from your browser for manual testing.

---

## Authentication

All endpoints validate the logged-in session via NextAuth.  
Roles that can call booking APIs:

| Role | Access |
|------|--------|
| `SUPER_ADMIN` | Full read + write |
| `BT_USER` | Full read + write |
| `GT_USER` | Read only (selected endpoints) |
| `CLIENT` | Read own booking only (client portal) |

---

## Full Booking API — `/api/bookings/full/[ref]`

This is the single comprehensive endpoint to **get, create, or update** an entire booking
including all nested data: passengers, flights, hotels, agenda, driver allocations, P&L, tickets.

### Supported Ref Formats

| Input | Matches booking |
|-------|----------------|
| `464660` | exact `464660` |
| `464660CNTL` | strips CNTL → finds `464660` |
| `VN19662` | finds `VN19662` |

---

## GET — Retrieve Complete Booking

```
GET /api/bookings/full/{tourRef}
```

**Example:**
```bash
curl -s \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  | jq .
```

### Response Structure

```json
{
  "success": true,
  "data": {

    "id":             "cuid...",
    "bookingRef":     "VN19662",
    "agentBookingId": "402011138462",
    "agent":          "MakeMyTrip",
    "fileHandler":    "Yogi",
    "status":         "OPERATIONS_READY",
    "version":        1,

    "arrivalDate":    "2026-10-15T00:00:00.000Z",
    "departureDate":  "2026-10-22T00:00:00.000Z",
    "paxAdults":      2,
    "paxChildren":    0,
    "quotedTotal":    1850.00,
    "currency":       "USD",

    "agentContact": {
      "email":    "bookings@makemytrip.com",
      "phone":    "+91 9876543210",
      "whatsapp": "+91 9876543210",
      "country":  "India",
      "address":  null
    },

    "clientContact": {
      "email":    "tourist@email.com",
      "phone":    "+91 9876543210",
      "whatsapp": "+91 9876543210",
      "country":  "India",
      "address":  null
    },

    "passengers": [
      { "id": "...", "name": "John Smith", "type": "ADULT", "isLead": true, "passport": null }
    ],

    "emergencyContacts": [
      { "id": "...", "name": "Local Guide", "phone": "+84 90 123 4567", "role": "Guide" }
    ],

    "flights": [
      {
        "id":       "...",
        "flightNo": "VN234",
        "date":     "2026-10-15T00:00:00.000Z",
        "fromApt":  "DAD",
        "depTime":  "08:00",
        "toApt":    "HAN",
        "arrTime":  "09:10",
        "airline":  "Vietnam Airlines",
        "notes":    null
      }
    ],

    "accommodations": [
      {
        "id":       "...",
        "hotel":    "Menora Grand Danang",
        "city":     "Danang",
        "checkIn":  "2026-10-15T00:00:00.000Z",
        "checkOut": "2026-10-17T00:00:00.000Z",
        "nights":   2,
        "roomType": "Superior",
        "mealType": "BB",
        "address":  null,
        "contact":  null
      }
    ],

    "agenda": {
      "id":        "...",
      "createdAt": "2026-06-15T11:00:00.000Z",
      "updatedAt": "2026-06-15T11:00:00.000Z",
      "items": [
        {
          "id":          "...",
          "date":        "2026-10-15T00:00:00.000Z",
          "location":    "Danang",
          "fromPoint":   "DAD",
          "toPoint":     "Menora Grand Danang",
          "details":     "Private transfer from Da Nang Airport to hotel.",
          "mealPlan":    null,
          "meetingTime": "09:50",
          "serviceType": "PVT_TRANSFER",
          "sortOrder":   0,

          "driverAllocation": {
            "id":           "...",
            "driverId":     "driver-cuid",
            "driverName":   "sasindi diluranga",
            "driverPhone":  "+83223212121",
            "vehicleType":  "van",
            "vehiclePlate": "764-3384",
            "notes":        null,
            "assignedAt":   "2026-06-15T12:00:00.000Z",
            "driver": {
              "id":        "driver-cuid",
              "name":      "sasindi diluranga",
              "phone":     "+83223212121",
              "email":     null,
              "licenseNo": null,
              "vehicle": {
                "id":       "...",
                "type":     "van",
                "plateNo":  "764-3384",
                "brand":    "Toyota",
                "model":    "Hiace",
                "capacity": 10
              }
            }
          },

          "tickets": []
        }
      ]
    },

    "pnl": {
      "id":          "...",
      "paxAdults":   2,
      "paxChildren": 0,
      "lockedAt":    null,
      "lineItems": [
        {
          "id":           "...",
          "activity":     "Menora Grand Danang 2N BB",
          "category":     "HOTEL",
          "mmtRate":      320.00,
          "sicRate":      0.00,
          "pvtRatePP":    0.00,
          "adEntrance":   0.00,
          "chEntrance":   0.00,
          "otherRate":    0.00,
          "paymentStatus": "PENDING",
          "notes":        null,
          "sortOrder":    0
        }
      ],
      "totals": {
        "mmtRate":   1200.00,
        "sicRate":   0.00,
        "pvtRatePP": 0.00
      }
    },

    "payments": [
      {
        "id":        "...",
        "type":      "customer_payment",
        "label":     "Deposit",
        "amount":    925.00,
        "currency":  "USD",
        "method":    "bank_transfer",
        "status":    "CONFIRMED",
        "reference": "INV-001",
        "dueDate":   null,
        "paidAt":    "2026-06-10T00:00:00.000Z"
      }
    ],

    "tickets": [],

    "statusHistory": [
      {
        "id":    "...",
        "from":  "GT_REVIEW",
        "to":    "OPERATIONS_READY",
        "actor": { "id": "...", "name": "Admin", "role": "SUPER_ADMIN" },
        "note":  null,
        "at":    "2026-06-15T10:00:00.000Z"
      }
    ],

    "createdBy":  { "id": "...", "name": "Admin", "email": "admin@aahaas.com", "role": "SUPER_ADMIN" },
    "createdAt":  "2026-06-14T08:00:00.000Z",
    "updatedAt":  "2026-06-15T12:00:00.000Z"
  }
}
```

---

## POST — Create New Booking

```
POST /api/bookings/full/{tourRef}
```

`arrivalDate` and `departureDate` are required. All nested arrays are optional.

**Example:**
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/464660" \
  -d '{
    "bookingRef":    "464660",
    "agent":         "MakeMyTrip",
    "fileHandler":   "Yogi",
    "arrivalDate":   "2026-10-15",
    "departureDate": "2026-10-22",
    "paxAdults":     2,
    "paxChildren":   0,
    "quotedTotal":   1850,
    "currency":      "USD",

    "agentEmail":    "bookings@makemytrip.com",
    "agentPhone":    "+91 9876543210",
    "contactPhone":  "+91 9876543210",
    "contactEmail":  "tourist@email.com",

    "passengers": [
      { "name": "John Smith",  "type": "ADULT", "isLead": true  },
      { "name": "Jane Smith",  "type": "ADULT", "isLead": false }
    ],

    "emergencyContacts": [
      { "name": "Local Guide", "phone": "+84 90 123 4567", "role": "Guide" }
    ],

    "flights": [
      {
        "flightNo": "VN234",
        "date":     "2026-10-15",
        "fromApt":  "DAD",
        "depTime":  "08:00",
        "toApt":    "HAN",
        "arrTime":  "09:10",
        "airline":  "Vietnam Airlines"
      }
    ],

    "accommodations": [
      {
        "hotel":    "Menora Grand Danang",
        "city":     "Danang",
        "checkIn":  "2026-10-15",
        "checkOut": "2026-10-17",
        "nights":   2,
        "roomType": "Superior",
        "mealType": "BB"
      }
    ],

    "agendaItems": [
      {
        "date":        "2026-10-15",
        "location":    "Danang",
        "fromPoint":   "DAD",
        "toPoint":     "Menora Grand Danang",
        "details":     "Private transfer from Da Nang Airport to hotel.",
        "meetingTime": "09:50",
        "serviceType": "PVT_TRANSFER"
      }
    ],

    "pnlLines": [
      {
        "activity":  "Menora Grand Danang 2N BB",
        "category":  "HOTEL",
        "mmtRate":   320.00
      }
    ]
  }'
```

---

## PUT — Update Booking (Partial or Full)

```
PUT /api/bookings/full/{tourRef}
```

Send **only the sections you want to update**. Array sections (passengers, flights,
accommodations, agendaItems) perform a **full replace** of that section when included.

### Update Core Fields Only

```bash
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  -d '{
    "paxAdults":   3,
    "quotedTotal": 2200,
    "fileHandler": "Rohan"
  }'
```

### Replace All Flights

```bash
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  -d '{
    "flights": [
      {
        "flightNo": "VN234",
        "date":     "2026-10-15",
        "fromApt":  "DAD",
        "depTime":  "08:00",
        "toApt":    "HAN",
        "arrTime":  "09:10",
        "airline":  "Vietnam Airlines"
      },
      {
        "flightNo": "VN007",
        "date":     "2026-10-22",
        "fromApt":  "SGN",
        "depTime":  "14:00",
        "toApt":    "BOM",
        "arrTime":  "17:30",
        "airline":  "Vietnam Airlines"
      }
    ]
  }'
```

### Replace Entire Agenda (Movement Chart)

```bash
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  -d '{
    "agendaItems": [
      {
        "date":        "2026-10-15",
        "location":    "Danang",
        "fromPoint":   "DAD",
        "toPoint":     "Menora Grand Danang",
        "details":     "Private transfer from Da Nang Airport to hotel.",
        "meetingTime": "09:50",
        "serviceType": "PVT_TRANSFER"
      },
      {
        "date":        "2026-10-16",
        "location":    "Danang",
        "fromPoint":   "Menora Grand Danang",
        "toPoint":     "Bà Nà Hills",
        "details":     "SIC pickup 07:30 from hotel lobby for Bà Nà Hills tour.",
        "meetingTime": "07:30",
        "serviceType": "SIC_TRANSFER"
      }
    ]
  }'
```

### Assign / Re-assign a Driver to an Agenda Item

```bash
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  -d '{
    "assignDriver": {
      "agendaItemId": "<agendaItemId from GET response>",
      "driverId":     "<driverId from drivers list>",
      "vehiclePlate": "764-3384",
      "notes":        "Van — confirmed"
    }
  }'
```

> **Tip:** Use `GET /api/bookings/full/VN19662` first to get the `agendaItemId` values.  
> Use `GET /api/drivers` to get available `driverId` values.

### Replace Accommodations

```bash
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662" \
  -d '{
    "accommodations": [
      {
        "hotel":    "Menora Grand Danang",
        "city":     "Danang",
        "checkIn":  "2026-10-15",
        "checkOut": "2026-10-18",
        "nights":   3,
        "roomType": "Deluxe",
        "mealType": "BB"
      },
      {
        "hotel":    "Silk Path Grand Hanoi",
        "city":     "Hanoi",
        "checkIn":  "2026-10-18",
        "checkOut": "2026-10-20",
        "nights":   2,
        "roomType": "Superior",
        "mealType": "BB"
      }
    ]
  }'
```

---

## Other Existing Booking API Endpoints

These are existing routes at `/api/bookings/[ref]/...`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bookings/[ref]` | Standard booking data (same as full but less nested detail) |
| `GET` | `/api/bookings/[ref]/agenda` | Movement chart / agenda only |
| `GET` | `/api/bookings/[ref]/pnl` | P&L line items only |
| `POST` | `/api/bookings/[ref]/confirm` | Confirm booking (BT_CONFIRMED status) |
| `POST` | `/api/bookings/[ref]/verify` | GT verify booking |
| `POST` | `/api/bookings/[ref]/complete` | Mark booking completed |
| `POST` | `/api/bookings/[ref]/cancel` | Cancel booking |
| `POST` | `/api/bookings/[ref]/in-progress` | Mark as in-progress |
| `POST` | `/api/bookings/[ref]/submit-ground` | Submit to ground team |
| `POST` | `/api/bookings/[ref]/recheck` | Trigger recheck |
| `POST` | `/api/bookings/[ref]/qc-send` | Send QC confirmation email |
| `GET/POST` | `/api/bookings/[ref]/whatsapp` | WhatsApp message history |

---

## Mail Processing API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/mail/process` | Process a TQ or PNL email body → create/update booking |
| `GET` | `/api/mail/fetch` | Fetch emails from DB cache |
| `POST` | `/api/mail/check-processed` | Check which graphIds are already processed |
| `GET` | `/api/mail/subscribe` | Webhook subscription status |
| `GET/POST` | `/api/mail/settings` | Less-credit mode toggle |
| `GET` | `/api/cron/process-mailboxes` | Trigger mailbox cron (requires `Authorization: Bearer <CRON_SECRET>`) |

### Process a Tour Confirmation Email

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/mail/process" \
  -d '{
    "emailType":   "TOUR_CONFIRMATION",
    "rawBody":     "Tour Ref: 464660\nAgent: MakeMyTrip\nArrival: 15 Oct 2026\nDeparture: 22 Oct 2026\n...",
    "subject":     "Tour Confirmation 464660",
    "graphId":     "AAMkAB...",
    "mailboxUser": "confirm.booking@aahaas.com"
  }'
```

### Process a PNL Email

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your-token>" \
  "https://holidays-booking.aahaas.com/api/mail/process" \
  -d '{
    "emailType":   "PNL",
    "rawBody":     "Tour No= #464660\nHotel Danang 2N - $320\nTransport - $150\n...",
    "subject":     "PNL:#464660",
    "graphId":     "AAMkAC...",
    "mailboxUser": "accounts.payable@aahaas.com"
  }'
```

---

## Booking Status Flow

```
DRAFT
  └─► GT_REVIEW          (auto on email import)
        └─► BT_CONFIRMED     (BT user confirms)
              └─► GT_VERIFIED     (GT user verifies)
                    └─► AWAITING_PAYMENT_CONFIRM
                          └─► OPERATIONS_READY
                                └─► CLIENT_LIVE
                                      └─► IN_PROGRESS
                                            └─► COMPLETED
                                                  └─► (CANCELLED at any stage)
```

---

## Booking Ref Rules

| Rule | Detail |
|------|--------|
| Source | Only created from **Tour Ref** on TQ emails |
| Format | Numeric only — `464660` (CNTL suffix stripped automatically) |
| IS Numbers | Rejected — `IS48369` will NOT create a booking |
| VN Numbers | Stored as-is — `VN19662` is a valid ref |
| PNL linking | PNL uses Tour No (numeric) to match the TQ booking |

---

## Database Tables Reference

| Table | Prisma Model | Key Fields |
|-------|-------------|------------|
| `bookings` | `Booking` | bookingRef, agent, status, arrivalDate, departureDate |
| `passengers` | `Passenger` | name, type (ADULT/CHILD), isLead, passport |
| `emergency_contacts` | `EmergencyContact` | name, phone, role |
| `flights` | `Flight` | flightNo, date, fromApt, toApt, depTime, arrTime |
| `accommodations` | `Accommodation` | hotel, city, checkIn, checkOut, nights, mealType |
| `itinerary_items` | `ItineraryItem` | dayNo, date, title, description |
| `tour_agendas` | `TourAgenda` | bookingId (1:1 with booking) |
| `agenda_items` | `AgendaItem` | date, location, serviceType, meetingTime |
| `assignments` | `Assignment` | agendaItemId, driverId, vehiclePlate (driver allocation) |
| `drivers` | `Driver` | name, phone, vehicleId, advanceBalance |
| `vehicles` | `Vehicle` | type, plateNo, brand, model, capacity |
| `pnl` | `PNL` | bookingId, paxAdults, paxChildren |
| `pnl_line_items` | `PNLLineItem` | activity, category, mmtRate, sicRate, pvtRatePP |
| `payments` | `Payment` | type, amount, status, paidAt |
| `tickets` | `Ticket` | type, qty, status, activated, costPerUnit |
| `mail_messages` | `MailMessage` | graphId, mailboxKind, bookingRef, status, rawBody |
| `system_settings` | `SystemSetting` | key/value store (webhook subs, processed dedup) |

---

## Live URL Examples

```
# Dashboard
https://holidays-booking.aahaas.com/dashboard/bookings/VN19662

# API — Get full booking
https://holidays-booking.aahaas.com/api/bookings/full/VN19662

# API — Get standard booking
https://holidays-booking.aahaas.com/api/bookings/VN19662

# API — Get agenda only
https://holidays-booking.aahaas.com/api/bookings/VN19662/agenda

# API — Get P&L only
https://holidays-booking.aahaas.com/api/bookings/VN19662/pnl
```

---

*Generated: 2026-06-16 | System: Apple Holidays Booking Platform*
