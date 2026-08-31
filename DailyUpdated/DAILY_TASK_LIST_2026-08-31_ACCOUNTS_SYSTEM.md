# Today Daily Task List — 31 August 2026

**System:** Accounts System (Laravel — `email-invoice-processor/`)
**Owner:** Sasindu Diluranga
**Date:** 31 August 2026
**Branch:** `REV1`
**Working rule:** Live production data. Read-only checks only. No `migrate:fresh` / `refresh` / `rollback` / `db:wipe` / `db:seed`, no raw `DELETE`/`UPDATE`/`TRUNCATE`, no writes on the B2C or B2B connections, no test suite against a remote host. Ask before email, third-party writes, commits, pushes or restarts.

## Main outcome for today

Ship and verify three things delivered today: the **Aahaas B2B (Flights) module** — a read-only view of the agent-portal `b2b_*` tables with booking detail, invoice and PDF export; **Report Studio**, the rewrite of `/reports/month-wise` into any-period, three-business reporting with a column picker and Excel/CSV/PDF exports; and the **custom Bootstrap pagination views** now applied app-wide. Plus the Detailed P&L modal-position fix.

## 1. Aahaas B2B (Flights) module — new, read-only — high priority

Commits `1b88f12`, `2637d36`. `B2bBookingService` (~1,050 lines), `B2bBookingController`, `b2b/index`, `b2b/show`, invoice + booking PDF views, new connection in `config/database.php`, `config/access.php` grants.

- [ ] Confirm the new `b2b` connection in `config/database.php` points at the agent-portal schema and is used **read-only** — no model writes, no migrations, no seeds on it.
- [ ] Verify `.env.example` documents every new B2B key and that no live credential was committed.
- [ ] Open `/dashboard/b2b-flights` (list) — confirm only `confirmed`, non-deleted bookings appear, newest first.
- [ ] Test filters and search: reference, PNR, hotel name, policy number, passenger blob, payment status, component, booked-date range.
- [ ] Open a booking detail page and cross-check flights, hotels, insurance and experiences against the raw JSON inspector — segments and passenger manifest must populate on a real row.
- [ ] Verify the table-existence probe (`2637d36`) behaves correctly where a `b2b_*` component table is missing: warn and degrade, never fatal.
- [ ] Confirm the trimmed database-name return value is correct on both connections.
- [ ] Test "View invoice" (HTML), "Invoice PDF" and "Download details" — check the per-component lines, subtotal, adjustment row and Paid/Unpaid stamp.
- [ ] Confirm mixed component currencies are **declared, never summed**.
- [ ] Verify the `access.php` grants: only the intended roles see the sidebar entry, and the route is blocked server-side for everyone else.
- [ ] Reconcile a sample of B2B totals against the Fligths_dash source before showing anyone the figures.

## 2. Report Studio — `/reports/month-wise` rebuilt

Commit `c392348`. New `ReportStudioController` + `Services/Reports/Studio/{ReportStudio, ReportColumns, ReportExporter, ReportFormatter, ReportPeriod}`, PDF export view, `month-wise.blade.php` rewritten.

- [ ] Confirm **every** query in the Studio path is a SELECT — re-run the smoke pass behind the `DB::listen` guard that throws on insert/update/delete/drop/truncate/alter/create.
- [ ] Verify old links still resolve identically: `?month=&year=` and `?start_date=&end_date=`.
- [ ] Test each period mode — Day / Week / Month / 3 months / Year / Custom — and the quick jumps (Today, Yesterday, This/Last week, This/Last month, Last 3 mo, This year).
- [ ] Confirm the trend chart auto-buckets by day/week/month so a year is not 365 points.
- [ ] Check all three business tabs — Apple System (B2B), Aahaas B2C, Aahaas B2B (Flights) — return the same window, and the comparison panel loads after render.
- [ ] Confirm the table opens on exactly the original 14 columns; the extra ~32 are opt-in through the picker.
- [ ] Verify the Reconciliation group: P&L restated in the invoice currency, variance and variance %. Re-check the VN41523 case (INR 65,008 vs USD 671.30 → 64,834.15, variance 173.85 / 0.27%).
- [ ] Confirm unmatched rows tint amber and cancellations red.
- [ ] Test Excel (summary sheet + per-currency totals + optional extra business sheets), CSV and PDF — each must contain exactly the columns on screen.
- [ ] Confirm currencies are never added together anywhere, and a money column with no row in that currency prints **blank, not 0**.
- [ ] Re-measure page weight after the markup tightening (month ≈ 761 KB, quarter ≈ 1.9 MB) and confirm no regression.
- [ ] Confirm the removed `ReportController::monthWise` / `exportMonthWise` helpers are genuinely unreachable and that `index`, `dateWise` and their exports are untouched.
- [ ] Verify the renamed sidebar entry / `reports_month` grant ("Report Studio") still covers every new sub-route under the `reports.month-wise` name prefix — no access-config change should be needed.
- [ ] Confirm timezone handling resolves days in Asia/Colombo (`config app.report_timezone`), not UTC.

## 3. Pagination views — app-wide UI change

Commit `9ea350d`. `vendor/pagination/aahaas.blade.php`, `aahaas-simple.blade.php`, registered in `AppServiceProvider`.

- [ ] Confirm the paginator default set in `AppServiceProvider` applies everywhere and no page still renders Tailwind/Bootstrap-4 default markup.
- [ ] Walk the main paginated pages — invoices, P&L, payables, reports, B2C, B2B — first / middle / last page, and the single-page case.
- [ ] Verify query strings (filters, date ranges, sort) survive page links on each of those pages.
- [ ] Check `simplePaginate` pages render the simple view correctly.
- [ ] Confirm accessibility bits: disabled prev/next, `aria-current` on the active page, keyboard focus visible.
- [ ] Check the views on a narrow viewport — pagination must not force horizontal scroll.

## 4. Detailed P&L — modal positioning fix

Commit `bbdb911`, `pnl/partials/detailed-pnl-scripts.blade.php`.

- [ ] Open the Detailed P&L modal from `/pnl/db` and confirm it is positioned usably at short and tall viewports, and when the page is scrolled.
- [ ] Confirm stacked dialogs (edit figures, diff popup) still layer correctly and body scroll is restored on close.
- [ ] Confirm no behaviour changed beyond position — figures, edit and revert paths untouched.

## 5. Safety and release preparation

- [ ] Re-confirm nothing in today's diff writes to the B2C or B2B connections.
- [ ] Confirm no migration was added today; if any schema change is needed, `php artisan migrate --pretend` first and get sign-off.
- [ ] Review the diff for secrets, tokens, production URLs or customer data (`.env.example` changes especially).
- [ ] Check logs for DB connection errors on the new B2B connection and for slow queries on Report Studio's wide windows.
- [ ] Do not run the PHPUnit suite unless the test connection is confirmed local — it drops tables in `tearDown` and the `TestCase` remote-host guard must stay in place.

## 6. Known follow-up

- [ ] `InvoiceReportService::download()` references an undefined `$onlyBrand` (~line 645) on the `/reports` export path. Harmless today (reads as null, the intended default) but latent — decide whether to fix now.
- [ ] Confirm with the user whether the B2B schema name is correct in this environment before anyone reads the figures as authoritative.

## Handoff checklist

- [ ] Record routes tested, sample bookings/invoices checked and the reconciliation figures verified.
- [ ] Note the B2B connection settings needed for deployment and which roles were granted access.
- [ ] List remaining issues with severity, reproduction steps and affected role.
- [ ] Prepare a deployment note covering: new B2B connection env keys, `access.php` grants, Report Studio route rename, pagination provider registration.

## Definition of done

B2B Flights reads real agent-portal data through a connection that provably cannot write, with invoice and PDF output that never sums mixed currencies; Report Studio answers any period across all three businesses with old links intact, exports matching the on-screen columns, and every query verified read-only; pagination renders consistently and preserves filters on every paginated page; the Detailed P&L modal is usable at every viewport; and every remaining risk is written down for handoff.
