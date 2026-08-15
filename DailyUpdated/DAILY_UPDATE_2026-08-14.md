# Daily Work Update — 14 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 14 Aug 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is a detailed summary of today's work, split between the **Accounts System** (Laravel) and the **Booking System** (Next.js / Ops), including the cross-system integrations that connect the two.

---

## 1. Accounts System

### 1.1 Ticket Approval Process for Ground Team Requests (new module)
The ground teams request attraction tickets; until now Accounts had no formal step between "requested" and "paid".

- Built the **`ticket_approvals`** schema (migration `create_ticket_approvals_table`) with the `TicketApproval` model — request, approver, decision, amount and full state history on each request.
- Built **`TicketApprovalService`** — the approval lifecycle: raise, approve, reject, re-submit, and the guards that stop an unapproved ticket being paid.
- Wired approvals into **`PayableV1Controller`** and the **Payable 1.0 board** — an attraction line now shows its approval state, and the decision can be taken from the board itself.
- Added the notification hooks in `NotificationController` so a pending approval is surfaced to the approver instead of sitting silently.

### 1.2 SL Booking Count Check — Reconciliation Page (new module)
Sri Lanka arrivals in Ops and driver advances in Payable 1.0 were drifting apart, and the gap was only ever found by hand.

- Built **`SlBookingCountCheckService`** — compares the Ops arrival list for a day against the Payable 1.0 driver-advance lines and reports exactly which bookings are missing on either side.
- Built **`SlBookingCountRepairService`** — repairs the discrepancies it finds rather than just listing them, so a missing booking can be pulled in on the spot.
- Added the **`/sl-booking-count`** reconciliation page (`SlBookingCountController`, `reconciliation/sl-booking-count` view) with day selection, per-booking comparison detail and the repair action, plus the access entry in `config/access.php`.
- Added the console command **`CheckSlBookingCount`** so the same check runs unattended.
- Refined the booking comparison logic so genuinely equivalent bookings no longer show as differences.

### 1.3 SL Count Check — Automatic Sweep & Email Report (new)
- Built **`SlCountCheckSweepService`** — sweeps the D+0 … D+8 window on a schedule, checking and repairing each day automatically.
- Added the command **`SweepSlBookingCount`** and its schedule entries in `routes/console.php`.
- Added **`SlCountCheckReportSource`** into the existing `ReportSourceRegistry` / `ReportSchedule` engine, so the count check reuses the same scheduler, history, resend and download machinery as the other auto-reports.
- Built the dedicated mail template (`emails/sl-count-check-report`) and the installer command **`InstallSlCountCheckAlert`**, so anything still unrepaired at D+4 / D+1 is emailed out rather than discovered late.

### 1.4 Hotel-Only Bookings — Payable Side (pairs with yesterday's Ops flag)
- Substantially reworked **`SlHotelOnlyBookingService`** so accommodation-only bookings produce correct payable lines without expecting transport that will never exist.
- Updated `PayableV1Controller` and the Payable 1.0 board to present these bookings distinctly.

### 1.5 Payable 1.0 — Driver Advance for Uncosted Bookings
- Extended `PayableV1Controller` and `PayableReportService` so a booking that has **not yet been costed** can still carry a driver advance — previously the advance was blocked until costing existed, which held up drivers on late bookings.
- Surfaced the uncosted state on the board so it is visible why the figure is provisional.

### 1.6 SL Hotel Supplier Auditing (new tooling)
- Added the command **`AuditSlHotelSuppliers`** — audits Sri Lanka hotel payable lines against the supplier master and reports unmatched or ambiguous suppliers.
- Added **`DiffSlHotelPayables`** — diffs hotel payables between runs so a change in the computed payable can be traced to its cause.
- Extended `PayableReportService` with the supporting resolution logic.

### 1.7 AS PNL Import into the PNL Database
- Added **`AsPnlImportService`** plus the import action on the **AS PNLs** page — a live AS PNL can now be imported straight into the local `pnl_records` database instead of waiting for the nightly sync.
- Improved **IS number matching** in `AsPnlImportService` and `PnlDbReportService`, which is what decides whether an imported PNL lands on the right booking.

### 1.8 Last-Minute Alerts — Channels & Per-User Preferences
- Added **channel tracking** to last-minute alerts (migration `add_channel_to_last_minute_alerts`) with the `LastMinuteAlert` model, so each alert records how it reached the user.
- Added the **`alert_preferences`** table and `AlertPreference` model — alert behaviour is now configurable per user rather than global.
- Built the **live last-minute alert view** (`notifications/last-minute-live`) and extended `NotificationController`, `NotificationSettingsController`, `LastMinuteAlertService` and the app layout to drive it.

---

## 2. Booking System (Ops)

### 2.1 Ticket Approval Workflow for Malaysia, Singapore and Vietnam (pairs with 1.1)
- Added the approval schema (`prisma/schema.prisma`, `manual-sql/2026-08-14-ticket-approvals.sql`) and the API `/api/tickets/[id]/approval`, plus approval-aware updates to `/api/tickets`, `/api/tickets/[id]` and `/api/tickets/[id]/purchase`.
- Updated the ticket creation routes (`pnl/create-tickets`, `ext-pnl/create-tickets`) so tickets are raised into the approval flow rather than straight to purchase.
- Updated the booking **Tickets page** and the **TE tickets page** so the ground team can request, track and act on approvals.
- Enhanced **approval history tracking** in `lib/ticket-approvals.ts` — every decision on a ticket is retained and readable, not just its current state.

### 2.2 Accounts Integration Endpoint — SL Booking Repair (new, cross-system)
- Built `/api/integrations/sl-booking-repair` — the endpoint the Accounts count check calls to retrieve a booking from **AppleSystem / OneDrive** when it is missing on the Ops side.
- Added the supporting environment configuration in `.env.example`.

### 2.3 Last-Minute Booking Board & Panel (D-4)
- Built the **last-minute board API** (`/api/bookings/last-minute/board`) and the **last-minute panel** component — the permanent board beside the header bell, showing every booking arriving inside the D-4 window.
- Extended `lib/last-minute.ts` with the board data logic and added the header entry point.

### 2.4 WhatsApp — Related Threads
- Added **related-thread support** to the WhatsApp inbox and the booking mini-chat: conversations and messages APIs now resolve threads related to the same booking/contact, so a conversation split across numbers reads as one history.

---

## 3. Cross-System Integrations Delivered Today

| Integration | Ops (Booking System) writes | Accounts reads / does |
|---|---|---|
| **Ticket Approvals** | Ground team raises the ticket request and sees the decision | `TicketApprovalService` approves/rejects; Payable 1.0 will not pay an unapproved ticket |
| **SL Booking Count Check** | `/api/integrations/sl-booking-repair` serves the missing booking from AppleSystem / OneDrive | `SlBookingCountCheckService` + `SlBookingCountRepairService` find and repair the gaps, swept and emailed automatically |
| **Last-Minute (D-4)** | Board API + header panel | Channel-tracked alerts with per-user preferences |

---

## Summary

| Area | Items Delivered |
|---|---|
| Accounts System | Ticket approval module, SL Booking Count Check page, automatic sweep + email report, hotel-only payables, driver advance for uncosted bookings, SL hotel supplier audit tooling, AS PNL import, last-minute alert channels & preferences |
| Booking System | Ticket approval workflow (MY/SG/VN) with history, SL booking repair integration endpoint, last-minute D-4 board & panel, WhatsApp related threads |

**Commits today:** 10 on the Accounts System (`871f4cd` → `0a707d4`, branch `REV1`) and 5 on the Booking System (`4cc7557` → `0856b31`, branch `Main_v7_DEV`).

Happy to walk through any of the above — particularly the SL Booking Count Check, which now closes the loop between Ops arrivals and driver advances on its own, and the ticket approval flow that spans both systems.

Best regards,
**Sasindu Diluranga**
