# Daily Work Update — 08 September 2026 (Tuesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 08 Sep 2026 (Booking System, Accounts System, AHS & Task Manager)

---

## Executive Summary

Today was about making counts agree and making long sends survive the browser. On the Booking System / OPS, three of the day's four threads were reconciliation: an import ledger that stops the same un-importable quotation re-alerting forever, a Created-by-Day intake view built on Colombo days, and a report-count chip on All Bookings that shows the daily report's own figure beside the list's and prints the arithmetic between them. A cancellation watch was then added to Live Watch — it detects an AppleSystem withdrawal and asks Accounts rather than cancelling anything itself. The afternoon delivered the Sri Lankan Driver Settlement Register, on both systems, off the Drive Log's existing figures with no schema change on the OPS side. On the Accounts System, weekly report sends moved onto the queue after a real timeout was traced, week selection was wired into the per-business B2B/B2C buttons, and the cohort tally block was removed from the daily invoice mail. AHS gained an animated "More" deck on the lifestyle home. The Task Manager carried no work.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Booking System / OPS | 11 commits | `LIVE-1.0.0v` | Clean |
| Accounts System | 10 commits | `REV1` | One untracked file (`DAILY_TASKS.md`) |
| AHS | 1 own commit (+7 by another member) | `SewV3---sasi-update-v2` | Clean |
| Aahaas Task Manager | no commits | `main` | Clean |

---

## 1. Booking System / OPS — Next.js

### 1.1 Import ledger — an announcement per reason, not per sweep

Two quotations (`q492574`, `q492530`) were re-alerting IT on every sweep, and acknowledging made it worse: `raiseAsImportAlert` only deduplicated against an *unacknowledged* alert, so each acknowledgement started a fresh one on the next tick.

- **Root cause:** alert identity was keyed on the *date window*, so a failure that can never succeed was a new failure every sweep.
- **New `as-import-ledger.ts`** keys failures on **quotation number + a stable reason code**. A quotation is announced **once per distinct reason**; later occurrences bump `attempts` and `lastAt` only. Retries are unchanged — only the noise stops.
- Wired into all three sources that were alerting about the same two bookings: `as-watch.ts` (Live watch), `as-reconcile.ts` (still-missing-after-reconciliation) and `as-import.ts` (the daily 06:00 job). A success — or the booking simply being present — clears the entry, so a genuine future failure of the same quotation is still heard.
- **Two new Live Watch panels** in `watch-tab.tsx`: *Bookings created* (ref, guest, arrival, quotation, country, which import path made it, how long ago) and *Could not import* — **one row per quotation, not per retry**, with the reason in plain English, what to do about it, attempt count, first/last seen, whether it was emailed, and a **Dismiss** that stops announcements without stopping retries or deleting history.
- The **Problems** metric read `80` because it summed 2 failures × 40 checks; it now counts distinct stuck bookings, and each check row names what failed (`2 failed (q492574, q492530)`).
- Verified with 17 assertions against the real Prisma/MySQL path: first sighting announces, 40 subsequent sweeps stay silent, a different quotation still gets through, a different reason for the same quotation is announced again, dismiss silences without deleting, a success clears.

*Background from yesterday's investigation:* the underlying `quotation_no` parameter is silently ignored by AppleSystem's `/api/quotation/list` — the fix is to match on `id`, plus a guard so an ignored filter throws instead of full-scanning 8,310 pages. Both quotations remain un-importable for a separate and legitimate reason: **AppleSystem has issued no IS number for either**.

### 1.2 Created by Day — intake, on Colombo days

New tab on `/dashboard/new-as-booking`, plus `api/bookings/created-daily` and shared date-window utilities (`booking-date-window.ts`, also adopted by the bookings list and export routes so all three stop resolving dates their own way).

- **Opens on yesterday** — today is still filling up and its count means nothing yet; yesterday is the finished day the morning report quotes. Auto-set once, then it's yours.
- **Histogram** — one clickable column per day, keyboard-navigable, tooltip with count, pax and how many have since been cancelled. A dashed rule marks the daily average, weekends get a faint band, and values are direct-labelled only where they earn it (selected, hovered, peak).
- **The day opened up** — every booking filed that day as a card with IS number, agent, country, arrival and the time it landed, linking through. Cancelled ones are struck through, not hidden. **Copy N references** puts the IS numbers on the clipboard for pasting against AppleSystem.
- **Presets are resolved on the server.** "Last 7 days" has to mean seven *Colombo* days; a laptop in another timezone would name a different week than the columns are drawn from. The route buckets on `opsDayOf` in JavaScript rather than `DATE(createdAt)` in SQL, because the column holds UTC instants and a SQL `DATE()` would quietly re-introduce the UTC day we just removed.
- **Cancelled bookings are counted** — this is an intake question. A booking filed Monday and cancelled Thursday was still filed Monday; dropping it would put the view out of step with the report it exists to be checked against.
- Also this thread: filtered item counts and Yesterday-created / Yesterday-on-ground / Today-created / Today-on-ground quick filters on the cards.

### 1.3 Report count chip — the two numbers, and the arithmetic between them

The All Bookings list and the Daily OPS Report disagreed. They count different populations on purpose, so the fix was not to force them equal:

```
report = intake − filed against an earlier confirmation + confirmed that day, filed later
```

- **All Bookings** counts *intake* (`createdAt` in the day). **The Daily Ops Report** counts the *cohort* — the confirmations Apple System raised that day, matched to whatever booking here carries that reference, whenever it was filed. That basis was chosen deliberately: three mails once counted the same day three ways and produced 42, 50 and 42 for a day upstream had confirmed 38.
- **New chip on the bookings page** — `Daily report · 72`, green with a tick when it agrees with B2B intake, amber when it doesn't. Click it for the arithmetic, the list's own total, a line saying why it may differ again (the list counts every channel; the report is B2B only), and a red line if a confirmation is on the report with **no booking here at all** — the one row worth chasing, called out so it isn't lost among the benign ones.
- **"View these 71 bookings"** — the set can't be expressed as a `createdAt` range, so the filter resolves upstream: `cohortBookingRefs(from, to)` in `created-reconcile.ts`, `cohortFrom`/`cohortTo` on the bookings route narrowing with `bookingRef in (…)`, matching both spellings (`VN41054` / `VN 41054`). While the cohort is on, date filters are *replaced* rather than intersected (intersecting would drop the +8), the date pills stay visually set with a banner saying they aren't applied, and touching any date control drops the cohort.
- An unreadable ledger returns **503** rather than filtering to zero — "the report's bookings vanished" would be the wrong answer.
- Files: `created-reconcile.ts`, `api/bookings/report-count/route.ts`, `report-count-chip.tsx`, plus the bookings route and page.

### 1.4 Cancellation watch — detect upstream, ask Accounts

Live Watch now asks the mirror question on the same call: one request (`status[]=2&status[]=3`) returns both populations and they are partitioned locally, so if AppleSystem ever ignores the multi-status filter the partition is still correct, just over more rows. New `as-watch-cancel.ts` (~690 lines) plus `watch/cancellations` and `watch/ledger` routes.

**It never cancels a booking.** It moves the file to `PENDING_CANCELLATION` — the existing *Pending Approval — Accounts Team (Cancelling)* state — stamps `cancelledByName = 'AppleSystem'` and emails the accounts desk through the same `sendCancellationApprovalEmail` a human cancellation uses. It therefore appears on All Bookings and in Accounts → Cancellations with no change to either. Money has usually moved by the time upstream changes its mind, so the job is to get Accounts asked within minutes, not to decide.

Three problems it had to solve:

1. **It would have fought the Parity Check.** `as-reconcile.ts` already auto-cancels on drift, but on any status off 2, so it needs two sightings twenty minutes apart. This one acts on the single unambiguous signal — `AS_CANCELLED_STATUSES = ['3']`, a whitelist of one, not "anything that isn't 2", since status 1 is a mid-edit quotation and not a withdrawal — and hands the decision to a person, so it can act on first sight. `PENDING_CANCELLATION` is already in the reconciler's `CLOSED_STATUSES`, so once this fires the reconciler keeps its hands off.
2. **It would have argued with Accounts forever.** Rejecting a cancellation restores the booking *and wipes* `cancelRequestedAt` by design, so a memoryless watcher would re-request every 15 minutes indefinitely. Every detection is now remembered by ref and followed through `awaiting → requested → approved | declined`; a **declined** row is shown as an open disagreement between two systems for a person to settle, and is never re-raised.
3. **Switching it on would have flooded the desk.** Detection always runs and is always listed; only *sending* is gated, on `as_watch_cancel_action_enabled` (ships off) — the same shape as `as_reconcile_autocancel_enabled` — with a per-row **Send for approval** button.

### 1.5 Sri Lankan Driver Settlement Register

The settlement spreadsheet, on screen, at `/dashboard/srilanka/driver-settlements`: Bulk No · Tour · Date · Y/M/D · Chauffeur · A/C Name · Cost type · Total transport cost · Advance paid · Balance payable · Budgeted cost · Excess/(Shortage) · % · Status · Remark, with group subtotals and a grand total.

- **Filtering goes well past the Drive Log's** — date window + presets, free text across tour/guest/chauffeur/agent/bulk/batch-ref, bulk (all / in a bulk / not in a bulk / one specific bulk), cost type, settlement state, **against budget** (under / over / on budget / unbudgeted), payment state (rest due / settled / overpaid), chauffeur, agent, balance min–max, P&L-approved-only, and group-by bulk/chauffeur/agent/month.
- **Multi-select** drives a sticky bar that applies bulk number, cost type, budget and remark across a selection, or submits/withdraws a whole batch — with per-row failure reporting, since twenty tours always contain one already pending.
- **No Prisma schema change.** The register reuses `fetchDriveLogRows` wholesale, so the figures are the same ones the Drive Log shows. New `sl-settlement-register.ts`; cost types and status definitions were then extracted to `sl-settlement-costs.ts` so both systems read one vocabulary.
- Entry point added to the driver-allocation page, shown only to roles holding `pnl:read`. Sidebar navigation gained tooltip logic for the collapsed state in the same pass.

### 1.6 Outstanding

- **The exports don't follow the cohort.** Download PDF / Excel still build from the date filters, so with the cohort on they produce 68 rows against a screen showing 71. `/print/bookings-list` and the Excel route need the same `cohortFrom`/`cohortTo` params.
- **The `+8` label is narrower than the number.** `inWindow` is a two-sided test, so the "entered here later" bucket also collects cohort rows created *before* the window — a booking that sat as a draft for days and only got its confirmation on the 7th counts toward the same +8. The arithmetic is correct; only the wording is.
- Something in the environment **auto-committed and pushed** the settlement work while it was still being written — `5379276` on `LIVE-1.0.0v` and `4b473f5` on `REV1`, both already at origin, with a generic message on the accounts side. No git command was run by hand. Worth checking whether that is a hook you want running on live branches.

---

## 2. Accounts System — Laravel

### 2.1 Weekly sends moved off the web request

**Cause:** `runNow` called `AutoReportService::dispatch()` inline — building the report *and* emailing it before responding. A weekly schedule is a 133–373 second build, so the browser timed out; worse, the send often kept running afterwards, so a "failed" page could sit on top of a real delivery.

- **New `SendReportScheduleJob`**, queued from both `runNow` controllers, following the existing `RunAsPnlSyncJob` pattern on the database queue the pm2 `invoice-queue-worker` already consumes. Results land in the history table as before.
- Verified with a faked queue (nothing could send): weekly Invoice AHDS-only dry run went from 133–373s → **0.061s**; weekly P&L B2C-only from ~360s → **0.003s**. The chosen week, business, recipient override and dry-run flag all travel to the worker intact.
- `timeout = 3600` (the pm2 worker starts with no `--timeout`, so without it the send would be killed at 60s) and `tries = 1`, because retrying a send that already reached the mail server means the same report delivered twice.
- **Config risk closed:** `DB_QUEUE_RETRY_AFTER=3900` added to `.env.example` with the reason written beside it — Laravel releases a job reserved longer than `retry_after` (default 90s), so a still-building weekly report could be picked up twice. `max_memory_restart` raised `1G → 2G` in `ecosystem.config.js` for the same reason: a whole-week build can hold the worker for ten minutes.
- **Previews still build inline** — `@set_time_limit(900)` added to `preview()` and `brandPreview()` in both controllers, which was a real gap (Excel already had the headroom). The proper fix there is the underlying report speed — the N+1 in the report builders.

### 2.2 Week selection on the per-business B2B/B2C buttons

- A **"Week these buttons send"** dropdown in the split card, listing finished weeks (`Sun 30/08/2026 – Sat 05/09/2026 · last week`) and defaulting to *Latest — what the schedule would send right now*. **View**, **Dry run**, **Run now** and **Excel** all honour it. No backend work was needed: `run`, `brand-preview`, `workbook` and `workbook-download` already accepted `as_of`.
- The separate "Send a particular week" card built earlier in the day (`b30bdcf` / `556ab5a`) was **removed** — it was a second, independent week selector on the same page showing a different week. Its two useful parts moved to `weekOptions()` and `sendsAWeek()` on `ReportSchedule`, so the split card and the Send-now modal share one source of truth. The modal's raw "run as if today were" date box becomes the same week dropdown on a weekly schedule.
- Week options later extended to **26 weeks, grouped by month**, so a back-week from earlier in the quarter can be picked without counting Sundays.
- `setDaysOfWeekAttribute()` added to `ReportSchedule` to normalise day-of-week values to integers.
- Verified across all four schedules: weekly ones get the dropdown in both places and no date box; the daily Invoice and P&L schedules are untouched.

### 2.3 B2B / B2C really do send as separate mails — verified against the run history

The scheduled side was already correct. Schedule #8 (Weekly Invoice) splits `apple` → AHDS (B2B) and `aahaas` → Aahaas (B2C); #10 (Weekly P&L) splits `as` → AHDS and `b2c` → Aahaas; each with its own 11-address list. Brand keys match their sources (`apple`/`aahaas` in `InvoiceReportSource`, `as`/`b2c` in `PnlReportSource`), so a one-brand run isn't silently filtered to nothing, and `dispatchSegments()` still builds both slices so the counterpart strip in the email tells the truth.

Evidence in today's own run history: runs 196, 198–201 (Weekly Invoice, `apple`, 01/09–07/09), 197 / 203 / 204 / 206 / 208 (Weekly P&L, `as`, same week) and 202 / 205 / 207 (Weekly P&L, `as`, **back-week** 30/08–05/09) — the back-week runs are what prove the `as_of` override lands rather than falling back to "latest".

**A correction worth recording:** mid-investigation I reported the queue as stalled with seven jobs stuck since 10:24 and a worker dead since 10:29. That was wrong. The database stores timestamps in UTC while the shell is Asia/Colombo — a nine-minute-old job was read as five hours old, and `ps aux` found no worker because the worker runs on the production box, not this Mac. All seven completed successfully while the investigation ran: runs 202–208, all `emailed=1`, no duplicates, `failed_jobs` empty. No evidence yet for `b2c` (Aahaas P&L) or `aahaas` (Aahaas invoices) — identical code path, not exercised today.

### 2.4 Cohort tally removed from the daily invoice mail

Dropped the `@include('emails.partials.cohort-check', …)` from `auto-report.blade.php`, leaving a comment where it stood saying what it was and where it went. Two things deliberately left alone:

- **The P&L mail keeps its copy** (`pnl-auto-report.blade.php`). The partial is shared, so removing the partial itself would have silently stripped the P&L mail too.
- **The cohort itself still runs.** It still cuts which bookings the report contains and still stops a day that doesn't tally from being sent quietly. Only the display block is gone from this one mail — which does mean the invoice mail no longer carries its own proof of completeness; the legs stay readable on `/sync-ledger`, and the P&L mail still prints them.

### 2.5 Driver Settlements page — the accounts half of the register

New page at `/driver-settlements`: the same register as OPS, plus the **Pay rest payment for drivers** flow — a per-row settlement window and a search box for tours that have fallen off every date window.

- It posts to `slTransportPay`, **the identical controller method Payable 1.0 pays through**, so the obligation is still re-derived server-side, an unapproved P&L is still refused, and the amount is still spread pro rata across the supplier lines. An OPS submission can also be sent back with a reason.
- **Additive migration only** — four nullable columns on `sl_transport_settlement_requests` (`bulk_no`, `cost_type`, `budgeted_cost_lkr`, `settlement_remark`). No existing column or row touched. **Not run** — it needs `--pretend` first and it is a production schema change.
- Budget and variance are **stored, not derived** — a variance measured against a re-costed P&L isn't a variance.
- Files: `driver-settlements/index.blade.php`, register methods on `PayableV1Controller`, `SlTransportSettlementRequest` model, routes, `config/access.php`, sidebar. The new `driver_settlements` grant sits deliberately **outside** `payables.`, so settlement staff don't need the whole board.

### 2.6 Housekeeping

`DAILY_TASKS.md` was drafted at the Accounts repo root — a daily operator's checklist built from the real schedule in `routes/console.php` and the routes that exist, framed as *confirm it ran* rather than *run it*. Untracked and uncommitted.

---

## 3. AHS — Customer-Facing React Front End

The orange **More** tile on the lifestyle home is now an in-place toggle — no popup, no navigation.

- **Iterated three times to get it right.** The first pass added six categories with their own colour tones and emoji; the second matched the four tiles above; the final one dropped the three that were already on the top row (Lifestyles, Hotels, Flights), leaving **Education, Essentials, Non Essentials** with `MdSchool` / `MdLocalMall` / `MdRedeem`, carrying `lh-tile lh-more-tile` so they inherit the existing ink surface, dotted wash, translucent icon puck, hover lift and icon tilt. No colour tones, no emoji, no gradient wash — the only additions are the entrance animation and a faint ↗ on hover.
- **The animation:** the card widens `1180px → 1320px`, the height unfolds via `grid-template-rows: 0fr → 1fr` (nothing hard-coded), the More tile's icon rotates `-90°` and its caret flips, and the tiles pop in 60ms apart on a springy curve. Reduced-motion fallback included.
- The deck sits exactly one card-gap below the first row — the collapsed `-14px` margin resolves to `0` when open — so it reads as a second row of the same set. Routes verified against `App.jsx`. Build passes.
- Branch is now `SewV3---sasi-update-v2`. Seven commits by another team member landed the same day: `CategoryCatalogueHero` replacing `HeroSearchBar` on the Education / Essential / Non-Essential pages, a `dissolveHeader` option on `useHeroHeaderMerge` so dark heroes don't dissolve the header, a `primaryAction` prop, and the removal of `CategoryTiles` from `HotelMainPage`.

---

## 4. Aahaas Task Manager — Next.js

No commits and no working-tree changes today; `main` is clean. Yesterday's IT-department lock on signup and team creation stands as delivered.

---

## 5. Main Outcomes

1. An un-importable quotation is now announced **once per reason** instead of once per sweep — and the Live Watch page shows what was created, what could not be, and why, one row per booking rather than one per retry.
2. Intake has its own view, bucketed on Colombo days in application code rather than `DATE()` in SQL, so clicking yesterday gives the same number the morning report quotes — by construction.
3. The All Bookings list and the daily report no longer look like they disagree: the chip prints both figures and the three-line identity between them, and can open the report's exact 71 bookings.
4. An AppleSystem cancellation now reaches the accounts desk within minutes, as a request a person approves — first sight, remembered by ref, and shipped with sending switched off.
5. The Sri Lankan driver settlement spreadsheet exists on both systems, off the Drive Log's own figures, with no OPS schema change and payment still going through Payable 1.0's server-side derivation.
6. Weekly report sends can no longer time out the browser, can no longer be delivered twice by a reclaimed job, and a chosen week now travels correctly through every per-business button — proven by back-week runs in today's history.
7. A wrong diagnosis was caught and corrected the same session: the queue was never stalled; a UTC column had been compared against Colombo local time.

## 6. Follow-Up Items

- **Run the accounts migration before deploying OPS** — `php artisan migrate --pretend`, then without it. Until then OPS's actuals *reads* degrade gracefully but *saves* will error.
- Grant the new `driver_settlements` page to the relevant roles in the permission picker.
- Extend `cohortFrom`/`cohortTo` to `/print/bookings-list` and the bookings Excel route, so exports follow the cohort filter.
- Put `DB_QUEUE_RETRY_AFTER=3900` into the live `.env` and pick up the `2G` pm2 change — the `.env.example` entry doesn't reach the server.
- Decide whether the invoice mail should get its completeness proof back in some other form, now that the cohort block is gone from it.
- Confirm `b2c` (Aahaas P&L) and `aahaas` (Aahaas invoices) manual sends by pressing Run now on the Aahaas card of each page.
- Investigate the N+1 in the report builders — it is now behind three separate symptoms (preview timeouts, View, Excel).
- Check whether a hook is auto-committing and pushing to `LIVE-1.0.0v` and `REV1`.
- Re-word the "entered here later" label, or split it, so it doesn't claim a direction the two-sided test doesn't measure.

---

**Prepared:** 08 September 2026  
**Projects reviewed:** Booking System / OPS, Accounts System, AHS, Aahaas Task Manager
