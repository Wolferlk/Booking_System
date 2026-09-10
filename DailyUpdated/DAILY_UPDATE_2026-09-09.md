# Daily Work Update — 09 September 2026 (Wednesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 09 Sep 2026 (Accounts System, Booking System, AHS & Task Manager)

---

## Executive Summary

The day belonged to the Accounts System. It opened by clearing a blocker left standing from yesterday — Payable 1.1 could not save its settings, and the cause turned out to be schema rather than settings code. The middle of the day delivered two substantial pieces: **Check List — Vietnam** at `/checklist`, a faithful on-screen rebuild of the agent's own spreadsheet built entirely from figures the system already holds, and **five new tabs on both daily workbooks** (cancellations, old amendments, today's new & updated, all revisions, and a day-by-day count table). The afternoon added a Transport category to Payable 1.1, broke the driver envelope into its parts in the Payable 1.0 export picker, and began re-basing the Payable 1.1 board so it selects the same bookings Payable 1.0 does — that last piece is written but still uncommitted. Two small Accounts changes went in early: *Reference no* renamed to **Agent ID** wherever an invoice prints it, and an **Indus – INR** payment mode. The Booking System took two focused fixes (a flight pickup buffer, a Leaflet stacking bug clipping the sidebar). AHS chased down the *missing navbar* on Hotels and Flights and landed the two-lane flight deck. The Task Manager cleared a 23-item bug list and replaced the broken emailed password reset with an emergency code.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 8 commits | `REV1` | One modified file (`PayableV11Controller.php`) |
| Booking System / OPS | 3 commits | `LIVE-1.0.0v` | Clean |
| AHS | 2 own commits (+11 by another member) | `SewV3---sasi-update-v2` | Clean |
| Aahaas Task Manager | 2 commits | `main` | Clean |

---

## 1. Accounts System — Laravel

### 1.1 Payable 1.1 could not save its settings — the column, not the code

Yesterday's board refused every settings save. The cause was found in the schema, not in the settings path.

- `app_settings.value` was **`VARCHAR(255)`** from the original `create_app_settings_table.php`. Payable 1.1 stores its *entire* settings document — categories, date rules, AI/split configuration, rates — as one JSON blob in a single row, roughly **700 characters**, so MySQL rejected the insert outright with `1406 Data too long`.
- `2026_09_09_090000_widen_app_settings_value_column.php` changes the column to **`longText`**. Previewed with `migrate --pretend` first (a single `MODIFY` statement, no data touched), then applied. The live column is now `longtext` and saves go through.

### 1.2 Agent ID — the field was already there, just misnamed

`booking.reference_no` *is* the agent's own reference; it is the same pair of stores that Settings → Agent ID Repair writes. Three fixes, one meaning:

- **`invoice-studio.blade.php:129`** — Details → Booking, the box labelled *Reference no* now reads **Agent ID** ("Agent's own reference"). That is the field that was showing `NA`.
- **`InvoiceDocumentRenderer.php:141`** — the edited-invoice PDF prints it under **Agent ID**, the heading every other template already uses, instead of "Reference".
- **`InvoiceDocumentService.php`** — saving a real agent id now *also* writes `incoming_emails.reference_no`. Without this the PDF would read correctly while the daily report's Agent ID column still printed `NA`. Placeholders (`NA`, `-`, blank) never overwrite a real id, and the value is captured in the edit snapshot so **Undo puts the old one back**.

One behaviour worth knowing before using it on a specific invoice: an invoice with no overrides yet still prints through its original template, and the **first save in Invoice Studio — any field — moves it onto the studio's own Apple Holidays layout permanently**. That is existing designed behaviour, not something changed today. To fix only the agent id without changing the template, Settings → Agent ID Repair writes just the email field.

### 1.3 Indus – INR payment mode

Payment modes live in the `payment_modes` table, seeded by migration with no admin CRUD page, so a new mode is a new forward migration: `2026_09_09_100000_seed_indus_inr_payment_mode.php`.

- Inserts `INDUS-INR` / "Indus – INR", currency **INR**, bank IndusInd Bank, red tile, active.
- Placed at **sort_order 2**, right after ICICI – INR, sliding the other seven modes down one so their existing order is preserved — the card appears second in the Mode of Payment grid.
- `down()` **deactivates rather than deletes** if any receipt already points at it, and only deletes (restoring the sort order) when it has never been used.

**Still open:** `account_name`, `account_no`, `branch`, `ifsc_code` and `bank_address` were deliberately left `null` — they are display-only (the Pay modal shows them as the block a payer remits to), so the mode works without them, but the block prints blank until the real IndusInd details are supplied. Also worth confirming whose account it is: ICICI – INR belongs to Sharmila Tours and Travels, and if Indus is a different entity the `account_name` should say so.

### 1.4 The count-check card is gone from the Daily P&L mail

`pnl-auto-report.blade.php:196-203` — the `@include('emails.partials.cohort-check', …)` was the only thing rendering the green **✔ Apple System count check** block (the header row, the APPLE SYSTEM / OPS BOOKINGS / P&LS / INVOICES / THIS REPORT figures, the footnote and the red *NOT IN THIS REPORT* box). It is replaced by a comment saying why it is off. Compiled views were cleared so the next send uses the new template.

Unchanged on purpose: **the cohort still cuts the mail's population** and the pre-send sweep/repair (`reports.cohort_preflight`) still runs — the mail is still built from a checked day, it just no longer prints the tally. The partial stays on disk, so restoring it is one line. The invoice mail never rendered this block, and `/sync-ledger` still shows the check.

### 1.5 Check List — Vietnam (`/checklist`)

A faithful rebuild of `Checklist 2026 (42).xlsx` on screen: one **booking header row** (tour code, agent, pax, month, arrival, departure, days, itinerary, revenue USD, rate, total VND, P&L incurred, margin) with its **service lines** underneath (details, vendor, code, dates, unit price, quan1, quan2, total estimate, paid, incurred, note).

It joins two things that already exist and **computes nothing of its own**:

- **Header** = the Vietnam P&Ls on `/pnl/db` (`pnl_records`, `country_code = VN`, latest revision, cancelled excluded).
- **Lines** = the Vietnam payables through the same engine Payable 1.0 and Daily Updates use (`PayableReportService` + `PayableV1Controller::normalizeRows`), plus Payable 1.1's split expanded into its real suppliers wherever one has been confirmed — toggleable with the scissors button.

**Manual editing, safely.** Every dotted cell is editable inline, with chip menus for CODE and PAID. Edits land in two brand-new tables only — `checklist_bookings` / `checklist_lines` — as an **overlay**: `NULL` means "the live figure stands". So clearing a cell restores the live figure, striking a line off hides it here and nowhere else, and a booking re-synced from the Apple System under a typed cell keeps the cell. **There is no endpoint in the group that can touch a P&L, payable, payment or invoice.**

Files: `ChecklistController.php` (586), `ChecklistService.php` (1,004), `ChecklistBooking` / `ChecklistLine` models, `2026_09_09_120000_create_checklist_tables.php`, `checklist/index.blade.php` (1,147), plus routes, `config/access.php` and the layout nav.

### 1.6 Five new tabs on both daily workbooks

Appended after OTHER ACTIVITY in the Invoice mail (`/reports/auto`) and the P&L mail (`/pnl/auto`), on **both** the AHDS and Aahaas split sends. Mail bodies and every existing sheet are untouched.

| Tab | What's on it |
|---|---|
| **CANCELLED DETAIL** | Every booking in the period called off — booking ref, invoice #, CXL #, agent, guest, country, arrival, pax, booking value, fee, paid to date, balance, refund, P&L value/cost/profit, cancelled on/by, note, and whether the cancellation fell inside the period or after it closed. Per-currency totals. |
| **OLD AMENDMENTS** | Confirmations first raised before the period and edited inside it — First Confirmed On, first invoice #, days old, revisions to date, previous invoice #, before → this amount → change, and the booking's whole revision chain on one line. Sorted oldest first, with 1–7 / 8–30 / 30+ day age bands. |
| **TODAY NEW & UPDATED** | Bookings first confirmed inside the period, one line each, with a Type column: *New*, or *Updated (same period)* for same-day churn. By-type and by-currency blocks. |
| **ALL UPDATED** | Every revision *document* raised in the period — a booking revised twice is two rows, because two files went out. Origin column separates "Older confirmation edited" from "Same period". |
| **DAILY COUNTS** | One table per day: New / Updated / Cancelled counted from the invoice ledger and the P&L board side by side, then invoice-value-by-currency and P&L-value-by-currency tables, then the same for the period total. |

**Two judgment calls, both written into the sheet's own header note** so nobody reads the gap as a fault: invoices are counted as **documents** (every revision) while P&Ls are counted as **bookings** (the board holds one row per booking); and the two sides classify new-vs-updated on different counters — ours on our document chain, the P&L on the Apple System's own revision number, which confirmations often arrive already above 1. On 08/09 that reads as 59 new invoices against 5 new P&Ls. Currency tables are kept apart because an INR invoice sits against a booking costed in USD.

Verified **read-only against the live database**: all four workbooks (AHDS + Aahaas for each mail) were built for 08/09/2026 into the scratchpad — no email, no DB writes, no schedule run rows. Sheet order came out `AHDS | CANCELLED | OTHER ACTIVITY | CANCELLED DETAIL | OLD AMENDMENTS | TODAY NEW & UPDATED | ALL UPDATED | DAILY COUNTS`, and the active sheet is still index 0 so the "view the Excel" preview still opens on the front sheet. Page exports (`/reports`, `/pnl/db`) are deliberately unchanged — the tabs attach only when the scheduled send passes its own window.

New `Services/Reports/ActivityTabs.php` (1,089 lines), wired through `InvoiceReportService`, `PnlDbReportService`, `InvoiceReportSource` and `PnlReportSource`.

### 1.7 The driver envelope, broken into its parts, in the Payable 1.0 export picker

Five new columns — **Transport Advance · Attraction · Others · Meals · Hotel**, each also in LKR. The four LKR ones are ticked by default and placed left-to-right as the money actually moves: **parts → envelope → rest → total**. Hotel is available but off, matching how the envelope treats it.

Three requested columns already existed and were **not duplicated under new names** — export templates are saved by column header, so a second header for the same figure would only confuse the picker: *Total Driver Advance* is `Driver Advance (LKR)`, *Rest driver payment settlement* is `Rest Payment (LKR)`, *Total (advance + rest)* is `Driver Total Payment (LKR)`.

**The arithmetic worth knowing:** the part columns are the *exact* shares, so they add to `Driver Advance Exact (LKR)`, **not** to `Driver Advance (LKR)` — the envelope is rounded into notes before the driver is handed it. On the sample booking, 18,435.05 + 7,653.24 = 26,088.29 exact, handed over as 26,000, with the 88.29 already exposed as `Envelope Rounding (LKR)`. A section the booking switched off reads **0**, not its cost — the driver isn't handed it. A hand-typed override behaves the same way: the parts show what the rule computed, and `Driver Advance (LKR)` shows what actually went into the envelope.

No server change was needed — the browser sends the finished grid and `exportXlsx` writes it, so xlsx and CSV pick these up automatically. Existing saved templates are untouched; the new columns appear in them unticked until someone adds them.

### 1.8 Payable 1.1 — an eighth category, Transport

Sitting between Meals and Others.

- **`VnPayableSettings.php:53`** — `TRANSPORT => Transport` in the default catalogue, with its default date rule (activity date, no offset).
- **`2026_09_09_140000_add_transport_category_to_vn_payable_settings.php`** — the catalogue is a *stored* setting and this board had already saved one, so the code default alone would never have reached it. The migration slots Transport into the existing `app_settings` row just before Others and copies Meals' payment rule (arrival → activity), leaving every other key untouched. Idempotent, with a `down()`. Run — one row updated; the board now reports 8 categories.
- **`VnAiSplitter.php:483`** — the AI is now told what Transport is (vehicle, transfer, driver, coach, SIC/private car, airport pick-up/drop-off), and Others no longer claims "transfers and vehicles". The worked example in the class docblock files "Shared Transfer" under TRANSPORT.
- **`PayableV11Controller.php:830`** — `guessCategory()`, which parks a not-yet-split line under a tab, gained a transport pattern placed **after** Ticket so "cable car ticket" and "water park" keep their desks. Spot-checked: shared transfer / SIC transfer / airport pick up / private car → TRANSPORT; cable car ticket → TICKET; bottled water → WATER.

**Two things left alone, both data rather than code:** 35 existing components are already filed under Others with transport wording (of 36 Others rows in total) and will stay there until re-filed; and learned splits (learning is on) will keep re-applying the old OTHERS category to product names already seen, so those learned rows need clearing or re-filing before new splits pick Transport up.

### 1.9 Re-basing the Payable 1.1 board on Payable 1.0's own selection — *uncommitted*

The 1.1 board selected its lines its own way — a base date, a 0–30 day window, a payment-vs-service mode and a separate `lookback` — which meant it and Payable 1.0 could be looking at the same day and showing different bookings.

- **`selection()`** now reads exactly the three fields Payable 1.0 reads, with the same names, clamps and defaults: base date, a **D-0…D-8** deadline (default 4), and a basis of **arrival** or **activity**. A Payable 1.0 link pasted at this board lands on the same bookings.
- **`boardLines()`** asks `PayableReportService` for **one day on one basis** — the very call Payable 1.0 makes — instead of sweeping a range of arrival days. The old `sourceLines()` range sweep survives only as the fallback `findLine()` uses when a line has moved off the day the page is sitting on.
- The payment day each category settles on is **still resolved, still shown and still exported** — it simply no longer decides which lines reach the board. `in_window` / `outside_window` / `window_total` give way to `board_total`, and the response now carries `deadline`, `date_basis` and `target_date`.
- The per-day cache is now keyed by **basis as well as day**, and a new `control_number` filter was added; the old `q` text parameter is still accepted so existing links keep working.

Written and reviewed, **not yet committed** — `PayableV11Controller.php` is the one modified file on `REV1`.

### 1.10 Documentation

- **`DAILY_TASKS.md`** — the operator's checklist for one working day, built from the real schedule in `routes/console.php` and the routes that exist, framed as *confirm it ran* rather than *run it*, with Colombo times throughout and a pointer to SAFETY.md before anything that writes, deletes or emails.
- **`VN_MISSING_PRODUCTS.md`** — the Vietnam products the rate sheet cannot price, against sheet upload #36 (547 rows). It settles a running argument with the rate team: for **five** products the row genuinely *is* in the sheet with the right name and Apple ID — what is missing is the **rate**, every price cell blank. A row with no price is discarded at import, so the ERP cannot tell "unpriced row" from "no row at all" and the email wrongly reports both as *"Not listed in this agent column."* **That is our bug**, and it does not change the outcome: an empty price cell prices nothing. Totals: 19 products / 40 lines / **USD 3,046.40** at risk on the current sheet, plus 7 products / 52 lines still open from earlier sheets. Read-only check; nothing in the system was changed.

---

## 2. Booking System / OPS — Next.js

### 2.1 Flight pickup buffer unified at 3 hours

`agenda-flight-link.ts:73` — the suggested pickup used a **2-hour** buffer for domestic sectors (DAD↔PQC is domestic, which is why VN41615 read 2 hrs). The two constants are replaced by a single `PICKUP_BUFFER_H = 3`, used for every departure at line 168. VJ718 departing 09:25 now reads *Suggested pickup 06:25 · 3 hrs before departure*. Because `bufferHours` flows through to the UI chip, the AI describe prompt and the PDF/Word note text, all three pick the change up with no further edits. `isInternational` is kept — it still drives the passports-vs-photo-ID wording.

### 2.2 The Live Ops map was painting over the sidebar

`.lom-wrap` was `relative` with **no z-index**, which does not create a stacking context. Leaflet's internal panes carry their own z-indexes (tilePane 200, overlayPane 400, markerPane 600, tooltipPane 650, controls 800–1000) and the component's own controls/legend use `z-[500]`. With nothing containing them, all of that competed in the **root** stacking context against the fixed sidebar at `z-40` — so tiles, pins and legend painted straight over it, clipping the labels to "Reservat…", "Proform…", "Feedbac…", "Chat".

The fix is one declaration at `live-ops-map.tsx:169` — `.lom-wrap{isolation:isolate}` — matching what the booking journey map already does (`journey-map.tsx:711`), so the two Leaflet instances behave the same way. Everything Leaflet draws stays sealed inside the map card; sidebar, header and modals sit above it again. `tsc` reports no errors in the file (the three it does print are pre-existing and unrelated).

Yesterday's daily update was also committed to the repo (`0fe74d1`).

---

## 3. AHS — Customer-Facing React Front End

### 3.1 The missing navbar on Hotels and Flights

Two separate causes, both found and both fixed in `category-modern.css`:

- **A `backdrop-filter` on the header *wrapper*.** An element with a backdrop-filter becomes the containing block for `position: fixed` **descendants** — so the moment the scrolled state frosted `.cm-page > .header`, `.navbar-desktop` stopped being fixed to the viewport and became fixed to the wrapper, which then scrolled away with the page and took the bar with it. The wrapper now gets only the background/shadow transition; **the blur belongs to the bar that is actually painted**, and the wrapper is deliberately excluded from every rule that sets a filter.
- **`overflow-x: clip` on the page root.** A clip box on the root also clips the fixed navbar inside it. Changed to `overflow-x: hidden`, which is what the Lifestyles home already uses for the same reason.
- The bar is then **pinned on purpose**: `.cm-page > .header` is sticky at `top: 0` and the desktop navbar fixed at the viewport, both at `--z-header`, so nothing on a page root — a clip box, a stacking context, a flex column — can carry it off once the hero scrolls past. The merge now only changes how the header is *painted*, never whether it is on screen.

### 3.2 The flight deck — one card, two lanes

Ask-in-words and fill-in-fields are the same task done two ways, so they now share **one slab** rather than stacking two surfaces. The AI composer used to ride along inside `MainHero`, which put it in a card of its own above a second, un-carded search bar; `showAIButton` is now off there and `AIQuoteLauncher` lives in the deck below. The lanes are told apart by tint and a labelled seam, and each recedes while the other has focus (CSS `:focus-within`), so **only one primary action is ever lit**.

The seam chip hands the user into the manual lane. The form exposes no focus handle and its airport cells swap between a rendered value and an `<input>` depending on selection, so there is not always an input to focus — clicking the **cell** works in both states, because the form's own handler opens the dropdown and mounts the input autofocused. The lookup is scoped to the deck's subtree rather than the document, since the results view renders a second copy of the same form.

### 3.3 Lifestyle "More" deck, sized down

The deck tiles are now a size down from the service tiles above — same surface, icon puck and type, just tighter (38px puck, 14px title, 11px subtitle, 15px radius). The row is `align-items: stretch` with the lead centred against it, so one-line and two-line subtitles end up the same height, and the shimmer/hover washes were toned down.

**Left open:** `5bef30b4` removed an `import './FlightDeck.css'` that pointed at a file which was never created — the build was breaking on it. That is the right immediate fix, but it means the `.fdeck-*` markup currently has **no stylesheet anywhere in `src/`**; the deck needs its CSS written before it looks like the design.

Eleven commits by another team member landed the same day on the same branch: a new `AIQuoteLauncher` replacing the old AI assistant button on Flights and Hotels, a `ModeToggle` component replacing `RoomAllocationModal`, a reworked `HotelSearchForm` (primary search row, quick date selections, padding and width passes), slogan/title text on the hotel hero, frosted hero-section controls, and dark-mode passes on both main pages.

---

## 4. Aahaas Task Manager — Next.js

### 4.1 A 23-item bug list, cleared

Highlights, with the causes rather than the symptoms:

- **Dropdown options invisible app-wide** — no `color-scheme` was declared, so in dark mode the browser painted option popups on a light ground while they inherited near-white text. Declared per theme, plus explicit option colours.
- **Team Tasks empty** — the view demanded `t.team_id IS NOT NULL`, but nobody in the database has a team, so it matched **0 of 219** tasks. Rescoped by ownership in `tasks/route.ts`; verified live, 0 → 219 rows for a manager.
- **Task updates not reaching the Manager Portal** — new `taskStakeholderIds()` in `notifications.ts`; every status change now notifies the creator, team leader and department manager, where previously only review requests did.
- **An unapproved account could change its password** — `reset-password` now rejects any non-ACTIVE account and burns the token.
- **Team performance not visible** — the page only ever fetched the signed-in user. Added a person selector and a sortable team table (score, assigned, completed, overdue, deadlines met, updates), each row opening that person's breakdown.
- **Pending Approval filter** — the query was correct; the *page* was unreadable, with no status tags and a failed fetch rendering as a blank page indistinguishable from "no matches". Added status badges, a banner linking to the Approval Center, a Rejected filter and a real error state — and stopped the edit modal silently approving a pending user.
- Plus: reveal toggles on every password field (new shared `PasswordInput`), a new `PhoneInput` with 14 dial codes and Sri Lanka default on signup/profile/People, name and job-title validation, department and team shown and pre-selected on Manager Approval, disabled departments filtered out of pickers (while a record already pointing at one still shows it), avatar fallback to initials on a broken image, "Unassigned" removed from task creation, a clickable "+7 more", search-bar overflow and a clear button, team member management wired to endpoints that already existed, Board and Sign out added to the sidebar, and the unlabelled ring on Profile now reading "Performance score N/100".

### 4.2 Forgot Password now uses an emergency code, not email

Graph `Mail.Send` permission is broken, which locked everyone out of password recovery. `/tm/forgot-password` now asks for **email + emergency code**; on a match the server issues a single-use token and takes the user straight to `/tm/reset-password`, where the existing strength meter and reveal toggle apply. **No mail is sent anywhere.** The code reads from `TM_RESET_CODE` with a working built-in default, so it can be rotated with one `.env` line and a restart.

Guards kept in place: the **same rejection message** for wrong email, wrong code and inactive account (so the endpoint can't be used to discover who has an account), rate limiting at 8 failures per email/IP in 15 minutes reusing the login throttle, constant-time comparison, every accepted and rejected attempt audited to `tm_audit_logs` with the IP, and a single-use token expiring in 30 minutes that still signs out every other session. Verified against the running server across five cases; the test token was burned afterwards, leaving 0 live reset tokens.

**One thing to weigh:** it is one shared code, so anyone holding it can reset any account, including a Manager's. That is the trade accepted to get people back in while mail is down — worth rotating once Graph `Mail.Send` is granted, or switching back to emailed links at that point.

---

## 5. Main Outcomes

1. Payable 1.1 can save its settings again — the blocker was a 255-character column holding a 700-character document, not the settings code.
2. The Vietnam checklist the agent keeps in Excel now exists on screen, built from the P&L board and the payable engine, with hand edits held as an overlay that can never reach a P&L, payable, payment or invoice.
3. Both daily mails now carry five new workbook tabs — cancellations, old amendments, the day's new and updated, every revision document, and a day-by-day count table — with the invoice/P&L counting difference written into the sheet rather than left to be discovered.
4. The driver envelope is no longer a single number in exports: its four parts are ticked by default, and the rounding between the exact shares and the cash handed over is a column of its own.
5. Payable 1.1 gained a Transport category everywhere it has to exist at once — default catalogue, the stored settings row, the AI's vocabulary, and the fallback guesser.
6. Payable 1.1's board is being re-based on Payable 1.0's own selection, so the same day means the same bookings on both pages.
7. Two "it looks broken" reports turned out to be CSS containment: Leaflet painting over the OPS sidebar, and a backdrop-filter plus a clip box carrying the AHS navbar off the screen.
8. Task Manager users can get back into their accounts without email, on a rate-limited, audited, single-use path.

## 6. Follow-Up Items

- **Commit `PayableV11Controller.php`** — the 1.1 re-basing work is finished but still sitting in the working tree on `REV1`.
- **Send the IndusInd account details** (`account_name`, `account_no`, `branch`, `ifsc_code`, `bank_address`) and confirm whose account it is — the migration has run, so the mode is live with a blank account block.
- **Write the `.fdeck-*` stylesheet on AHS** — the markup shipped, the CSS file it imported never existed and the import has been removed.
- **Decide on the 35 Others rows with transport wording** in Payable 1.1, and whether learned splits should be cleared so new splits pick Transport up straight away. The list can be shown before anything moves.
- **Take the Vietnam missing-products document to the rate team** — starting with Group A, where the row exists and only the price cells are blank.
- **Fix the import-side reporting bug** the document exposes: an unpriced row is discarded at import, so the email calls it "not listed" when it is listed.
- Rotate `TM_RESET_CODE`, or restore emailed links, once Graph `Mail.Send` is granted.
- Still open from yesterday: extend `cohortFrom`/`cohortTo` to `/print/bookings-list` and the bookings Excel route; put `DB_QUEUE_RETRY_AFTER=3900` into the live `.env` and pick up the `2G` pm2 change; confirm the `b2c` and `aahaas` manual sends; investigate the N+1 in the report builders; re-word the "entered here later" label.

**Closed from yesterday:** the accounts settlement-register migration has been run (`2026_09_08_100000_add_register_columns_to_sl_transport_settlement_requests`, batch 73), so OPS actuals *saves* no longer error.

---

**Prepared:** 09 September 2026  
**Projects reviewed:** Accounts System, Booking System / OPS, AHS, Aahaas Task Manager
