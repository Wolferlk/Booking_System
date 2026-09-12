# Daily Work Update — 10 September 2026 (Thursday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 10 Sep 2026 (Accounts System, Booking System, AHS & Task Manager)

---

## Executive Summary

Two boards were argued with all day, and both turned out to be right about their arithmetic and wrong about their basis. On the Accounts side, **Payable 1.1 now selects on the payable day itself** — a hotel arriving 14 Sep but checking in on the 19th no longer sits on the 14 Sep board — and three follow-on fixes came out of chasing the cards that were still wrong: stays are now collected by *their own* dates rather than their booking's arrival, superseded revisions are dropped from every board, and the Vietnam tab on Payable 1.0 now hands the user to 1.1 instead of opening an empty board. The afternoon settled a longer-running dispute: **B2C P&Ls were being re-derived from today's catalogue instead of read from what the order was actually worth**, which cost FOC children, drifted the FX and quietly restated old orders. The storefront's own checkout snapshot is now the price, the storefront discount is netted (Aahaas funds it, not the supplier), and a failed snapshot read can no longer overwrite a correct row with a derived one.

On the Booking System, **Activity Check** shipped — a reverse search over the operational record, agenda and itinerary merged, with a typo-tolerant matcher pinned by its own check script — and the **Driver Settlement Register** gained a package-cost column, bank details end to end, PDF/XLSX exports and saved layouts. AHS moved ten commits, all by another team member. The Task Manager was untouched.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 11 commits | `REV1` | Clean (one untracked scratch doc) |
| Booking System / OPS | 10 commits | `LIVE-1.0.0v` | Clean |
| AHS | 0 own commits (10 by another member) | `SewV3---sasi-update-v2` | Clean |
| Aahaas Task Manager | No work today | `main` | Clean |

---

## 1. Accounts System — Laravel

### 1.1 The B2C discount is funded by Aahaas, not the supplier

`tbl_checkouts.total_price` is the **listed** price, not what the customer paid. The storefront promo comes out of Aahaas's own margin, so the supplier cost stays at the full rate — and the accounts system was booking revenue at the listed price against cost at the same figure, which reads as break-even where there is a real loss.

- **AHS-14253:** listed 60.79, 10% promo 6.08, customer paid 54.71. Supplier cost is 3 × LKR 6,800 = 60.79 (`life_style_rates_packages.actual_adult_rate` equals the sell rate — zero markup on that product). Revenue 60.79 against cost 60.79 → profit 0.00, which is why the mail said *"no profit or loss"*. The admin dashboard nets the discount and shows the real **6.08 loss**.
- `B2cPnlService` never subtracted the discount anywhere — `product_base_discount` was display-only, and wrong for percentage discounts.
- A new **`applyDiscounts()`** pass runs after all five category builders are merged (the discount is only knowable once the whole order is in hand), and `settle()` was split so a line can be settled again once its discount is known.

**Where the discount is read from, in order:** `tbl_checkouts.discount_price` on the line itself — preferred, because it attributes the money to the right line of a multi-line order; failing that, **payment evidence** allocated pro-rata: `SUM(total_price) − (paid_amount + balance_amount − delivery_amount)`.

Route 2 is deliberately evidence-based rather than reading `tbl_checkout_ids.discount_amount`: older orders record a discount that **was never taken off the payment** (AHS-6926 among them), and those must keep full revenue. Across 2026 data the two agree on **355 of 356 orders**. Flight lines are skipped — their payload's `totalPrice` is already the discounted fare, so netting again would double-count. The discount now shows as a tile and a column in the detail modal, the detail PDF and the XLSX, and §4.2b of `AAHAAS_B2C_INVOICE_PNL_STRUCTURE.md` documents the rule.

### 1.2 B2C P&Ls now price from the checkout snapshot, not today's catalogue

Three separate drifts, all present on order **#14277**:

- **Free-of-charge children** — `tbl_lifestyle_rates.child_foc_age` carries an in-band child at zero. The code multiplied the child rate by the full child count; on this order **2 of 3 children were FOC**, inventing ~USD 330 of cost that was never payable.
- **FX drift** — cost normalised at today's SGD rate (0.7815) while the customer was charged in LKR at the order day's rate (0.8704). Sale and cost were being compared across two different days' rates.
- **Rate drift** — a catalogue rate edited after booking silently restates a months-old order.

The storefront already freezes each line's P&L at checkout into **`checkouts_more_data`** — quantities, FOC-adjusted cost, both FX rates in force that day, and `net_total_amount` (what was actually charged). That table is the only thing the admin dashboard's *#ORD… PROFIT & LOSS STATEMENT* reads (`PNLController.php:1550` → `reports/pnl/order.blade.php`), so it is the definition of a correct B2C P&L — and it is now what the Accounts System prices from.

`B2cPnlService::applySnapshots()` runs after the category builders and **before** `applyDiscounts()`. A snapshot-priced line sets `pricedSale`, which excludes it from the discount pass — a snapshot sale is already net, so it cannot be discounted twice.

**#14277 now reads USD 1,101.37 / 969.54 / +131.83 — exactly the PDF, instead of 985.85 / 1,302.27 / −316.42.**

**Accuracy guards.** A line keeps its old derived figures when it has no snapshot (an order older than the table) or an unusable one (`net_total_amount` null or ≤ 0 — an unfinished write must never be booked as a total loss). Every line carries `priced_from`, badged **order-time** (green) or **re-priced** (orange) in both order modals, with a warning banner on non-snapshot orders — a P&L that cannot tie out to the admin statement says so rather than looking wrong. `B2C_SNAPSHOT_PRICING` in `config/b2c.php` is the kill switch, default on.

**Live-data safety.** Every new query is a `SELECT` on the read-only `b2c` connection; nothing writes there. `pnl_records` repair is **upsert only**, keyed on source + control number — rows update in place, none are deleted. Already-issued invoices keep their stored amounts. Six new tests in `B2cSnapshotPricingTest.php` are pinned to #14277's real figures and pass; the suite's 7 errors / 4 failures are pre-existing and unchanged.

### 1.3 A failed snapshot read was overwriting the correct row

The order page and the P&L board did not disagree about arithmetic — they disagreed about **when they were priced**.

- `B2cInvoiceController.php:108` prices one order live: a handful of line ids, so the `checkouts_more_data` lookup succeeds → every line reads *order-time*, and the figures are right.
- `B2cReportService.php:102` renders the stored `pnl_records` row. That row was written by a window sweep, and `snapshotsFor()` caught any failure on a **1,000-id `IN ()`** against the remote storefront, returned `[]`, and let the whole sweep price from today's catalogue — then `store()` wrote those derived figures over the correct ones. Hence the orange *re-priced* badges and −316.42.

Fixed on four fronts: chunks halved to **500** and each chunk retried once after a `reconnect()` (a single timeout on a remote read replica is normal), so a failure now costs only that chunk and is flagged `snapshotDegraded()` instead of failing silently; **`store()` refuses to replace a snapshot-priced row with derived figures** — basis going backwards is not an amendment, it is a failed read, and it is reported as *skipped* in the sweep tally; `B2cLedgerRepairService.php:182` logs a refused write as **FAILED**, so the ledger gap stays open instead of being closed on a write that never happened; and both `b2c:pnl-resync` and the fetch runner report the kept rows.

**The already-corrupted rows still need one repair run.** The scheduled sweep is a **3-day rolling window** (`B2cPnlFetchRunner.php:27`), so anything older than three days will never re-price itself.

```
php artisan b2c:pnl-check 14277                            # prove one order: snapshot vs derived vs stored
php artisan b2c:pnl-resync --from=… --to=… --dry-run       # see the size of the correction
php artisan b2c:pnl-resync --from=… --to=…                 # apply it (upsert, nothing deleted)
```

Neither has been run — this machine cannot reach the production database, and the resync writes.

### 1.4 Payable 1.1 selects on the payable day itself

**What was wrong:** the board was selected the way Payable 1.0 selects — bookings *arriving* on the window date — and then showed every payable inside them, each dated by its own category rule. Three hotels arrived 14 Sep but check in on the 19th, 20th and 21st, so their *Pay on* was right and **the board day was the mismatch**.

- A third date basis, **Payable day**, is now the default on `/payables/v11`. The board is a day's *payments*: every payable settled on that date, dated by the rule its category is paid on behind the gear, whatever day its booking arrived. **Arrival (booking)** and **Activity (line)** are still there, one click away, unchanged.
- **`linesPayableOn()`** answers "what's due on the 14th" cheaply. No report call can answer it — the payment day is decided in `VnPayableSettings`, not upstream — so candidate bookings are narrowed in SQL first: those travelling across the day, widened only by whatever slack the rules actually ask for (`dateSlack()`: offsets, plus a supplier's up-to-10-days-before-check-in). For 14 Sep that is **8 arrival days, not a month**.
- **A line is trimmed to the day.** A split line paid to a hotel, a guide and a ticket desk on three different days now appears on each of those days carrying only that day's parts, chipped as *"N more payables on another day"*, and reconciled against itself rather than against the whole P&L line.
- The blue card's label now reads **Payable date** rather than "Arrival date" / "Activity date"; the *Payable on the board* card's sub-line still names the basis, so the arrival-vs-activity distinction has moved off the blue card rather than disappeared.

**Verified read-only against live data**, base 10 Sep + D-4 = 14 Sep:

| Basis | Lines | Payables dated off the board day | Board total |
|---|---:|---:|---:|
| Payable day | 138 | 0 | USD 10,521.84 |
| Arrival (unchanged) | 137 | 3 | USD 10,326.20 |

Those three are exactly the reported cards — **VN 40539, VN 40628, VN 40403** — and VN 40539 now appears on the 19 Sep board instead.

**Performance worth knowing:** first load of a day is ~**20s**, then ~4s for a few minutes (the per-day report cache, shared with the arrival board); the endpoint raises its PHP time limit for that sweep. The **Activity** basis is the slow one at ~**292s cold**, because the report scans the whole country on it — pre-existing, not introduced here.

### 1.5 Hotel stays are collected by their own dates — and a real sync bug behind it

Chasing three cards that were still wrong turned up the cause and two new commands.

**VN 19878 / VN 19919 missing from the P&L DB.** `as-pnl:sync` sweeps a *created-date* window, so a booking that cannot be dated upstream is unreachable without an hours-long backfill. Added a direct lookup — `ImportAsPnlByIsNumber.php`:

```
php artisan as-pnl:import "VN 19878" "VN 19919" --dry-run   # look first
php artisan as-pnl:import "VN 19878" "VN 19919"             # then write
```

It goes through `AsPnlSyncService::saveBooking()` — the same writer the nightly sync and the *Fetch from AS API* button use — so it is idempotent, it respects a P&L someone deliberately deleted, and it writes nothing for a booking the API returns without a P&L. A revision upstream is a new booking id, so it imports the newest; `--all` stores every revision the IS number answers with.

**VN 40689 — Sanouva Saigon (check-in 14 Sep) missing from the 14 Sep board.** Root cause is a real bug: **`AsPnlSyncService` never writes `pnl_records.end_date`**, so every AS-synced row has it `NULL`. The payable-day board's "bookings travelling across this day" query — `DATE(COALESCE(end_date, start_date, as_arrival_date)) >= ?` — therefore collapses to "bookings arriving that day". VN 40689 arrived 9 Sep, so its 14 Sep stay was invisible.

Fix: **`PayableReportService::hotelStaysInWindow()`** collects stays by their own dates, modelled on the Sri Lanka hotel pass that already solves exactly this (including the 120-day arrival floor for rows with no end date), and `stayLinesPayableOn()` merges them into the payable-day board. Same builder, so the rows keep their `syncKeyFor()` identity — **existing splits and recorded payments follow them**.

**Bamboo Sapa Hotel (check-in 23 Oct) showing under 14 Sep.** The same change moves it — filtered off 14 Sep, reachable on 23 Oct — but only for a line sourced from `hotels_cruises`. The reported card reads *"Pay on 14 Sep · Check-in date"* with service date 14 Sep, which is the booking's arrival: what a free-text `cost.other` line named "Bamboo Sapa Hotel" would look like, not a stay. Every non-hotel AS line is stamped with the booking's arrival as its own date (`getAsPnlCategoryPayables`), so a hotel-shaped charge hiding there cannot be dated by check-in at all. A new read-only `payables:why "VN 41531"` prints the stored rows, the payload's stay dates and every payable line with the day the rules settle it on — that output decides whether a second, larger fix (giving `cost.other` and product lines their own dates from the itinerary) is needed.

Two side effects: the first payable-day load now also reads a 120-day window of VN bookings with a trimmed payload (cached 240s, the same cost Sri Lanka already pays daily); and a stay whose payload carries no check-in date resolves to **no payable day at all** and appears on no payable-day board — pre-existing.

### 1.6 Superseded revisions are dropped from the board

New **`rejectSupersededRevisions()`**: after the window picks its winner, each booking is checked against every revision of itself across the country, and a pick is dropped when something newer answers to the same identity. Same comparison the existing code already uses (revision first, id breaking a tie), same grouping key. **Every skip is logged with both ids and revisions.**

For **VN 41531** that removes the 14 Sep card outright, and rev 10's stay lands on 23 Oct — reachable there through the stay-window pass above, whether or not rev 10's arrival also moved.

**Two things to weigh before this goes live.** It touches **all four boards**, not just Vietnam: any line currently being paid off a superseded revision disappears from the day it was on and reappears on the current revision's day, with a different figure if the amendment repriced it. That is correct, but a country carrying many revisions will visibly shed lines. And the VN 40689 explanation above is incomplete on one point — VN 40548 (arrival 10 Sep) and VN 40323 (arrival 11 Sep) do reach the 14 Sep board, which the sweep can only do if those rows carry an end date or some category rule has a non-zero offset widening the slack. So `end_date` is **not** uniformly `NULL` the way the sync code alone suggests; the stay pass fixes VN 40689 either way, but the mechanism is not purely the missing column.

### 1.7 Invoice figures on the Payable 1.1 export

The board now resolves each booking's current invoice **the same way Payable 1.0 does** — `resolveInvoices()` + `bookingKey()`: latest revision only, tour-ref-numbered rows excluded, IS and invoice numbers normalised to one shape. `invoiceFigures()` attaches `invoice_amount`, `invoice_currency`, `invoice_paid`, `invoice_balance`, `invoice_payment_status` and `has_real_invoice` to every source line, and the card and the flattened component list carry them into the export.

Five new checkboxes right after *Invoice Number* (`scripts.blade.php:1232-1236`): **Invoice Amount, Invoice Currency, Received Amount, Balance, Invoice Payment Status** — in the CSV, the `.xlsx` and saved templates, off by default. Numbers export as numbers, and a booking with **no invoice raised exports blank rather than 0**, so *not invoiced* and *invoiced, nothing paid* stay distinguishable.

Syntax-checked only — the production DB was unreachable from this machine, so the invoice lookup has not been smoke-tested against real rows.

### 1.8 The Vietnam tab now hands the user to the right board

- **Payable 1.0** — the Vietnam tab keeps its position in the strip but is frosted (`blur(3px)`, dimmed) with **→ Payable 1.1** written across it, and it is an `<a>` to `payables.v11.index` rather than a board button. It carries no `data-country`, and the three tab-wiring loops now select `.pv1-country-tab[data-country]`, so it can never be picked up as a selectable country or set `state.country` to `undefined`.
- **Payable 1.1** — the same four-country strip sits under the topbar. Vietnam is the active pill; Malaysia, Singapore and Sri Lanka link back to `payables/v1?tab=<code>`, the deep link Payable 1.0 already reads at `index.blade.php:2284`, so 1.0 opens straight on that country.
- Both boards are granted separately in `config/access.php` (`payable_v1` / `payable_v11`), so each strip checks `PageAccess::allows()` first: a reader without the other board gets the same tab **locked and inert**, rather than a link into a 403.

VN data, the data endpoint and existing `?tab=VN` deep links behave exactly as before — only the tab affordance changed. All three views compile cleanly.

---

## 2. Booking System / OPS — Next.js

### 2.1 Activity Check — a reverse search over the operational record

Instead of starting from a booking and drilling down to activities, you start from an **activity** and find every file doing it. New page at `/dashboard/activity-check`, ~4,400 lines across the board, explorer, column picker, matcher, stats, and four export routes.

**Keyword × date range.** Type keywords as chips ("Ba Na Hills", "Ha Long cruise"), pick a window from 13 presets (*Last week* is one click), and get back every matching activity with its date, file, guest, pax and driver. The matcher had the most care spent on it, because **a keyword that silently matches nothing looks identical to a quiet week**:

- typo-tolerant — *Bana hils* finds *Ba Na Hills*
- spacing-blind — *banahills* finds *Ba Na Hill*
- diacritic-folding — *Da Nang* finds *Đà Nẵng*
- word-order free — each word must land somewhere, in any order

`activity-match-check.mts` (`npm run activity:match`) pins this down and caught two real bugs: 4-letter tokens got no typo slack, and the no-space check was unreachable behind that guard. Both fixed; **15 cases pass**, including precision guards so *hue* does not match *the*.

**Agenda ↔ itinerary pairing.** Each result is paired with the other side's record for the same booking and day — search the agenda and the sold itinerary paragraph is attached underneath; a file with no agenda built yet still surfaces from its itinerary, tagged as such.

**Exports.** Excel with a real two-pane column picker — 47 columns across 6 groups, reorderable, 5 presets (Ground ops / Sales / Full detail / …), your order is the file's order — and five sheets (Activities, By Keyword, By Date, By Booking, Breakdown). PDF rendered through Chromium with keyword highlighting, a CSS day-histogram and breakdown tables, falling back with a clear message if the server has no Chromium. Plus a print view of the same HTML that needs no server browser.

**Live-data safety:** no schema change, no migration, no `db push`. The whole feature issues exactly three Prisma calls — `agendaItem.findMany`, `itineraryItem.findMany`, `booking.groupBy` — and has **no write path anywhere**.

### 2.2 The country filter was sending a query fragment as a value

The board read `countryParam` off `useCountryFilter()` and did `sp.set('country', countryParam)` — but `countryParam` is a ready-made query *fragment* (`"country=VIETNAM"`) meant to be appended to a URL string. The request went out as `country=country%3DVIETNAM`, and Prisma rejected it as an invalid `OperationCountry`. It now uses `countryFilter` (the value), dropped when it is `ALL`. The Explore panel broke the same way through the same source and is fixed by the same change.

`activity-check.ts:437` — `countryClause` now checks the override against the enum's actual values and ignores anything else: **a mistyped country in a URL should narrow nothing, not throw the search back as a wall of red.** Permission scoping is untouched — the check sits after the branch that pins a non-global user to their own countries, so it can only widen back to the user's own scope, never past it. The fragment-vs-value trap is now documented at `use-country-filter.tsx:19`.

### 2.3 Driver Settlement Register — package cost, bank details, PDF/XLSX, saved views

- **Package cost as its own column.** New `savedPackageCosts(refs)` — one `SELECT` over `sl_settlement_docs` for the whole window, pulling `pack.transport.packageCost` per booking ref, tolerating a missing table (`P2021` → empty map). It joins onto the rows before filtering and sorting, so the column sorts like any other, and a failed read is logged and swallowed rather than taking the register down. Rendered between *Cost* and *Total transport cost*, with subtotals in the group rows and footer and a column in the CSV.
  - The cell shows **only what has been saved** on the Settlement documents sheet; an unsaved booking gets an em dash rather than the derived draft figure, because the derived package cost is just the accounts system's transport total — already the *Total transport cost* column — and filling it in would print the same number twice while hiding that no figure has been agreed with the driver.
  - While adding those cells, the totals and group-subtotal rows turned out to be **one cell short of the header** (`colSpan={8}` stopped at A/C Name), so every subtotal sat one column left of its heading and the total transport cost printed under *Cost*. The label now spans 9.
- **Bank details, end to end.** The Drive Log layer already built a bank object for driver, vendor and movement-named cases — it just never reached the register row. `RegisterRow` now carries `bankAccountNo`, `bankHolder`, `bankName`, `bankBranch`, `bankCode`, read off `row.driver.bank` (vendor-run files get the vendor's account, which is where that money actually goes). The **search box matches on account number and holder**, so an account number pasted from a bank statement finds the tour it belonged to. Six new columns under *People*, including a derived one-liner (`1234567890 · W A Perera · BOC Kandy (7135)`); *Bank a/c no* and *A/C holder* ship in the default layout.
  - The account cell is monospace tabular figures, never truncated, full bank line on hover; a driver with nothing registered gets an amber **No account** badge — it is the one thing that blocks a transfer. The settle drawer gained a read-only **Pay to** block above the figures: read-only deliberately, because the driver register owns those fields and *an editable account number on a settlement screen is a redirected payment waiting to happen*. Account numbers export as text, so leading zeros survive.
- **Exports and layouts.** `sl-settlement-pdf.ts` renders a printable statement through Chromium with filters, totals and caveats; `sl-settlement-xlsx.ts` writes a workbook that reflects the user's own layout, with tabs by bulk, by chauffeur and exceptions, numeric cells formatted as numbers; `sl-settlement-views-server.ts` saves each user's register layout as a single JSON row in system settings.
- **The Register menu was being sliced off** at the header's bottom edge. The header carried `overflow-hidden` for a good reason — to stop two blurred glows bleeding past the rounded corners — but `ViewMenu` and `ExportMenu` render their panels as absolute children inside that same header, so the clip caught them too. The glows now clip themselves in a dedicated `absolute inset-0 overflow-hidden` layer and the header clips nothing.
  - **Deliberately not done:** adding `z-20` to the header "for robustness". `relative` + a z-index creates a stacking context, which would trap the menu's `z-50` inside the header's layer — and the sticky bulk-action bar at `page.tsx:1602` is `z-30`, so it would then paint over the open menu. Leaving the header at `z-auto` keeps `z-50` competing in the root stacking context, where it correctly beats that bar. The other pages with the same header treatment (Proforma, Precheck, B2C, Drive Log, Driver Allocation) put no dropdown inside a clipped container, so this was isolated.

### 2.4 Cancellation recovery and full cancel

**Settings → Operations → "Cancellation Recovery"** — a card with a live timeline strip showing what actually happens to a cancelled booking under the current settings (Cancelled → Recoverable until a real date → Closed), then two governed blocks:

| Recover a cancelled booking | Full cancel — sealed |
|---|---|
| On/off (default **on**) | On/off (default **off**, behind an acknowledgement tick) |
| Window: 24h / 3d / 1w / 2w / 30d / 90d / No limit (default **14d**) | Who may seal: Admins / +Accounts / +Ops (default **admins**) |
| Who may recover: Admins / +Accounts / +Ops (default **accounts**) | Type the booking ref to confirm |
| Require a reason · Notify accounts + original requester | |

Recovery puts a `CANCELLED` booking back at the exact status it held before the request — same ref, itinerary, passengers. Full cancel seals a booking so **no role and no later settings change can bring it back**; run on a live booking it cancels outright (the only path that skips the accounts queue, which is why it is admin-only and off by default), run on an already-cancelled one it just closes the window.

**Nothing is deleted, anywhere.** The seal is an append-only `StatusEvent` marker, not a column, so it cannot be lost to a later write. A recovery folds the entire cancellation record (who, why, the fees, the approval) into its status-trail entry as JSON before clearing the live columns for the next cancellation to use. One `evaluateRecovery()` in `cancellation-policy.ts` decides eligibility, so the button and the route it calls cannot disagree — `GET` returns the verdict the UI draws, `POST` enforces the same one. A new green **"Cancellation Reversed"** notice goes out from `send-cancellation-email.ts`, because a recovered booking silently rejoining the pipeline is how one reaches its arrival date with nobody on it.

**One thing to decide:** the new setting keys were left out of `PROTECTED_KEYS`, so enabling full cancel does not require the critical-services password — the ack checkbox, the admin-only default and the typed-ref confirmation are the gates. It can take the password like `ticket_direct_issue` does if preferred.

---

## 3. AHS — Customer-Facing React Front End

No work of my own today. Ten commits by another team member on `SewV3---sasi-update-v2`, all presentational: new hotel cover images and a reworked `HotelMainPage` hero, `LifestyleHome` CSS sizing and the *More* tile spacing, a smaller header icon badge, `AIQuoteLauncher` layout for the advanced tool, `HotelSearchForm` / `category-modern.css` consistency passes, and the removal of the manual-lane focus logic on `FlightMainPage` and the auto-scroll on `HotelMainPage`. `LifestyleHome` now sets standard mode before navigating to flights and hotels. A dead 2,063-line `SummaryProductCard 1.jsx` and unused `index.html` markup were deleted.

**Still open from yesterday:** the `.fdeck-*` markup has no stylesheet anywhere in `src/` — the import that pointed at a file which was never created was removed to unbreak the build, and the CSS still needs writing.

## 4. Aahaas Task Manager

No commits today. Yesterday's emergency-code password reset remains live and `TM_RESET_CODE` still wants rotating once Graph `Mail.Send` is granted.

---

## 5. Main Outcomes

1. **B2C P&Ls are priced from what the order was worth, not what the catalogue says today** — FOC children honoured, order-day FX, and no silent restatement of old orders. #14277 goes from −316.42 to +131.83, matching the admin statement exactly.
2. **The storefront discount is netted against Aahaas's margin, not the supplier's cost** — a discounted order that read break-even now shows the real loss.
3. **A failed snapshot read can no longer overwrite a correct P&L row** with derived figures, and the failure is now logged rather than swallowed — but the rows already corrupted still need one repair run.
4. **Payable 1.1 is a day's payments, not a day's arrivals.** Verified on live data: 138 lines, zero payables dated off the board day, against 3 misplaced under the old basis.
5. **Hotel stays are collected by their own dates**, working around AS-synced rows that carry no `end_date` at all — and existing splits and payments follow the rows because the identity key is unchanged.
6. **Superseded revisions no longer reach any of the four boards** — a booking is paid off its current revision or not at all, with every skip logged.
7. **Activity Check ships** — the operational record searchable from the activity end, with a matcher that tolerates typos, spacing and diacritics, and is pinned by its own check script.
8. **The Driver Settlement Register can now be paid from**: agreed package cost, the driver's actual bank account, an amber badge on anyone who has none, and PDF/XLSX exports that follow each user's saved layout.
9. **A cancelled booking can be brought back — or sealed so it never can be** — under settings that are governed by role, window and acknowledgement, with nothing deleted either way.

## 6. Follow-Up Items

- **Run the B2C repair on the live box.** `b2c:pnl-check 14277` first (expect 1,101.37 / 969.54 / 131.83 on the snapshot row), then `b2c:pnl-resync --dry-run` for the size of the correction, then the real run. Anything older than the 3-day rolling sweep will never re-price itself.
- **Run `as-pnl:import "VN 19878" "VN 19919"`** on the live box — `--dry-run` first. Both are code-verified only; this machine cannot reach the production database or the AS API.
- **Send the `payables:why "VN 41531"` / `"VN 40689"` output.** If Bamboo Sapa comes back with its line dated off the booking's arrival, it is a free-text `cost.other` charge and needs the larger fix: giving `cost.other` and product lines their own dates from the itinerary.
- **Verify the Payable 1.1 invoice columns** against the Pay popup for a booking or two — the lookup was never smoke-tested against real rows.
- **Watch the boards shed lines** the first day `rejectSupersededRevisions()` is live; it touches all four countries, not only Vietnam.
- **Decide whether `AsPnlSyncService` should write `pnl_records.end_date`** — the stay pass works around it, but every AS-synced row is still missing the column, and the real behaviour of the existing rows is not fully explained by the sync code.
- **Consider warming the payable days on the nightly schedule** if a ~20s cold load is too slow on the live box; the Activity basis at ~292s cold is worse and pre-existing.
- **Decide on `PROTECTED_KEYS` for the full-cancel setting keys** — critical-services password, or the current ack + admin-only + typed-ref gates.
- **Check bank details on live drivers** once OPS deploys — if the *No account* badge comes up amber across the board, the gap is in the driver register, not the register page.
- **Decide whether the Package cost column should fall back** to the derived figure when nothing has been saved on the Transport settlement sheet.
- **The branch moved without anyone asking, twice today** — commits appeared on Accounts `REV1` mid-session, and two commits were pushed to `origin/LIVE-1.0.0v` during the Activity Check build. Nothing broken shipped, but worth finding what is doing it.
- **Write the `.fdeck-*` stylesheet on AHS** (carried from yesterday), and rotate `TM_RESET_CODE` once Graph `Mail.Send` is granted.
- Still open from earlier: the 35 Payable 1.1 *Others* rows with transport wording and the learned splits behind them; the Vietnam missing-products document with the rate team, and the import-side bug that reports an unpriced row as "not listed"; `cohortFrom`/`cohortTo` on `/print/bookings-list` and the bookings Excel route; `DB_QUEUE_RETRY_AFTER=3900` and the `2G` pm2 change on the live `.env`; the IndusInd account details for the new payment mode.

**Closed from yesterday:** the Payable 1.1 re-basing work sitting in the working tree is committed, and the payable-day basis built on top of it.

---

**Prepared:** 10 September 2026  
**Projects reviewed:** Accounts System, Booking System / OPS, AHS, Aahaas Task Manager
