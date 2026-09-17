# Daily Work Update — 15 September 2026 (Tuesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 15 Sep 2026 (Checklist VN 1.0V, VN Payable, daily mail trim, database load)

---

## Executive Summary

The bulk of the day went into a **brand-new component in the Accounts System — Checklist VN 1.0V** (`/checklist-vn`). A Vietnam booking is *sold* as a handful of agenda lines and *paid* as several dozen invoices, and nothing stood between the two. The component reads each booking's agenda live from ops, uses OpenAI to name what suppliers are inside each line, prices those lines off the 2,220-rate VN TARIFF workbook, and tallies the result against the booking's own P&L. Six tabs, five new tables, and nothing existing altered.

The afternoon added the sixth tab, **VN Payable**, which gives preparation a deadline: a booking becomes due **eight days before it arrives**, a nightly sweep prepares whatever crossed that line overnight, and where the rate resolver refuses to commit, the best candidate is taken anyway — filed as a **guess**, never as a match, and the booking cannot read *ready* while a guess on it is unreviewed.

Two smaller strands closed out the day. The **daily invoice and P&L mails** were cut to the three sheets the mail actually reads, with the removed blocks replaced by tables the reader can check. And the **database load** work — the primary was carrying 100 % of read and write traffic while three replicas idled at ~2 % CPU — put connection caps, read-replica routing and the missing indexes in place on both systems, plus an admin page to watch it.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 7 commits | `REV1` | Clean |
| Booking System / OPS | 1 commit | `LIVE-1.0.0v` | Clean |
| Aahaas Task Manager | 1 commit | `main` | Clean |
| AHS | No work today | `SewV3---sasi-update-v2` | Clean |

---

## 1. Accounts System — Checklist VN 1.0V (new component)

`/checklist-vn` · nav: **Payable → Checklist VN 1.0V** · ~7,000 lines across 26 files

```
BOOKING            VN41071 · 485484CNTL · 30 SUNDAYS (Credit) · 2 pax
  AGENDA LINE        19 Sep · Hanoi · SIC · "Halong Cozy Bay Day Cruise…"
    CHECKPAYABLE       Day Cruise  Cozy Bay Premium   1,026,000 × 2
    CHECKPAYABLE       Trans       Shared SIC bus       660,000 × 2
    CHECKPAYABLE       Meal        Lunch on board             —
    CHECKPAYABLE       Ticket      Sung Sot cave              —
```

### 1.1 The six tabs

| Tab | What it is |
|---|---|
| **Bookings** | Every VN booking arriving in the window, read live from ops, with cost, revenue, margin and P&L tally |
| **Booking** | The drill — booking → agenda line → checkpayables, every cell editable |
| **Checkpayables** | The flat register: one row per thing one vendor is owed, across every booking |
| **P&L tally** | The same bookings sorted by how far this sheet is from the booking's P&L |
| **Rate sheet** | The imported VN TARIFF workbook, all 16 tabs, searchable; fetch + activate |
| **Settings** | Workbook link, model, house rate, match threshold, validity handling |

### 1.2 The tariff workbook — three things that are easy to get wrong

Read from the SharePoint link in Settings via Graph. **2,220 rates across all 16 tabs.**

1. **VND columns are in thousands.** The ACTIVITIES tab says so on its own header. Everything is stored in full dong — `518.4` → `518,400`.
2. **Each tab's corner cell is its own USD→VND rate**, also in thousands (25.5, 25.8, 24.2, 26). Stored per row. Proof: `518.4 / 20.3294 = 25.5` exactly.
3. **`setReadDataOnly(true)` does not mean "give me values".** Most of the money in this workbook is computed, and a formula cell comes back as formula *text*. The importer reads `getOldCalculatedValue()` — Excel's own cached result. Reading `getValue()` alone silently dropped ~380 rates and produced garbage like `195012003000` from `=(1950+1200+3000)*1.1/$A$1/K$2`.

### 1.3 How a rate is chosen — and when it refuses

Four widening steps — **code → exact name → exact name in city → fuzzy** — each labelled on the row so the reader can tell a certainty from a guess. Scoring is a **weighted F-measure**; two earlier, more obvious designs both lost money in testing and are documented in the code:

* Overlap over the *smaller* bag scored a longer, more specific row as a perfect match — `"Ba Na Hills Cable Car Ride"` picked the **Night combo** over the plain ticket.
* Unweighted words let the brand be outvoted — `"Shared Cozy Bay Day Cruise"` matched **Dolphin Halong Cruise** at 2,760,000 instead of Cozy Bay at 1,026,000. Fixed with IDF: "cruise"/"bay"/"halong" are in hundreds of rows and say nothing; "cozy" says everything.

Two hard guards: **service class** (`shared`/`sic` never matches `private`/`pvt` — a shared SIC transfer had been priced off a private full-day charter at 153.62 USD/pax, because the original stopword list struck out exactly those words), and **validity** (a rate whose window does not cover the travel date is dropped *before* scoring — the workbook keeps last season's rows, and the nearest name is often the expired one).

**It refuses more often than it answers, on purpose.** Two rows equally plausible *and quoting different amounts* are a question, not an answer. A refusal keeps its working: the top three candidates are stored on the row and offered inline, one click to accept, never applied on their own.

### 1.4 What the AI does and does not do

* **Never prices.** Any figure the model volunteers is discarded silently.
* Answers only in the eight categories; anything else folds into `OTHERS`.
* May correctly say a line is payable to **nobody** — leisure day, hotel-only, own arrangement.
* **Quantity is checked, not taken.** Asked for "2 on a round trip", the model returned 2 for a full-day tour's transfer *and* its cable car, buffet lunch and guide — silently doubling four real payments. A quantity above 1 now needs the line to actually say round trip / return / 2 ways, and is only ever allowed on `TRANSPORT`. A guest does not eat two lunches.
* Identical movements are read once and re-used across bookings.

### 1.5 The arithmetic, taken verbatim from the desk's workbook

Two of the three read as the opposite of their names, so they are worth stating:

```
Total estimate  = Σ checkpayables          what the trip COSTS
Total VND       = Revenue USD × rate       what it SOLD for
P&L incurred    = Total VND − Total estimate   the PROFIT in dong
Profit margin   = P&L incurred / Total VND
```

Verified against the reference sheet: `20,298,000 − 11,329,200 = 8,968,800` → `44.19 %`. ✓

### 1.6 Two live-data bugs found while building

* **`quotedTotal` is not always USD.** 24 VN bookings quote in dong; one read as **$2,000,000 of revenue** and dominated the window total. Now converted at the booking's own rate.
* **An unread booking has an *unknown* cost, not a zero one.** "Revenue minus nothing" was showing a 100 % margin on 300 trips nobody had costed. Cost-dependent figures now stay null until a line is read, and only costed bookings contribute to the window's profit.

### 1.7 Safety

Five tables created fresh (`vn_tariff_imports`, `vn_tariff_rates`, `checklist_vn_bookings`, `checklist_vn_lines`, `checklist_vn_payables`) — **nothing existing altered.** The ops booking system is read-only throughout: every call is `get()` / `first()` / `value()` / `pluck()` / `count()`. `agenda_item_id` is deliberately **not** a foreign key — a cross-database constraint would let this component's table block a delete in the live booking system. No endpoint can amend a P&L, re-price a payable, record a payment or issue an invoice. Every overlay column is nullable and **NULL means "use the live value"**, so an ops amendment flows straight through and only typed cells survive on top of it. A tariff import arrives **inactive** — nothing reprices because a fetch ran. Removing the component is five `DROP TABLE`s and a route-file edit.

**Verified against live data:** 16/16 tabs parsed, spot-checked (`S.HAN01 → 518,400`, `Ngoc Son Temple → 50,000 / 30,000`, PVT ladder `2 pax → 4-seat band`). `VN41071` read end to end: 7/7 agenda lines, CNTL and credit type resolved, P&L matched. Booking list **35.4 s → 3.4 s** after the `select *` on `pnl_records` (which carries whole email bodies) was narrowed to the columns actually used.

---

## 2. Accounts System — VN Payable (sixth tab)

`VnPayablePrep.php` · `ChecklistVnPrepare.php` · one additive migration

Checklist VN could already read a line into checkpayables and price them. What it could not say is **when** that should have happened — preparation started when somebody opened a booking, which in practice was after the guests had landed and after the suppliers had asked to be paid.

> A booking becomes **due** a set number of days before it arrives — **eight** by default — and from that day the board is answerable for it.

**The five states**, re-derived (never incremented) by `VnPayablePrep::assess`, worst first: `failed` (the agenda could not be read at all) · `attention` (an unread line, a read error, or a row with no rate) · `pending` (nothing read yet) · `review` (priced, but a guess stands unchecked) · `ready`.

**Pricing on probability.** Eight days out, a blank cell is not a safe answer either — it is a supplier paid late, or paid whatever they invoice. Between "certain" and "nothing" there is a band the resolver cannot use but a person can. `autoPriceOne` fills it, and the distinction between a **matched** rate and a **guessed** one is carried in five separate places: a distinct `rate_source = 'auto'` so no query can mistake one for the other; `auto_margin` (a high score with **no** margin is two near-identical rows quoting different money — the most expensive kind of wrong — so it is never rated *high*, however well it reads); the runners-up kept on the row; a booking never reading `ready` while a guess is unreviewed; and `GUESS — NOT CHECKED (62%)` in capitals on the CSV export, because a spreadsheet is where a figure stops being questioned and starts being paid. A guess is only ever placed on a row nobody has touched.

**The filter bar is Payable 1.0's, deliberately** — not imitation. The Vietnam desk reads both boards in the same hour, and a payment window meaning one thing on one screen and something else on the other is a mistake waiting to be made. Same base date, same date basis (arrival vs activity), same D-0…D-8, same search boxes. *Show converted values* restates every dong figure booking by booking at **each booking's own rate**, never one board rate. Category chips are counted **before** the category filter, so picking Hotel does not make the other seven read zero.

**Running it.** `php artisan checklist:vn-prepare` is scheduled daily at **04:20 Colombo**, switched off from the page, bounded by a budget, and re-reads nothing — a night with nothing newly due costs nothing at all. A first run is done from Settings → *Ready Payable*. Preparing eighty bookings is eighty agendas of OpenAI calls, so the page loops in batches of two rather than issuing one request that would time out having reported nothing; every booking commits as it finishes, and **Stop** means stop rather than abandon.

---

## 3. Accounts System — the daily mails, trimmed

### 3.1 Invoice mail: three sheets, not six

`ActivityTabs.php:110-139` stopped creating **DAILY SUMMARY**, **ALL UPDATED** and **DAILY COUNTS**; `InvoiceReportService.php` now skips the AHDS brand ledger sheet and the OTHER ACTIVITY appendix for the scheduled mail. The gate is whether activity tabs were passed — the daily mail passes them, the Reports-page *Export Excel* does not, so **the manual export is unchanged** and still produces AHDS + AAHAAS (verified).

Two guards were needed because, with the brand sheet gone, the book can now legitimately be empty at points where it never could be before: the mid-build `setActiveSheetIndex(0)` is conditional, and a book that ends with no sheets gets a **NO ACTIVITY** sheet rather than throwing and failing the send.

Verified by regenerating the 14/09 AHDS workbook to a scratch file — no mail sent, nothing written — and diffing **every cell** of the three surviving sheets against the workbook that actually went out: **0 differing rows**. Nothing that stayed has moved. The three methods are kept in place but no longer called, so the existing reflection-based test is unaffected.

**Deck zero** — the month-to-date book the day is a day of — was removed from the invoice mail body for the same reason: the mail should describe one period.

### 3.2 P&L mail: three tabs, and three tables that can be checked

The emailed AHDS/B2B P&L attachment now carries exactly **TODAY NEW & UPDATED · OLD AMENDMENTS · CANCELLED DETAIL**. The *P&L Report* and *OTHER ACTIVITY* sheets are skipped for the daily mail only — the `/pnl/db` page's own export is untouched and still has both (verified: daily-mail book = 0 base sheets, page export = P&L Report).

In the body, *By country* / *By agent & country* / *By agent* now print **one line per currency** off the unconverted totals — no more SGD folded into USD — and the column is renamed **Invoice → Sell**, since it is P&L money. Those blocks now carry a labelled warning: they count every booking **whole**, including older confirmations, so they will not add to the Selling / Cost / Profit headline, which counts an older confirmation as its **change only**. That gap was real in the sample — the country table summed to USD 22,400.19 against a headline of 19,620.94, the difference being exactly the 3 older bookings (1,678.50).

A **Cancelled** table now mirrors the remaining CANCELLED DETAIL tab (booking, cancellation #, agent, guest, country, arrival, booking value, fee billed, refund, P&L profit, cancelled on, and whether it was raised inside the period or after it closed). Its rows come from a new `ActivityTabs::cancelledMailRows()` using the same brand filter and P&L join as the sheet, so the table and the tab can never list different bookings.

Verified by rendering the full mail body offline against a synthetic payload — two today rows in two currencies, one old amendment, two cancellations, one of them after the period. Blade compiles clean, all touched PHP passes `php -l`, **no database written and nothing sent.**

---

## 4. Database load — both systems

The primary `aahaas-prod-database-4` was carrying 100 % of read and write traffic while database-5/6/7 idled at ~2 % CPU. From `npm run db:health` against live (MariaDB 10.11, 1,193 h uptime):

| Measure | Value | Reading |
|---|---|---|
| Buffer pool hit ratio | **99.92 %** | Not I/O bound — the working set fits in RAM |
| Rows scanned per query | **1,294** | ~54,000 rows/sec read sequentially. **This is the CPU.** |
| Full scans | **24 % of all queries** | A quarter of queries read a whole table |
| Peak connections | **503 / 500** | The limit has been hit — this is the P1001 / P2024 source |

A high hit ratio *with* a high scan rate means the server is spending CPU walking rows already in memory, so the fix is to stop the scans, not to add RAM.

**Three fixes are in, on both sides:**

- **Connection pool caps** (live, with defaults). Applied in `db-tuning.ts` where the connection string is *resolved*, not by editing `DATABASE_URL` — this app resolves its connection from four different sources and only one is the line an operator would think to edit.
- **Read-replica routing** (code in place, inactive until `DB_READ_HOST` is set). The Booking System gets `prisma-read.ts` and moves the file-handler resolve sweep, both PortalLink sweeps and the dashboard aggregates; the Accounts System gets two always-read-only connections, `mysql_read` and `ops_read`, which fall back to the primary when unset. **Existence checks that decide whether to create a booking deliberately do not move** — a stale "no such booking" would import a duplicate. A full split on the Laravel `mysql` connection is wired but **opt-in** for the same reason: `emails:fetch` / `pnl:fetch` decide whether to process a mail by first SELECTing whether they already have it, and served stale that check processes the same mail twice. A kill switch on the new admin page sends every read back to the primary, no redeploy.
- **Indexes** (in the schema, five confirmed missing on live, not yet created). The statements in the original brief do not run against this schema at all — the tables are `bookings` / `flights`, not `Booking` / `Flight`; there is no `vnNumber` column anywhere (the reference is `bookings.isNumber`); and `flights` has no `arrivalDate`. Five correct indexes were added instead, matched to the `WHERE` clauses the schedulers actually issue. **Be honest about the gain:** `bookings` is 2,682 rows / 16 MB and `flights` is 7,362 rows / 1 MB — tables this small cannot produce 99.8 % CPU however often they are scanned. They stop the sweeps getting slower as the tables grow; they will not move the CPU graph.

**New:** a **Database Health** admin page (`/dashboard/admin/db-health`) with connection stats, index status and the replica toggle, plus two read-only commands — `npm run db:health` and `npm run db:indexes` (`-- --apply` is the only writer, and only ever `ALTER TABLE … ADD INDEX` with `ALGORITHM=INPLACE, LOCK=NONE`).

---

## 5. Aahaas Task Manager — the AHDS defect list

Seventeen reported items worked through; **12 fixed**, 3 answered as not-defects, 2 left open pending a decision.

Fixed: login needing two attempts (`await refresh()` before navigating; AppShell no longer redirects mid-revalidation) · mobile number digits hidden · MANAGER missing from the registration roles (still approval-gated) · a reusable `SearchInput` with a clear button and *Clear filters* on both people and task lists · **Approvals — four empty tabs** (only 2 of 5 types were ever created; added `TASK_COMPLETION` on submit, a new `/approvals/request` endpoint, UI entry points and the missing `LEADER_REQUEST` decision branch) · *Open Full Page* → 404 (the route did not exist; extracted `TaskDetailContent`, added `/tm/tasks/[id]`) · a reopened task showing *In Progress* (added `REOPENED` end to end) · project members, % and counts · the Daily Mail toggle knob.

Two of them shared one root cause worth naming: **0 of 263 tasks had a `team_id`**, which is why the Leader Portal and the Teams counts were blank. Task creation now inherits the assignee's team and leader scoping reads `tm_team_members` — but the code fix only applies to *new* tasks; a backfill script is included and still needs to be run.

Left for a decision: **Achievements & Badges** are unimplemented (10 badges seeded, nothing in the codebase ever inserts into `tm_user_badges` — it needs award criteria), and **daily emails** could not be verified from here (sent via Graph on update submission, but failures are silently swallowed).

---

## 6. Verification

- Checklist VN was built and read against **live data**, not fixtures: 2,220 rates imported and spot-checked against the workbook, `VN41071` read end to end, all 20 routes registered, every endpoint smoke-tested.
- Both trimmed mails were **rendered and read end to end offline**, and the invoice workbook was diffed cell by cell against the file that actually went out.
- **No mail was sent, no P&L amended, no payment recorded, and no migration run against live.** The five Checklist VN tables and the one additive migration are the only schema changes, both on tables this component owns.
- The PHPUnit suite was not run, per SAFETY.md.

---

## 7. Follow-Up Items

1. **The five missing indexes are not yet created on live.** Run `npm run db:indexes -- --apply` — safe on a live primary, but it needs a person. **Do not use `prisma db push`:** live has drifted from `schema.prisma` and a push would try to reconcile the whole schema.
2. **`DB_READ_HOST` must be set in the Amplify environment**, not only local `.env` — this codebase has had prod/local env drift before. Until it is set, none of the replica routing is active.
3. **The real CPU offender has not been found.** 1,294 rows/query is instance-wide and is not explained by anything fixed above. Next: lower `long_query_time` from 10 s to 1 s in the RDS parameter group (dynamic, no restart), collect for an hour, and rank by **rows examined, not duration**. Suspect the blob tables first — `pnl_price_adjustments` is **8 GB over 116,000 rows (72 KB/row)**, and `pnl_records` carries full email bodies and should never be selected with `*`.
4. **`.env` defines `DB_DATABASE` twice** — `apple_booking_system` near the top, `invoice_processor` further down — and the loader keeps the last one. The new scripts name the database explicitly for that reason, but it is a trap for the next person.
5. **Checklist VN's five tables and the two migrations still need applying to live**, and the tariff workbook needs one fetch + activate before the board has anything to price against.
6. **The VN Payable nightly sweep (04:20) will make OpenAI calls once it is live** — the budget defaults to 40 bookings a night; confirm that is the intended spend before enabling `prep_auto_run` in production.
7. **Task Manager: the team backfill has not been run.** 235 existing tasks still have no `team_id`, so the Leader Portal and Teams counts stay blank for historic work until `scripts/backfill-task-teams.mjs` is run against the database.
8. **Task Manager work was committed on `main`.** Worth moving that repo onto the branch-first rule the other two follow.
