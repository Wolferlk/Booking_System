# Daily Task List — 20 November 2026 (Friday)

**Owner:** Sasindu Diluranga
**Date:** 20 November 2026
**Written:** 21 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 20 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 9 commits straight on `LIVE-1.0.0v` (no PR) · pushed · in sync with `origin` |
| Accounts System | `Master-Live` | 8 commits straight on `Master-Live` (no PR) · pushed · in sync with `origin` |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No commits found · repo not checked from this laptop |

> All commits are pushed. **Nothing is confirmed as deployed.** The whole day was the **daily report emails** (OPS daily report + Accounts B2C invoice / P&L mails). OPS changes type-check (the same 15 old errors in 4 untouched files remain); Accounts changes pass PHP lint including compiled Blade. **No mail was rendered against real data** — the storefront database timed out from this laptop — so all 19/11 figures below are **expected, not observed**. Nothing was written to any database and no email was sent.
>
> ⚠️ Several commit messages say "nothing is committed". That was true when written; the work is now committed and pushed.

## What was done

1. **OPS daily report:** D-3 driver rule relaxed, new **D-10 Driver Allocation**, new header + tiles (Outlook-safe colours), **Look-ahead** row (D-10 arrivals, D-6 reconfirmation).
2. **OPS daily report:** **"Arriving next 3 days — readiness"** rebuilt on the Ops Board's checks (QC1 / QC2, guest contact, tour-by-tour grid).
3. **OPS daily report:** B2C counts **only invoiced bookings** (19/11: 8 instead of 20); four separate **intake cards**; two **cancellation cards**.
4. **OPS:** Agent digest preset no longer includes "Arriving tomorrow" (30 Sundays email).
5. **Accounts:** B2C mails — **"How these orders were booked"**, real file handlers on the 7-day leaderboard, **Customer + Traveller** columns, **New vs Amended** agree everywhere, P&L includes amended bookings.

---

## 1. OPS — driver allocation, header, look-ahead (`f1bed59a`, `f3fe828e`)

`f1bed59a`: 7 files · +583 / −172 · `f3fe828e`: 6 files · +84 / −77

- [x] **D-3 rule** (`booking-readiness.ts`): a tour counts as allocated once **at least one** movement has a driver/vendor (registered or typed). Rows still show "3 of 5 movements named". Also changes the driver count in `ops-day-data.ts`; the booking page QC panel is unchanged.
- [x] **New D-10 Driver Allocation** section (D-1 to D-10 as a table with progress bars; "needs a driver" list starts at D-4). Both D-3 and D-10 in the Excel attachment, CSV and dashboard preview.
- [x] **Header redesign** (`report-html.ts`): Outlook drops semi-transparent colours (unreadable dark-on-teal text) → solid colours only. Calendar-style date block, **"Today's focus"** chips, figures as labelled tiles with coloured top edge and progress bars.
- [x] **Look-ahead row:** D-10 arrivals (files, pax, B2B/B2C, hotel-only, mini bar chart, busiest day) and D-6 reconfirmation (completed / total, %). Also on the Excel Overview.
- [ ] **Decide:** D-6 starts tomorrow (today's arrivals excluded); D-10 arrivals include hotel-only files.
- [ ] `Call with Safraz and Sassindu .docx` was committed to the repo root with `f1bed59a` — move or remove if it shouldn't be in git.

## 2. OPS — 3-day readiness from the Ops Board (`4209e30f`)

5 files · +321 / −6 · checked with a rendered preview on sample data

- [x] "Ready" now follows the board's rule: reconfirmation, driver/vendor, tickets **and QC2** must be clear. Tiles: Arriving in 3 days, Tomorrow, Fully ready, Needs action.
- [x] **Guest contact strip:** WhatsApp on file ("18 / 24 · 6 missing"), email on file, call permission.
- [x] **Board checks scorecard** (WhatsApp, Email, Reconfirm, Call request, Driver/Vendor, Tickets, Tickets sent, Driver details, CS calls D1·D2·D3, QC1, QC2) with Done / Part / Open / N/A.
- [x] **Tour-by-tour grid** of not-ready tours grouped by day ("D-1 Fri 20 Nov · 8 tours · 6 not ready"), worst first, first 30, with legend.
- [x] Subject line ("N not ready in 3d") and "Today's focus" chip use the same rule — numbers will be **higher** (preview 5 → 19). Excel board tabs gained the new columns. Falls back to the old section if board data fails.

## 3. OPS — B2C invoiced-only, intake cards, cancellations (`7a640c8a`, `51ce4a48`, `cc69b0db`, `5dfdbefa`, `762e9091`)

~ 12 file changes · +456 / −79

- [x] **B2C = invoiced bookings only** (`b2c-day.ts`), same rule as the Aahaas invoice mail. 19/11 expected **B2C 8 (6 new + 2 amended)** instead of 20 — the other 12 were checkout attempts / unpaid payment links with no invoice.
- [x] Same filter on the Ops Board digest (`ops-board-digest.ts`): B2C files without a B2C invoice and agent-portal orders are left off; orders before **28 Oct 2026** (start of auto B2C invoicing) still count. Read-only lookups; lead passenger name resolved for B2C guests.
- [x] **Four intake cards**, no combined total: B2B new & same-day amended (42) · B2B old amendments (18, "oldest 148d back") · B2C new & same-day amended (6) · B2C old amendments (2). "On ground" / "Upcoming" moved to their own row.
- [x] **Cancellation cards** (`collectCancellationFlow` in `report-data.ts`): **Moved to cancel pending** (that day; "n still need accounts approval") and **Accounts approved cancels** ("n same-day · N awaiting approval in all"). Rejected requests not counted; follows the country filter; shows "—" if the read fails.
- [x] Excel layout tweaks (`5dfdbefa`).
- [ ] Check the 21/11 morning mail: B2C 8, intake 42 / 18 / 6 / 2 for 19/11.

## 4. OPS — Agent digest "Arriving tomorrow" (`35c06cab`)

6 files · +395 / −38

- [x] **Cause:** the "30 Sundays — daily ops" preset had two blocks — "On ground today" and **"Arriving tomorrow"** — which produced "ARRIVING TOMORROW · 21 NOV (16)" and inflated the subject count (80 bookings).
- [x] `agent-digest/shared.ts`: default preset now has only "On ground today"; description updated. Applies to new digests only.
- [ ] **Your step:** Dashboard → Agent digest → "30 Sundays — daily ops" → turn off / delete "Arriving tomorrow" → Save. (Done in the app, not by a DB write.)

## 5. Accounts — B2C invoice + P&L mails (`1483cf0`, `6a145bc`, `bc9326a`, `56c8594`, `09d9b9f`, `6a4c0e3`, `5a32184`, `6dcd2a4`)

~ 25 file changes · +1,195 / −182

- [x] **"How these orders were booked"** on the B2C P&L mail (`b2c-order-origin-pnl` partial): Booking ID + New/Amended badge, booking type, file handler / agent, channel ("Travel Quote GPT", "WhatsApp"), method, payment badge (% for part payments); type-mix and payment-state bars; totals footer.
- [x] **7-day leaderboard on the Aahaas mail** now uses the storefront lookup: real handlers (Abdul Hameed, Siddiq KR, Parinda, Vigneswaran Vinith…) or "Customer (self-booked)"; agent = B2B agency or booking type. Was 100 % "Unassigned" / "Aahaas B2C". AHDS unchanged.
- [x] **Customer + Traveller columns** on both B2C reports and the AAHAAS workbook sheet, from one read-only `B2cOrderPeopleService`:
  - Account-holder lookup fixed (it asked for a non-existent `customer_lname`, failed silently → every cell "—").
  - Customer = **lead passenger email name** (AHS-16296 → `amitha.flyzentours`), since `admin6611` is the shared desk login; `@aahaas.com` addresses ignored; falls back to account holder.
  - Traveller matches AahaasFlow (AHS-16285 → "Samitha Gamage"); values with no letters (AHS-16277 "??") skipped.
- [x] **New vs Amended agree:** Aahaas invoices no longer use the Apple System "−2" revision rule — REV shows New / Amended / Cancelled (AHS-15026R2, AHS-15025R2 → Amended). Same label in the workbook Rev column and Accounts daily summary.
- [x] **P&L includes amended bookings:** top row "Total bookings 8 · New 6 · Amended 2"; ORDERS (8) lists amended ones on amber with "↳ order #16294"; new Rev column.
- [x] P&L report can group by **lead passenger** (`6dcd2a4`).
- [ ] Render the Aahaas invoice mail and P&L mail on the server and check 19/11 names and counts against AahaasFlow.

---

## Still to do today

- [ ] **Deploy both:** `LIVE-1.0.0v` (OPS daily report) and `Master-Live` (B2C mails + 17–19 Nov work).
- [ ] Turn off "Arriving tomorrow" on the 30 Sundays digest.
- [ ] Check the next morning's OPS report and Aahaas mails with real data.
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 19 Nov:** approve or skip the `pnl_price_adjustments` index migration; cancellation-card number decision; render AHDS / Aahaas mails; try remove driver on one booking.
2. **From 18 Nov:** confirm Fetching tasks run again (VN43307_R2); Sync now on Payable 2.2VN; Online Work type-check + deploy, `PORTAL_URL`, email-reply mode decision.
3. **From 17 Nov:** decide on correcting stored B2C invoices / P&L rows (approval + backup); order-date rate decision; Excel MC Generate trial; check VN40172 and VN43304_R2.
4. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; merge `61f2ac06`; invoice PDF/logo check; Reconciliation download check; Agent Management short-name keywords; "Sri Lanka" in address decision.
5. **From 14 Nov:** type-check Bulk Issue desk / Ticket Issue workspace; Vendor Payable migration.
6. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default; AI-call re-point decision.
7. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; 2 old `AutoReportMailTest` failures.
8. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Meta template submissions; driver app build.
9. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
