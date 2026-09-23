# Daily Work Update — 21 September 2026 (Sunday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 21 Sep 2026 (Accounts: period activity on Invoice Payments & P&L board, KPI currency split, Vietnam payable switch; Online Work: one-tap sign-in & demo sandbox; Task Manager: Leaders can create projects)

---

## Executive Summary

Most of the day went into the **Accounts System**, where two boards were made to tell the same story as the daily mail. **Invoice Payments** and the **P&L board (`/pnl/db`)** now both open with a **Period activity strip** (New / New updates / Old updates / Cancelled) read straight from the mail's own computation, so a card and the email cannot disagree. Along the way, a 4-vs-3 mismatch against the 20/09 mail was traced to **one B2C document** being counted by the strip but shown by neither the board nor the AHDS mail, and fixed.

The P&L board's KPI tiles had been **adding USD and INR into one number labelled "(USD)"**. They now split by currency. One query I shipped **500'd on the live server** (`ONLY_FULL_GROUP_BY`) and was fixed within the hour. I also found and removed a much worse side effect: **opening the board was triggering an API-calling Sync Ledger repair sweep.**

In the **Online Work portal**, the sign-in page gained **one-tap Admin / HR buttons**, then a **demo sandbox** of 24 `demo.*` accounts that can sign up, sign in and reset passwords **without writing a single row to the live database**.

In the **Task Manager**, **Leaders can now create projects**. They could see the invitation to create one but had no button to act on it.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 13 commits | `REV1` | Clean |
| Aahaas Online Work | 3 commits | `main` | Clean |
| Aahaas Task Manager | 2 commits | `main` | Clean |
| Booking System / OPS | No work today | `LIVE-1.0.0v` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

---

## 1. Accounts System — P&L import by quotation number (committed)

`d53d209` · 2 files · +172

Friday's in-progress work is now **committed on `REV1`**. `php artisan as-pnl:import --quotation=473420` (with or without the `CNTL` suffix, and with `--all` to walk earlier revisions) imports a booking whose IS number was never stamped in the Apple System. This closes follow-up #5 from 19 Sep **on the commit side**. A real, non-dry run against such a booking is still outstanding.

---

## 2. Accounts System — Invoice Payments: Period activity strip

`cee348d` `431db63` `5bdda54` `22959ce` `781902a` `32615d7` · ~1,060 lines

### 2.1 What changed on the page

* **The KPI cards are gone** from Invoice Payments, which removes **eight COUNT/SUM queries from every page view**. `statsFor()` stays, because the PDF and Excel exports still head their summary sheet with it.
* **The Period activity strip now leads the page:** New, New updates, Old updates, Cancelled. Clicking a card cuts the board to exactly the documents that card counted.
* **The Cancelled switch moved into *Filter Invoices*** beside Currency, and it is now a real filter. When it is off, everything cancelled comes off the page at once.
* **The mail's AGENT AMOUNT deck** sits under the four cards: *Credit agent amount*, *Non-credit agent amount* (each with an *Older edited* line that is shown separately and never added in), and *Amended amount (change)*.

### 2.2 The 4-vs-3 mismatch

The daily mail is sent **split**: one email for AHDS (Apple System agent bookings) and one for Aahaas B2C. The board hides B2C too. The strip, however, was asking for the **combined** day, so a storefront order raised on 20/09 was counted by the card and shown by neither the board nor the AHDS mail.

> That was exactly the 4-vs-3, and the USD gap: 919.86 − 818.55 = **101.31, one B2C document.**

`activityBrand()` now makes the strip follow the board's own population (AHDS only while B2C is off the board), and the brand is part of the cache key. Against the 20/09 preview it should now read **New 3 · INR 450,499.56 / USD 818.55**.

**Worth knowing:** the board's B2C exclusion matches on `agent_name = 'aahaas b2c'`, while the report's `brandOf()` keys off an AHS invoice prefix or `customer_name`. They agree on every ordinary B2C document, but they are not literally the same rule. If a card ever sits one off the mail again, that is the first place to look.

### 2.3 ⓘ explanations on every card

All seven cards (four activity, three agent amount) carry an ⓘ that opens a popup about that card only. Each popup has five parts: *the live figures*, *what it counts*, *how the figure is arrived at*, *worth knowing* (the thing that has caught someone out), and *where the data comes from*. The ⓘ is its own button, so it does not fire the card's filter.

---

## 3. Accounts System — P&L board (`/pnl/db`)

`a118147` `dda4683` `e441c6e` `acd84ef` `6d1f71f` `deaec82` · ~2,000 lines

### 3.1 Period Activity, in P&L money

The page does **not re-implement the mail**. It builds the report through `PnlReportSource` exactly as the scheduler does and reads the same `activity_split`, so any future change to how a day is cut reaches both at once. It has three tiers:

1. **Four movement cards.** These are the same counts as the invoice board, because the day is cut once, on the invoice ledger (the only place that holds every revision).
2. **P&L money**, showing sell / cost / profit / margin **per currency, never added across currencies**. The deck has three parts: *This period's own* (added whole), *Older confirmations* (**their change only**), and *Period total*. The old-as-change rule is the one that matters: adding a back-catalogue booking whole is what once turned a 141.00 profit into 14.62.
3. **As invoiced**, fenced under its own heading, because invoice money and P&L money are never added together.

**Wide windows:** the cap is **400 days, trimmed from the end backwards** rather than refused, and the window read is stated under the cards. Up to 92 days the strip loads with the page. Beyond that it waits for a *Show period activity* click, so the board never sits on a spinner. `/invoice-payments` no longer refuses a wide filter either.

### 3.2 Advanced filters

A **"More options"** panel covers agent, sales person, currency, P&L approval, priced/unpriced, result (profit / loss / break-even) and a sell-value band. Two switches were added:

* **Cancelled bookings' P&Ls** (default off). When on, cancelled bookings are listed and marked but **never added to Sell, Cost or Profit**. It is the same parameter the header's *Cancelled hidden* pill toggles, so the two cannot disagree.
* **This period's own bookings only** (default off). When on, bookings first confirmed before the window come off the board, so the board becomes **New + New updates**, matching the strip above it.

All filters live in `PnlDbReportService`, so **the listing, the KPI tiles, the currency split and the downloaded workbook narrow identically**. The scheduled report is untouched because every filter is opt-in.

### 3.3 KPI tiles: a currency bug fixed

The tiles **added USD and INR into one number and labelled it "(USD)"**. That was true only while the board held one currency, and silently wrong otherwise. Sell / Cost / Profit / Margin are now grouped by each booking's own currency, with margin worked out **within** each currency. The cards are about half the size, and each carries an ⓘ with a full per-currency table and a day-by-day (or month-by-month beyond 62 days) breakdown. That breakdown is fetched once on first open (`/pnl/db/kpi-detail`), not on every load.

### 3.4 Two production problems found and fixed

* **A 500 on `/pnl/db` (`acd84ef`).** `currencyBreakdown()` grouped by a `COALESCE(NULLIF(TRIM(currency)…))` expression. The live server runs `ONLY_FULL_GROUP_BY`, and MySQL rewrites `TRIM()` internally, so the expression stopped matching itself. The query now groups on the bare column and normalises in PHP, so `" usd"`, `"USD"` and NULL fold into one row. The same exposure in the period breakdown was fixed before anyone reached it. **This was a read-only failure; no data was touched.** It happened because no database is reachable from my machine, so the query could not be run before it shipped.
* **Opening a board was triggering a repair sweep (`6d1f71f`).** The strip went through `segment()`, which calls `AppleDayCohort::ensure()`. When a window looked unbalanced, that ran a **Sync Ledger sweep with `repair => true`, meaning upstream Apple System calls and repair writes, from someone opening a page.** That was the cause of the timeout. The fix:
  * The cohort is now **read-only on a screen**. Only the scheduled send may call the API and write repairs.
  * A **lean path** (`activitySplitFor()`) skips the analytics deck, summary tables, parity check and workbook rows that the strip never prints.
  * **Lean mode** in `ActivityTabs` drops the month-to-date census and a full `pnl_records` pass that nothing in the split read.
  * The cache went from **5 min to 30 min**, with `set_time_limit(180)` on the read.

---

## 4. Accounts System — Vietnam payable: 1.0 ↔ 1.1 switch

`91004d5` · 3 files

On Payable 1.0, the Vietnam tab had been **frosted over and did nothing but link across**. It is now an ordinary selectable tab, and a *Payable 1.0 / 1.1* switch appears below the topbar whenever Vietnam is the country being read (hidden on MY / SG / SL, which have one board each).

**No backend change was needed.** `PayableV1Controller` never stopped serving VN; only the view was blocking it. Access is respected both ways: without `payable_v1` or `payable_v11`, that side of the switch is a locked, greyed label.

---

## 5. Online Work — one-tap sign-in and a demo sandbox

`5ab2c75` `97fc269` `9608db6` · ~1,900 lines

### 5.1 One-tap Admin / HR

The first version put credentials in the page. **The second removed them.** Each button now posts only a key (`admin` or `hr`) to `/api/auth/quick`, and the server decides what that key is worth:

| Button | What the tap does |
|---|---|
| Admin | **No password.** A session is minted and you land on `/dashboard`. |
| HR | The configured password runs through the ordinary sign-in on the server, so hash, lockout and audit all still apply. |

`Admin@123` / `Hr@123` no longer appear in the page source (checked: zero matches). The Admin button works on production **even with no matching row in RDS**, because the session is built from config when no user row exists.

> **Flagged plainly:** the Admin button is an **unauthenticated door into the workforce view**. Anyone who can load `/signin` can see every employee's attendance, mail and Teams activity. `QUICK_SIGNIN=off` removes both buttons. This was built as asked and documented in the README.

### 5.2 Demo sandbox

24 `demo.*` accounts (password `Demo@Aahaas2026`, or tap one from the searchable *Demo sandbox* list on the sign-in page). These accounts can **sign up, sign in, reset their password and use the system**. Their passwords, lockouts and sign-ups live in `.data/demo-sandbox/accounts.json`. **The live `ahds_online_work` database is only ever read.**

* **Password reset** has no mail sender behind it, so the six-digit code appears on the page as a mock email with a 10-minute countdown. **Self-service reset is refused for real accounts**, because showing their code on screen would let anyone take them over.
* **Demo team leads can open the admin dashboard but not change anything** (employee codes, devices, monitoring settings, seeding).
* The sandbox is **on in development and off in production** unless `DEMO_SANDBOX=on`.

**Proof it's safe:** I took a fingerprint of `users` (hashes, lockout counters, last-login times, employee codes) and `audit_logs` before and after a full run of sign-in, pages, sign-out and sign-up against the live DB. Both were **identical**.

---

## 6. Task Manager — Leaders can create projects

`812cd9d` `3b2e1d6` · 5 files

The *New Project* button existed all along, but it was gated behind `tm.project.manage`, which is Manager-only. A Leader saw the empty state's invitation with nothing to act on.

* **A new `tm.project.create` permission is granted to Leader.** I deliberately did **not** give Leaders `tm.project.manage`, because that permission also guards editing and deleting every project company-wide.
* **`POST /api/tm/projects` now requires `tm.project.create`**, so the API agrees with the UI.
* **Editing is owner-scoped.** A Leader can edit a project they own or created. **DELETE stays Manager-only.**
* The empty state now has its own button, and it reads honestly for people who cannot create.
* **No schema change.** Permissions are derived from role at request time, so this takes effect on deploy.

---

## 7. Verification

- **Online Work sandbox:** typecheck passes. The whole flow was run against a dev server (wrong reset code rejected, old password stops working after reset, duplicate sign-up refused, lockout after five tries). The live-DB fingerprint was identical before and after. **The new screens were tested with curl and have not been checked in a browser.**
- **Online Work quick sign-in:** both paths verified locally. With the row present the session is *Aahaas Admin / super_admin*. With no matching row it is still super_admin, and `/dashboard` returns 200. An unknown key is rejected.
- **Accounts System:** PHP lints clean, blades compile and routes register. **None of the new boards have been run against data from my machine** (no DB reachable). The `ONLY_FULL_GROUP_BY` 500 is the direct result of that gap.
- **Task Manager:** type-check and production build only. **Not clicked through as a real Leader.**

---

## 8. Follow-Up Items

1. **Deploy `acd84ef` to bring `/pnl/db` back.** Then check the currency table and the *Over the filtered period* block in a KPI ⓘ popup. Those are the two queries still unproven on the live server.
2. **Check both strips against the mail.** Load `/invoice-payments?date_from=2026-09-20&date_to=2026-09-20` and `/pnl/db` on the same single day, and compare the four counts and the Period total with the 20/09 mail. Click *New* and confirm the row count matches the card.
3. **Time the first wide (385-day) load** on `/pnl/db`. If it is too slow, the next step is a queued job with a cached result.
4. **Decide whether the P&L strip should have a "sweep this window" button.** With the repair sweep gone from the board, the strip reports the Sync Ledger as the last scheduled sweep left it.
5. **Online Work production `.env`:** delete the old 4-field `QUICK_SIGNIN_ACCOUNTS` line, then deploy and restart. HR will fail on production until `scripts/create-staff.mjs --apply` is run there (or say the word and HR becomes one-tap too).
6. **Decide whether to keep the passwordless Admin button.** It exposes the whole workforce view to anyone who can reach `/signin`.
7. **One stray audit row:** `audit_logs` id 19 (`portal.signout`, Dinuka Ekanayake) was written by a demo session before sign-out was fixed to skip them. It has not been deleted, because deleting from an audit log should be your call.
8. **Task Manager:** Leaders can currently set any owner and any department when creating a project. Say if a Leader's projects should be confined to their own department. It also needs one click-through as a real Leader after deploy.
9. **The quotation import** is committed but still needs one real (non-dry) run against a booking with a blank `is_number`.
10. **Still open from 19 Sep:** the `admin@aahaas.com` password decision and `AUTH_SECRET` in the deployment environment.
11. **Still open from 15 Sep:** the five live indexes, `DB_READ_HOST` in Amplify, Checklist VN's tables on live, and the Task Manager team backfill.
