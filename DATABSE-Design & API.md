# Apple Holidays Booking System

This document describes the full database structure, how the tables link together, and the public booking detail API for the system.

The booking record is the root of the whole model. Every operational, financial, communication, and audit record hangs off `Booking`.

---

## 1. Core Design Rules

1. `Booking` is the parent table for almost everything.
2. Child tables always reference the parent using a foreign key such as `bookingId`.
3. One booking can have many passengers, flights, accommodations, itinerary items, agenda items, payments, tickets, change requests, status events, version snapshots, contact logs, reminders, and feedback.
4. `TourAgenda` is a one-to-one operational layer on top of `Booking`.
5. `PNL` is a one-to-one financial layer on top of `Booking`.
6. `AgendaItem` can optionally have one `Assignment`.
7. `Assignment` can optionally connect to a `Driver` and `VehicleVendor`.
8. `Ticket` can link to both an `AgendaItem` and a `PNLLineItem`.
9. `BookingVersion` is the history table for amendments.
10. `StatusEvent` is the audit trail for booking state changes.

---

## 2. Full Database Structure

### 2.1 Users and Access

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `users` | System users and staff accounts | `id`, `email`, `name`, `password`, `role`, `country`, `phone`, `isActive` | Parent for logs, bookings, payments, reminders, feedback |
| `activity_logs` | Action audit log | `userId`, `action`, `entityType`, `entityId`, `details`, `createdAt` | `userId -> users.id` |

### 2.2 Booking Core

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `bookings` | Main booking record | `id`, `bookingRef`, `status`, `arrivalDate`, `departureDate`, `paxAdults`, `paxChildren`, `quotedTotal`, `currency`, contacts, notes, source docs | `createdById -> users.id`, `clientUserId -> users.id` |
| `booking_versions` | Amendment snapshots | `bookingId`, `versionNo`, `docSnapshot`, `amendmentNote`, `createdById`, `createdAt` | `bookingId -> bookings.id` |
| `status_events` | Status change history | `bookingId`, `fromState`, `toState`, `actorId`, `note`, `createdAt` | `bookingId -> bookings.id`, `actorId -> users.id` |
| `change_requests` | Change requests from teams | `bookingId`, `raisedById`, `targetField`, `notes`, `status`, `resolvedAt` | `bookingId -> bookings.id`, `raisedById -> users.id` |

### 2.3 Booking Detail Tables

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `passengers` | Passenger list | `bookingId`, `name`, `type`, `age`, `isLead`, `passport`, `nationality`, `contact`, `mealPreference` | `bookingId -> bookings.id` |
| `emergency_contacts` | Emergency contact list | `bookingId`, `name`, `phone`, `role` | `bookingId -> bookings.id` |
| `flights` | Flight schedule | `bookingId`, `flightNo`, `date`, `fromApt`, `depTime`, `toApt`, `arrTime`, `airline`, `notes` | `bookingId -> bookings.id` |
| `accommodations` | Hotel and stay details | `bookingId`, `city`, `hotel`, `checkIn`, `checkOut`, `nights`, `roomType`, `mealType`, `address`, `contact` | `bookingId -> bookings.id` |
| `itinerary_items` | Day-by-day itinerary | `bookingId`, `dayNo`, `date`, `title`, `description`, `inclusions`, `exclusions` | `bookingId -> bookings.id` |

### 2.4 Operations Layer

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `tour_agendas` | One agenda per booking | `bookingId`, `createdAt`, `updatedAt` | `bookingId -> bookings.id` |
| `agenda_items` | Movement chart / service rows | `agendaId`, `date`, `location`, `fromPoint`, `toPoint`, `details`, `mealPlan`, `meetingTime`, `timeFrom`, `timeTo`, `serviceType`, `sortOrder` | `agendaId -> tour_agendas.id` |
| `assignments` | Driver / vehicle assignment for agenda items | `agendaItemId`, `driverId`, `vendorId`, `driverName`, `driverPhone`, `vehicleType`, `vehiclePlate`, `notes`, `driverRate`, `rateCurrency`, `assignedAt` | `agendaItemId -> agenda_items.id`, optional `driverId -> drivers.id`, optional `vendorId -> vehicle_vendors.id` |
| `tickets` | Operational ticket records | `bookingId`, `agendaItemId`, `pnlLineId`, `type`, `qty`, `supplier`, `costPerUnit`, `totalCost`, `currency`, `status`, `activated`, `purchasedAt`, `reference`, `notes` | `bookingId -> bookings.id`, optional `agendaItemId -> agenda_items.id`, optional `pnlLineId -> pnl_line_items.id` |

### 2.5 Financial Layer

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `pnl` | One financial record per booking | `bookingId`, `paxAdults`, `paxChildren`, `sourceDocUrl`, `isPnlData`, `lockedAt` | `bookingId -> bookings.id` |
| `pnl_line_items` | P&L cost lines | `pnlId`, `activity`, `category`, `mmtRate`, `sicRate`, `pvtRatePP`, `adEntrance`, `chEntrance`, `otherRate`, `paymentStatus`, `paymentRefNumber`, `paymentBillUrl`, `paymentConfirmedAt`, `paymentConfirmedBy`, `sortOrder`, `notes` | `pnlId -> pnl.id` |
| `payments` | Booking-level payments | `bookingId`, `type`, `label`, `amount`, `currency`, `method`, `status`, `reference`, `refNumber`, `dueDate`, `paidAt`, `processedById` | `bookingId -> bookings.id`, optional `processedById -> users.id` |
| `external_pnl_links` | Link to external invoice processor DB | `bookingId`, `externalPnlId`, `matchedBy`, `matchedValue`, `cachedRecord`, `cachedItems`, `lastFetchedAt` | `bookingId -> bookings.id` |

### 2.6 Operations People and Assets

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `drivers` | Driver master | `name`, `phone`, `email`, `licenseNo`, `vehicleId`, `country`, `bankName`, `advanceBalance`, `isActive` | optional `vehicleId -> vehicles.id` |
| `vehicles` | Vehicle master | `type`, `plateNo`, `brand`, `model`, `capacity`, `vendorId`, `isActive` | optional `vendorId -> vehicle_vendors.id` |
| `vehicle_vendors` | Vendor master | `name`, `phone`, `email`, `address`, `country`, `password`, `whatsappPhone`, `isRegistered` | parent of `vehicles` and `assignments` |
| `driver_payments` | Driver payment history | `driverId`, `amount`, `type`, `description`, `refNumber`, `paidById`, `createdAt` | `driverId -> drivers.id`, `paidById -> users.id` |

### 2.7 Credit Agent and Communication

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `credit_agents` | Credit agent master | `name`, `aliases`, `contactName`, `contactEmail`, `contactPhone`, `creditLimit`, `currency`, `country` | parent of `credit_agent_payments` |
| `credit_agent_payments` | Agent settlement records | `agentId`, `periodStart`, `periodEnd`, `dueDate`, `bookingRefs`, `amountDue`, `amountPaid`, `currency`, `status`, `paidAt`, `processedById` | `agentId -> credit_agents.id`, `processedById -> users.id` |
| `contact_logs` | Customer / client contact log | `bookingId`, `userId`, `type`, `subject`, `notes`, `contactedAt` | `bookingId -> bookings.id`, `userId -> users.id` |
| `reminders` | Scheduled reminders | `bookingId`, `userId`, `type`, `title`, `message`, `scheduledAt`, `sentAt`, `isDone`, `createdAt` | `bookingId -> bookings.id`, `userId -> users.id` |
| `customer_feedback` | Feedback after trip | `bookingId`, `rating`, `comment`, `savedById`, `createdAt`, `updatedAt` | `bookingId -> bookings.id`, `savedById -> users.id` |

### 2.8 Mail, AI, Sync, and System Tables

| Table | Purpose | Important Fields | Link |
|---|---|---|---|
| `mail_messages` | Cached email records | `graphId`, `mailboxUser`, `mailboxKind`, `subject`, `fromAddress`, `receivedAt`, `folder`, `rawBody`, `bodyHtml`, `bookingRef`, `operationCountry`, `status` | `bookingRef` links to `bookings.bookingRef` logically |
| `whatsapp_messages` | WhatsApp history | `bookingRef`, `phone`, `direction`, `body`, `waMessageId`, `status`, `senderName`, `createdAt` | `bookingRef` links to `bookings.bookingRef` logically |
| `onedrive_events` | OneDrive sync events | `driveType`, `itemId`, `itemName`, `itemPath`, `eventType`, `bookingRef`, `status`, `errorMessage`, `processedAt` | `bookingRef` links to `bookings.bookingRef` logically |
| `onedrive_delta_tokens` | OneDrive delta sync token | `driveKey`, `token`, `updatedAt` | sync state only |
| `ai_usage_logs` | AI token and cost tracking | `callType`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`, `bookingRef`, `source`, `createdAt` | optional `bookingRef` for traceability |
| `system_settings` | App settings | `key`, `value`, `updatedAt` | no FK |

---

## 3. Relationship Map

The easiest way to understand the system is to start from `bookings.id` and follow the foreign keys.

```text
users
  ├─< bookings.createdById
  ├─< bookings.clientUserId
  ├─< activity_logs.userId
  ├─< contact_logs.userId
  ├─< reminders.userId
  ├─< payments.processedById
  ├─< driver_payments.paidById
  ├─< credit_agent_payments.processedById
  ├─< customer_feedback.savedById
  ├─< change_requests.raisedById
  └─< status_events.actorId

bookings
  ├─< passengers.bookingId
  ├─< emergency_contacts.bookingId
  ├─< flights.bookingId
  ├─< accommodations.bookingId
  ├─< itinerary_items.bookingId
  ├─1 tour_agendas.bookingId
  ├─1 pnl.bookingId
  ├─< payments.bookingId
  ├─< change_requests.bookingId
  ├─< status_events.bookingId
  ├─< booking_versions.bookingId
  ├─< contact_logs.bookingId
  ├─1 customer_feedback.bookingId
  └─1 external_pnl_links.bookingId

tour_agendas
  └─< agenda_items.agendaId

agenda_items
  ├─1 assignments.agendaItemId
  └─< tickets.agendaItemId

pnl
  └─< pnl_line_items.pnlId

pnl_line_items
  └─< tickets.pnlLineId

drivers
  ├─1 vehicles via `drivers.vehicleId -> vehicles.id`
  └─< assignments.driverId

vehicle_vendors
  ├─< vehicles.vendorId
  └─< assignments.vendorId
```

### Linking rules in plain words

1. Create a booking first.
2. Use `bookings.id` as the parent key for all booking detail rows.
3. Create `TourAgenda` only once per booking.
4. Create many `AgendaItem` rows under the agenda.
5. Create one `Assignment` per `AgendaItem` when a driver or vehicle is allocated.
6. Create one `PNL` record per booking.
7. Create many `PNLLineItem` rows under `PNL`.
8. Create `Ticket` rows under the booking and optionally attach them to an agenda item or P&L line.
9. Use `StatusEvent` every time booking status changes.
10. Use `BookingVersion` whenever the booking is amended.

### Important link fields

| Parent | Child | FK Field |
|---|---|---|
| `bookings` | `passengers` | `bookingId` |
| `bookings` | `emergency_contacts` | `bookingId` |
| `bookings` | `flights` | `bookingId` |
| `bookings` | `accommodations` | `bookingId` |
| `bookings` | `itinerary_items` | `bookingId` |
| `bookings` | `tour_agendas` | `bookingId` |
| `tour_agendas` | `agenda_items` | `agendaId` |
| `agenda_items` | `assignments` | `agendaItemId` |
| `bookings` | `pnl` | `bookingId` |
| `pnl` | `pnl_line_items` | `pnlId` |
| `bookings` | `payments` | `bookingId` |
| `bookings` | `change_requests` | `bookingId` |
| `bookings` | `status_events` | `bookingId` |
| `bookings` | `booking_versions` | `bookingId` |
| `bookings` | `contact_logs` | `bookingId` |
| `bookings` | `customer_feedback` | `bookingId` |
| `bookings` | `external_pnl_links` | `bookingId` |

---

## 4. Booking Status Flow

The booking moves through these states:

`DRAFT -> BT_CONFIRMED -> GT_REVIEW -> CHANGE_REQUESTED -> GT_VERIFIED -> AWAITING_PAYMENT_CONFIRM -> OPERATIONS_READY -> CLIENT_LIVE -> IN_PROGRESS -> COMPLETED`

Other valid states:

`CANCELLED`, `AMENDED`

Status history must be saved in `status_events` every time the status changes.

---

## 5. Public Booking Detail API

This is the non-security, read-only booking detail API. Any one can call it to see the booking details.

If you want to keep the code name aligned with the existing system, this can be exposed as:

`GET /api/bookings/full/{bookingRef}`

For a clearer public route name, you can also expose:

`GET /api/public/bookings/{bookingRef}`

### 5.1 Request

#### Path parameter

| Name | Type | Required | Description |
|---|---|---|---|
| `bookingRef` | string | yes | Booking reference such as `VN19662`, `464660`, or `464660CNTL` |

#### Optional query parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `include` | string | no | Use `full` to return all nested booking sections |
| `format` | string | no | Use `json` for API response, `html` if you later add a portal view |

### 5.2 Request Example

```bash
curl -s \
  "https://holidays-booking.aahaas.com/api/bookings/full/VN19662"
```

### 5.3 Response Structure

The response should return the complete booking snapshot.

```json
{
  "success": true,
  "message": "Booking VN19662 found",
  "data": {
    "id": "booking-id",
    "bookingRef": "VN19662",
    "agentBookingId": "402011138462",
    "cntlNumber": "463720CNTL",
    "agent": "MakeMyTrip",
    "fileHandler": "Yogi",
    "version": 1,
    "amendmentNote": null,
    "status": "OPERATIONS_READY",
    "arrivalDate": "2026-10-15T00:00:00.000Z",
    "departureDate": "2026-10-22T00:00:00.000Z",
    "paxAdults": 2,
    "paxChildren": 0,
    "quotedTotal": 1850.0,
    "currency": "USD",
    "cancellationDeadline": "2026-09-24T00:00:00.000Z",
    "terms": null,
    "exclusions": null,
    "policyNotes": null,
    "agentContact": {
      "email": "bookings@makemytrip.com",
      "phone": "+91 9876543210",
      "whatsapp": "+91 9876543210",
      "country": "India",
      "address": null
    },
    "clientContact": {
      "email": "tourist@email.com",
      "phone": "+91 9876543210",
      "whatsapp": "+91 9876543210",
      "country": "India",
      "address": null
    },
    "passengers": [],
    "emergencyContacts": [],
    "flights": [],
    "accommodations": [],
    "itineraryItems": [],
    "agenda": {
      "id": "agenda-id",
      "createdAt": "2026-06-15T11:00:00.000Z",
      "updatedAt": "2026-06-15T11:00:00.000Z",
      "items": [
        {
          "id": "agenda-item-id",
          "date": "2026-10-15T00:00:00.000Z",
          "location": "Danang",
          "fromPoint": "DAD",
          "toPoint": "Menora Grand Danang",
          "details": "Private transfer from Da Nang Airport to hotel.",
          "mealPlan": null,
          "meetingTime": "09:50",
          "timeFrom": null,
          "timeTo": null,
          "serviceType": "PVT_TRANSFER",
          "sortOrder": 0,
          "driverAllocation": {
            "id": "assignment-id",
            "driverId": "driver-id",
            "driverName": "Sasindi Diluranga",
            "driverPhone": "+8322321",
            "vehicleType": "van",
            "vehiclePlate": "764-3384",
            "notes": null,
            "assignedAt": "2026-06-15T12:00:00.000Z",
            "driver": {
              "id": "driver-id",
              "name": "Sasindi Diluranga",
              "phone": "+83223212121",
              "email": null,
              "licenseNo": null,
              "vehicle": {
                "id": "vehicle-id",
                "type": "van",
                "plateNo": "764-3384",
                "brand": "Toyota",
                "model": "Hiace",
                "capacity": 10
              }
            }
          },
          "tickets": []
        }
      ]
    },
    "pnl": {
      "id": "pnl-id",
      "paxAdults": 2,
      "paxChildren": 0,
      "sourceDocUrl": null,
      "isPnlData": null,
      "lockedAt": null,
      "lineItems": [
        {
          "id": "pnl-line-id",
          "activity": "Menora Grand Danang 2N BB",
          "category": "HOTEL",
          "mmtRate": 320.0,
          "sicRate": 0.0,
          "pvtRatePP": 0.0,
          "adEntrance": 0.0,
          "chEntrance": 0.0,
          "otherRate": 0.0,
          "paymentStatus": "PENDING",
          "paymentRefNumber": null,
          "paymentBillUrl": null,
          "paymentBillName": null,
          "paymentConfirmedAt": null,
          "paymentConfirmedBy": null,
          "sortOrder": 0,
          "notes": null
        }
      ],
      "totals": {
        "mmtRate": 320.0,
        "sicRate": 0.0,
        "pvtRatePP": 0.0
      }
    },
    "payments": [
      {
        "id": "payment-id",
        "type": "customer_payment",
        "label": "Deposit",
        "amount": 925.0,
        "currency": "USD",
        "method": "bank_transfer",
        "status": "CONFIRMED",
        "reference": "INV-001",
        "refNumber": null,
        "dueDate": null,
        "paidAt": "2026-06-10T00:00:00.000Z"
      }
    ],
    "tickets": [],
    "changeRequests": [],
    "statusHistory": [
      {
        "id": "status-event-id",
        "from": "GT_REVIEW",
        "to": "OPERATIONS_READY",
        "actor": {
          "id": "user-id",
          "name": "Admin",
          "role": "SUPER_ADMIN"
        },
        "note": null,
        "at": "2026-06-15T10:00:00.000Z"
      }
    ],
    "createdBy": {
      "id": "user-id",
      "name": "Admin",
      "email": "admin@aahaas.com",
      "role": "SUPER_ADMIN"
    },
    "createdAt": "2026-06-14T08:00:00.000Z",
    "updatedAt": "2026-06-15T12:00:00.000Z"
  }
}
```

### 5.4 Output Field Notes

| Field | Meaning |
|---|---|
| `agentContact` | Agent side contact information |
| `clientContact` | Traveler or lead customer contact information |
| `agenda.items[].driverAllocation` | Driver and vehicle allocation for that movement |
| `pnl.lineItems[]` | Financial line items for the booking |
| `pnl.totals` | Derived totals from the P&L lines |
| `statusHistory` | Who changed the booking status and when |
| `createdBy` | Staff user who created the booking |

### 5.5 Public Response Rules

1. Read only.
2. No login required.
3. No password, session, or auth token required.
4. No write operations from this endpoint.
5. If a booking ref is not found, return `404`.
6. If the booking exists but is archived or canceled, still return the record unless business rules say otherwise.

---

## 6. Standard Linking Process

When saving a booking from a document or manual form, the system should follow this order:

1. Create `Booking`.
2. Create `Passenger` rows.
3. Create `EmergencyContact` rows.
4. Create `Flight` rows.
5. Create `Accommodation` rows.
6. Create `ItineraryItem` rows.
7. Create `TourAgenda`.
8. Create `AgendaItem` rows.
9. Create `Assignment` rows for the agenda items that need drivers or vehicles.
10. Create `PNL`.
11. Create `PNLLineItem` rows.
12. Create `Payment` rows.
13. Create `StatusEvent` rows for lifecycle changes.
14. Create `BookingVersion` rows when amendments happen.
15. Create `ContactLog`, `Reminder`, `CustomerFeedback`, and `ExternalPnlLink` rows when those modules are used.

---

## 7. Recommended API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/bookings/full/{ref}` | Full booking snapshot |
| `GET` | `/api/bookings/{ref}` | Standard booking snapshot |
| `GET` | `/api/bookings/{ref}/agenda` | Agenda only |
| `GET` | `/api/bookings/{ref}/pnl` | P&L only |
| `POST` | `/api/bookings/{ref}/confirm` | Confirm booking |
| `POST` | `/api/bookings/{ref}/verify` | GT verification |
| `POST` | `/api/bookings/{ref}/complete` | Mark completed |
| `POST` | `/api/bookings/{ref}/cancel` | Cancel booking |
| `POST` | `/api/bookings/{ref}/recheck` | Recheck booking |

---

## 8. Notes for Implementation

1. Keep `bookingRef` unique.
2. Keep `TourAgenda` one-to-one with `Booking`.
3. Keep `PNL` one-to-one with `Booking`.
4. Use server-side derived totals for P&L values.
5. Do not store derived totals manually if they can be computed.
6. Use `StatusEvent` and `BookingVersion` for auditability.
7. If the public booking API is exposed without security, avoid returning password, session, or internal admin-only data.
