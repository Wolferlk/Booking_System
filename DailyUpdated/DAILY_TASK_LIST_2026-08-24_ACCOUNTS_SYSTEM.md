# Today Daily Task List — 24 August 2026

**System:** Accounts System / Email Invoice Processor
**Owner:** Sasindu Diluranga
**Date:** 24 August 2026
**Application path:** `Accounts_system/email-invoice-processor`
**Working rule:** This is a live accounting system. Do not send email, call external write APIs, run production migrations, record payments, or alter invoices without explicit approval. Use local/test configuration and read-only inspection first.

## Main outcome for today

Close out two workstreams delivered today: (1) the Proforma invoice document viewer with the combined payable + receipt popup, S3 document configuration and the payable summary fallback to P&L cost; (2) the Vietnam Excel nett-rate pricing improvements in `VietnamExcelPriceService` / `MissingProductService`, including the handling of products the agent has already replied about. Both must be safe against existing invoice, payable and P&L data.

## 1. Proforma document viewer and payable/receipt popup — high priority

- [ ] Open the Proforma Invoice page and confirm the invoice list renders and every invoice can be opened (the earlier "cannot view invoices" failure must not reproduce).
- [ ] Confirm the popup shows the payable detail and the receipt document side by side, for the same settlement, in one view.
- [ ] Verify the document viewer route added in `routes/web.php` streams the file for the selected invoice only and cannot be pointed at another invoice's document.
- [ ] Test a missing / malformed / expired document reference and confirm a safe fallback instead of a broken page or a raw exception.
- [ ] Confirm the viewer route is permission-gated server-side, not only hidden in the blade view.
- [ ] Check invoice numbers, reference numbers and account identifiers keep their leading zeros in the popup.

## 2. S3 / filesystem configuration

- [ ] Review the new keys added to `.env.example` and `config/filesystems.php` and confirm each one is documented for deployment.
- [ ] Confirm the intended disk is used for proforma documents and no credentials, private paths or bucket names leak into the rendered page or logs.
- [ ] Verify behaviour when the S3 credentials are absent: the page must degrade, not fatal.
- [ ] Confirm no production bucket values were committed to source control.

## 3. Payable summary fallback to P&L cost

- [ ] Review the change in `ProformaSettlementService` that uses the P&L cost when no payable record exists.
- [ ] Confirm the fallback only applies when a payable row genuinely does not exist, and never overrides an existing payable amount.
- [ ] Verify the currency of the P&L cost matches the currency shown in the summary; no silent mixing.
- [ ] Cross-check a few bookings against Payable 1.0 and confirm the summary figures agree.
- [ ] Confirm the fallback is display/summary only and does not create or write a payable row.
- [ ] Verify a suitable payable in Payable 1.0 is linked to the proforma invoice where one exists, and that matching stays scoped to the same booking/supplier.

## 4. Vietnam Excel price service — pricing logic and errors

- [ ] Review the changes in `VietnamExcelPriceService`, `MissingProductService`, `ExcelProductRate` and `detailed-pnl-scripts.blade.php`.
- [ ] Re-price a sample of Vietnam P&Ls and confirm corrected nett rates are plausible; implausible rates must still be refused, not written.
- [ ] Confirm improved error handling reports the reason per product instead of failing the whole run.
- [ ] Verify the Detailed P&L panel shows the new pricing/erro/state messages correctly in the UI.
- [ ] Confirm no P&L is repriced silently without an audit trail.

## 5. Missing-products mail and agent replies

- [ ] Re-check the "Daily Missing Products (Vietnam)" list for 21/08/2026 (22 products) against the current rate sheet.
- [ ] For products the agent has already replied as rated, confirm they now resolve and drop off the missing list.
- [ ] Confirm products still genuinely unrated remain listed with a clear reason.
- [ ] Verify the daily missing-products email content before any send, and do not send to real recipients without approval.
- [ ] Confirm clearing/acknowledging a missing product is recorded and reversible.

## 6. Regression and safe testing

- [ ] Confirm Payable 1.0 still loads with its filters, sections, driver advance and exports unaffected.
- [ ] Confirm invoice search, revision handling and `is_latest` behaviour are unchanged.
- [ ] Read `SAFETY.md` before any command touching database, email, external APIs or deployment.
- [ ] Use `php artisan migrate --pretend` only against a local/test connection; never reset, refresh, rollback, wipe, seed, or run unscoped SQL.
- [ ] Confirm the PHPUnit test connection is local before running tests; never bypass the production-host guard.
- [ ] Review logs for SQL errors, authorisation failures, S3 errors and accidental external calls.

## 7. Handoff checklist

- [ ] Document the routes, permissions and configuration keys verified today.
- [ ] Record test references and expected/actual results without sensitive customer or payment data.
- [ ] List unresolved issues with severity and release impact.
- [ ] Prepare deployment notes: proforma viewer route, S3 config keys, payable summary fallback, Vietnam pricing changes.
- [ ] Obtain finance approval before any real settlement write or invoice email.

## Definition of done

Proforma invoices open reliably with payable and receipt visible together, document access is scoped and permission-gated, the payable summary falls back to P&L cost only where no payable exists, Vietnam pricing corrects the right products and refuses implausible rates, the missing-products list reflects the agent's replies, and no live data was written without approval.
