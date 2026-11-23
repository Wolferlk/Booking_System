# Daily Task List — 19 November 2026 (Thursday)

**Owner:** Sasindu Diluranga
**Date:** 19 November 2026
**Written:** 21 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 19 Nov |
|---|---|---|
| Booking System / OPS | `fix/excel-mc-skip-meeting-time`, `Live-Pari` → `LIVE-1.0.0v` | 2 commits · **PR #327 merged** into `LIVE-1.0.0v` (`f0fd1080`) · `Live-Pari` (meeting doc) also in `LIVE-1.0.0v` · pushed |
| Accounts System | `Master-Live`, `ParindaFixes-MasterLive`, `feat/b2c-booking-type-columns` | 5 commits · **PR #71 merged** into `Master-Live` (`ca8d38d`) · pushed |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No commits found · repo not checked from this laptop |

> All commits are pushed. **Nothing is confirmed as deployed.** OPS passed a type check only. On the Accounts side PHP wasn't on the PATH for the first fix (not even linted), and the ERP has no `vendor/` folder on this laptop, so **no email template was rendered**. Nothing was written to a live database and no email was sent.
>
> ⚠️ One **schema change** (new index on `pnl_price_adjustments`) is written but **not run** — needs approval.

## What was done

1. **Accounts:** **500 error on `/settings/excel-prices`** fixed (badge counts timed out on a huge table).
2. **Accounts:** **cancellation cards** (File Handler / Accounts) on the AHDS and Aahaas daily invoice mails.
3. **Accounts:** **"Top performers — last 7 days"** section on both daily invoice mails.
4. **Accounts:** **B2C order origin** breakdown ("how they were booked") + **B2C amendments now counted** (AHS…R2 numbering).
5. **OPS:** **Remove driver** (×) on the agenda chart; Excel MC / Driver Sync **never copy meeting times** from the sheet.

---

## 1. Accounts — `/settings/excel-prices` 500 (`d03e6f7`)

2 files · +93 / −42 · **migration written, not run**

- [x] **Cause:** the "worth re-checking" badge ran 5 separate counts over `pnl_price_adjustments` (no index on `status` / `upload_id`, ~47 KB payload per row). Each count read the whole table and hit `max_statement_time`.
- [x] `ExcelRecheckService.php`: one query instead of five (`staleSignals()`), cached 5 min (resets when the workbook, last hand edit or margin handling changes), and a failed count logs a warning and shows 0 instead of crashing.
- [x] Migration `2026_11_19_120000_add_status_index_to_pnl_price_adjustments.php` adds an index on `(status, upload_id, margin_mode, applied_at)`.
- [ ] Deploy the service file (stops the 500 on its own).
- [ ] **Decide (schema change on live `invoice_processor`, needs approval):** run the index migration — `php artisan migrate --pretend` first. May briefly slow writes to that table.

## 2. Accounts — cancellation cards on invoice mails (`8b02c66`)

3 files · +143 / −5

- [x] New row of two cards under the invoice cards on the AHDS and Aahaas mails:
  - **Cancellation by File Handler** — bookings a file handler asked to cancel in OPS that accounts hasn't approved/rejected yet; small text = how many were requested in the report period.
  - **Cancellation by Accounts** — the old "Invoices Cancelled Today" card, renamed.
- [x] `CancelledBookingService::pending()` reads OPS (read-only); shows "—" if OPS can't be reached. Combined report unchanged.
- [ ] **Decide:** big number = all pending (any age) or only that day's requests? One-line swap.
- [ ] Render one AHDS and one Aahaas mail on a machine with `vendor/` installed.

## 3. Accounts — "Top performers — last 7 days" (`4e56f60`)

2 files · +85

- [x] Same agents / file handlers panels as the daily one, ranked over the 7 days ending on the report day (top 10 by invoices created; billed amount per currency). Header shows the dates ("12/11 – 18/11/2026").
- [x] Uses the light read-only mode of `/pnl/db`; if the read fails the section is left off and the mail still sends.
- [x] Aahaas file-handler panel was expected to be mostly "Unassigned" — **fixed on 20 Nov** (`6a145bc`).

## 4. Accounts — B2C order origin + amendments (`8236b97`, `9de878a`, PR #71 `ca8d38d`)

`8236b97`: 5 files · +438 · `9de878a`: 6 files · +590 / −147

- [x] New `B2cOrderOriginService`: how each Aahaas order was booked (who placed it, method, payment status); new `b2c-origin` partial on the invoice mail.
- [x] **Amendments bug:** the report expected `_R2` revisions, but B2C revisions are `AHS-16220R2` (no underscore). All 34 B2C revisions since October were counted as new, so the B2C "Amended" card always showed 0. Fixed for AHS…R2-style numbers only; AHDS unaffected; weekly/monthly B2C reports now show amendments too.
- [x] 18 Nov report now: 5 invoices = 4 New + 1 Amended (AHS-16220R3, amended amount USD ▼ −7.38). Preview PDF: "Aahaas B2C Invoice Report - 18 Nov 2026 (preview).pdf".
- [ ] Rev column shows AHS-16220R3 as "R1" (existing config offset) — **fixed on 20 Nov** (`5a32184`).
- [ ] Excel attachment still has Agent / Guest tabs; "Old amendments" tab doesn't include B2C yet.

## 5. OPS — remove driver + meeting time rule (`36a15c53`, PR #327 `f0fd1080`)

5 files · +131 / −9

- [x] Small **×** next to the driver chip on the agenda chart (edit and normal view) → "Remove driver? [Remove] [Keep]" (auto-cancels after 4 s).
- [x] Saves that one movement only (other unsaved edits kept); toast "Saved — PDF, Word and Excel MC already show it unassigned" with **Re-assign**. Clears driver / transport vendor, phone, vehicle, rate; guide and tour vendor stay.
- [x] No Excel resync needed — PDF / Word / Excel MC read the driver from the database. (VN Driver Sync can put a driver back if run.)
- [x] WhatsApp: same save as "Remove Assignment", so a driver with no other movement on the booking gets the cancellation WhatsApp.
- [x] **Meeting times belong to OPS:** Excel MC Generate, the 15-min auto-update and VN Driver Sync (`fillTime` forced off) no longer copy the sheet's meeting time. The sheet time is still used to pair rows.
- [ ] Try remove + re-assign on one booking after deploy.

Also: `8467bd47` "Meeting scheduled with the team.docx" added to the repo root on `Live-Pari` (now in `LIVE-1.0.0v`).

---

## Still to do today

- [ ] **Accounts:** deploy `Master-Live` (excel-prices fix, cancellation cards, 7-day leaderboard, B2C origin + amendments, plus 17–18 Nov work).
- [ ] **Accounts:** approve or skip the `pnl_price_adjustments` index migration.
- [ ] **OPS:** build `LIVE-1.0.0v` and redeploy.
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 18 Nov:** confirm Fetching tasks run again after deploy (VN43307_R2); click Sync now on Payable 2.2VN; Online Work type-check + deploy, `PORTAL_URL`, email-reply mode decision.
2. **From 17 Nov:** decide on correcting stored B2C invoices / P&L rows (approval + backup); order-date rate decision; Excel MC Generate trial on one VN booking; check VN40172 and VN43304_R2.
3. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; merge `61f2ac06`; invoice PDF/logo check; Reconciliation download check; Agent Management short-name keywords; "Sri Lanka" in address decision.
4. **From 14 Nov:** type-check Bulk Issue desk / Ticket Issue workspace; Vendor Payable migration.
5. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default; AI-call re-point decision.
6. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; 2 old `AutoReportMailTest` failures.
7. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Meta template submissions; driver app build.
8. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
