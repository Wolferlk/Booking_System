# Daily Work Update — 07 September 2026 (Monday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 07 Sep 2026 (Booking System, Accounts System, AHS & Task Manager)

---

## Executive Summary

The heaviest work today was on the Booking System / OPS: a hand-editable mirror of the query sheet built under append-only rules, a full analytical rebuild of the weekly and monthly report mail with a 17-sheet Excel workbook behind it, a ticket report modal with shared filters, and a run of fixes to the Query Monitor screen that turned gateway timeouts into honest status instead of false failures. On the Accounts System, the payments popup became a three-tab workspace with real refunds and cancel-vs-delete, a B2C flights-only sale policy was added, and the P&L overlay gained hold (manually stated) figures — plus the OpenAI key path was moved onto config, fixing a latent production bug. AHS split the lifestyle catalogue into its own hook and results page; the Task Manager locked signup and team creation to the IT department.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Booking System / OPS | 9 commits | `LIVE-1.0.0v` | One modified file (`applesystem.ts`) |
| Accounts System | 5 commits | `REV1` | Clean |
| AHS | 3 own commits (+1 by another member) | `SewV3---sasi-update-v1` | One modified stylesheet |
| Aahaas Task Manager | 2 commits | `main` | Clean |

*(06 September, Sunday, carried no commits in any repository.)*

---

## 1. Booking System / OPS — Next.js

### 1.1 Hand-editable mirror of the query sheet

Built a second tab in the same workbook — *Query Entry Sheet-Manual(Edit)* — carrying the same 28 columns as the live sheet but written under append-only rules, so the desk can annotate rows without the sweep ever undoing their work.

- **New module `manual-mirror.ts`.** The row builder, identity keys and colour rule are injected from `run.ts` rather than redefined, so the mirror cannot drift from the live sheet.
- **Don't overwrite manual edits** — there is no `updateRow` call in the module at all. A row is appended once and never written into again.
- **Only add new items** — candidates are `manualSheetRow IS NULL` only; before appending, the tab's tail is read and anything already standing there is claimed rather than written twice.
- **Keep a colour you chose** — before painting green on reply, the row's current fill is read; if it isn't the colour we last painted, the row is locked permanently (`manualColorLocked`) and its fill is never touched again.
- **Never remove a line you added** — no delete call, and the tab is excluded from the duplicate sweeps. Because hand-inserted lines shift rows, rows are re-found by identity (date + allocation time + subject) before painting; a row that cannot be found is left alone rather than guessed at.
- **Live-data safety** — only queries the live sheet has already accepted (`SYNCED`) are copied, so a row later folded as a duplicate never lands on a tab it can't be removed from. The mirror pass catches everything, so it can never fail the live workbook write.
- Toggled from Configuration ("Keep a hand-editable copy of the query sheet"), with the tab name editable and validated beside it.

Schema: `prisma/schema.prisma` plus additive SQL (`2026-09-07-query-monitor-manual-mirror.sql` / `-all-mails-mirror.sql`), guarded by `information_schema` and safe to re-run. The same treatment was then extended to the all-mails tab (`all-mails.ts`).

### 1.2 The 33-character bug

The tab could not be created at all: *"Query Entry Sheet - Manual (Edit)"* is 33 characters and Excel's hard limit for a worksheet name is 31. Graph rejected it with a bare 400 `InvalidArgument` naming neither the tab nor the rule, which surfaced as "could not prepare the workbook (502)" and sent the investigation to the workbook, to Graph and to the deployment in turn. Deploying would have failed identically.

- Renamed to *Query Entry Sheet-Manual(Edit)* (30 characters), keeping every word.
- Added `worksheetNameError()` in `constants.ts` checking Excel's actual rules — 31 characters, no `: \ / ? * [ ]`, no leading/trailing apostrophe, not the reserved *History* — wired into the settings route for all six tabs and into `saveConfig`, so a bad name is refused under the box it was typed into.
- Two diagnostic scripts, both reusable: `qm-prepare-probe.mts` (read-only, replays what Prepare does and reports where it stops — this caught both the Graph 503 and the 400) and `qm-create-mirror-tab.mts` (dry-run by default, `--commit` to write, additive only, stops if the tab exists).

Verified against the live workbook: the tab is present, the header matches all 28 columns, typecheck and lint clean.

### 1.3 Query Monitor — telling a timeout apart from a failure

Sweeps take 105–146 seconds and finish `SUCCESS`, but the gateway in front of the app gives up first and returns a 504 while the sweep carries on writing rows normally. The screen was reporting that as a fault.

- `readJson()` added in `ui.tsx` — reads the body as text, parses defensively, and turns a non-JSON response (Amplify's HTML error page) into a real message for 504/524, 502/503 and 401/403. All 43 `.json()` call sites across the six tab files now go through it, replacing `Unexpected token '<', "<!DOCTYPE"…`.
- **Run now no longer waits on the request.** It fires the POST, switches to "Sweeping…", and watches the run lock — which is what the sweep genuinely holds — then reads the outcome from the run record, which survives the 504. The button now reports *"Sweep success in 134s — 3 new · 3 appended · 2 rewritten"*; failed and partial runs come through as error/warning toasts with the same detail.
- Two guards, because a 504 is normal here: the outcome is only reported once a poll has actually seen the lock held (so a click cannot announce a sweep that never ran), and a genuine 409 refusal comes back fast with JSON and stands the watcher down. A sweep fast enough to answer before the first poll is still reported inline.
- Run now is disabled while a sweep is in flight, closing a real hole — it was previously pressable mid-sweep, and the server-side rejection read like a fault.
- `graphFetch` gained retry logic for transient Graph errors (the recurring `FileOpenHostServiceUnavailable`).

### 1.4 Weekly / monthly report — analytical rebuild

The periodic mail no longer prints bookings. Every row moved into an attached Excel workbook, so the mail's size is now bounded by the analysis rather than the booking count (~58 KB regardless of volume, well under Gmail's 102 KB clip point).

- **`period-insights.ts`** — four additional narrow queries, each degrading independently: the previous period counted on the same basis (a delta between two differently-counted populations isn't a trend, so where it can't be matched the report says so instead of drawing an arrow); what was delivered, in guest-days (days on the ground × party size); attrition — cancellations, notice given, reason, fee, rate against the period's own book; lead time, party size, market/partner movers, new and lapsed partners, concentration.
- **`period-html.ts`** — scorecard with per-metric deltas → a rule-derived action list (not AI, and placed first so a reader who stops after one screen stopped in the right place) → intake trend drawn against the arrivals it produced → markets → partners, including "booked last week, silent now" → commercial shape → delivered → attrition → service quality as complaints per 100 tours, so a busy period is judged fairly → integrity → forward book. A period-specific AI prompt replaces the daily one: direction and cause, four sentences, and it may only restate an action the rules already derived.
- **`report-workbook.ts`** — a 17-sheet workbook (Contents, Scorecard, Trend, Countries, Agents, Value, Bookings, Not Counted, Cancellations, Operated, On Ground, Arrivals 3 Days, Reconfirmation, Complaints, Forward Book, Count Check, AS Parity). Every sheet carries a title row and a sentence saying what it holds and how it was derived, plus autofilter, sized columns and numbers written as numbers. Contents explains every other sheet and the counting rules.
- Booking-line primitives were extracted to `booking-lines.ts` as a pure move, so the legacy SG/MY country rules exist in one place only. The CSV attachment is replaced by the workbook on periodic sends only; preview gained `format=xlsx`, and the drawer button, editor toggle and schedule card now say "Excel workbook" for weekly/monthly.
- Verified with a new `npm run period:render` script that builds both reports from synthetic figures — no DB, no mail, no AI. Both render, the workbook parses back with all 17 sheets populated, the action list derives correctly, and the email contains zero booking references or guest names. `next build` passes.

### 1.5 Ticket report modal and shared filters

- `TicketReportModal` renders a report from whatever filters the tickets page currently holds, with CSV export.
- A shared query builder (`ticket-filters.ts`) with parsing and validation for every filter parameter, so the list route and the report route filter identically instead of drifting.
- Filtering extended to multiple criteria at once — status, date ranges and categories — behind a new `ticket-filter-bar` component.

### 1.6 Outstanding

- Run `npx prisma db execute --file prisma/sql/2026-09-07-query-monitor-manual-mirror.sql` **before** deploying — the Prisma client selects the new columns as soon as the new code runs, so the Queries tab errors if the order is reversed. Not run here: the local `.env` resolves to the live AWS database and it is a production schema change.
- The four `… bak 0811-0809` archive tabs are still on the workbook. Eleven worksheets on one file is plausibly why SharePoint keeps throwing `FileOpenHostServiceUnavailable`; the new retry masks that rather than removing it.
- `cancelledAt` has no index, so the attrition query scans. Fine once a week or month, but a monthly preview will be slower than a daily one.

---

## 2. Accounts System — Laravel

### 2.1 Payments popup → three-tab workspace, with real refunds

The Record Payment popup is now a full workspace over a booking's money. All three tabs share a header strip reading **Invoice Value · Received · Refunded · Balance** with a progress bar, so no tab can show a figure the others disagree with.

- **Record Payment** — the existing mode grid / FX / AI receipt flow, plus a "balance" fill button and a live hint under the amount ("Settles the invoice in full" / "Leaves X outstanding" / "more than the balance — overpaid"). Saving now keeps you in the popup and lands on History instead of closing it.
- **Refund** — money back out. Pick the receipt being reversed (pre-fills amount, currency, mode, rate) or refund free-hand. Valued at the booking's own fixed rate rather than today's market, capped server-side at what the booking is actually holding, reason required, optional transfer slip. Refunds reuse the exact negative-entry shape `BookingCancellationService` already wrote, so paid / balance / status still fall out of one `recalculateLedger()`.
- **History** — the whole ledger with filter chips (All / Receipts / Refunds / Cancelled), receipt links, statement PDF and Excel, and per-entry actions.
- **Cancel vs. delete are now different acts** — the substantive change. Cancel requires a reason, keeps the row on file with who voided it and why, and takes it off the balance via `InvoicePayment::scopeCounting()`; it is restorable. Delete remains the hard erase, now behind a confirm that points at cancel instead.

Live-data safety: the migration was additive only — four nullable columns and one index — with `--pretend` output confirmed before applying and `counting()` verified afterwards, keeping all 64 existing rows counting exactly as before (no balance moved). The one pre-existing refund row now reads correctly (received 49,910 / refunded 49,910 / net 0, with the Refund tab offering 0 headroom). Both statement exporters were fixed to label refunds and cancelled rows, or their line items would no longer add up to the printed total. The PHPUnit suite was **not** run — it drops tables in `tearDown` and the connection points at production RDS; verification was read-only.

### 2.2 Verification page — reference and slip completion

A narrow editing path on the Check & Recheck page for what receipts are missing, without ever moving money.

- New `updatePayment()` endpoint writes exactly two things: `reference_number`, and the slip when the receipt has none. Amount, date, currency, rate, mode and status are never touched, so the page's "nothing here moves money" rule holds.
- A slip already on file is not replaceable from this page — it answers 422 pointing at the Invoice Payments board, because supplying a missing slip and overwriting the document an earlier signature was taken against are different acts.
- Same upload rules as the payments board (jpg/jpeg/png/webp/heic/heif/pdf, 10 MB max, stored through `PaymentReceiptStorage` into the private bucket). Every save is logged with payment id, invoice, user email, old → new reference and whether a slip was added.
- The ledger now flags what's missing — a blank reference prints as an amber *no reference*, a receipt with no slip as *no slip* — and each row gets an "Add slip" or "Reference" button, shown only to users who may edit (`canEditReceipts()`: super admin, or anyone assigned to either stage of the invoice tab).
- Flagged: the Slip link uses the existing payments attachment route, which sits under the Invoice Payments grant, so a reviewer holding Check & Recheck but not Invoice Payments can upload a slip and be refused when opening one. Pre-existing; left alone pending a decision on a verification-scoped attachment route.

### 2.3 B2C — flights-only sale policy

A second switch on `/settings/b2c`, under the existing one: **"Flights only — sale price = cost (no profit)"**. While on, only the flight lines (B2C main category 6) of an order show at cost with zero profit; hotels, essentials, lifestyle and education keep their real figures. The wide switch already covers flights, so it wins when both are on. Like the existing one it is display-only — the sync and invoice generation keep recording the truth.

`B2cSalePolicy` gained the new setting plus flight-aware overlays: `flightRecord()` restates the flight lines of a stored P&L and moves the order's sale/profit by exactly the suppressed profit; `flightOrder()` does the same live; `row()` restates a flattened row when the whole order is flights. Where a record is loaded without its line breakdown, a flights-only order is still restated from its rollup while a mixed order is deliberately left real rather than guessed at. Invoice rows are restated at order grain, before flattening, so the split is exact in the list, the modal, the Excel exports and the report emails; the P&L page's KPI tiles get a matching aggregate so they agree with the rows. Arithmetic verified on a mixed order — flight 120/100 + hotel 200/150 → order sale 320→300, profit 70→50, hotel untouched.

### 2.4 Detailed P&L — held (manually stated) result figures

- **The MY 40097 defect, closed.** The stored record read `cost_total = 552.00` while the Apple System payload was correct throughout. The overlay was double-counting: when the desk acted, the content catalogue had no names for ids 82 and 1113, so they printed in the Attraction table and the voids saved as `products:*`; the catalogue later resolved them to transfer names, moving the rows to Tour Transfers as `transfers:*`, and chaining on the raw anchor gave one item two chains and took its cost off twice. Repaired to `cost_total 1,454.00 / profit_loss 236.00`, matching both the payload and the sections on screen. Every record carrying `products:`/`transfers:` overlay lines was scanned — 42340 was the only collision.
- **Prevention.** Both tables now key on the item id alone (`attraction:<id>`), and `chainKey()` reads the older anchors as one chain so pre-existing history still binds. A chain whose row the sheet has re-filed carries its accumulated shift across instead of stranding it. The "0 hand edits" basis text was also fixed — it was counting only the figure editor's tally and ignoring overlay lines.
- **New `hold` op.** Cost Per Person rows, Total Tour Cost and Profit are typeable in Edit mode and saved as an absolute figure applied last — after the payload, the Excel correction and every other overlay line. No migration needed. Audited, revertable ("Release" on the figure), survives a re-sync, marked *Held* on the sheet with who/when/why, and printed in its own PDF and workbook section, separate from the movement table whose total a hold is no part of. `pnl_records.amount` remains untouchable, since invoices are raised from it.
- Verified live: cost hold → profit re-derived; profit hold → stands alone by design; per-person hold → moves no money; restating supersedes; a bad anchor or section is refused.

### 2.5 OpenAI key path moved onto config

`config/services.php` now resolves `env('OPENAI_API_KEY') ?: env('OPENAI_OPS_KEY')`, and four services that were reading `env()` directly — `OpenAIService`, `ServiceNameMatcher`, `PaymentReceiptExtractor`, `VnAiSplitter` — now read `config('services.openai.key')`. This was a latent production bug as well as a convenience: bare `env()` returns null once `php artisan config:cache` runs, so on a cached server those services had no key at all regardless of billing. With a funded key in place, the Payable 1.1 health check now passes all five steps (sample split returned 4 payables).

---

## 3. AHS — Customer-Facing React Front End

- **Lifestyle catalogue extracted.** `useLifestyleCatalogue.js` (new hook) takes the catalogue logic out of `LifestyleMainPage`, which drops from ~1,400 lines to a thin page.
- **New `LifestyleResultsPage`** — results header with layout, animation and responsive rules, navigation back to the lifestyles landing page, AI-filter and vendor-filter banners with clear actions, in-category search, and `ProductList` for the mapped products.
- **`LifestyleHome` composer revamped** — layout, responsiveness and dark-mode compatibility, plus a Vite server config change for network access during testing.
- Branch `SewV3---sasi-update-v1`; one stylesheet still modified in the worktree. A separate commit by another team member removed `MainHero` from the Essential and Non-Essential pages.

---

## 4. Aahaas Task Manager — Next.js

Signup and team creation are now locked to the IT department.

- **Signup** — the Department select renders only IT (matched on `code === 'IT'` or name) and is disabled; IT is auto-selected as soon as public meta loads, so `department_id` is always sent. The Team select still works normally and shows IT's teams.
- **Teams page** — the New/Edit Team dialog's Department select shows a single disabled option, and new teams default to IT. Editing an existing team still displays that team's own department, so saving an older non-IT team won't silently reassign it. The "Choose a department." submit guard still applies if IT isn't found.
- Both changes are client-side and deliberately easy to revert — drop the `itDepartment` block and the `disabled` prop to restore the full list. Typecheck passes.

---

## 5. Main Outcomes

1. The query sheet now has a hand-editable twin that the sweep will never overwrite, recolour against your choice, or delete from — enforced by the absence of the write paths, not by convention.
2. A 400 from Graph that had been read as a workbook, deployment and network problem turned out to be Excel's 31-character sheet-name limit; the rule is now validated at the point of entry and two reusable diagnostic scripts exist.
3. Query Monitor stops reporting gateway timeouts as failures — it watches the run lock and reports the sweep's real outcome.
4. Weekly and monthly report mails are now analysis with a 17-sheet workbook behind them, at constant size regardless of booking volume.
5. Invoice payments gained real refunds and a cancel-with-reason distinct from delete, on an additive migration with no balance moved.
6. B2C can present flights at cost while the rest of an order keeps its real figures, display-only.
7. Detailed P&L result figures can be stated by hand, audited and released — and the double-counting defect behind MY 40097 was traced, repaired and prevented.
8. A latent production bug was closed: on any config-cached server, four AI services had no OpenAI key at all.

## 6. Follow-Up Items

- Run the query-monitor mirror SQL on the live database, then commit and deploy — in that order — and confirm the next sweep fills the new tab.
- Decide on removing the four archive tabs from the query workbook, and whether to index `cancelledAt`.
- Rotate the OpenAI keys (the working one has been exposed in a transcript), then update the live `.env` and run `php artisan config:clear` — the code change alone won't reach the server's cached value.
- Decide whether Check & Recheck should get its own attachment route, so a reviewer without the Invoice Payments grant can open a slip they just uploaded.
- SG 40063 (id 17928) is off by 7.60 — pre-existing, the stacked-op case `pnl:repair-line-totals` was written for and never run with `--apply`. Left alone by instruction.
- Confirm the target branch for the AHS lifestyle results work.

---

**Prepared:** 07 September 2026  
**Projects reviewed:** Booking System / OPS, Accounts System, AHS, Aahaas Task Manager
