# Daily Task List — 5 October 2026 (Monday)

**Owner:** Sasindu Diluranga
**Date:** 5 October 2026
**Written:** 5 October 2026, from git history and working-tree status

| Project | Branch | Work on 5 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits (`8714825`, `58ea3b5`) pushed · `a0bdf55` (18:35) · WhatsApp mini chat rework uncommitted |
| Accounts System | `REV1` | 2 commits (`7229dc6`, `87be367`) pushed · **Test Bookings work uncommitted** (13 files + 3 new) |
| Aahaas Online Work | `main` | 4 commits (`4c73980`, `9178805`, `d077aea`, `b30f8eb`) · clean · up to date with origin |
| Aahaas Task Manager | `main` | 4 commits (`76191e4`, `456c026`, `2893033`, `da53d8f`) · clean · **ahead of origin by 1 (not pushed)** |
| Aahaas mobile app (`Desktop/Aahaas_f/Aahaas_Final`) | `upgrade/rn-0.77-16kb` | 1 merge with origin (`b9169e7a`) · `android/app/build.gradle` modified |
| AHS | `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several messages say *"nothing is committed"* or *"haven't opened it in a browser"*. The first was true when written; every commit listed is now committed. The second is still true — nothing below has been checked in a browser or confirmed as deployed.

## What was done

1. **OPS:** the Drivers list now shows a **performance card** (score, grade, tours, movements, files, rating, last / next trip) in place of the advance balance and bank line. Credentials removed from `.env.example`.
2. **OPS (in progress):** large rework of the **WhatsApp mini chat** on bookings (status ticks, queued sends, search, quick emoji, day separators, no scroll-jumping on poll).
3. **Accounts:** Flight Tickets email and `/b2b/tickets` now show **real routes** from `b2b_ticket_coupons` (e.g. *CMB ⇄ MAA* instead of *CMB → CMB*).
4. **Accounts:** **Cxl Requested** column added to the cancellations table.
5. **Accounts (in progress):** **Test Bookings** — mark a booking as a test so it is hidden from reports, without changing its records.
6. **Online Work:** roster **shift templates**, half days with exact times and **named holidays**.
7. **Online Work:** new **Workplace hub** (`/workplace`, `/settings/workplaces`) with AI-generated banners.
8. **Task Manager:** dev-admin login, dates on "Needs attention", **auto-saving edit dialog**, and dev admin hidden from people lists. **Security concern raised — see §8.**

---

## 1. OPS — Drivers list performance card (`8714825`, `58ea3b5`)

9 files · +329 / −287 · **no database change** · `drivers/page.tsx`, `partner-analytics.ts`, `analytics/leaderboard/route.ts`

- [x] **Removed** Advance Balance and the bank line (e.g. *"Seylan Bank · ****9001"*) from each driver row.
- [x] **Added** a clickable performance card that opens the driver's Performance tab:
  - Score ring 0–100, coloured by grade (A+/A/B/C/D, or *New*)
  - Tours, Movements, Files, guest Rating (or *Unrated*)
  - Last trip (turns **red** after 60 days) and Next trip (**green** within 2 days)
- [x] Partner analytics summary gains `toursDone`, `lastCompletedTrip`, `nextTrip` (read-only, from the existing leaderboard).
- [x] `apple-holidays/.env.example` stripped of credentials; `.gitignore` updated.
- [x] 3 Oct daily task list committed.
- [x] Type-check passes; lint has no errors (8 warnings on images that were already there).
- [ ] **Not opened in a browser** (local `.env` points at live).
- [ ] The credentials removed from `.env.example` are still in git history — **rotate them**.

## 2. OPS — WhatsApp mini chat rework (uncommitted / `a0bdf55`)

`whatsapp-mini-chat.tsx` · +743 / −228

- [x] Message status ticks: sending → sent → delivered → read, failed, plus **queued** (`pending`) sends that go out when the client replies, and cancelled sends.
- [x] Poll results are fingerprinted, so a poll with no changes no longer re-renders and **no longer yanks the chat to the bottom** while someone is reading.
- [x] Day separators (Today / Yesterday / weekday / date), relative times, 24-hour window tracking.
- [x] New tools: search, maximise, quick emoji, copy, retry, cancel queued send, jump-to-bottom.
- [ ] Confirm whether `a0bdf55` (18:35) contains this work; if not, commit it.
- [ ] Browser check on a booking with a real WhatsApp thread, including a queued send.

---

## 3. Accounts — Real flight routes (`7229dc6`)

6 files · +341 / −26 · **no database change** · `B2bTicketService.php`, `B2bTicketPnlService.php`, `B2bTicketsReportSource.php`, `tickets.blade.php`

| Ticket flies | Route shown |
|---|---|
| CMB – MAA – CMB | CMB ⇄ MAA |
| CMB – DOH – LHR – DOH – CMB | CMB ⇄ LHR |
| CMB – DOH – LHR | CMB → LHR |
| CMB – DXB (4 days) – LHR | CMB → DXB → LHR |

- [x] Stops of **24 h or more** count as a visited place; shorter stops are hidden connections.
- [x] Tickets with no coupons fall back to their own origin / destination.
- [x] Email Busiest Routes, ticket rows, Excel **"Full journey"** column, ticket board cards and drawer (**Flights** section), search / IATA filter, P&L Route breakdown and payment popup all use the new rule.
- [x] Tested on `production_test11` (read-only session, SELECT only): old *CMB → CMB* split into CMB ⇄ DXB (8), CMB ⇄ MAA (3), CMB ⇄ MLE (2); search "MAA" returns 19 tickets.
- [ ] Multi-stop cases checked only with made-up sample flights.
- [ ] Preview / send one real Flight Tickets email.
- [ ] Decide: keep **⇄** for returns or use the *"CMB - MAAx"* style (one-line change).

## 4. Accounts — Cxl Requested column (`87be367`)

1 file · +12 / −1 · `bookings/cancellations.blade.php`

- [x] New **Cxl Requested** column after Arrival Date, e.g. *05 Oct 2026 · 14:32 · 3 hours ago*, in Sri Lanka time.
- [x] Reads `cancelRequestedAt` (same as *Requested At* in the booking popup). Shows "—" when empty, including rejected requests.
- [x] Pending tab still sorted by arrival date.
- [ ] Check in a browser.

## 5. Accounts — Test Bookings (uncommitted)

New: `Models/TestBooking.php`, `Services/TestBookingRegistry.php`, `Services/TestBookingService.php` · changed: Dashboard, DbPnl, Invoice, InvoicePayment, PayableV1 / V11 controllers, `InvoiceReportService`, `PnlDbReportService`, `SyncLedgerRepairService`, `SyncParityService`, Apple / B2C day cohorts, `db-pnls.blade.php` (+170 / −16)

- [x] Only writes the new `test_bookings` table; invoices, P&Ls, payments and OPS bookings are read, never modified. Screens hide a booking by asking `TestBookingService`.
- [x] Guards: reference must look like a booking ref (not a bare number); bookings with money recorded need explicit confirmation; unknown refs need explicit "register before created"; a reason is required and every mark / release is kept as history.
- [ ] Finish, then add the **migration for `test_bookings`** and run it with approval.
- [ ] Test marking and releasing one booking, and check it disappears from / returns to every report.
- [ ] Commit.

---

## 6. Online Work — Roster shift templates & holidays (`4c73980`)

7 files · +641 / −73 · `roster-palette.tsx` (new), `roster-board.tsx`, `roster-types.ts`, `roster-store.ts`, `roster-view.ts`, `roster-strip.tsx`, `api/roster/[id]/route.ts`

- [x] **Shift templates** per team: name, 3-letter tag, Shift / Half day, start–end (shows overnight), WFH, colour (12 presets or custom). Number keys 1–9 stamp them; *Save & stamp selection*.
- [x] Cells matching a template's hours are painted in its colour (existing cells too), also on profile strips and the legend. Frequently used unsaved hours show as dashed chips with ☆ to save.
- [x] Department heads can manage templates (no admin needed).
- [x] **Half day with times** (e.g. 08:00–12:30), written to Excel so it survives a sync.
- [x] **Holidays:** select a day (shift-click for a range), name it or pick *Poya day*; optional "mark everyone as Poya / holiday" (waits for Save).
- [ ] Colours are portal-only; Excel keeps its own legend. Short leave can't be a template.
- [ ] Not opened in a browser (sign-in needs live DB).

## 7. Online Work — Workplace hub (`9178805`, `d077aea`, `b30f8eb`)

36 files · ~+2,700 · new `workplace-store.ts`, `workplace-types.ts`, `workplace-banner-ai.ts`, `workplace-hub.tsx`, `workplace-admin.tsx`, `workplace-card.tsx`, 8 hub images

- [x] API: create / update / delete / list workplaces, `/api/me/workplaces`, banner upload and **AI banner generation (OpenAI image API)**, rate limiting, audience rules by role.
- [x] Pages: `/workplace` hub for staff and `/settings/workplaces` admin page.
- [x] Nav: *Workplaces* leads both rails; admins get *Workplace hub* under Fleet.
- [x] Session / middleware / auth routes touched (`session-token.ts`, `middleware.ts`, sign-in, quick, reset).
- [ ] Set the **OpenAI API key** on the server and try one banner generation.
- [ ] Re-test sign-in, quick sign-in and password reset after the session changes.
- [ ] Browser check of hub and admin pages.

---

## 8. Task Manager (`76191e4`, `456c026`, `2893033`, `da53d8f`)

- [x] **Dev admin login** `admin@aahaas.com` with a hard-coded password (`src/lib/devAdmin.ts`); creates a *Dev Admin* Manager user on first sign-in (user id **24**). Tested on local dev server.
- [x] **Needs attention** rows show dates: *"Overdue 12d · Sep 23, 2026"*, *Created …*, *Done …*.
- [x] **Edit dialog auto-saves:** dropdowns / dates save immediately, text after ~0.8 s, pending edits saved on close; only changed fields are sent; dates sent with time zone. Fixes edits lost on ✕ / Esc / outside click and form resets on background reload. Tested through the API.
- [x] **Dev admin hidden** (`hideDevAdmin()`) from people pages, pickers, search, @mentions, counts, reports, performance, daily-mail list, auto daily-update cron and notifications.
- [ ] ⚠️ **Security:** user id 24 exists on the **live** site (taskmanager.aahaas.com). Either live isn't in production mode or it shares the dev database — **the hard-coded password may work on live. Check today and disable / remove the account if so.**
- [ ] **Push** `da53d8f` (branch is 1 ahead of origin).
- [ ] Browser check of the auto-saving dialog and Needs attention dates.
- [ ] Decide whether existing items created by Dev Admin should be relabelled.

---

## 9. Mobile app

- [x] Merged origin into `upgrade/rn-0.77-16kb` (`b9169e7a`, 09:18).
- [ ] `android/app/build.gradle` has uncommitted changes — review and commit.
- [ ] Still open from 3 Oct: sign in to Xcode with an Admin / App Manager Apple ID (team `PW6M457Q9S`) and upload **1.14.0 (1)**; check cart images and the date picker on a device.

---

## 10. Still open from earlier

- **From 3 Oct:** Driver-Auto browser check, `apply-driver-auto.sh --check` → run with approval, morning-message dry run, one test driver link; Accounts MY40020 vs MY40029 and possibly lost review-step edits; open a downloaded Daily Report Excel.
- **From 2 Oct:** daily report test send; B2C lead names (`cffa4de`, `--ref 14779` dry run → `--apply`); Payable 2.2VN migration; Online Work roster `ROSTER_SYNC*` env (`ROSTER_SYNC_SECONDS` must be a number); India offices setup.
- **From 1 Oct and earlier:** MC done SQL; Accounts Log Manager *Preview cleanup*; `/var/www/invoice-processor` scheduler; 29/09 B2C mails with AHS-14748; OPS `apply-*.sh` scripts and Bank Settlements migrations; payment migrations and live indexes; **rotating credentials in `web/.env.local.example`**; `AUTH_SECRET`; `DB_READ_HOST`.
- **Missing write-ups:** `DAILY_UPDATE` files for 29 Sep – 5 Oct.

---

## Next steps

- [ ] **Task Manager:** check whether the dev-admin login works on live — fix first; then push `da53d8f`
- [ ] **OPS:** confirm / commit the WhatsApp mini chat work; browser-check drivers performance card; rotate the old `.env.example` credentials
- [ ] **Accounts:** finish and commit Test Bookings (with migration); send a real Flight Tickets email; deploy routes + Cxl Requested
- [ ] **Online Work:** set the OpenAI key, test banners and sign-in flows; browser-check roster templates and holidays
- [ ] **Mobile:** commit `build.gradle`, upload 1.14.0 to App Store Connect
- [ ] Carry-overs from 3 Oct (Driver-Auto deploy steps)
