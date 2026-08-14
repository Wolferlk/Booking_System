# Daily Work Update — 13 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 13 Aug 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is a detailed summary of today's work, split between the **Accounts System** (Laravel) and the **Booking System** (Next.js / Ops), including the cross-system integrations that connect the two.

---

## 1. Accounts System

### 1.1 Excel Rate Sheet — Manual Editing (new)
The Vietnam agent rate sheet drives how VN P&L products are re-priced. Until now the only way to correct a rate was to re-upload the whole workbook.

- Built a new **Excel Rate Sheet editor** (`/settings/excel-rate-sheet`) — a full browse/search/edit screen over every product row imported from the agent's sheet.
- Added `ExcelRateSheetController` with list, filter, inline edit, bulk edit and revert actions.
- Extended `ExcelProductRate` with **manual-edit tracking** (migration `add_manual_edits_to_excel_product_rates`): a manually corrected rate is flagged, stamped with who changed it and when, and **survives the next rate-sheet upload** instead of being overwritten.
- Every manual value can be **reverted back to the sheet value** in one click, so an accidental edit is never permanent.

### 1.2 Missing Products — Detection, Management & Reporting (new module)
Some P&L products simply do not exist in the agent's rate sheet, so they cannot be priced. Previously these silently landed at zero cost.

- Built `MissingProductService` — scans Detailed P&L lines against the rate sheet and records every product that cannot be priced, with the bookings and dates it appeared on.
- Added the schema (`create_missing_product_tables`): `missing_products` + `missing_product_exports`, with models `MissingProduct` and `MissingProductExport`.
- Added the console command **`ScanMissingProducts`** so detection can run on a schedule as well as on demand.
- Built the **Missing Products management page** (`/settings/excel-missing`):
  - Grouped view by product / country / supplier with occurrence counts
  - **Export to the agent** — produces the chase-up list of products needing a rate
  - **Clear / resolve** flow once the agent supplies the rate, with export history retained
- Surfaced missing products **inline on the Detailed P&L view** — a costing line that cannot be priced is now visibly flagged instead of quietly showing 0.
- Added a **daily Missing Products email report**:
  - New `MissingProductReportSource` plugged into the existing `ReportSourceRegistry` / `ReportSchedule` engine, so it reuses the same scheduler, history, resend and download machinery as the other auto-reports
  - Dedicated HTML mail template (`emails/missing-products-report`)
  - Run / stop / send-now controls on the Missing Products page

### 1.3 Payable 1.0 — Transfer Leg → Driver Allocation (new matcher)
Malaysia and Singapore transfers must be paid to the **specific driver Ops assigned to that movement**, not to a generic supplier.

- Built **`TransferLegMatcher`** — matches each transport payable line to the exact itinerary leg it belongs to (date, direction, route, vehicle, pax), which is what makes a per-movement payment possible.
- Built **`OpsTransferAllocationService`** — reads the Ops-side movement allocations (driver / vehicle / vendor) and brings the assigned party across to the payable line.
- Added the shared **`ResolvesOpsParties`** concern so driver/vendor resolution is identical everywhere it is used.
- Added a **driver pin** on payable records (`add_transfer_driver_pin_to_payable_records`) — once a line is matched to a driver, the allocation is pinned and no longer re-derived, so a later Ops change cannot silently move an already-processed payment.
- Extended the **Payable 1.0 board** with the driver/allocation column, the matcher's confidence state and a manual override where the automatic match is not certain.

### 1.4 Payable 1.0 — Ticket Portals (new, cross-system)
Attraction tickets for MY / SG / VN are bought through online portals. Ops records **which portal** the ticket was bought from; Accounts has to **pay that portal**.

- Created the shared **`payment_portals`** table (`create_payment_portals_table`) plus the `PaymentPortal` model — the single portal master used by both systems.
- Built the **Portals settings page** (`/settings/portals`) with `PaymentPortalController`: create/edit portals, their payment details, currency and country, with access controlled via `config/access.php`.
- Built **`OpsTicketPortalService`** — reads the tickets Ops purchased and the portal each was bought through.
- Built **`TicketPortalMatcher`** — matches Accounts payable lines to those Ops tickets so the payable line knows its portal, ticket reference and purchased amount.
- Added the portal columns to `payable_records` (`add_ops_portal_columns_to_payable_records`) and surfaced them on the **Payable 1.0 board**, so an attraction line now shows the portal to pay, the Ops ticket it came from, and any amount mismatch between the two.

---

## 2. Booking System (Ops)

### 2.1 Ticket Portals — Ops Side (pairs with 1.4)
- Built the **portal management API** (`/api/portals`, `/api/portals/[id]`) and the **Admin → Portals page**, writing to the same shared `payment_portals` table Accounts reads.
- Extended the **ticket purchase flow** (`/api/tickets/[id]/purchase`) so that when a ticket is marked purchased, the **portal used, reference and amount are captured** — this is exactly what the Accounts matcher consumes.
- Updated the booking Tickets page and the TE tickets page to select and display the portal.
- Extended `accounts-db.ts` and added `lib/portals.ts` for the shared portal logic.
- Added the sidebar entry for portal administration.

### 2.2 Hotel Only Bookings (new)
Some bookings are accommodation-only — no transport, no driver, no movements. These were previously flowing through the full operational pipeline and showing up as incomplete forever.

- Added the **Hotel Only** flag on a booking (`prisma/sql/2026-08-13-hotel-only.sql`, `lib/hotel-only.ts`) with the API `/api/bookings/[ref]/hotel-only` and the `hotel-only-control` component on the booking page.
- Updated **booking readiness** so a Hotel Only booking is not held open waiting for transport that will never exist.
- Updated **driver allocation** (`/api/srilanka/driver-allocation`, `lib/driver-requirement.ts`) so Hotel Only bookings no longer demand a driver, and the allocation page reflects this.
- Reflected Hotel Only across the **MC report**, the **Ops board**, the **Ops drilldown** and the **auto-report preview**, so operations can see and filter these bookings distinctly.
- Added **Hotel Only** and **Detailed P&L** filters to the bookings list, its export and its printout.

### 2.3 Hotel Reconfirmation — Facets, Filters and Delay Handling
Continuing yesterday's pre-checking work, today focused on making reconfirmation *manageable at scale*.

- Implemented **reconfirmation facets and filters** on the Ops drilldown and Operations board (`reconfirm-filters.ts`, `ops-day-data.ts`) — filter a day's bookings by reconfirmation state rather than scrolling the whole list.
- Built the **Reconfirmation Delay panel** (`reconfirm-delay-panel.tsx`, `lib/reconfirm-delay.ts`, `reconfirm-delay-shared.ts`) with the API `/api/bookings/[ref]/reconfirm-delay` — staff can record *why* a reconfirmation is late and when it will be chased, and that reason travels into the reports.
- Wired the delay state through **report data, report HTML, the report runner and the report schedules**, so the emailed operations report now explains its own outstanding items.
- Handled **past bookings** correctly — a booking whose travel date has passed no longer nags for reconfirmation, and the UI messaging says so.
- Added **own-arrangement detection** (`lib/own-arrangement.ts`) — guest-arranged stays are correctly treated as *optional* to reconfirm, and the pre-check panel and stay card reflect that instead of showing them as failures.

### 2.4 Last-Minute Booking Alerts (new)
- Implemented **last-minute booking classification** (`lib/last-minute.ts`, `last-minute-shared.ts`) — bookings arriving inside the threshold window are detected and ranked by urgency.
- Added the API `/api/bookings/last-minute`, the acknowledgement schema (`2026-08-13-last-minute-acks.sql`), and an **acknowledgement flow** so an alert stays raised until a user actually accepts it.
- Built the **header alert component** and the **last-minute badge** shown on the bookings list and the booking detail page.
- Added a **settings component** (`last-minute-alert-settings.tsx`, `last-minute-alert-prefs.ts`) on the Admin → Config page so the threshold and alert behaviour are configurable per user rather than hard-coded.

### 2.5 Query Monitor — Daily Mail Statistics (new)
- Implemented **daily mail statistics tracking** across the query-monitor module (`daily-stats.ts`, `daily-stats-sheet.ts`, `/api/query-monitor/daily-stats`).
- Added the **Daily Mail tab** and a **Config tab** to the Query Monitor admin page — per-mailbox counts of received / replied / pending, with the reply source resolved from the group mailbox (`query-monitor-group-mailbox-reply-source.sql`).
- Added **highlighting** (`/api/query-monitor/highlight`) and per-entry updates so a specific query can be flagged for follow-up.
- Reworked `collect.ts` / `run.ts` to gather the statistics as part of the normal monitoring run and push them to the tracking sheet.

### 2.6 MC Report Enhancements
- Added **guide and tour vendor details** to the MC report and its printout.
- Built the **Assign Movement modal** — assign a driver / guide / vendor to a movement directly from the report instead of going into each booking.
- Added the **agent name column** to both the MC report page and its print view.

### 2.7 Access & Permissions
- Updated the **Vietnam ground team** role: refined permissions in `rbac.ts` and `middleware.ts`, and granted the appropriate level of P&L access with clearer role descriptions on the Admin → Users page.

---

## 3. Cross-System Integrations Delivered Today

| Integration | Ops (Booking System) writes | Accounts reads / does |
|---|---|---|
| **Ticket Portals** | Portal master + portal captured on ticket purchase | `TicketPortalMatcher` links payable lines to Ops tickets → Payable 1.0 pays the portal |
| **Transfer Driver Allocation** | Driver/vendor assigned to each movement | `TransferLegMatcher` + `OpsTransferAllocationService` pay the MY/SG transfer to that driver |
| **Missing Products** | Detailed P&L lines | Detection, agent export and daily email of unpriceable products |

---

## Summary

| Area | Items Delivered |
|---|---|
| Accounts System | Excel rate sheet manual editing, Missing Products module (detect / manage / export / daily report), Payable 1.0 transfer-leg driver allocation, Payable 1.0 ticket portals |
| Booking System | Ticket portal management + purchase capture, Hotel Only bookings, reconfirmation facets & delay handling, last-minute booking alerts, Query Monitor daily mail stats, MC report guide/vendor + movement assignment, VN ground team permissions |

**Commits today:** 5 on the Accounts System (`ba8df7a` → `cdc52e9`, branch `REV1`) and 15 on the Booking System (`deb4bc8` → `d9fbab5`, branch `Main_v7_DEV`).

Happy to walk through any of the above — particularly the Payable 1.0 ↔ Ops matchers (portals and transfer drivers), which are the pieces that now close the loop between operations and payments.

Best regards,
**Sasindu Diluranga**
