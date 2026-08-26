# Daily Work Update — 25 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 25 Aug 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is a detailed summary of today's work, split between the **Accounts System** (Laravel) and the **Booking System** (Next.js / Ops), including the cross-system integrations that connect the two.

Today had two main threads: the **Proforma Invoice pipeline** finished end to end — Ops reads the hotel's document, Accounts settles it and states the rate — and a brand new **Invoice Studio** on the Accounts side that makes every printed field of a client invoice editable and lets an invoice be re-expressed in another currency without losing its audit trail. Two live-data defects were also fixed: agent Credit / Non-Credit on the payable board, and P&Ls stuck on an old revision.

---

## 1. Accounts System

### 1.1 Invoice Studio — editable invoice documents + currency conversion (new module)
The largest piece of the day. An invoice's printed content used to live in three separate places — the invoice row (number, dates, parties, totals), the source email (guest, pax, tour dates, file handler) and the `calculations` blob (fare / handling fee / GST). The old templates re-derived from all three at render time, and one of them re-read a live FX feed, so "correct what this invoice says" was simply not possible: any change was silently undone the next time the PDF was rebuilt.

- Built **`InvoiceDocumentService`** (~1,000 lines) — on the first save the whole printed document is materialised into `generated_invoices.document_overrides`, and from then on the PDF is rendered from that **verbatim**. Nothing is re-derived, so what a person typed is exactly what prints, every regeneration. Untouched invoices keep `document_overrides` NULL and render through their original template exactly as before, so the thousands of rows nobody edits are unaffected.
- Built **`InvoiceDocumentRenderer`** — a deliberately literal PDF/HTML renderer for edited invoices. The same HTML backs the live browser preview, so what the clerk sees while typing is the document they are about to send.
- Built the **Invoice Studio UI** (`invoices/partials/invoice-studio.blade.php`, ~770 lines) — parties, booking meta, line items, charges, notes and totals all editable side by side with a live preview.
- Added **`InvoiceDocumentController`** and the routes (`/{invoice}/document`, `/document/fx`, `/document/preview`, `/document` save, `/document/revert/{edit}`). Only save and revert write, and both leave an undo point.
- **Currency conversion.** The rate comes from the CBSL table the dashboard ticker already reads (never scraped mid-request) and is always editable — the rate the bank actually gave outranks the published one. CBSL quotes LKR per unit for four currencies, so anything else is either derived through the LKR pivot (and **labelled as derived**) or typed by the clerk (and recorded as **manual**). 11 currencies supported, with VND correctly handled as zero-decimal.
- A conversion moves the document, the invoice's own money columns and — only where receipts already exist — each receipt's invoice-currency amount, so the ledger keeps saying what it said in the new unit.
- **Byte-for-byte undo.** New table `invoice_document_edits`: one row per save, written inside the same transaction *before* the invoice changes, holding the untouched invoice columns, the calculations blob, the previous overrides and every affected receipt. An undo is a restore, not an inverse calculation — so a bug in the conversion arithmetic can never survive a revert. Same shape as `pnl_payload_edits`, and for the same reason.
- **Quote basis** (migration `add_quote_basis_to_invoice_document_edits`). An invoice is raised off the confirmation's quoted value — SGD 6,153.78 turned into INR at 76.37, say. Re-expressing *that* invoice in a third currency by converting the INR figure runs the money through two rates and lands somewhere neither of them says. The Studio can now convert **from the quote instead** — one rate — and the audit row records which basis was used, on what quoted amount, at what rate, so the number is always re-derivable.
- **Manual amount entry** — a clerk can type the figure directly instead of driving it through a rate, for the case where the bank's number is simply known.
- **Hidden charges and target totals** (final commit of the day). A charge can now be marked *hidden*: it counts towards what the agent pays but is not printed on the document. And a typed sub-total or grand total is treated as a **target** — whatever the lines and charges come to, the difference is carried by a single hidden markup that is re-solved every time a line moves. Percentage charges work off the correct base (lines + hidden), the visible/hidden split is tracked separately in the totals block, and a target figure is itself converted when the invoice currency changes.

### 1.2 Proforma Invoices — FX on settlement, receipts and bank details
Accounts pays out of a rupee account while properties bill in their own currency. The one number the desk argues about afterwards — *what did this cost us in rupees, and at what rate?* — was nowhere on the record. It could be re-derived from the payable line's live FX cell, but that cell moves: an unfixed line is restated at *today's* CBSL quote, so a payment made in March read back in August at August's rate.

- Migration `add_fx_and_receipt_to_proforma_settlements` — six nullable columns, purely additive: `pay_currency`, `fx_rate` (6dp, as CBSL publishes it), `fx_rate_source` (`cbsl` / `manual`), `fx_rate_date`, `actual_payable`, `receipt_no`. Every pre-existing settlement reads back as nulls, which is exactly what it knew before.
- `actual_payable` is **not** derived on read — the clerk may round to what the bank actually debited, and that figure, not rate × amount, is what reconciles against the statement.
- `receipt_no` is kept apart from `payment_reference` deliberately: a cheque number and a wire reference are different things, and a desk chasing one is not helped by finding the other.
- This does **not** become a second ledger — `payable_payments` remains the only record of money, written through Payable 1.0's ordinary `recordPayment` path. These columns are the proforma's own copy, so the invoice reads on its own and so Ops (which SELECTs this table and nothing else) can show the booking desk what was settled.
- New **`/proforma/{id}/fx` endpoint** — today's CBSL quote for every currency this invoice could be settled in, on its own route so the pay dialog can re-ask without reloading the invoice. Only two conversions are ever quoted (identity at 1.0, and `from → LKR` at CBSL's buy rate); a cross rate such as USD→SGD comes back **null with a reason**, because nobody's bank settles at a derived rate and a figure that looks authoritative while matching no statement is worse than no figure. The clerk types the rate their bank gave, and it is recorded as `manual`.
- New **`/proforma/{id}/bank` action** — copies the beneficiary account the property printed on its invoice onto the matched Payable 1.0 line. **Never automatic**: a person presses it. Two guards make that meaningful — a paid line is refused outright (rewriting the account a payment went to would falsify the record), and already-filled fields are left alone unless `overwrite` is set, so the ordinary press tops up what is missing and cannot silently replace an account somebody set deliberately.
- Bank details are read **defensively** — the columns are created by an Ops-side script, and Accounts keeps working on a database where that script has not run yet.
- Extended `CbslRateService` and the proforma blade with the pay dialog, currency picker, rate provenance and receipt capture.

### 1.3 Payable 1.0 — agent Credit / Non-Credit fixed (live-data defect)
- Payable 1.0 and the payable reports were reading the agent's credit type off `pnl_records.credit_type` — **a column that does not exist**. Every row therefore fell through to a hardcoded `'Credit'`, so an agent explicitly marked Non-Credit still showed as Credit on the board.
- Added **`AgentClassificationService::agentTypeLabel()`**, reading the same `agent_gsts` registry the Agent Management page edits and invoice classification already uses. Anything that is not an active credit agent is Non-Credit, exactly as `classify()` decides it.
- Wired it into `PayableReportService` in three places (hotel items, AS hotel stays, and the arrival rail) and into `PayableV1Controller`.
- Memoised the credit registry per instance — a payable board maps hundreds of rows through this, and without it each row re-queried the same handful of agents.

### 1.4 AS P&L — revisions were never being picked up (live-data defect)
A booking sat on revision 3 (sell 210) here while upstream had moved to revision 5 (sell 190). Two independent causes, both fixed:

- **"Fetch from AS API" could not see a revision.** When the Apple System revises a booking it does not edit the quotation in place — it issues a **new booking id**, and the old id keeps answering with the revision it was frozen at. The refresh quoted `as_reference_id`, so it could only ever return the revision already stored: the button reported "no changes" on precisely the bookings it exists to catch. The IS-number lookup now chooses the booking **newest first** (created date deciding, numeric id breaking ties) and the quote is read for *that* id, with the booking row and the quoted id kept consistent.
- Added a guard so a refresh can never walk a record **backwards**: if the newest id somehow answers with an older revision than the one on file, it logs and falls back to quoting the stored id.
- **The nightly sweep could not reach post-travel amendments.** A revision issued after the guests have flown home carries the *original* arrival date but today's created date, so the one-month backward reach simply could not see it — the case above was revised 44 days after arrival. Widened `ARRIVAL_MONTHS_BEFORE_CREATED` from 1 to 12. Measured before committing: 22 bookings found in 1.4s at one month back, 23 in 36s at twelve (5,627 rows matched against 1,739), neither truncated — roughly four minutes for the nightly seven-day re-sweep, in exchange for the amendments that would otherwise never arrive. Post-travel amendments are exactly the ones that change what an agent is billed.

---

## 2. Booking System (Ops)

### 2.1 Proforma Invoice — read the document instead of typing it (new)
A reservation clerk used to hold the PDF in one hand and type nine numbers into a form with the other. Every keystroke is a chance to transpose a figure Accounts will later pay — and the bank details at the foot of the page were not captured at all, so Accounts opened the same document a second time and read the account number by eye. That second reading is where wrong-account transfers come from.

- Built **`lib/proforma-extract.ts`** — reads hotel name, city, invoice number, invoice/due dates, currency, nett amount, tax, total, check-in/out, nights, room type, meal plan **and the beneficiary bank block** off the uploaded document.
- Built **`POST /api/proforma/extract`** — permission-gated (`proforma:manage`), reads the file in memory and **writes nothing at all**. Filing still goes through `POST /api/proforma` with whatever the clerk confirms, so a bad read costs a correction in an open form, never a wrong row. A failed read is a 200 with `extraction: null` and a reason, not an error — "the reader could not manage this one" leaves the clerk typing, exactly as before this endpoint existed.
- **Reworked the filing form** (`invoice-form.tsx`) — the document moved to the *top* of the form, because it is the only thing a clerk should have to provide. Dropping the PDF fills the form in; every auto-filled field is marked as such, all remain editable, and the model's full answer plus its confidence is filed alongside for audit. The machine proposes, the clerk disposes.
- **PDF handling reworked** (commit 2 of 4): PDFs are handed to the model **whole**, so it gets the page render as well as the text layer. This is what the document type actually requires — a hotel proforma routinely prints its bank block as an *image* pasted into an otherwise text PDF. On a real Hotel Topaz invoice a text-only read returned the heading "Bank Details" followed by nothing; account name, bank, branch, account number and SWIFT were all invisible to `pdf-parse`. Reading the page is the only way those fields come back, and it also means a **scanned PDF now reads** where it was previously refused outright. `pdf-parse` survives as a fallback for a rejected or corrupt container.
- **Legibility gate (`MIN_IMAGE_EDGE`)** — this one is not a guess. A 612×792 render of a real proforma, legible to a person on screen, came back from the vision model with an **invented guest name, an invented invoice number and an invented bank account number**, at a self-reported confidence of 0.9 and with no warnings. The same page at 1700×2200 read perfectly, and reading it twice does not help: both passes converge on the *same* fabrication, because a blurred invoice pulls the model towards the average invoice it has seen. Self-reported confidence and cross-checking are both useless here; resolution is the only signal that separates the two cases. Floor set at 1000px on the long edge — A4 at 150 dpi is 1240×1754 and any phone photo is far larger, so it refuses almost nothing real.
- Wrote a dependency-free **`imageSize()`** (PNG / GIF / WebP in all three VP8 forms / JPEG marker walk) so the gate costs no new package. HEIC falls through ungated, which is the pre-existing behaviour.
- Hardened the extraction prompt: blurred / cropped / blank ⇒ **every field null and confidence 0**, never a plausible placeholder — "a null is always correct; an invented value is a wrong payment."
- **Filing rules corrected** (commit 4 of 4): the invoice **total is no longer required** — the document is the record, and a figure nobody could read off it must not stop the paper being filed; it stays null and the board shows an em dash. Conversely the **document is now mandatory** — an invoice row with no paper behind it is a claim nobody in Accounts can check.

### 2.2 Proforma — bank details schema and settlement visibility
- Added **`scripts/sql/proforma-component-02-bank-details.sql`** — the beneficiary account columns on `proforma_invoices` (account name, bank, branch, account number, SWIFT, IBAN, currency, address) plus the `aiExtract` / `aiExtractedAt` columns the Prisma model declared but never had. Every statement is an `ADD COLUMN` guarded by an `information_schema` lookup, so running the file twice is a no-op; nothing drops, renames, re-types or rewrites a row, and every new column is nullable — the truthful value for every invoice already filed. Applied by hand via `mysql`, **never** `prisma db push`.
- These columns are a **quotation of the paper**, never an instruction to pay: Accounts shows them beside the payable line and a person presses a button to copy them across. Nothing downstream pays from them directly.
- Extended `/api/proforma` and `/api/proforma/[id]` to carry the bank block and the settlement detail.
- **Proforma dashboard now shows what Accounts actually did** — paid / part-paid badge with amount, date, transfer reference, receipt number and who paid, plus a "Settled at" line showing what really left the account, the rate applied, and whether that rate was CBSL (with its publication date) or set by hand. Shown only where Accounts recorded it; older payments simply do not have it and read as *not recorded*, never as zero.
- Extended `lib/accounts-proforma-db.ts` and `lib/proforma.ts` for the shared shapes.

---

## 3. Cross-System Integrations Delivered Today

| Integration | Ops (Booking System) writes | Accounts reads / does |
|---|---|---|
| **Proforma bank details** | AI reads the beneficiary account off the uploaded PDF into `proforma_invoices` | Shows it beside the matched payable line; one deliberate press copies it onto the Payable 1.0 line (refused on a paid line) |
| **Settlement FX + receipt** | Dashboard renders "Settled at X at rate R · CBSL 25/08" | Records `pay_currency`, `fx_rate`, source, date, `actual_payable`, `receipt_no` on settlement — a pinned rate that cannot drift |
| **Proforma filing rules** | Document mandatory, total optional | Payable summary and matching tolerate a null total rather than blocking on it |

---

## Summary

| Area | Items Delivered |
|---|---|
| Accounts System | **Invoice Studio** (editable invoice documents, CBSL currency conversion, quote-basis conversion, manual amounts, hidden charges & target totals, byte-for-byte undo); proforma settlement FX + receipt capture + bank-details apply; Payable 1.0 agent Credit/Non-Credit fix; AS P&L revision-detection + sweep-window fix |
| Booking System | Proforma AI document extraction (PDF page reads, image legibility gate, no-invention prompt), upload-first filing form, bank-details schema, document-mandatory / total-optional filing rules, settlement + FX visibility on the proforma dashboard |

**Commits today:** 9 on the Accounts System (`1402b3e` → `7c531be`, branch `REV1`, including the merge of `fix/as-pnl-latest-revision` via PR #51) and 4 on the Booking System (`de47cfe` → `772002c`, branch `Main_v7_DEV`).

**Migrations added today (all forward-only and additive):** `add_fx_and_receipt_to_proforma_settlements`, `create_invoice_document_edits_table`, `add_quote_basis_to_invoice_document_edits` (Accounts); `proforma-component-02-bank-details.sql` (Ops, idempotent guarded `ADD COLUMN`s).

Happy to walk through any of the above — particularly the **Invoice Studio** (it changes how an invoice document is produced, and the undo model is the part worth reviewing) and the **AS P&L revision fix**, which was silently under-billing amended bookings.

Best regards,
**Sasindu Diluranga**
