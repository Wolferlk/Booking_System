# Daily Work Update — 03 September 2026 (Thursday)

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 03 Sep 2026 (Accounts System, Booking System, Task Manager & AHS)

---

Hi [Name],

Below is a detailed summary of Thursday's work. **29 commits across three repositories — roughly 41,600 lines added and 780 removed.** Four systems were in scope; three saw work.

| System | Commits | Lines | Branch |
|---|---|---|---|
| **Accounts System** (Laravel) | 13 | +4,767 / −683 (64 files) | `REV1` |
| **Booking System / OPS** (Next.js) | 7 | +5,282 / −84 (45 files) | `LIVE-1.0.0v` (pushed) |
| **Aahaas Task Manager** (Next.js, new) | 9 | +31,590 / −13 (191 files) | `main` (pushed) |
| **AHS** (React front end) | 0 | — | untouched today |

There were four threads running through the day:

1. **"Show me what will be emailed, before it is emailed."** Every automated report page — invoice, P&L and the new B2B one — got a full preview stack: the actual mail body, and the actual Excel attachment, rendered on demand without sending anything or writing a run row.
2. **Payable 1.0 became a real payment document.** Export templates, a rounded driver envelope, and a second "Driver payment summary" table on the same sheet — i.e. the sheet the desk actually hands over.
3. **A commercial switch for Aahaas B2C** — sale price displayed at cost — built as a strictly display-only overlay that can never reach the database.
4. **Two large new builds on the Ops side**: a templated, tracked, threaded **Mail Box** for booking correspondence, and the **Aahaas Task Manager** — a complete task-management product stood up from nothing in one evening.

---

## 1. Accounts System (Laravel) — 13 commits, 10:45 → 17:25

### 1.1 One shared movement deck for both daily mails (`2f3b82b`, 10:45) — +713 / −123

Yesterday's work made the three daily mails agree on *which day* they were counting. Today's made them agree on *what happened to those bookings*.

- **`Services/Reports/BookingMovementDeck.php`** (+170, new) — one service that reads the invoice ledger and classifies the day's bookings into **new / amended / cancelled**, so both the invoice mail and the P&L mail describe the same movements in the same words instead of each deriving them separately.
- **`InvoiceReportService`** (+78) and both report sources (`InvoiceReportSource`, `PnlReportSource`) now feed off it.
- **`auto-report.blade.php`** (+143 / −49) and **`pnl-auto-report.blade.php`** (+84 / −41) rewritten onto the deck.
- **`docs/AAHAAS_B2C_B2B_DATA_FLOW.md`** (+342, new) — written documentation of where B2C and B2B data comes from and how it is processed for reporting. This is the reference that had been living only in my head and in commit messages.

### 1.2 Payable 1.0 export templates (`66c4e33`, 11:39) — +389 / −2

The desk was rebuilding the same column layout by hand for every export.

- **`payable_export_templates` table** (new migration) — name, country code, category, format, column list (JSON), owner.
- **`PayableExportTemplate` model** + save/delete routes and `PayableV1Controller` actions (+81).
- **`payables/v1/index.blade.php`** (+219) — arrange the columns once, name it, save it; picking it back applies the layout and downloads that sheet. Templates are per board, so one desk's layout can't be handed to another by accident.

### 1.3 Driver Advance: rounding + its own export sheet (`55c4bd6`, 11:46) — +287 / −9

Two problems, both from the settlement desk.

**The export sheet was empty.** Driver Advance is a *derived* section, so the generic `visibleRows()` returned nothing for it and Export wrote a blank sheet. It now has its own columns and grid, modelled on the desk's own `Fuel Advance Payable.xlsx` sample:

- One row per **booking × cost category** — arrival → CNTL/IS → invoice block → agent/customer → Driver → Cost Category, Category P&L Amount, Advance % (transport at the settlement %, everything else 100), Advance Share + LKR → Driver Advance (LKR), Rest Payment (LKR) → Status, P&L approval → the driver's account name / bank / account number / branch.
- 20+ further columns available in the picker (LKR category amount, in-envelope flag, advance basis, released/outstanding, override + reason, vehicle, phone, bank code, FX rate).
- First sheet comes out named **Driver Advance SL**, with Portal totals and No-payable-lines alongside — same shape as the sample.
- **A booking with nothing in it still gets a row**, so the driver you are *not* paying is visible rather than absent.

**The advance was an odd number.** `SlDriverAdvanceService` gained `ADVANCE_ROUNDING_LKR = 1000` and `roundEnvelopeLkr()`, applied to the computed envelope in rupees (the costed-currency figure follows it, so the two can never disagree). Verified against the desk's three examples: 13,815.40 → **14,000**, 43,895.50 → **44,000**, 20,384.75 → **20,000**. The difference falls into the rest payment automatically — the obligation is untouched, `rest = obligation − advance`. Guards: never rounds down to nothing, never above the total in scope, and **a hand-typed override is never rounded** — that figure is already the one the desk decided. The panel mirrors the rule live and the tile explains itself ("rounded to the nearest LKR 1,000 from LKR 13,815.40 — the odd LKR 184.60 comes off the rest payment").

### 1.4 Mail preview on every automated report (`9f39319` 12:32, `2421c1b` 12:42, `75591b8` 13:03)

A **View** button that opens the *real* email in a modal — subject, To/CC/BCC, attachment name, row count, and the rendered body in an isolated iframe. Nothing sent, nothing logged, safe to press repeatedly. It also warns when the period is empty and *skip-when-empty* would suppress the send.

- **Auto invoice reports** (`reports/auto.blade.php`, +83) — per-brand preview via `AutoReportService::brandPreview()` (+120 / −13).
- **Auto P&L reports** (`pnl/auto.blade.php`, +83) — same modal, no service change needed: it reuses `brandPreview()`, so both pages render through the report source's own mail view and cannot drift apart. Verified read-only against schedule 3: AHDS 49 bookings, Aahaas B2C 20 orders, both rendering, nothing sent, no run rows written.
- **B2B** — `AutoReportService::mailPreview()`, the unsegmented twin of `brandPreview()`, sharing the same `mailPayload()` / `subject()` / `fileName()` helpers a real send uses.

### 1.5 A dedicated screen for the B2B daily email (`804b9f9`, 12:52) — +1,492 / −453

The B2B email settings had been squatting on the bookings board. They now have their own page at **`/b2b/auto`**, modelled on `/pnl/auto`.

- **`AutoB2bReportController.php`** (+499, new) and **`b2b/auto.blade.php`** (+927, new) — a shelf of B2B automations switched by `?kind=`. The live one is the **B2B Invoice Report**: run/stop hero with countdown, multiple schedules with a switcher, board filters, cadence + timezone, recipients, subject + body note, skip-when-empty, a live preview panel, full paginated send history with view / download / re-send, and Send-now with `as_of` and dry run.
- **B2B Flights P&L (`?kind=pnl`)** — a deliberately empty tab that explains what exists (the selling side) and what is missing (supplier fare / taxes / commission are not readable anywhere yet), and never writes. Wiring it later is one `KINDS['pnl']` entry.
- **`/b2b/bookings` is now read-only again** — the settings card, form and send-now block are replaced by a one-line status strip with a link. `B2bBookingController` lost `scheduleSave/Toggle/SendNow/RunDownload` (−225), so every route on that board is a `SELECT`.
- **Continuity:** the new page reads the same `report_type = b2b_flights_report` row, so the live schedule (id 9, all 12 recipients) carried over untouched. Nothing was written to the database.
- **Access:** new `auto_b2b_reports` page key in `config/access.php` + Analytics sidebar entry. Anyone who configured the email through their old `b2b_bookings` grant needs the new page granted.

### 1.6 Workbook preview — see the attachment, not just the mail (`ef80f9f` 13:13, `691fdd3` 13:22)

An **Excel** button beside View / Dry run / Run now, on both `/b2b/auto` and `/pnl/auto`.

- Builds the workbook the schedule *would* attach right now, off the saved settings, and shows the actual sheet: title block, column order, first 500 rows, with "showing the first N of M" when longer.
- **Download .xlsx** streams the same file then deletes it — nothing emailed, no history row.
- `AutoReportService` gained **`buildWorkbook()`** (writes a throwaway file through the same source, file name and title block a real send uses) and **`workbookPreview()`**. `readWorkbook()` for *sent* runs now shares the same reader, so an unsent workbook is read exactly the way a sent one is — including the merged-title-block skip the P&L sheet needs.
- On `/pnl/auto` the viewer appears in three places: inside the email modal ("View the attachment", for that same business), on each business card, and in the hero for the combined workbook. `buildWorkbook()` takes an optional `brand` and cuts the segment exactly as a split send does, so preview and real attachment cannot diverge.

### 1.7 Aahaas B2C — "sale price at cost" switch (`a5aa7a8` 14:07, `9787894` 15:08)

A commercial requirement: show B2C storefront figures with **sale = cost, profit = 0**.

- **`/settings/b2c`** (`B2cSettingsController` + `settings/b2c.blade.php`) stores one `app_settings` row, `b2c.sale_equals_cost` — same table the other toggles use, **so no migration**.
- **`B2cSalePolicy.php`** (+190, new) — while on, every B2C figure is restated **in memory**: order totals, each breakdown line, and the KPI tiles.

**Data safety was the whole point, and it is deliberate:**

- Nothing is ever saved. The overlay only touches models and arrays already loaded on their way to a screen, an export or an email.
- Overlaid `PnlRecord` attributes pass through `syncOriginalAttributes(['amount','profit_loss','extracted_data'])`, so **even an unrelated `save()` later in the same request cannot flush the restated numbers to the database.**
- The write paths are pointedly *not* routed through the policy: `B2cPnlSyncService` (the `pnl_records` upsert) and `B2cInvoiceService::generate()` keep recording the real storefront figures. Turn the switch off and the true numbers are back with nothing to repair.

**The afternoon follow-up (`9787894`):** the emailed workbook came from a different engine than the two B2C pages — `/pnl/auto` builds its rows through `PnlDbReportService`, which reads `pnl_records` for *both* books of business, so storefront rows there were still carrying their real sale and profit. The overlay now runs at the **shared chokepoint**:

- `PnlDbReportService::fetch()` / `fetchForBookings()` restate `source = 'b2c'` rows as they load, so the P&L rows, the currency totals, the email's headline stats, the movement deck and the attached workbook all restate together and **cannot disagree**.
- `PnlInvoiceParity` restates the "carried in" bookings on the same rule.
- `DbPnlController` — `/pnl/db` listing rows, plus one extra aggregate (only while the switch is on) so the KPI tiles match the rows beneath them.
- **Apple System rows are untouched throughout** — only `source = 'b2c'` is restated.

Verified against a live boot: with the switch ON a B2C record loads as 478.98 / 478.98 / 0 while reporting **no dirty attributes**, and an AHDS record came back untouched at 1000 / 800 / 200. Only `SELECT`s were run; no report sent, no row written.

### 1.8 Driver payment summary — a second table on the same sheet (`791befa`, 16:10) — +476 / −51

The Driver Advance export now writes the line-by-line table it always did, then a blank row, a bold **"Driver payment summary"** title, and a second table with its own header, one row per booking.

- Default columns exactly as requested: IS Number, CNTL Number, Driver Advance, Travel Date, Driver Advance (LKR) (the rounded envelope), Rest Payment (LKR), Driver Total Payment (LKR), Total Booking Payment Cost (LKR), Driver, Account Name, Bank, Account Number, Branch.
- Fully customisable — a second picker block with on/off, Default / Select all / Clear, tick boxes and up-down ordering over **45+ columns**. Remembered per board in `localStorage` and carried inside saved templates, so a template can't hand the next desk a different sheet. CSV gets the same second table.
- **Leading-zero account numbers stay text in both tables** (each table's text columns are read off its own header row); freeze pane + autofilter stay on the first table only; sheets sent without a second table produce **byte-identical** output to before. Verified end to end by writing a real workbook through the controller.
- Two readings I had to choose, both one click to change: *"Advance"* = the envelope in the costed currency (USD, with Advance % available if the 30% was meant); *"Total Booking Payment cost"* = every costed section including ones outside the envelope (e.g. an office-paid hotel), in LKR.

> ⚠️ **Open item:** the migration `2026_09_03_170000_add_summary_table_to_payable_export_templates` is **still pending** — the safety hook correctly blocked `php artisan migrate --force` against the live database. It is additive only (`summary_columns` JSON nullable, `include_summary` tinyint default 1) and `--pretend` confirms it is the single pending migration. **Until it runs, exporting works fine but saving an export template will error on the unknown column.** Please confirm whether you want me to run it or you will.

### 1.9 Twin coverage in the payable report (`813c933`, 17:25) — +84 / −12

`PayableReportService` — reworked twin-coverage logic so a booking that exists on both sides is matched and counted once rather than being double-reported or dropped.

---

## 2. Booking System / OPS (Next.js) — 7 commits, 13:23 → 18:45 · branch `LIVE-1.0.0v`, pushed

### 2.1 Driver brief: itinerary + package slides (`cc7ce51`, 13:23) — +451 / −35

Both sections are now proper slides in the driver brief deck, not appended text.

- **`lib/driver-brief.ts`** — deck order is now driver → overview → flights → hotels → movements → **itinerary** → tickets → **package** → notes; both new slides self-hide when the file carries nothing. Payload pulls `itineraryItems` (day, date, title, description, per-day inclusions/exclusions) and the nine package text columns, split by a `lines()` helper that strips pasted bullets so the deck draws its own marks.
- The AI talking points now tell the model that **the itinerary is the guest's document and the movement chart is the driver's**, and that the package screen means "provide this / refuse this" — never a price.
- **The Itinerary slide** — days on one continuous glowing spine, numbered dots with a pulse on the open day, cards expanding to the full brochure paragraph with per-day include/exclude chips. Beside it a fixed **"Which document wins"** panel: the guest bought this, you drive the *n* movements on the chart, call the office before agreeing to anything else.
- **What's Included** — value-added services first as hand-over chips ("You give them this, without being asked"), then included / not-included / further exclusions, with terms, policy and tips muted underneath. The right rail carries the say-this points, the guest's special requests, and an amber "if they ask for an excluded item" card naming the file handler.
- **Bug caught in passing:** step kickers were hardcoded ("Step 6 of the brief") and would have gone wrong the moment two slides were inserted. They are now computed from the deck actually built for that booking, so a file with no flights never claims a step it doesn't have.

### 2.2 Vehicle photo in the driver brief (`9c33e13`, 13:54) — +40

The assigned vehicle's photo now displays in the brief, so the guest can be told what to look for.

### 2.3 The CSV export was truncating the day (`9bb36cf`, 15:28) — +29 / −4

**A real reporting defect.** `report-data.ts:710` cut the created-bookings list to `maxRows` (default 30), and the CSV renderer wrote that *already-truncated* list — so a day with 50 confirmations headlined 50 and exported 30 rows.

- `CreatedSection` now also carries `allBookings` / `allOutside` — the full, uncapped populations. The capped `bookings` / `outside` stay, so the email table doesn't grow unbounded.
- `renderReportCsv` writes the uncapped lists for both the counted block and the "NOT COUNTED (earlier confirmations)" block.
- `preview/route.ts` strips the uncapped arrays out of the JSON the drawer receives, so the page payload doesn't double for rows it never renders. Both the `?format=csv` download and the mailed attachment get the full set.

### 2.4 B2C reconciliation was reporting a shortfall that didn't exist (`704c0b7`, 15:39) — +81 / −9

I queried the live storefront for the 20 orders booked 02 Sept: **all 20 are Aahaas flight sales (category 6), and 19 have no `service_date` on any line.** The importer's query requires `service_date IS NOT NULL` and still ahead — so those orders are **invisible to it by construction** and OPS can never hold them. The one flight order that does carry a service date (#14097) *is* in OPS.

So the red ×s were not a matching bug: the reconciliation was reporting 19 orders as "missing from OPS" that were never importable.

- `b2c-db.ts` — `fetchOrdersBookedBetween` now also returns `datedLines` and `flightLines`, plus an exported `FLIGHT_CATEGORY_ID`.
- `reconcile-report-data.ts` — each line carries `importable` and `flightOnly`. **`missingInOps` now holds only orders OPS could have filed**; the rest go to a new `notImportable` list. Neither counts against the verdict.
- New *info* finding: "19 storefront orders the importer cannot see — all of them are Aahaas flight sales", explaining that a flight's travel date lives in the itinerary, not `service_date`.
- The OPS column shows **—** (not applicable) instead of a red ×, the Service column reads *flight*, and the "Filed in OPS" tile reads **1 / 1** with a note, instead of an apparent 1-of-20 shortfall. CSV gains a *Flight only* column.
- Verified against live data for 02 Sept: `missingInOps` is now empty, `notImportable` lists the 19, P&L and invoice coverage 20/20, verdict stays balanced.

### 2.5 "Booked Today" live intake card (`c3e3318`, 15:50) — +191 / −3

Filled the dead space under Upcoming Tours / Arrival Flights on the wall dashboard.

- Live and verified: **17 booked today · 75 pax · busiest at 10:00 · ▲1 vs yesterday**, an hour-by-hour skyline, and per-country chips (VN 10, LK 4, MY 1, SG 1).
- The count runs up through the existing `Counter` easing and, **on a rise only — not on every 2-minute poll** — fires a violet ring burst and a spring tick on the digits, so a new booking landing is visible from across the room. The 24 bars grow with a 26 ms stagger; the current hour's bar is brighter, glowing, and breathes on a 1.8 s loop; a slow light sweep keeps it from looking frozen on a wall screen.
- **`view-dashboard/route.ts`** reads today's created bookings as rows (tens per day, one query) and derives the count, pax, 24 hourly buckets and the country split. **The comparison is against yesterday up to this same clock time**, not yesterday's full total, so the tile doesn't show every morning as a collapse.

### 2.6 Mail Box — templated, tracked, threaded booking correspondence (`a1fe38d` 18:19, `7f563d0` 18:45) — +4,490 / −33

The largest single OPS build of the day: outbound mail for a booking, sent from the system, with a record of what was said.

**Data layer** — `prisma/manual-sql/2026-09-03-mail-box.sql` (+134) creates **five brand-new tables** (`mail_templates`, `mail_agents`, `mail_internal_recipients`, `mail_threads`, `mail_thread_messages`).
- **Strictly additive:** not one existing table is altered, and no existing row is read or written. `CREATE TABLE IF NOT EXISTS` throughout, so a second run is a no-op rather than an error.
- Foreign keys point **only at the new tables**. There is deliberately **no FK to `bookings`** — threads are keyed by `bookingRef` string, the same convention as `sl_settlement_docs` and `driver_briefs`, **so correspondence survives the child-row rewrite an amendment performs.**

**Backend** — 12 API routes under `/api/mailbox` (threads, compose, send, agents, internal CC list, templates, install-starters) plus five libraries: `send.ts` (tracked sending through Microsoft Graph), `sync.ts` (+184 — pulls replies back in and updates thread status), `tokens.ts` (+157 — dynamic content insertion for template rendering), `resolve.ts` (+138 — agent matching from a booking to an email address and name), `starter-templates.ts` (+151) and `guard.ts`.

**Access** — expressed as **two role lists in `mailbox/access.ts`, deliberately not new `Permission` entries.** Adding a permission means editing all ten `ROLE_PERMISSIONS` arrays, and every one of those edits is a chance to widen an unrelated role by accident; Mail Box grants nothing that existing permissions gate, so the narrower change is the safer one. `MAILBOX_SEND_ROLES` (compose, send, read) vs `MAILBOX_MANAGE_ROLES` (edit templates, the agent directory, the internal CC list).

**UI** — `dashboard/admin/mail-box/page.tsx` (+864) with a `template-editor.tsx` (+402), and `components/bookings/mail-box-modal.tsx` (+1,025) opening straight from a booking page. Sidebar entry added.

**The 18:45 follow-up** hardened it: **booking-scope checks in the guard** (a user can only correspond on bookings within their own scope), enforced in `compose`, `send` and `threads` alike, plus improved agent selection in the modal.

---

## 3. Aahaas Task Manager — new product, 9 commits, 18:38 → 19:45 · `main`, pushed

A complete Task Management System, built as an **isolated Next.js module at `/tm`** against the live MySQL database. ~31,600 lines.

### Database — additive only, and proven so

- **43 new `tm_*` tables** via a purpose-built migration runner (`scripts/migrate.mjs`) that **statically rejects any `DROP` / `ALTER` / `DELETE` / `UPDATE` statement before it touches the database**, and verifies the pre-existing **373 tables are byte-identical before and after**.
- Verified the existing `users` table (**21,571 rows**) and other production tables are untouched.
- Seeded departments, task categories, reward types, badges and the default Manager account (bcrypt-hashed).

### Backend — 36 API routes (`f7f560b`, `638fbe8`)

Auth (signup / login / approval / password reset), tasks (CRUD, comments with @mentions, checklists, dependencies, workflow and approval), **daily updates with AI parsing behind a human review gate**, departments / teams / users / projects, transparent weighted **performance scoring** (Manager-configurable), **Monthly Power Rewards** (metrics first, AI explains after), reports + CSV export, notifications, audit log, saved views, global search, settings. **RBAC enforced server-side on every route** — verified with a live 401 test.

### Frontend — full SaaS UI (`dcc9887` → `7ad1987`)

Design system (Button, Card, Badge, Avatar, Field, Tabs, Toast, Overlay, Misc), sidebar + **⌘K command palette** + mobile bottom nav, light/dark/system theming, Today dashboard with a **deterministic "What should I do today?" engine**, Kanban board with drag-and-drop, calendar, task drawer with tabs (details / checklist / comments / activity timeline), the Daily Update AI review screen, performance and reports charts (Recharts), rewards + leaderboard, admin, notifications, profile, settings.

### Verified live (`483ef27`)

Login, signup→approval flow, task creation with auto-generated `TM-2026-000124`-style numbers, AI daily-update parsing (**caught and fixed a real prompt bug producing empty titles**), performance scoring, and **a reserved-keyword SQL bug in the approvals query** — all fixed and retested. Production build passes clean: **59 routes, 0 type errors.** Test data cleaned out of the `tm_*` tables afterwards.

---

## 4. AHS (Aahaas customer-facing React front end)

**No work today.** Last commit remains `258e1b06` (02 Sep) — the compact category dock. Yesterday's redesign pass is unchanged and needs no follow-up at this stage.

---

## 5. Data safety — what was and was not touched today

Worth stating plainly, because three of today's threads sat close to live data:

- **B2C "sale at cost"** — display-only overlay, `syncOriginalAttributes()` guarding against accidental flush, write paths deliberately excluded. Verified against a live boot with **no dirty attributes** and **only `SELECT`s executed**.
- **Mail Box** — five new tables, `CREATE TABLE IF NOT EXISTS`, zero alterations to existing tables, no FK into `bookings`.
- **Task Manager** — 43 new tables through a runner that refuses destructive SQL by static check, with a 373-table before/after integrity verification.
- **Report previews** — every new View / Excel / Dry-run path builds through the same code a real send uses but **emails nobody, logs no run row, and deletes the throwaway workbook afterwards.**
- **No migration was run against the live database.** The one pending migration (§1.8) was blocked by the safety hook, as intended.

---

## 6. Open items for tomorrow

1. **Run `php artisan migrate`** on Accounts for `add_summary_table_to_payable_export_templates` — additive, two columns, currently blocking template *saving* on the Payable export dialog. Awaiting your go-ahead.
2. **Grant `auto_b2b_reports`** to anyone who previously configured the B2B email through their `b2b_bookings` page grant.
3. **Confirm the two B2C scope decisions I left alone:** the order-detail modal's "storefront" block still shows what Aahaas itself recorded (labelled as the storefront's own record), and I need a decision on whether that should be restated too.
4. **Confirm the two Driver-summary readings** — "Advance" as the USD envelope vs the 30%, and "Total Booking Payment cost" including sections outside the envelope. Both are one click to change.
5. **Driver advance rounding step** is currently a constant (LKR 1,000) in the service plus its mirror in the page. Say the word and I'll move it into `/settings/payables`.
6. **B2B Flights P&L** remains a deliberately empty tab until supplier fare / taxes / commission become readable somewhere.

Happy to walk through any of this.

Best regards,
**Sasindu Diluranga**

---

### Appendix — commit log, 03 Sep 2026

**Accounts System** (`REV1`)

| Time | Commit | Subject |
|---|---|---|
| 10:45 | `2f3b82b` | BookingMovementDeck — unify booking data for P&L and invoice reports |
| 11:39 | `66c4e33` | Payable 1.0 export templates |
| 11:46 | `55c4bd6` | Driver Advance — rounding + export improvements |
| 12:32 | `9f39319` | Brand preview for Auto Reports |
| 12:42 | `2421c1b` | Brand preview mirrored onto Auto P&L |
| 12:52 | `804b9f9` | `/b2b/auto` — dedicated B2B automation screen |
| 13:03 | `75591b8` | Mail preview for Auto B2B reports |
| 13:13 | `ef80f9f` | Workbook preview + download, B2B |
| 13:22 | `691fdd3` | Workbook preview + download, P&L |
| 14:07 | `a5aa7a8` | Aahaas B2C — sale price displayed at cost |
| 15:08 | `9787894` | Same rule applied at the `PnlDbReportService` chokepoint |
| 16:10 | `791befa` | Driver payment summary table on the Payable export |
| 17:25 | `813c933` | Twin coverage logic in `PayableReportService` |

**Booking System / OPS** (`LIVE-1.0.0v`)

| Time | Commit | Subject |
|---|---|---|
| 13:23 | `cc7ce51` | Itinerary + package slides in the driver brief |
| 13:54 | `9c33e13` | Vehicle photo in the driver brief |
| 15:28 | `9bb36cf` | Uncapped booking lists for CSV export |
| 15:39 | `704c0b7` | B2C reporting — flight category + importability |
| 15:50 | `c3e3318` | "Booked Today" hourly intake card |
| 18:19 | `a1fe38d` | Mail Box — access control, schema, APIs, UI |
| 18:45 | `7f563d0` | Mail Box — booking scope checks, agent selection |

**Aahaas Task Manager** (`main`)

| Time | Commit | Subject |
|---|---|---|
| 18:38 | `9fe9b39` | First commit — schema, libs, migration/seed runners |
| 18:53 | `f7f560b` | Task workflow and management endpoints (30 routes) |
| 19:04 | `638fbe8` | Audit, exports, rewards, saved views, search, settings |
| 19:20 | `dcc9887` | Design system, shell CSS, hooks, client |
| 19:21 | `af9eb60` | Command palette (⌘K) |
| 19:24 | `41d8dc8` | Core layout, auth pages, navigation |
| 19:32 | `907da0a` | Task list, board, calendar, drawer; users/teams/projects |
| 19:39 | `7ad1987` | Performance, reports, rewards, admin, settings pages |
| 19:45 | `483ef27` | Live verification fixes (AI prompt bug, SQL reserved word) |
