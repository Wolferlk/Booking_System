# AppleHolidays — P&L API Documentation

**Base URL (Dev):** `https://holidays-booking-dev.aahaas.com`  
**Base URL (Local):** `http://localhost:3000`

---

## Authentication

Most endpoints require a valid session cookie (logged-in user).  
The endpoint marked **PUBLIC** requires no authentication.

**Role permissions required:**

| Permission | Roles |
|---|---|
| `pnl:read` | AC_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| `pnl:create` | AC_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| `pnl:confirm_payment` | AC_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |

---

## Response Format

All endpoints return:

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": "message", "status": 400 }
```

---

## Endpoints

---

### 1. GET /api/pnl-by-isnumber/[isNumber]

**PUBLIC — No authentication required.**

Fetch full P&L data for a booking using its IS Number (VN / IS / SG / MY prefix).

#### Request

```
GET /api/pnl-by-isnumber/VN11467
GET /api/pnl-by-isnumber/IS48375
GET /api/pnl-by-isnumber/SG22232
GET /api/pnl-by-isnumber/MY10045
```

No headers or body required.

#### Example

```bash
curl https://holidays-booking-dev.aahaas.com/api/pnl-by-isnumber/VN11467
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingRef":       "VN11467",
      "isNumber":         "VN11467",
      "cntlNumber":       "463720CNTL",
      "agent":            "Make My Trip",
      "arrivalDate":      "2025-01-04T00:00:00.000Z",
      "departureDate":    "2025-01-10T00:00:00.000Z",
      "paxAdults":        2,
      "paxChildren":      0,
      "operationCountry": "VIETNAM",
      "status":           "GT_REVIEW"
    },
    "pnl": {
      "id":           "cmqvzx3pd001l67ec7amu74zg",
      "bookingId":    "cmqvzu9cp000267eczhh7cctz",
      "paxAdults":    2,
      "paxChildren":  0,
      "totalRevenue": 551.17,
      "totalCost":    342.86,
      "profit":       208.31,
      "margin":       37.79,
      "isNumber":     "VN11467",
      "cntlNumber":   "463720CNTL",
      "bookingAgent": "Make My Trip",
      "sourceDocUrl": null,
      "lockedAt":     null,
      "createdAt":    "2026-06-27T06:45:33.313Z",
      "updatedAt":    "2026-06-27T06:45:45.317Z",
      "lineItems": [
        {
          "id":                  "cmqvzxdhy003567ecfnukcy1q",
          "pnlId":               "cmqvzx3pd001l67ec7amu74zg",
          "activity":            "Diamond Legend",
          "category":            "HOTEL",
          "mmtRate":             "57.16",
          "sicRate":             "0",
          "pvtRatePP":           "0",
          "adEntrance":          "0",
          "chEntrance":          "0",
          "otherRate":           "0",
          "totalCost":           0,
          "paymentStatus":       "PENDING",
          "paymentRefNumber":    null,
          "paymentBillUrl":      null,
          "paymentBillName":     null,
          "paymentConfirmedAt":  null,
          "paymentConfirmedBy":  null,
          "sortOrder":           0,
          "notes":               null
        }
      ]
    }
  }
}
```

#### Error Responses

| Status | Reason |
|---|---|
| `400` | IS number not provided |
| `404` | No booking found with that IS number |
| `404` | Booking exists but has no P&L record yet |

---

### 2. GET /api/bookings/[ref]/pnl

Fetch P&L for a booking using its internal booking reference.

**Auth required:** Session + `pnl:read` permission

#### Request

```
GET /api/bookings/VN11467/pnl
```

#### Example

```bash
curl https://holidays-booking-dev.aahaas.com/api/bookings/VN11467/pnl \
  -H "Cookie: next-auth.session-token=<token>"
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "id":           "...",
    "bookingId":    "...",
    "paxAdults":    2,
    "paxChildren":  0,
    "totalRevenue": 551.17,
    "totalCost":    342.86,
    "profit":       208.31,
    "margin":       37.79,
    "bookingAgent": "Make My Trip",
    "isNumber":     "VN11467",
    "cntlNumber":   "463720CNTL",
    "sourceDocUrl": null,
    "lockedAt":     null,
    "lineItems":    [ ... ]
  }
}
```

> Returns `null` data (not a 404) if the booking exists but has no P&L yet.

---

### 3. POST /api/bookings/[ref]/pnl

Create or replace all P&L line items for a booking.  
Existing lines are deleted and recreated. Also auto-generates inactive tickets for ticketable categories.

**Auth required:** Session + `pnl:create` permission

#### Request Body

```json
{
  "paxAdults":   2,
  "paxChildren": 0,
  "lineItems": [
    {
      "activity":   "Diamond Legend Hotel",
      "category":   "HOTEL",
      "mmtRate":    57.16,
      "sicRate":    0,
      "pvtRatePP":  0,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate":  0,
      "notes":      "3 nights"
    }
  ]
}
```

#### Category Values

| Value | Description |
|---|---|
| `HOTEL` | Hotel / Accommodation |
| `TRANSPORT` | Transfers / Vehicles |
| `GUIDES` | Guide Services / Tours |
| `CRUISE` | Cruise / Boat |
| `FLIGHT_TICKETS` | Internal Flights |
| `TICKETS` | Entrance Tickets |
| `WATER` | Water Activities |
| `SIM_CARD` | SIM Card |
| `INSURANCE` | Travel Insurance |
| `VISA` | Visa Fees |
| `OTHER` | Miscellaneous |

#### Cost Formula

```
totalCost = (sicRate + pvtRatePP + otherRate) × (paxAdults + paxChildren)
           + (adEntrance × paxAdults)
           + (chEntrance × paxChildren)
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "totalRevenue": 551.17,
    "totalCost":    342.86,
    "profit":       208.31,
    "margin":       37.79,
    "lineItems":    [ ... ]
  },
  "message": "P&L saved"
}
```

---

### 4. POST /api/pnl-lines/[id]/confirm

Confirm or reject a single P&L line item payment.  
When all lines on a booking are confirmed, the booking automatically advances to `OPERATIONS_READY`.

**Auth required:** Session + `pnl:confirm_payment` permission

#### URL Parameter

`id` — the `PNLLineItem.id` (from lineItems array in GET responses above)

#### Request Body — Confirm

```json
{
  "action":    "CONFIRMED",
  "refNumber": "TXN-REF-2025-001",
  "billUrl":   "/uploads/bills/bill-abc123.pdf",
  "billName":  "Hotel Invoice Jan 2025.pdf"
}
```

#### Request Body — Reject

```json
{
  "action": "REJECTED"
}
```

> `refNumber` is **required** when action is `CONFIRMED`.

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "id":                 "cmqvzxdhy003567ecfnukcy1q",
    "paymentStatus":      "CONFIRMED",
    "paymentRefNumber":   "TXN-REF-2025-001",
    "paymentConfirmedAt": "2026-06-27T07:00:00.000Z",
    "paymentConfirmedBy": "user-id-here"
  },
  "message": "Payment confirmed"
}
```

---

### 5. POST /api/pnl-lines/[id]/upload-bill

Upload a payment bill PDF or image for a P&L line item.

**Auth required:** Session + role `AC_USER`, `SUPER_ADMIN`, or `ULTRA_SUPER_ADMIN`

#### Request

`multipart/form-data` with field `file`.

Allowed types: `PDF`, `JPG`, `PNG`, `WebP` — max **10 MB**.

```bash
curl -X POST https://holidays-booking-dev.aahaas.com/api/pnl-lines/LINE_ID/upload-bill \
  -H "Cookie: next-auth.session-token=<token>" \
  -F "file=@invoice.pdf"
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "fileUrl":  "/uploads/bills/bill-LINE_ID-1719468000000.pdf",
    "fileName": "invoice.pdf"
  }
}
```

> Use the returned `fileUrl` as the `billUrl` value in the confirm endpoint above.

---

### 6. GET /api/accounts/pnl-overview

Returns a three-way split of external P&L records vs internal bookings.

**Auth required:** Session + role `AC_USER`, `SUPER_ADMIN`, or `ULTRA_SUPER_ADMIN`

#### Query Parameters

| Param | Default | Max | Description |
|---|---|---|---|
| `limit` | `300` | `500` | Max external PNL records to return |
| `search` | — | — | Filter by IS number, tour ref, invoice, vendor, or agent name |

#### Request

```
GET /api/accounts/pnl-overview?limit=100&search=VN114
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalExtPnl":  150,
      "linked":       120,
      "pnlOnly":      20,
      "bookingsOnly": 10
    },
    "linked":       [ ... ],
    "pnlOnly":      [ ... ],
    "bookingsOnly": [ ... ]
  }
}
```

| Field | Description |
|---|---|
| `linked` | External P&L records matched to a booking |
| `pnlOnly` | External P&L records with no matching booking |
| `bookingsOnly` | Bookings with no external P&L link |

---

## P&L Totals — How They Are Calculated

| Field | Formula |
|---|---|
| `totalRevenue` | Sum of all `mmtRate` values across line items |
| `totalCost` | Sum of all computed `totalCost` per line (see formula above) |
| `profit` | `totalRevenue − totalCost` |
| `margin` | `(profit / totalRevenue) × 100` (percentage) |

---

## Booking Status After P&L Confirmation

When all P&L line payments are confirmed on a booking in `AWAITING_PAYMENT_CONFIRM` status, the system automatically transitions it to `OPERATIONS_READY`.

---

## IS Number Prefixes

| Prefix | Country |
|---|---|
| `VN` | Vietnam |
| `IS` | Sri Lanka |
| `SG` | Singapore |
| `MY` | Malaysia |

---

## Quick Reference

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/pnl-by-isnumber/[isNumber]` | **None** | Get full PNL by IS number |
| `GET` | `/api/bookings/[ref]/pnl` | Session | Get PNL by booking ref |
| `POST` | `/api/bookings/[ref]/pnl` | Session | Create / replace all PNL lines |
| `POST` | `/api/pnl-lines/[id]/confirm` | Session | Confirm or reject a line payment |
| `POST` | `/api/pnl-lines/[id]/upload-bill` | Session | Upload payment bill file |
| `GET` | `/api/accounts/pnl-overview` | Session | Accounts PNL reconciliation view |
