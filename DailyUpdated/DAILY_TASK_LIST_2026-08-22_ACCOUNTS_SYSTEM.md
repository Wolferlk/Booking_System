# Today Daily Task List — 22 August 2026

**System:** Accounts System / Email Invoice Processor
**Owner:** Sasindu Diluranga
**Date:** 22 August 2026
**Application path:** `Accounts_system/email-invoice-processor`
**Working rule:** This is a live accounting system. Do not send email, call external write APIs, run production migrations, record payments, or alter invoices without explicit approval. Use local/test configuration and read-only inspection first.

## Main outcome for today

Complete the verification and handoff of the new Proforma Invoice workflow: filtered invoice listing, scoped matching, auto-match, settlement status, receipt URLs, recent-invoice display, and the reorganised UI. Payment and settlement actions must be idempotent, permission-gated, auditable, and safe for existing invoice data.

## 1. Proforma invoice listing and filters — high priority

- [ ] Open the Proforma Invoice page and confirm the new view structure renders correctly.
- [ ] Verify the listing supports the expected filters: country, booking/reference number, supplier, invoice status, settlement status, date range, and search text where available.
- [ ] Confirm filter combinations narrow results correctly and clearing filters restores the full permitted list.
- [ ] Confirm empty results show an explicit empty state rather than a false success message.
- [ ] Verify recent invoices are displayed in the correct section with invoice number, booking/reference, amount, currency, date, and settlement status.
- [ ] Confirm invoice data is scoped correctly and one booking’s invoices cannot appear under another booking.
- [ ] Verify pagination or result limits do not hide matching records without a clear indicator.
- [ ] Check that invoice numbers, reference numbers, control numbers, and account identifiers preserve leading zeros.

## 2. Auto-match workflow

- [ ] Test auto-match using a clearly matching invoice and confirm the proposed booking/reference is correct.
- [ ] Test an invoice with multiple possible matches and confirm the system requires user review instead of choosing silently.
- [ ] Test an invoice with no match and confirm it remains visibly unmatched with a useful explanation.
- [ ] Verify scoped lookup rules prevent a match from another country, supplier, or unrelated booking.
- [ ] Confirm matching records the matched relationship and actor/time information required for auditability.
- [ ] Repeat the same auto-match request and confirm it is idempotent: no duplicate match, settlement, or ledger entry is created.
- [ ] Verify changing or clearing a match is permission-gated and does not delete the source invoice.

## 3. Settlement and payment safety

- [ ] Review `ProformaInvoiceController`, `ProformaSettlementService`, models, routes, and migration for precise status transitions.
- [ ] Confirm only the permitted statuses can move to settled/paid and invalid transitions are rejected.
- [ ] Verify settlement amounts cannot exceed the invoice balance or create a negative remaining balance unintentionally.
- [ ] Test partial settlement, full settlement, repeated submission, and a zero/invalid amount in a local or isolated test database.
- [ ] Confirm payment references, remarks, receipt URLs, and settlement timestamps are retained after refresh.
- [ ] Verify failed settlement attempts do not partially write a payment or mark an invoice as settled.
- [ ] Confirm the status shown in the list, detail view, recent-invoice panel, and Payable 1.0 is consistent.
- [ ] Check that settlement actions are protected by access configuration and server-side authorization, not only hidden in the UI.

## 4. Receipt URL and document handling

- [ ] Verify a valid receipt URL is displayed as a safe, clickable link.
- [ ] Verify missing, malformed, or unavailable receipt URLs show a safe fallback and do not break the invoice page.
- [ ] Confirm URLs are escaped/sanitised before rendering and cannot inject markup or scripts.
- [ ] Confirm the receipt link belongs to the selected proforma settlement and cannot be replaced by another invoice’s URL.
- [ ] Check storage/filesystem configuration for the intended disk and confirm no credentials or private paths are exposed.

## 5. Existing Accounts workflows regression

- [ ] Confirm Payable 1.0 still loads and existing filters, payment detail, remarks, and exports remain available.
- [ ] Confirm non-credit invoice search still matches invoice and reference numbers and only shows the latest revision.
- [ ] Confirm Sri Lanka transport settlement requests still appear in the correct settlement window and status transitions remain controlled.
- [ ] Confirm existing role/access catalogue entries remain unchanged except for the intended Proforma permissions.
- [ ] Check invoice email/report actions are not triggered during testing.
- [ ] Review logs for SQL errors, missing columns, failed lookups, authorization failures, and accidental external-service calls.

## 6. Safe test and release preparation

- [ ] Read `SAFETY.md` before any command that could touch database, email, external APIs, or deployment state.
- [ ] Run `php artisan migrate --pretend` only against the intended local/test configuration if migration review is required; never run reset, refresh, rollback, wipe, seed, or destructive SQL.
- [ ] Confirm the PHPUnit test connection is local and isolated before running tests; do not bypass the production-host guard.
- [ ] Run the frontend build from `email-invoice-processor/` and inspect compiled output for errors.
- [ ] Run targeted Proforma tests for listing, filters, auto-match, settlement, duplicate prevention, and receipt URL handling.
- [ ] Review the final diff and migration for additive, reversible changes and precise `WHERE` clauses on any update.
- [ ] Verify no secrets, production URLs, payment data, or customer information were added to source control.

## 7. Handoff checklist

- [ ] Document the exact routes, permissions, and statuses verified.
- [ ] Record test references and expected/actual outcomes without including sensitive customer or payment data.
- [ ] List any unresolved issue with severity and whether it blocks release.
- [ ] Obtain finance approval before testing a real payment/settlement write or sending any invoice email.
- [ ] Prepare deployment notes for the Proforma page, auto-match logic, settlement service, receipt URLs, and UI structure.

## Definition of done

The Proforma Invoice workflow is verified in an isolated environment; filters and scoped lookups are correct; auto-match is safe and idempotent; settlement statuses and receipt URLs are consistent; existing Accounts functions regress cleanly; permissions and auditability are confirmed; and production actions remain pending approval.

