# Daily Work Update — 01 September 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 01 Sep 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is a detailed summary of today's work, split between the **Accounts System** (Laravel) and the **Booking System** (Next.js / Ops).

The day was almost entirely an **Accounts System** day — eleven commits — with one focused change on the Ops side. Four threads ran through it:

1. **Money has to be stated at a rate somebody can point at.** Exchange rates moved to two-decimal precision everywhere they are printed, exports learned to carry the board's own rate, and a super admin can now pin an invoice's rate by hand so it stops drifting.
2. **A supplier's own P&L document can now become a board record.** A ~2,800-line new module reads a supplier's Word P&L, synthesises an Apple System-shaped payload from it, and files it as an ordinary Detailed P&L.
3. **The P&L board stopped hiding things from the person searching it.** IS-number search became a lookup rather than a filtered search, cancelled bookings became visible on request, duplicates now say *where* the other copy is, and the Apple System's own created / updated timeline is printed on the sheet.
4. **The daily emails learned to say where their amendments came from**, and `/daily-updates` gained an invoices-and-profit panel.

---

## 1. Accounts System (Laravel)

### 1.1 Payable 1.0 — hotel stays now pay on the hotel's own due date (`7ed7844`, 10:44)
The Sri Lanka hotel section is placed by the hotel's *own* payment day rather than the booking's arrival, but a hotel-stay row built from a **budget** allocation was falling through that rule and landing on the booking's date instead — so a payment could be scheduled after the property expected it.

- `PayableReportService` now resolves the payment due date for budget-derived hotel stay rows through the same hotel payment-day path that ordinary hotel rows use (+43 / −3 lines, one file).
- Nothing else about the row changes — the supplier, the amount and the sync key are untouched, so no existing payment is orphaned by the correction.

### 1.2 Duplicate P&L records now tell you where the other copy lives (`6a5d29b`, 12:13)
"This record already exists" is only useful if it says *which* record and *where*. Previously the desk had to go hunting.

- New **`app/Support/PnlRecordLocator.php`** (+109) — given a booking, returns the page and the anchor where the existing record can be opened.
- Wired into **`DbPnlController`** (+65) and **`PnlUploadController`** (+22), so both the board and the upload path answer with a link rather than a bare refusal.
- **`OneDriveService`** (+37 / −14) updated along the same path, so a OneDrive-sourced duplicate reports identically to a hand-uploaded one.
- Views updated: `pnl/db-pnls.blade.php` and `pnl/upload.blade.php` render the reference.

### 1.3 Supplier P&L → board: read the supplier's document, file it as a P&L (`9429e2d`, 13:41) — **largest item of the day**
Some bookings are costed by a supplier who sends a Word P&L rather than anything the Apple System ever saw. Those had no route onto the board at all.

- **`SupplierPnlParser.php`** (+853) — reads the supplier's `.docx` costing sheet: sections, line names, per-day rows, quantities, rates and totals.
- **`SupplierPnlPayloadBuilder.php`** (+360) — turns the parsed sheet into an **Apple System-shaped `as_payload`**, which is the important design decision: from that point on the record is an ordinary P&L. The Detailed P&L overlay, the payable builders, the exports and the reports all read it through their existing paths, with no special case anywhere downstream.
- **`SupplierPnlRecordService.php`** (+361) — creates / updates the `pnl_records` row from the synthesised payload.
- **`SupplierPnlController.php`** (+437) and 13 new routes.
- **`add-pnl-modal.blade.php`** (+808) — the "Add New PNL" dialog on `/pnl/db`: upload, review what was read line by line, correct anything, then file.
- Two real supplier documents (`MY23077 - PNL.docx`, `MY23130 - PNL.docx`) committed as fixtures so the parser can be re-checked against genuine input.
- **2,846 insertions, no deletions** — the module is entirely additive and touches no existing costing path.

### 1.4 Board-specific FX on exports (`68f5b91`, 14:52)
A Payable 1.0 export was printing raw amounts while the board on screen showed converted ones, so the workbook and the page disagreed.

- `payables/v1/index.blade.php` — the export now carries the **board's own FX rate** and the converted amount, so the spreadsheet says what the board says.
- Verified by producing a real workbook (`payable-1.0-SL-hotel-arrival-D2-2026-09-01.xlsx`, committed as evidence).

### 1.5 Rates to two decimals, everywhere they are printed (`46d096d`, 15:01)
Six-decimal rates are correct for CBSL's publication and wrong for a document a person signs — a driver advance receipt printed `301.482900`, which reconciles against nothing anybody wrote down.

- **`SlPayableSettings::standardRate()` / `setStandardRate()`** — rounded to two decimals at the settings boundary, so the stored figure and the printed figure are the same number.
- Manual rate entry `step` changed to two decimals on `payables/v1/index.blade.php` and on the settings page, so the input cannot accept precision the system will then round away.
- Display updated in `daily-updates/index.blade.php`, `driver-advance-receipt.blade.php` and `settings/payables.blade.php` (standard rate and CBSL rate side by side).
- `PayableV1Controller` (+60 / −13) and `PayableSettingsController` adjusted to match.

### 1.6 Manual FX lock on an invoice — super admin only (`402591b`, 15:43)
An invoice's rupee value was being restated at *today's* rate every time somebody opened it. For an invoice already settled, that is a number that changes after the money has moved.

- Migration **`add_manual_fx_lock_to_generated_invoices`** — forward-only and additive; every existing invoice reads back as *not locked*, which is exactly what it knew before.
- **`GeneratedInvoice`** (+80 / −7) — the lock is honoured wherever the rate is resolved, so one locked invoice cannot be restated by any other code path.
- **`InvoicePaymentController`** (+93) and 4 routes — set, clear and audit the lock.
- **`invoices/payments.blade.php`** (+218) — the UI, gated to **super admin**. Fixing a rate by hand overrides a published figure, so it is deliberately not an everyday permission.

### 1.7 `/daily-updates` — Invoices & profit panel (`0243389`, 16:12)
A read-only panel between the KPI strip and the filters, driven by the FROM/TO period already on the page. No migration, no write path.

Four cards:
| Card | What it answers |
|---|---|
| **Created invoices** | Invoices dated inside the period — count, value chips per currency, a daily sparkline (today highlighted, hover gives that day's count and value), and a footer of bookings billed / settled / voided |
| **Travelling in period** | The invoices of the bookings actually on the sheet — count, value per currency, what agents have settled, how many bookings still have no invoice. Follows every filter on the page |
| **Profit in period** | Headline figure, per-currency chips, cost/profit bar with margin %, and a **P&L / Invoice basis switch** — P&L's own value less cost, or the invoice raised less the booking's cost |
| **Payable in period** | What these lines owe suppliers, as a paid / still-to-pay stacked bar |

Below them, a per-currency table printing the arithmetic: created count & value, received, travelling count & value, booking value, cost, profit, margin.

Three decisions worth recording:

- **Nothing is added across currencies.** Invoices are INR and USD while bookings are costed in USD / MYR / SGD; a single "invoice − payable" total would be a number in no currency at all. This follows the rule already set in `AccountsDailySummaryService::b2bRow()`. Profit is stated per currency, and the *Invoice* basis only counts bookings billed in the currency they were costed in — the card names how many were excluded and why.
- **Created and travelling are separate reads.** An invoice raised today for a November booking is on no row of this sheet, so the created half is a new server endpoint (`GET /daily-updates/invoices`); the travelling half and the margin are summed in the browser from rows already loaded, so they always agree with what is on screen. Country resolves by booking key against the stored P&Ls, with the invoice-number prefix as fallback; B2C (`AH…`) and unmatched invoices are reported in the panel header rather than silently folded into a country.
- **`profit_loss` can disagree with `amount − cost_total`** on some records (MY 23077: value 3,680, cost 4,838, stored profit 432). The stored figure is kept as authority, as the rest of the codebase does, and the table prints all three side by side so the disagreement is *visible* rather than hidden.

Verification: PHP lint on all changed files, Blade compiles, extracted JS passes `node --check`, and `invoiceSummary()` returns sane figures for all four tabs over August (SL 308, VN 779, MY 36, SG 39 invoices). **No tests run** — the suite drops tables in `tearDown` and `.env` points at production.

Files: `DailyUpdateController` (+25), `DailyUpdateService` (+251), `InvoiceReportService` (+208), `PnlDbReportService` (+115), `InvoiceReportSource`, `PayableV1Controller`, `daily-updates/index.blade.php` (+615), 2 routes.

### 1.8 Both auto-report emails now split amendments by the age of the booking behind them (`2ce2f69`, 16:17)
A day's amendment count says nothing useful on its own — re-issuing today's booking and re-opening a booking from six weeks ago are different events with different consequences. New section in each email, **"Amendments — where they came from"**: a share bar plus a card row.

| Card | Means |
|---|---|
| Booked & amended same day | Raised and re-issued inside the period — the day's own churn |
| Older confirmations edited | First raised on an earlier day, re-opened in this one |
| How far back they reach | Age bands 1–7 / 8–30 / over 30 days, plus average age |
| Oldest booking re-opened | Age of the oldest booking touched |
| Origin not on record | Only where a booking's first document cannot date it — **never guessed into either side** |

How the age is derived:
- **Invoices** — `InvoiceReportService::analytics()` now returns `brands[*]['origins']`. Added `ledgerHistory()` (one ledger read, now also selecting `created_at`, shared with `previousDocuments()` so it stays a single query), `originDocuments()` (the *earliest* document in the ledger, not the one it replaced) and `recordOrigin()`. Days resolve in the report timezone, which `InvoiceReportSource` now passes through.
- **P&L** — a row's `as_created_at` is the *revision's* date, since the Apple System cuts each revision as a new booking. So `firstRaisedDates()` looks up the earliest date recorded against the row's `as_quotation_no` — the one id that survives revisions.
- In both, a lineage whose earliest stored record is itself already an amendment (the original was never held here) counts as **unknown** rather than inflating the same-day figure. Both lookups are wrapped so a failure degrades to *unknown* instead of breaking a send.
- The section is **hidden on a re-send of a report stored before this existed**, so an old report does not render a row of zeroes that would read as "no old bookings were touched".

Verified by compiling both Blade views and rendering them end to end with synthetic data, and by exercising both `analytics()` methods on in-memory rows (same-day / 12-day-old / no-origin cases bucket correctly; the combined report re-weights the average by each business's carried count rather than averaging two averages). **No database or mail touched.**

### 1.9 Apple System timeline strip on the Detailed P&L (`23d92e5`, 17:27)
A strip directly under the Tour No / IS Number / Agent fact box: **Created · Last updated · Synced here**.

- `AsPnlSyncService` — the stored `as_payload` now keeps a `booking` node carrying the Apple System's own `created_at`, `updated_at`, `update_count` and `status`. `as_created_at` is a **date** column, so the full stamps previously had nowhere to live. The per-booking "Fetch from AS API" refresh goes through the same `prepare()`, so it picks them up too — and the refresh diff compares only the `pnl` node, so this does not register as a change.
- `DbPnlController` (+70) — `as_timeline` on the detail JSON: created, last updated, when we last mirrored it (rendered in Asia/Colombo), the AS edit count and the revision.
- `detailed-pnl-scripts.blade.php` (+77) — `dtAsTimeline()` renders the strip with a relative hint ("3 days ago") beside the update stamp. On the live `/pnl/as` page (no stored payload) it falls back to the booking row's own stamps.
- **Expected behaviour on old rows:** records synced before the `booking` node existed show *Created* as a date only, and *Last updated* reads "not recorded — fetch this booking from the AS API to pick it up", until the nightly sync or a manual refetch touches them. **No schema change; nothing run against the database.**

### 1.10 IS number in the search box is a lookup, not a filtered search (`3a7b01e`, 17:59)
Typing an IS number and getting nothing back — because the date window or country filter silently excluded it — is the board lying to the person using it.

- `DbPnlController::resolveFilters()` — if the search term normalises to an IS number (`AppleSystemApiService::normaliseIsNumber`), the status, country and date window reset to *everything stored* before the query is built. Any **other** search term (agent, sales person) keeps the filters it was typed under, since that is a genuine narrowing of the visible list.
- Because every consumer reads the same `resolveFilters()`, the listing, the KPI totals, the cancelled-hidden count and "Download Filtered Report" all agree. This also makes the search box's existing placeholder ("IS 48288 … searches all dates") **true** — it was claiming that already.
- A hint renders under the search field while an IS lookup is active, since the date / country / status controls stay on screen showing values that are being ignored for that search.
- The search-miss rescue message no longer says "it falls outside the filters currently applied", which is now never the reason — a stored booking that still is not listed is held back by the board's own rules, and the message names which.

### 1.11 Cancelled bookings can now be shown in P&L listings and reports (`c8f4eb7`, 18:12)
The natural follow-on from the item above: cancelled records were excluded by a rule separate from the filters, so an IS lookup could still come back empty with no explanation.

- `DbPnlController` (+45) — an explicit *include cancelled* control; the listing, the counts and the export all honour it through the shared filter path.
- `PnlDbReportService` (+10) — the same option reaches the scheduled report, so a report can state cancellations rather than quietly dropping them.
- `pnl/db-pnls.blade.php` (+31) — the toggle plus the hidden-count line that tells you how many rows the rule is currently withholding.

---

## 2. Booking System (Ops)

### 2.1 Reconfirmation delay — the reason is now recorded properly (`8249726`, 10:56 · merged as PR #314)
The D-10 hotel reconfirmation queue lets a user defer a reconfirmation, but the reason it was deferred was being recorded inconsistently between the API and the panel — so the queue could show a delay with no usable explanation behind it.

- **`reconfirm-delay-shared.ts`** (+26, new) — one shared definition of the reason set and its validation, so the route and the UI can no longer disagree about what a valid reason is.
- **`api/bookings/[ref]/reconfirm-delay/route.ts`** (+39 / −16) — reason recording reworked to write through that shared definition.
- **`reconfirm-delay-panel.tsx`** (+60 / −16) — the panel reads the same list.
- Added a new reason: **"Awaiting client confirmation"** — the case the existing set had no honest option for, which is how blank and mis-filed reasons were getting into the queue in the first place.

---

## 3. Summary

| Area | Items delivered |
|---|---|
| **Accounts System** | Supplier P&L → board module (parser + payload builder + record service + review modal, 2,846 lines); `/daily-updates` invoices & profit panel; amendment-origin split on both auto-report emails; manual FX lock on invoices (super-admin, migration); two-decimal rate precision across settings, receipts, exports and inputs; board-specific FX on Payable 1.0 exports; hotel-stay budget rows pay on the hotel's own due date; duplicate P&L records report where the other copy lives; Apple System created/updated/synced timeline on the Detailed P&L; IS number search is a lookup; cancelled bookings can be included in listings and reports |
| **Booking System** | Reconfirmation-delay reason recording unified between API and panel via a shared module, plus a new "Awaiting client confirmation" reason |

**Commits today:** 11 on the Accounts System (`7ed7844` → `c8f4eb7`, branch `REV1`) and 1 on the Booking System (`8249726`, merged as PR #314 from `Main_v7_DEV`).

**Migrations added today (forward-only and additive):** `add_manual_fx_lock_to_generated_invoices` (Accounts). No other schema change; nothing was run against a live database.

**Verification note (honest state):** the production RDS is not reachable from this machine, so everything today was verified by lint, Blade compilation, `node --check` on extracted JS, synthetic-data renders and in-memory harnesses. **The PHPUnit suite was not run** — it drops tables in `tearDown` and `.env` points at production.

Happy to walk through any of the above — particularly the **Supplier P&L module** (it is the one that adds a new way for a record to reach the board) and the **amendment-origin split**, which changes how both daily emails should be read.

Best regards,
**Sasindu Diluranga**
