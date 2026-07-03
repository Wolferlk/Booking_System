# Apple Holidays MMT — Booking Verification Workflow

> This document covers the complete booking lifecycle with a focus on the verification flow, QC automation, and the automated WhatsApp & email communication system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [The Verification Workflow — Core Flow](#2-the-verification-workflow--core-flow)
3. [All Booking Statuses — Complete State Machine](#3-all-booking-statuses--complete-state-machine)
4. [Role Permissions (RBAC)](#4-role-permissions-rbac)
5. [QC1 & QC2 — Automated WhatsApp & Email](#5-qc1--qc2--automated-whatsapp--email)
6. [Automated Email System](#6-automated-email-system)
7. [Automated WhatsApp System](#7-automated-whatsapp-system)
8. [How Bookings Are Created (Automation Pipeline)](#8-how-bookings-are-created-automation-pipeline)
9. [Full Feature List](#9-full-feature-list)
10. [API Endpoints Reference](#10-api-endpoints-reference)

---

## 1. System Overview

Apple Holidays MMT is a **multi-role travel booking operations platform** that manages tour bookings across Vietnam, Sri Lanka, Singapore, and Malaysia.

Every booking is a **state machine** — it moves through strictly defined stages, where each stage is gated by role permissions. No one can skip a stage or go backwards without an explicit allowed transition.

### Who Uses The System

| Role | Code | Responsibility |
|---|---|---|
| Booking Team | `BT_USER` | Creates and confirms draft bookings |
| Travel Experience | `TE_USER` | Reviews, verifies, handles QC and customer communication |
| Ground Team | `GT_USER` | Driver allocation, operational execution |
| Combined GT+TE | `GT_TE_USER` | Used for Sri Lanka, Singapore, Malaysia operations |
| Accounts | `AC_USER` | P&L confirmation, payment tracking |
| Client | `CLIENT` | Read-only portal for the travelling customer |
| Super Admin | `SUPER_ADMIN` | Country-scoped administration |
| Ultra Super Admin | `ULTRA_SUPER_ADMIN` | Full system access across all countries |

---

## 2. The Verification Workflow — Core Flow

The focused verification flow requested is:

```
DRAFT  ──────────►  BT_CONFIRMED  ──────────►  GT_REVIEW  ──────────►  GT_VERIFIED
 (created)            (confirmed)             (TE reviewing)         (Client Confirmed)
```

### Step 1: DRAFT

**What it is:** A booking has been created — either automatically from an incoming email/OneDrive file, or manually entered by a staff member.

**What happens at this stage:**
- Booking data is extracted (via AI/GPT-4o from `.docx` TC files)
- Passenger details, flights, accommodation, itinerary items are populated
- The booking has a reference number (e.g. `VN19018`, `IS22001`, `SG00045`)
- P&L lines may or may not be attached yet

**Who can move it forward:** `BT_USER`, `SUPER_ADMIN`, `GT_TE_USER`, `ULTRA_SUPER_ADMIN`

**Gate condition:** At least **one passenger must be added** before the booking can be confirmed.

---

### Step 2: BT_CONFIRMED (Booking Confirmed)

**API endpoint:** `POST /api/bookings/[ref]/confirm`

**What happens:**
- Booking Team reviews and confirms the draft
- Status changes from `DRAFT` → `BT_CONFIRMED`
- A `StatusEvent` audit record is written: *"Booking confirmed by Booking Team"*
- The booking is now ready to be submitted to the Travel Experience team for review

**Who can move it forward:** `BT_USER`, `TE_USER`, `SUPER_ADMIN`, `GT_TE_USER`, `ULTRA_SUPER_ADMIN`

---

### Step 3: GT_REVIEW (Travel Experience Review)

**What happens:**
- The booking is submitted to the Travel Experience (TE) team
- TE team reviews all details: passenger names, passport info, accommodation, itinerary, flights
- TE can either:
  - **Approve** → advance to `GT_VERIFIED`
  - **Request Changes** → send back to `CHANGE_REQUESTED` (requires a note explaining what needs fixing)

**Change Request sub-flow:**
```
GT_REVIEW  ──────────►  CHANGE_REQUESTED  ──────────►  BT_CONFIRMED
              (TE requests fix)              (BT re-confirms after correction)
```
After the Booking Team corrects the issue and resubmits, the booking returns to `BT_CONFIRMED` and can be sent to `GT_REVIEW` again.

---

### Step 4: GT_VERIFIED (Client Confirmed)

**API endpoint:** `POST /api/bookings/[ref]/verify`

**Who can trigger:** `TE_USER`, `SUPER_ADMIN`, `ULTRA_SUPER_ADMIN`

**What happens:**
1. Status changes from `GT_REVIEW` → `GT_VERIFIED`
2. A `StatusEvent` is written: *"Client confirmed by Travel Experience Team"*
3. **An agent confirmation email is automatically fired** (fire-and-forget, does not block the response)
   - Sends to the agent's email address
   - CC'd to `confirm.booking@aahaas.com` (internal traceability)
   - CC'd to the client's contact email (if different from agent)
   - Attaches the **Tour Confirmation PDF**

**Significance:** This is the point at which the booking is considered locked and agreed upon by all parties. Everything after this is operational execution.

---

## 3. All Booking Statuses — Complete State Machine

Below is the full lifecycle from creation to completion:

```
DRAFT
  │
  ▼
BT_CONFIRMED  ◄──────────────────────────────┐
  │                                           │ (resubmit after fix)
  ▼                                           │
GT_REVIEW  ─────────────────► CHANGE_REQUESTED
  │
  ▼
GT_VERIFIED
  │
  ▼
OPERATIONS_READY
  │
  ▼
CLIENT_LIVE  (Client portal unlocked)
  │
  ▼
IN_PROGRESS  (Tour has started)
  │
  ▼
TE_REVIEWED
  │
  ▼
DRIVER_ALLOCATED
  │  (auto-chains immediately ↓)
  ▼
QC1_PASS  ◄──── AUTO (triggered on Driver Allocated)
  │              └─ Fires: WhatsApp Msg 1 + Agent Email
  ▼
TICKETS_ISSUED
  │  (auto-chains immediately ↓)
  ▼
QC2_PASS  ◄──── AUTO (triggered on Tickets Issued)
  │              └─ Fires: WhatsApp Msg 2 (full details)
  ▼
MSG_SENT_CUSTOMER
  │
  ▼
FEEDBACK_DONE
  │
  ▼
COMPLETED
```

**Terminal states:** `COMPLETED`, `CANCELLED`, `AMENDED`

---

## 4. Role Permissions (RBAC)

Each state transition is role-gated. The table below shows who can trigger each step:

| Transition | From → To | Allowed Roles |
|---|---|---|
| Confirm Booking | DRAFT → BT_CONFIRMED | BT_USER, SUPER_ADMIN, GT_TE_USER, ULTRA_SUPER_ADMIN |
| Submit to TE | DRAFT/BT_CONFIRMED/CHANGE_REQUESTED → GT_REVIEW | BT_USER, TE_USER, SUPER_ADMIN, GT_TE_USER, ULTRA_SUPER_ADMIN |
| Request Changes | GT_REVIEW → CHANGE_REQUESTED | TE_USER, SUPER_ADMIN, GT_TE_USER, ULTRA_SUPER_ADMIN |
| Resubmit after Correction | CHANGE_REQUESTED → BT_CONFIRMED | BT_USER, SUPER_ADMIN, GT_TE_USER, ULTRA_SUPER_ADMIN |
| **Client Confirmed (Verify)** | **GT_REVIEW → GT_VERIFIED** | **BT_USER, GT_USER, TE_USER, GT_TE_USER, AC_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN** |
| Mark Operations Ready | GT_VERIFIED → OPERATIONS_READY | GT_USER, TE_USER, GT_TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| Open Client Portal | OPERATIONS_READY → CLIENT_LIVE | GT_USER, TE_USER, GT_TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| Mark In Progress | CLIENT_LIVE → IN_PROGRESS | GT_USER, GT_TE_USER, TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| TE Reviewed | IN_PROGRESS → TE_REVIEWED | TE_USER, GT_TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| Driver Allocated | TE_REVIEWED → DRIVER_ALLOCATED | GT_USER, GT_TE_USER, TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| QC1 Pass | DRIVER_ALLOCATED → QC1_PASS | **AUTO — system triggered** |
| Tickets Issued | QC1_PASS → TICKETS_ISSUED | TE_USER, GT_TE_USER, BT_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| QC2 Pass | TICKETS_ISSUED → QC2_PASS | **AUTO — system triggered** |
| Message Sent | QC2_PASS → MSG_SENT_CUSTOMER | TE_USER, GT_TE_USER, BT_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| Feedback Done | MSG_SENT_CUSTOMER → FEEDBACK_DONE | TE_USER, GT_TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |
| Complete Trip | FEEDBACK_DONE → COMPLETED | TE_USER, GT_TE_USER, SUPER_ADMIN, ULTRA_SUPER_ADMIN |

---

## 5. QC1 & QC2 — Automated WhatsApp & Email

This is the core automation layer of the system. When certain status milestones are hit, the system **automatically fires** WhatsApp messages and emails to the customer and agent — without any manual action required.

### QC1 — Triggered when Driver is Allocated

When a staff member marks a booking as `DRIVER_ALLOCATED`, the system **automatically and instantly**:

1. Advances the status to `QC1_PASS` (no manual step needed)
2. Fires **QC1 Auto-Send** in the background

**QC1 Auto-Send does:**
- Sends the **Agent Confirmation Email** (Type-1 email with PDF attached)
- Sends **WhatsApp Message 1** to the customer's WhatsApp number

**QC1 checks before sending:**
- Client must be in a confirmed state (`GT_VERIFIED` or beyond)
- All driver-required agenda items must have a driver assigned
- All activated tickets must be `PURCHASED` or `PAID`

### QC2 — Triggered when Tickets are Issued

When a staff member marks tickets as `TICKETS_ISSUED`, the system **automatically and instantly**:

1. Advances the status to `QC2_PASS`
2. Fires **QC2 Auto-Send** in the background

**QC2 Auto-Send does:**
- Sends **WhatsApp Message 2** — full trip details (itinerary highlights, hotels, flights)
- Sends the **Agent Confirmation Email** again (updated with final details)

### Manual QC Send

If auto-send fails or needs to be re-triggered manually, the TE team can hit the **QC Send** button which calls `POST /api/bookings/[ref]/qc-send`. This performs the same QC check and fires the same Type-1 messages.

---

## 6. Automated Email System

### What Gets Sent

**Agent Confirmation Email** is the primary automated email. It is sent:
- Automatically when a booking reaches `GT_VERIFIED` (via `/verify` endpoint)
- Automatically on `QC1_PASS` (via `triggerQC1AutoSend`)
- Automatically on `QC2_PASS` (via `triggerQC2AutoSend`)
- Manually via the QC Send button or agent email button

### Email Contents

- **Subject:** `Booking Confirmed — [REF] ([Agent Name])`
- **Body:** HTML email built by `buildAgentConfirmationEmail()` containing:
  - Booking reference and travel dates
  - Passenger list with passport details
  - Accommodation breakdown
  - Flight itinerary
  - Day-by-day itinerary items
  - Emergency contact numbers
- **Attachment:** Full **Tour Confirmation PDF** generated by `generateConfirmationPdf()`

### Email Routing

| Mode | Recipient | CC |
|---|---|---|
| **Production** | Agent's email (`booking.agentEmail`) | Customer's contact email + `confirm.booking@aahaas.com` |
| **Test Mode** | `sasiofficial25@gmail.com` | `sasindu@aahaas.com` |

Test mode is controlled by the `use_test_data` flag in the `SystemSetting` table (togglable without deployment).

### Email Infrastructure

Emails are sent via **Microsoft Graph API** (`sendMailViaGraph`) using the `confirm.booking@aahaas.com` mailbox, which is authenticated via OAuth2 service credentials. This means emails come from a real tracked corporate mailbox — not a no-reply address.

---

## 7. Automated WhatsApp System

### Infrastructure

WhatsApp messages are sent via two possible channels (in priority order):

1. **Meta WhatsApp Business API** — direct integration using `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. Full support for text messages **and PDF document attachments**.

2. **Internal Notify Service** — fallback if Meta credentials are not set. Calls `https://travel-parser-live.aahaas.com/v1/notify/whatsapp` with a secret key. Text-only, no PDF attachment support.

### WhatsApp Message 1 (QC1 — Basic Confirmation)

Sent when the booking passes QC1 (Driver Allocated stage).

**Target:** Customer's WhatsApp number (`contactWhatsapp` or `contactPhone`)

**Content:**
```
Hello [FirstName],
Greetings from Apple Holidays! 🌟

Your booking has been *confirmed*. Please find the attached *Tour Confirmation* for your upcoming trip.

📋 *Booking Reference:* [REF]
📅 *Travel Dates:* [Arrival] – [Departure]
👥 *Passengers:* [X Adults, Y Children]

Kindly review the attached PDF and confirm:
✅ All passenger names & passport details are correct
✅ Accommodation and itinerary are as expected
✅ Flight details (if any) are accurate

We kindly request:
1️⃣ Meal preference — Vegetarian or Non-Vegetarian?
2️⃣ Any special assistance required?

Emergency Contacts:
📞 Helen: +84 94 959 15 36
📞 Senthoor: +91 95852 22335
📞 Tina: +84 94 516 95 95

Please reply with your confirmation at the earliest.
Thank you! 🙏
*Apple Holidays Team*
```

**Attachment:** Tour Confirmation PDF (uploaded to WhatsApp Media API, then sent as a document message)

### WhatsApp Message 2 (QC2 — Full Trip Details)

Sent when the booking passes QC2 (Tickets Issued stage).

**Content includes:**
- Booking reference and travel dates
- **Itinerary highlights** — first 8 agenda days with date, location, and meeting time
- **Accommodation list** — each hotel with city and number of nights
- **Flight summary** — each flight with number, route, departure and arrival times
- Emergency contact numbers
- Confirmation that all arrangements are locked and drivers/guides are coordinated

### WhatsApp Message Logging

Every outbound WhatsApp message (whether auto-sent or manual) is written to the `WhatsAppMessage` table with:
- `bookingRef`, `phone`, `direction: outbound`, `body`, `status: sent`
- `senderName`: either `QC1 Auto-Send`, `QC2 Auto-Send`, or the staff member's name

Incoming WhatsApp messages from customers are received via the **Meta webhook** at `POST /api/webhooks/whatsapp` and also stored in the same table with `direction: inbound`.

This creates a complete **two-way WhatsApp conversation log** per booking, visible in the dashboard.

### Booking Timestamp Fields

When auto-sends fire, the booking record is updated with:

| Field | Set when |
|---|---|
| `qcPassedAt` | First time QC1 or QC2 auto-send runs |
| `qcAutoEmailSentAt` | Agent confirmation email is successfully sent |
| `qcAutoWaSentAt` | WhatsApp message is successfully sent |

---

## 8. How Bookings Are Created (Automation Pipeline)

Bookings can originate in two automated ways — both feed into the same processing pipeline.

### Path A: Email → Booking

1. Microsoft Graph polls configured mailboxes **every 5 minutes** (via `cron/process-mailboxes`)
2. Incoming emails with `.docx` attachments (Tour Confirmation format) are detected
3. The `.docx` text is extracted and passed to **GPT-4o** (`extractBookingFromText`)
4. GPT-4o returns structured JSON: booking ref, agent, passengers, flights, accommodations, itinerary
5. The system creates/upserts the booking in the database
6. If a matching P&L `.xlsx` email arrives (same IS number), it is linked automatically
7. The booking starts at status `GT_REVIEW` (or `DRAFT` if data is incomplete)

**Deduplication:** Processed email IDs are tracked in `SystemSetting` rows with key `processed_email_{graphId}`. Re-processing the same email is safely skipped.

**Waiting state:** If a P&L email arrives before its TC booking exists, it is held in `MailMessage` with `status: WAITING` and retried on the next cron tick.

### Path B: OneDrive → Booking

1. The system polls SharePoint/OneDrive drives **every 3 minutes** (Microsoft Graph delta API)
2. It watches for `TC.docx` and P&L `.xlsx` files appearing in booking folders
3. Same AI extraction and upsert logic as Path A

### AI Extraction (GPT-4o)

| Function | Model | Purpose |
|---|---|---|
| `extractBookingFromText()` | GPT-4o | Parses TC.docx into structured booking JSON |
| `extractPNLFromText()` | GPT-4o | Parses xlsx into P&L line items |
| `classifyPNLCategories()` | GPT-4o-mini | Classifies activity names (HOTEL, TRANSPORT, CRUISE, etc.) |
| `generateAgendaFromBooking()` | GPT-4o | Auto-generates the operational tour agenda |
| `extractTicketDetails()` | GPT-4o Vision | Reads ticket images to extract reference/driver info |

All AI calls are cost-tracked in the `AiUsageLog` table.

---

## 9. Full Feature List

### Booking Management
- Create, confirm, and cancel bookings
- Full state machine with role-gated transitions and audit trail (`StatusEvent`)
- Booking version history (`BookingVersion`) — snapshots the raw document on each amendment
- Change request workflow with mandatory notes
- Country scoping — staff only see their own country's bookings (Vietnam / Sri Lanka / Singapore-Malaysia)
- Bulk delete (admin only)

### Passenger Management
- Add, edit, remove passengers per booking
- Lead passenger flagging
- Passport details, meal preference, special assistance fields

### Flights & Accommodation
- Flight records with route, times, and flight numbers
- Accommodation records with hotel, city, check-in/out, and number of nights
- Both are extracted automatically from TC.docx via GPT-4o

### Tour Agenda & Driver Assignments
- AI-generated agenda from booking data
- Day-by-day agenda items with location, meeting time, service type
- Driver/vehicle assignment per agenda item
- Ground team can view assigned agenda items and receive WhatsApp notifications

### QC Automation (see Section 5)
- QC1: auto-triggered on Driver Allocated — fires agent email + WhatsApp Msg 1 with PDF
- QC2: auto-triggered on Tickets Issued — fires WhatsApp Msg 2 with full trip summary
- Manual QC send button for re-triggering
- QC pass timestamps recorded on the booking

### WhatsApp (see Section 7)
- Outbound: automated messages at QC1 and QC2 with PDF attachment capability
- Inbound: customer replies received via Meta webhook and stored in conversation log
- Per-booking WhatsApp conversation view in dashboard
- Driver WhatsApp notifications for upcoming assignments

### Email (see Section 6)
- Agent confirmation email with full PDF at GT_VERIFIED and QC stages
- Sent via Microsoft Graph from `confirm.booking@aahaas.com`
- CC to customer contact + internal traceability mailbox
- Test mode that redirects all emails to developer addresses

### P&L (Profit & Loss)
- AI extraction of P&L line items from `.xlsx` attachments
- Line items categorised (HOTEL, TRANSPORT, CRUISE, WATER, GUIDES, etc.)
- Formula-computed totals — never stored directly, always recalculated
- Accounts team confirms individual line payment status
- Payment confirmation unlocks ticket purchasing

### Tickets
- Linked to both agenda items and P&L line items
- States: PENDING → PURCHASED → PAID → ACTIVATED
- Accounts confirmation of P&L line required before ticket can be purchased
- AI vision extraction of ticket details from uploaded images

### Client Portal
- Read-only trip view at `/portal/[ref]` for the `CLIENT` role
- Accessible once booking reaches `CLIENT_LIVE` status
- Shows itinerary, accommodation, flight details, and emergency contacts

### Documents & Files
- OneDrive/SharePoint integration for file browsing and document attachment
- Cloud file linking per booking
- Confirmation PDF generation (on-the-fly, attached to emails and WhatsApp)

### Reporting & Accounts
- MC report
- P&L overview with external database sync
- Credit agent tracking and payments
- Per-booking P&L with external ticket system linking

### Admin Features
- User management with role assignment and country scoping
- System settings (test mode, mail toggles, webhook state)
- Activity log — all staff actions recorded
- AI usage log — every GPT call tracked with cost and tokens
- Danger zone — bulk delete (Ultra Super Admin only)
- Webhook renewal cron (keeps Microsoft Graph subscriptions alive)

---

## 10. API Endpoints Reference

### Core Verification Flow

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/bookings/[ref]/confirm` | DRAFT → BT_CONFIRMED |
| `POST` | `/api/bookings/[ref]/resubmit` | CHANGE_REQUESTED → BT_CONFIRMED |
| `POST` | `/api/bookings/[ref]/verify` | GT_REVIEW → GT_VERIFIED (fires agent email) |
| `POST` | `/api/bookings/[ref]/advance-status` | Generic stepper for TE_REVIEWED / DRIVER_ALLOCATED / TICKETS_ISSUED / MSG_SENT_CUSTOMER / FEEDBACK_DONE |
| `POST` | `/api/bookings/[ref]/complete` | FEEDBACK_DONE → COMPLETED |
| `POST` | `/api/bookings/[ref]/cancel` | Any pre-completion state → CANCELLED |

### QC & Communication

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/bookings/[ref]/qc-send` | Manual trigger: QC checks + Type-1 email + WhatsApp Msg 1 |
| `POST` | `/api/bookings/[ref]/send-agent-email` | Send agent confirmation email manually |
| `GET/POST` | `/api/bookings/[ref]/whatsapp` | Fetch or send WhatsApp messages for a booking |
| `GET` | `/api/bookings/[ref]/whatsapp/messages` | WhatsApp conversation history |
| `POST` | `/api/webhooks/whatsapp` | Meta webhook receiver for inbound WhatsApp messages |

### Booking Data

| Method | Path | What it does |
|---|---|---|
| `GET/POST` | `/api/bookings` | List all bookings / create a new booking |
| `GET/PATCH/DELETE` | `/api/bookings/[ref]` | Get, update, or delete a single booking |
| `GET` | `/api/bookings/full/[ref]` | Full booking with all relations |
| `GET/POST` | `/api/bookings/[ref]/passengers` | Passenger management |
| `GET/POST` | `/api/bookings/[ref]/agenda` | Tour agenda |
| `POST` | `/api/bookings/[ref]/agenda/generate` | AI-generate agenda from booking data |
| `POST` | `/api/bookings/[ref]/agenda/send` | Send agenda to customer |

### Automation & Cron

| Method | Path | Cron schedule |
|---|---|---|
| `GET` | `/api/cron/process-mailboxes` | Every 5 minutes |
| `GET` | `/api/cron/onedrive-poll` | Every 3 minutes |
| `GET` | `/api/cron/renew-webhook` | Every 12 hours |
| `GET` | `/api/cron/driver-notify` | Daily |

---

## Key Source Files

| File | Purpose |
|---|---|
| [src/lib/state-machine.ts](../src/lib/state-machine.ts) | All valid status transitions and role guards |
| [src/lib/rbac.ts](../src/lib/rbac.ts) | Role → permission mapping |
| [src/lib/qc-auto-send.ts](../src/lib/qc-auto-send.ts) | QC1 and QC2 auto-send logic (WhatsApp + email) |
| [src/lib/send-agent-email.ts](../src/lib/send-agent-email.ts) | Agent confirmation email builder and sender |
| [src/lib/send-mail.ts](../src/lib/send-mail.ts) | Microsoft Graph mail sender |
| [src/lib/whatsapp.ts](../src/lib/whatsapp.ts) | WhatsApp send utilities |
| [src/lib/incoming-mail-automation.ts](../src/lib/incoming-mail-automation.ts) | Email → booking pipeline |
| [src/lib/mail-processor.ts](../src/lib/mail-processor.ts) | Email body parsing and attachment extraction |
| [src/lib/openai.ts](../src/lib/openai.ts) | All GPT-4o AI extraction functions |
| [src/app/api/bookings/[ref]/verify/route.ts](../src/app/api/bookings/%5Bref%5D/verify/route.ts) | GT_REVIEW → GT_VERIFIED endpoint |
| [src/app/api/bookings/[ref]/advance-status/route.ts](../src/app/api/bookings/%5Bref%5D/advance-status/route.ts) | Auto-chain QC1/QC2 trigger logic |
| [src/app/api/webhooks/whatsapp/route.ts](../src/app/api/webhooks/whatsapp/route.ts) | Inbound WhatsApp webhook |
