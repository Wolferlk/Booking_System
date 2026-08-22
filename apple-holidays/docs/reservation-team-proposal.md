# Reservation Team — Feature Proposal

**Status:** Proposal only. Nothing in this document has been implemented.
**Scope:** A new internal team ("Reservation Team") that owns the hotel side of every booking — from availability and rate comparison, through confirmation and amendments, to proforma invoices and credit notes.
**Author:** drafted against the current `Main_v7_DEV` codebase.

---

## 1. Why a new team, and what changes

Today the hotel side of a booking is spread across roles that each own a slice of it:

| What happens now | Where it lives | Who does it |
|---|---|---|
| Hotel names arrive on the TC document | `Accommodation[]` rows extracted by `extractBookingFromText()` | automation |
| Hotel identity, contacts, WhatsApp verification | `HotelProfile` / `HotelContactChannel` ([hotel-precheck.ts](../src/lib/hotel-precheck.ts)) | TE / Ground, via **Pre-checking** |
| D-10 reconfirmation of each stay with the property | `HotelReconfirmation` + events | TE / Ground |
| Hotel cost lines & payment status | `PNLLineItem` where `category = HOTEL` | Accounts |
| Supplier mail chasing | `QueryMonitorEntry` threads | Admin |

What is **missing entirely** is everything *before* the stay exists on the TC: the request from the customer, the availability check, the rate comparison, the negotiation, the option hold and its expiry, the hotel's written confirmation, the proforma invoice, and the credit note when a booking shrinks or cancels. That work is being done today in spreadsheets and mailboxes, invisible to the system.

The proposal is therefore **not** "add another role that can see bookings". It is:

1. A new role `RS_USER` with its own workspace.
2. A new entity — the **Hotel Reservation** — that models a stay as a *negotiated commitment with a supplier*, with its own lifecycle, money, documents and deadlines. `Accommodation` stays what it is (what the customer was sold); the reservation is what we owe the hotel.
3. Reuse — not duplication — of `HotelProfile`, the pre-checking queue, the P&L, the WhatsApp sender and the Query Monitor.

---

## 2. Duty → feature map

Every duty listed for the team, mapped to the component that would carry it.

| # | Duty | Feature | New/Reuse |
|---|---|---|---|
| 1 | Handle hotel booking requests from customers | **Reservation Request Inbox** — queue of bookings needing hotel work | New |
| 2 | Check availability and room rates | **Availability & Rate Workspace** per request | New |
| 3 | Compare options on preference + budget | **Option Comparison Board** (side-by-side quotes, margin vs P&L budget) | New |
| 4 | Confirm reservations with hotels | **Confirm action** → `CONFIRMED` + confirmation number | New, writes to existing `HotelReconfirmation` |
| 5 | Send hotel confirmations | **Outbound message composer** (WhatsApp template + email) | Reuse `WhatsAppMessage`, Graph mail |
| 6 | Modify / cancel / rebook | **Amendment & Cancellation flow** with version history | New |
| 7 | Follow cancellation & amendment policy | **Policy engine** — free-cancel-until date, penalty ladder, live countdown | New |
| 8 | Special requests (early check-in, extra bed, honeymoon…) | **Special Requests checklist** per reservation, ack-tracked | New |
| 9 | Resolve booking issues with hotels | **Issue log** per reservation, linked to Query Monitor threads | Reuse |
| 10 | Monitor deadlines and payment due dates | **Deadline Board** — one screen, colour-coded, the team's home page | New (mirrors pre-checking urgency model) |
| 11 | Process payments, maintain records | **Payment request → Accounts handoff**; reservation ↔ `PNLLineItem` link | Reuse `Payment`, `PNLLineItem` |
| 12 | Maintain hotel partner relationships | **Hotel Partner 360** page (history, spend, disputes, response times) | Extends `HotelProfile` |
| 13 | Update contract info in the reservation sheet | **Contract & Rate Card** per hotel (season bands, contracted rates, validity) | New |
| 14 | Ensure details accurate before confirming | **Pre-confirmation validation gate** (blocking + warning checks) | New |
| 15 | Obtain proforma invoices, verify, forward | **Proforma Invoice tracker** with AI extraction + 3-way match | New + reuse `openai.ts` |
| 16 | Follow up pending credit notes | **Credit Note register** with ageing and auto-chasers | New |
| 17 | *(implicit)* Audit of everything above | **Reservation event log**, append-only | Reuse pattern of `StatusEvent` |

---

## 3. Role and access

### 3.1 New role

```
UserRole += RS_USER          // "Reservation Team"
ROLE_LABELS.RS_USER  = 'Reservation Team'
ROLE_COLORS.RS_USER  = 'indigo'
ROLE_COUNTRY_SCOPE.RS_USER = ['VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA','ALL']
```

Country scoping behaves exactly as it does everywhere else — a Sri Lanka reservation user never sees a Vietnam stay. Enforced server-side via `userCountryScope()`, the same way [precheck-guard.ts](../src/lib/precheck-guard.ts) does it.

### 3.2 New permissions

```
'reservation:read'         // see the workspace
'reservation:create'       // open a reservation on a booking
'reservation:edit'         // rates, rooms, special requests
'reservation:confirm'      // move to CONFIRMED — the accuracy gate applies
'reservation:cancel'       // cancel / release a held option
'reservation:contact'      // send WhatsApp/email to a hotel
'contract:read' / 'contract:edit'   // hotel contract & rate cards
'invoice:read' / 'invoice:verify'   // proforma verification
'creditnote:read' / 'creditnote:manage'
```

Grants:

| Role | Grant |
|---|---|
| `RS_USER` | all of the above, plus `booking:read`, `pnl:read` (needs the hotel budget), `agenda:read` |
| `AC_USER` | `reservation:read`, `invoice:read`, `invoice:verify`, `creditnote:*` — Accounts pays and reconciles |
| `BT_USER` | `reservation:read` — needs to see whether the hotel is secured before promising the client |
| `TE_USER` / `GT_*` | `reservation:read` — pre-checking already shows them the stay |
| `SUPER_ADMIN` / `ULTRA_SUPER_ADMIN` | everything |

**Deliberately not granted to `RS_USER`:** `pnl:edit`, `pnl:confirm_payment`, `payment:create`. The Reservation Team *requests* payment; Accounts *releases* it. That separation is the existing control and should not be weakened.

### 3.3 Sidebar

A new `NAV_ITEMS.RS_USER` block in [sidebar.tsx](../src/components/layout/sidebar.tsx):

```
Deadline Board      /dashboard/reservations              Gauge
Request Inbox       /dashboard/reservations/requests     Inbox
Reservations        /dashboard/reservations/list         BedDouble
Hotel Partners      /dashboard/reservations/hotels       Building2
Contracts & Rates   /dashboard/reservations/contracts    FileSpreadsheet
Proforma Invoices   /dashboard/reservations/invoices     ReceiptText
Credit Notes        /dashboard/reservations/credit-notes FileMinus2
Pre-checking        /dashboard/precheck                  BedDouble
All Bookings        /dashboard/bookings                  FileText
WhatsApp            /dashboard/whatsapp                  MessageCircle
```

---

## 4. Data model

New models, following the conventions already in `schema.prisma` (cuid ids, `@@map` snake-case tables, append-only event tables, soft pointers by `bookingRef` where amendments would otherwise cascade away evidence).

### 4.1 `HotelReservation` — the core entity

```prisma
model HotelReservation {
  id                String   @id @default(cuid())
  /// bookingRef + normalised hotel + check-in. Same convention as HotelReconfirmation.stayKey.
  reservationKey    String   @unique
  bookingRef        String
  accommodationId   String?          // soft pointer, re-resolved on read
  hotelProfileId    String?
  hotelName         String
  city              String?
  operationCountry  OperationCountry?

  // ── Stay
  checkIn           DateTime
  checkOut          DateTime
  nights            Int      @default(0)
  roomType          String?
  roomCategory      String?
  roomCount         Int      @default(1)
  mealPlan          String?          // RO | BB | HB | FB | AI
  adults            Int      @default(0)
  children          Int      @default(0)
  cwb               Int      @default(0)
  cnb               Int      @default(0)
  infants           Int      @default(0)

  // ── Commercial
  currency          String   @default("USD")
  nettRate          Decimal? @db.Decimal(12,2)   // per room per night, what we pay
  totalCost         Decimal? @db.Decimal(12,2)   // computed on save, stored for reporting
  taxesIncluded     Boolean  @default(true)
  budgetRef         String?                      // linked PNLLineItem.id (category HOTEL)

  // ── Lifecycle
  status            ReservationStatus @default(REQUESTED)
  confirmationNumber String?
  confirmedAt       DateTime?
  confirmedBy       String?

  // ── Option hold
  optionHeldUntil   DateTime?                    // release deadline
  optionReleasedAt  DateTime?

  // ── Policy (denormalised from HotelContract at confirm time — a policy that
  // changed later must not rewrite what we agreed)
  freeCancelUntil   DateTime?
  penaltyTiers      Json?                        // [{fromDaysBefore, pct|amount, note}]
  policyText        String?  @db.Text

  // ── Deadlines
  paymentDueAt      DateTime?
  proformaDueAt     DateTime?

  // ── Handoff / channel
  lastChannel       String?                      // WHATSAPP | EMAIL | CALL | PORTAL
  lastContactedAt   DateTime?
  assignedToEmail   String?
  priority          String   @default("NORMAL")  // LOW | NORMAL | HIGH

  notes             String?  @db.Text
  createdBy         String?
  updatedBy         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  options           ReservationOption[]
  requests          ReservationSpecialRequest[]
  events            ReservationEvent[]
  invoices          ProformaInvoice[]
  creditNotes       CreditNote[]

  @@index([bookingRef])
  @@index([status])
  @@index([checkIn])
  @@index([hotelProfileId])
  @@index([optionHeldUntil])
  @@index([paymentDueAt])
  @@map("hotel_reservations")
}

enum ReservationStatus {
  REQUESTED        // customer wants it, nothing sent yet
  QUOTING          // options being gathered
  OPTION_HELD      // hotel holding, release deadline running
  PENDING_HOTEL    // sent, awaiting hotel reply
  CONFIRMED        // hotel confirmed, confirmation number captured
  AMEND_REQUESTED
  AMENDED
  CANCEL_REQUESTED
  CANCELLED
  NO_SHOW
  WAITLISTED
  REJECTED         // hotel declined / no availability
}
```

### 4.2 `ReservationOption` — a quote we are comparing

```prisma
model ReservationOption {
  id             String   @id @default(cuid())
  reservationId  String
  hotelProfileId String?
  hotelName      String
  starRating     Int?
  roomType       String?
  mealPlan       String?
  currency       String   @default("USD")
  nettRate       Decimal? @db.Decimal(12,2)
  totalCost      Decimal? @db.Decimal(12,2)
  availability   String   @default("UNKNOWN")   // AVAILABLE | ON_REQUEST | FULL | UNKNOWN
  cancelPolicy   String?  @db.Text
  distanceNote   String?                        // "300 m from beach"
  pros           String?  @db.Text
  cons           String?  @db.Text
  quotedAt       DateTime?
  quoteValidTil  DateTime?
  quoteDocUrl    String?  @db.Text
  /// Exactly one option per reservation may be selected.
  selected       Boolean  @default(false)
  selectedReason String?  @db.Text
  sortOrder      Int      @default(0)
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  reservation    HotelReservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)

  @@index([reservationId])
  @@map("reservation_options")
}
```

### 4.3 `ReservationSpecialRequest`

```prisma
model ReservationSpecialRequest {
  id            String   @id @default(cuid())
  reservationId String
  kind          SpecialRequestKind
  detail        String?  @db.Text
  chargeable    Boolean  @default(false)
  cost          Decimal? @db.Decimal(12,2)
  status        RequestStatus @default(REQUESTED)  // REQUESTED|ACKNOWLEDGED|CONFIRMED|DECLINED|NA
  hotelResponse String?  @db.Text
  requestedAt   DateTime @default(now())
  respondedAt   DateTime?
  createdBy     String?

  reservation   HotelReservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  @@index([reservationId])
  @@map("reservation_special_requests")
}

enum SpecialRequestKind {
  EARLY_CHECK_IN
  LATE_CHECK_OUT
  EXTRA_BED
  HONEYMOON
  ANNIVERSARY
  BIRTHDAY
  CONNECTING_ROOMS
  HIGH_FLOOR
  SEA_VIEW
  QUIET_ROOM
  ACCESSIBLE_ROOM
  DIETARY
  AIRPORT_TRANSFER
  BABY_COT
  OTHER
}
```

### 4.4 `HotelContract` + `HotelContractRate` — duty #13

```prisma
model HotelContract {
  id              String   @id @default(cuid())
  hotelProfileId  String
  contractCode    String?
  validFrom       DateTime
  validTo         DateTime
  currency        String   @default("USD")
  /// Cancellation ladder that applies to reservations quoted under this contract.
  policyText      String?  @db.Text
  penaltyTiers    Json?
  freeCancelDays  Int?
  childPolicy     String?  @db.Text
  paymentTerms    String?  @db.Text     // "30 days before arrival", "on checkout"
  commissionPct   Decimal? @db.Decimal(5,2)
  contractDocUrl  String?  @db.Text
  status          String   @default("ACTIVE")   // DRAFT | ACTIVE | EXPIRED | SUPERSEDED
  notes           String?  @db.Text
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  rates           HotelContractRate[]
  @@index([hotelProfileId])
  @@index([validFrom, validTo])
  @@map("hotel_contracts")
}

model HotelContractRate {
  id           String   @id @default(cuid())
  contractId   String
  seasonName   String?              // "Peak", "Shoulder", "Green"
  seasonFrom   DateTime?
  seasonTo     DateTime?
  roomType     String
  mealPlan     String   @default("BB")
  singleRate   Decimal? @db.Decimal(12,2)
  doubleRate   Decimal? @db.Decimal(12,2)
  tripleRate   Decimal? @db.Decimal(12,2)
  extraBedRate Decimal? @db.Decimal(12,2)
  cwbRate      Decimal? @db.Decimal(12,2)
  cnbRate      Decimal? @db.Decimal(12,2)
  minNights    Int?
  sortOrder    Int      @default(0)

  contract     HotelContract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  @@index([contractId])
  @@map("hotel_contract_rates")
}
```

### 4.5 `ProformaInvoice` — duty #15

```prisma
model ProformaInvoice {
  id             String   @id @default(cuid())
  reservationId  String?
  bookingRef     String?
  hotelProfileId String?
  invoiceNumber  String?
  invoiceDate    DateTime?
  dueDate        DateTime?
  currency       String   @default("USD")
  amount         Decimal? @db.Decimal(12,2)
  taxAmount      Decimal? @db.Decimal(12,2)
  totalAmount    Decimal? @db.Decimal(12,2)
  fileUrl        String?  @db.Text
  /// Raw payload from the AI extraction pass, kept for audit — same pattern as
  /// HotelProfile.aiResearch.
  aiExtract      Json?
  status         InvoiceStatus @default(RECEIVED)
  /// Result of the 3-way match against the reservation and the P&L budget.
  matchResult    Json?
  variance       Decimal? @db.Decimal(12,2)
  verifiedAt     DateTime?
  verifiedBy     String?
  forwardedAt    DateTime?
  forwardedTo    String?
  rejectReason   String?  @db.Text
  notes          String?  @db.Text
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  reservation    HotelReservation? @relation(fields: [reservationId], references: [id])
  @@index([reservationId])
  @@index([bookingRef])
  @@index([status])
  @@index([dueDate])
  @@map("proforma_invoices")
}

enum InvoiceStatus {
  RECEIVED        // arrived, untouched
  UNDER_REVIEW
  DISCREPANCY     // 3-way match failed, hotel queried
  VERIFIED        // details agree
  FORWARDED       // sent to Accounts for payment
  PAID
  REJECTED
  VOID
}
```

### 4.6 `CreditNote` — duty #16

```prisma
model CreditNote {
  id             String   @id @default(cuid())
  reservationId  String?
  bookingRef     String?
  hotelProfileId String?
  hotelName      String
  reason         CreditNoteReason @default(CANCELLATION)
  reasonNote     String?  @db.Text
  currency       String   @default("USD")
  expectedAmount Decimal? @db.Decimal(12,2)
  receivedAmount Decimal? @db.Decimal(12,2)
  creditNoteNo   String?
  raisedAt       DateTime @default(now())
  expectedBy     DateTime?
  receivedAt     DateTime?
  appliedAt      DateTime?          // offset against a later invoice
  appliedToInvoiceId String?
  status         CreditNoteStatus @default(PENDING)
  lastChasedAt   DateTime?
  chaseCount     Int      @default(0)
  fileUrl        String?  @db.Text
  notes          String?  @db.Text
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  reservation    HotelReservation? @relation(fields: [reservationId], references: [id])
  @@index([bookingRef])
  @@index([status])
  @@index([expectedBy])
  @@map("credit_notes")
}

enum CreditNoteReason { CANCELLATION AMENDMENT OVERCHARGE NO_SHOW_WAIVER SERVICE_FAILURE DUPLICATE_PAYMENT OTHER }
enum CreditNoteStatus { PENDING REQUESTED PROMISED RECEIVED APPLIED WRITTEN_OFF DISPUTED }
```

### 4.7 `ReservationEvent` — append-only audit

Mirrors `HotelReconfirmationEvent` exactly: `action`, `fromStatus`, `toStatus`, `channel`, `note`, `actorName`, `actorEmail`, `createdAt`. Never updated, never deleted. This is the evidence trail of who agreed what with which hotel.

---

## 5. Lifecycle

```
REQUESTED
   │  gather quotes
   ▼
QUOTING ──────────────► REJECTED        (no availability anywhere)
   │  select option
   ├──► OPTION_HELD ──► (deadline lapses) ──► REQUESTED / CANCELLED
   │  send to hotel
   ▼
PENDING_HOTEL ────────► WAITLISTED
   │  hotel confirms + confirmation number
   ▼
CONFIRMED ◄──────────── AMENDED
   │                       ▲
   ├──► AMEND_REQUESTED ───┘
   ├──► CANCEL_REQUESTED ──► CANCELLED ──► (credit note if prepaid)
   └──► NO_SHOW
```

Implemented as a `RESERVATION_TRANSITIONS` table in `src/lib/reservation-state.ts`, in the same shape as [state-machine.ts](../src/lib/state-machine.ts) — `{ from, to, allowedRoles, label, requiresNote?, guard? }` — so `getAvailableTransitions()` / `canTransition()` work identically and the UI can render buttons generically.

**Guards worth having:**
- `CONFIRMED` requires a confirmation number **and** a passing accuracy gate (§6.4).
- `CANCELLED` after `freeCancelUntil` requires a penalty note and offers to raise a `CreditNote`.
- `OPTION_HELD` requires `optionHeldUntil` in the future.

This lifecycle is **independent of `BookingStatus`**. A booking can sit at `GT_VERIFIED` with three hotels confirmed and one still `PENDING_HOTEL`. What the main booking flow gains is a *derived* rollup: `hotelsSecured / hotelsTotal`, shown as a chip on the booking detail page.

---

## 6. Components

### 6.1 Deadline Board — `/dashboard/reservations`

The team's home page. One screen, everything with a clock on it, newest crisis first. Modelled on the existing pre-checking urgency classifier (`classifyStay()` in [precheck-shared.ts](../src/lib/precheck-shared.ts)) so the colour language is already familiar to staff.

Five lanes, each a count + expandable list:

| Lane | Rule | Colour |
|---|---|---|
| **Option releasing** | `optionHeldUntil` within 48 h, status `OPTION_HELD` | red |
| **Awaiting hotel** | `PENDING_HOTEL` and `lastContactedAt` > 24 h ago | amber |
| **Payment due** | `paymentDueAt` within 7 days, not yet paid | red / amber |
| **Proforma missing** | `CONFIRMED`, `proformaDueAt` passed, no `ProformaInvoice` | amber |
| **Credit notes ageing** | `CreditNote.status ∈ {PENDING, REQUESTED, PROMISED}` and `expectedBy` passed | grey→red by age |

Plus a top strip: *Today's check-ins*, *Unassigned requests*, *My reservations*.

Every row is one click to the reservation drawer. No page reload — same pattern as the precheck queue.

### 6.2 Request Inbox — `/dashboard/reservations/requests`

Bookings with accommodation lines that have **no** `HotelReservation` row yet, or whose reservation is still `REQUESTED`. Derived on read (the precheck approach) so no backfill job is needed.

Each card shows: booking ref, agent, pax, travel dates, the accommodation lines from the TC, the P&L `HOTEL` budget line if one exists, and any customer preference text pulled from the itinerary. Actions: **Claim**, **Start quoting**, **Mark own-arrangement** (reuses `isOwnArrangement()`).

### 6.3 Availability & Rate Workspace

Opened from a request. Three panels:

**Left — the ask.** Dates, pax breakdown, room configuration, meal plan, budget ceiling from the P&L line, customer preferences, and any special requests already known.

**Centre — option cards.** Add an option by picking a `HotelProfile` (autocomplete over the existing 
directory) or typing a new name. Picking a profile pre-fills contacts and, if a live `HotelContract` covers the dates, **pre-fills the contracted rate for the room type and season** — the contract sheet earning its keep. Each card takes: room type, meal plan, nett rate, availability, cancellation policy, validity, pros/cons, and an attached quote file.

**Right — comparison.** Auto-computed per option: total cost for the stay, cost per pax per night, variance vs budget (± and %), margin if the selling price is known, and a policy severity badge (free-cancel window length). Sortable by total, by margin, by star rating. One **Select** button per card writes `selected = true` and a required `selectedReason` — which is what makes the comparison auditable rather than decorative.

**AI assist (optional, `gpt-4o-mini`):** given the customer preference text and the option set, draft a one-paragraph recommendation with reasoning. Logged to `AiUsageLog` like every other call.

### 6.4 Pre-confirmation accuracy gate — duty #14

Before `CONFIRMED` is allowed, a validation pass runs and renders as a checklist. **Blocking:**

- Check-in/check-out dates match the booking's `Accommodation` line (or an explicit override note exists).
- Room count × occupancy covers total pax.
- Lead guest name present and matching a `Passenger` row.
- Nett rate and currency set.
- Cancellation policy captured (text or tiers).
- Confirmation number entered.

**Warnings (non-blocking, must be dismissed with a reason):**

- Total cost exceeds the P&L `HOTEL` budget line.
- Free-cancel window shorter than 7 days.
- Hotel has no verified contact channel (`whatsappVerified = false`).
- Contract expired or absent for these dates.
- Another reservation on the same booking overlaps these dates.

This is the single highest-value component in the proposal: it is the difference between "we think it's right" and "the system checked".

### 6.5 Reservation drawer

The working surface for a single reservation, opened from any list. Tabs:

- **Stay** — all fields, inline-editable, with a diff highlight against the booking's `Accommodation`.
- **Options** — the comparison board, read-only once confirmed.
- **Special requests** — checklist, each with an ack status and the hotel's reply.
- **Communication** — every message sent to this hotel about this stay, plus any linked Query Monitor thread. Compose box with templates.
- **Money** — nett cost, linked P&L line, payment due date, payment request status, proforma invoices, credit notes.
- **Policy** — free-cancel date with a live countdown, the penalty ladder, and a "what would cancelling cost today?" calculator.
- **History** — the `ReservationEvent` trail.

### 6.6 Communication

Reuses the existing WhatsApp sender and Graph mail. Templates needed (registration required with Meta — see the known constraint that free-form text outside the 24 h window is dropped):

| Template | Purpose |
|---|---|
| `hotel_availability_request` | dates, pax, room config → asking availability + rate |
| `hotel_option_hold` | asking for a hold and its release deadline |
| `hotel_booking_confirm` | confirming the option we selected |
| `hotel_amendment_request` | changed dates/rooms/pax |
| `hotel_cancellation_notice` | cancelling, quoting the policy |
| `hotel_special_request` | early check-in / honeymoon / extra bed etc. |
| `hotel_proforma_request` | asking for the proforma invoice |
| `hotel_credit_note_chase` | chasing a pending credit note |

Email versions of each, sent through the existing Graph mailbox, so a hotel that only answers mail is still covered. Every send writes a `ReservationEvent` and sets `lastChannel` / `lastContactedAt`.

### 6.7 Amendment & cancellation flow — duties #6, #7

Amend opens a form pre-filled with current values; changed fields are highlighted. On submit:

1. A snapshot of the pre-amendment state is written to `ReservationEvent` (payload in `note` as JSON, following the `BookingVersion` precedent).
2. Status → `AMEND_REQUESTED`.
3. The amendment message is drafted from a template with the before/after table.
4. When the hotel confirms → `AMENDED` → back to `CONFIRMED` with new values.

Cancel shows the **policy calculator before anything is sent**: today's date against `freeCancelUntil` and `penaltyTiers`, giving "cancelling today costs USD 0" or "cancelling today costs USD 420 (50% of 1 night × 3 rooms)". If a penalty applies and money was already paid, the flow offers to raise a `CreditNote` in the same action. Rebooking is "cancel + create new reservation, linked" — the link kept in `notes` / event trail so the history reads as one story.

### 6.8 Proforma invoice tracker — duty #15

Pipeline view: **Awaiting → Received → Under review → Discrepancy → Verified → Forwarded → Paid**.

Ingest three ways:
1. Manual upload on the reservation drawer.
2. Drag-and-drop into the invoice page.
3. *(Phase 3)* Auto-capture from the reservations mailbox, reusing the `incoming-mail-automation.ts` pattern — hotel invoice mail with a PDF attachment.

On ingest, an AI extraction pass (`gpt-4o` vision, same shape as `extractTicketDetails()`) pulls invoice number, date, amount, currency, tax, and the stay it refers to; the raw payload is kept in `aiExtract` for audit. A **3-way match** then compares: invoice amount ↔ reservation `totalCost` ↔ P&L `HOTEL` budget line. Agreement inside tolerance → `VERIFIED` in one click. Outside → `DISCREPANCY`, with the variance shown and a pre-drafted query message to the hotel.

**Forward** hands it to Accounts: creates the payment request, notifies `AC_USER`, sets `FORWARDED`. Accounts confirming payment on the linked `PNLLineItem` flips it to `PAID` — no new payment mechanism, just a link into the one that exists.

### 6.9 Credit note register — duty #16

A table the team can actually work: hotel, booking, reason, expected amount, raised date, days outstanding, last chased, status. Sorted by ageing. Bulk **Chase** action sends the chase template to every selected hotel and increments `chaseCount`. Ageing buckets (0–30 / 31–60 / 61–90 / 90+) with totals per bucket and per hotel, so "which partner owes us most, longest" is one glance. Applying a credit note against a later invoice records both sides.

### 6.10 Hotel Partner 360 — duty #12

An extension of the existing hotel directory rather than a new one. Per hotel: contact channels and their verification state (already there), plus **reservation history** (count, total spend, cancellation rate), **responsiveness** (median hours to reply, derived from `ReservationEvent`), **reliability** (confirmations honoured, special requests fulfilled, discrepancy count), **contracts** (current + expired, with expiry warnings), and **open money** (unpaid proformas, pending credit notes). A simple partner score out of 5 computed from those, used to sort the option board.

---

## 7. Integration with what already exists

| Existing thing | How the Reservation Team touches it |
|---|---|
| `Accommodation` | Read-only source of truth for what was sold. Reservations point at it softly and show a diff when they disagree — a disagreement is a *finding*, not something to silently overwrite. |
| `HotelProfile` / `HotelContactChannel` | Reused wholesale. The reservation team becomes the primary maintainer of contact verification. |
| `HotelReconfirmation` (D-10 pre-checking) | Stays where it is. A `CONFIRMED` reservation **pre-fills** the reconfirmation row's confirmation number and room detail, so the D-10 call becomes a verification rather than a re-discovery. |
| `PNLLineItem` (category `HOTEL`) | The budget the reservation is measured against, and the payment record Accounts confirms. Linked via `budgetRef`. Nothing about P&L computation changes. |
| `Payment` | Reused for the actual outgoing payment. |
| `QueryMonitorEntry` | A hotel mail thread can be linked to a reservation so the chasing history is one place. |
| `WhatsAppMessage` | Reused for all hotel messaging. |
| Booking detail page | Gains a **Hotels** panel: one row per stay with status chip, confirmation number, and cost — visible to every internal role, editable only by `RS_USER`. |
| `StatusEvent` / audit | Pattern reused; reservations get their own event table rather than polluting the booking trail. |

---

## 8. Notifications

- **To the team:** option release within 24 h; hotel silent > 24 h; payment due in 3 days; proforma overdue; credit note past `expectedBy`.
- **To Accounts:** invoice forwarded for payment; credit note received and applicable.
- **To Booking Team:** hotel rejected / no availability (they must re-sell); reservation cancelled with penalty.
- **To the reservation owner:** a booking they hold is amended upstream (dates or pax changed on the TC) — this one matters most, because an upstream amendment silently invalidating a confirmed hotel is the classic failure mode.

Delivery via the in-app notification path already used elsewhere, plus the daily digest mail.

---

## 9. Reporting

- **Reservation productivity** — requests handled, average time request→confirmed, per user.
- **Rate savings** — selected option vs. cheapest option vs. budget, aggregated. The number that justifies the team.
- **Cancellation cost** — penalties actually paid, by hotel and by reason.
- **Hotel performance** — response time, confirmation reliability, discrepancy rate.
- **Money in flight** — proformas awaiting payment, credit notes outstanding, both by ageing bucket.
- **Deadline compliance** — % of reservations confirmed before their option release, % of proformas received before due.

All exportable to Excel/PDF using the existing download machinery from the Detailed P&L panel.

---

## 10. Suggested build order

**Phase 1 — the spine (highest value, lowest risk)**
`RS_USER` role, permissions, sidebar. `HotelReservation` + `ReservationEvent` models. Request Inbox. Reservation drawer (Stay, History tabs). Lifecycle state machine. Booking-detail Hotels panel.
*Outcome: the team's work becomes visible in the system.*

**Phase 2 — the working surface**
Options + comparison board. Special requests. Communication tab with WhatsApp/email templates. Accuracy gate. Deadline Board.
*Outcome: the team stops using spreadsheets.*

**Phase 3 — the money**
Proforma tracker with AI extraction and 3-way match. Credit note register. Accounts handoff. Payment deadline monitoring.
*Outcome: leakage stops.*

**Phase 4 — the leverage**
Contracts & rate cards with auto-fill. Hotel Partner 360 and scoring. Mailbox auto-capture of invoices. Reporting suite. AI recommendation assist.
*Outcome: the team gets faster instead of bigger.*

---

## 11. Decisions needed before building

1. **Country scope at launch** — all four operations, or Sri Lanka first (where the hotel profile data is richest)?
2. **Does `RS_USER` replace part of TE's pre-checking duty, or run alongside it?** The proposal assumes alongside, with reservations feeding pre-checking.
3. **Currency handling** — hotels quote in local currency (LKR, VND, MYR). Store as quoted with an FX rate at confirm time, or normalise to USD? The P&L is USD.
4. **Who owns own-arrangement stays?** Proposal: excluded from the reservation queue entirely, same as pre-checking treats them.
5. **WhatsApp template registration** — eight new templates need Meta approval before Phase 2 can ship; that is lead time, not build time.
6. **Migration** — every schema change here must go through `db:migrate`, and on live via raw SQL given the known schema drift. No `db push` on production.
