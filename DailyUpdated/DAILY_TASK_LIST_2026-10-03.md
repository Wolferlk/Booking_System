# Daily Task List — 3 October 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 3 October 2026
**Written:** 3 October 2026, from git history

| Project | Branch | Work on 3 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits (`e35c0df`, `e0b9367`) · clean · up to date with origin |
| Accounts System | `REV1` | 1 commit (`9e101c8`) · clean · up to date with origin |
| Aahaas Online Work | `main` | 1 commit (`7066d38`) · clean · up to date with origin |
| Aahaas mobile app (Aahaas_Final) | `upgrade/rn-0.77-16kb` | 1 commit (`d271cd3b`) · clean · **ahead of origin by 1 (not pushed)** |
| Aahaas Task Manager | `main` | No work · clean |
| AHS | `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several of the 3 Oct messages say *"nothing is committed"*. That was true when each message was written. Every commit listed here is now committed, and all except the mobile app commit are pushed. Nothing has been checked as deployed.

## What was done

1. **OPS:** built **Driver-Auto** (`/dashboard/driver-auto`), where drivers ask for open trips from their own link and staff approve them, plus a morning WhatsApp / email message listing trips still without a driver.
2. **OPS:** the **IS number** is now the main file number everywhere on Driver-Auto (falls back to CNTL, then booking ref).
3. **Accounts:** the supplier P&L reader now reads the **Apple System printed P&L** layout (e.g. *MY40020 P&L.docx*), and several broken buttons on the review screen are fixed.
4. **Online Work:** removed the **Summary tab** from the Daily Report Excel export.
5. **Aahaas mobile app:** committed the React Native 0.77.3 upgrade, iOS fixes and the **1.14.0 (1)** version change. The App Store upload is still blocked on signing.

---

## 1. OPS — Driver-Auto (`e35c0df`)

29 files · +4343 / −1 · **new SQL:** `prisma/sql/2026-10-03-driver-auto.sql` (creates `driver_trip_claims` and `driver_board_sends`, run by `apply-driver-auto.sh`) · new cron `api/cron/driver-auto-send` (added to `vercel.json` and `cron-scheduler.ts`)

**Staff page** (`/dashboard/driver-auto`, in the sidebar for ground and admin roles):

- [x] **Four country tabs:** Sri Lanka, Vietnam, Singapore, Malaysia. Sri Lanka offers the whole booking as one round trip. The others offer one movement per trip.
- [x] **Still not allocated:** trips from today to D-10 with no driver, grouped by day, with a day-by-day bar chart. Leisure, Hotel Only and already-assigned trips are left out (same rules as the movement chart).
- [x] **Get Bookings:** driver requests, grouped when several drivers want the same trip. Each one shows whether the driver already has a trip on those dates, whether the vehicle has enough seats and how busy the driver is, with **Approve** and **Decline** buttons.
- [x] **Approval switch per country.** On: requests wait for staff. Off: the first driver to tap gets the trip, but a driver who is busy on those dates or whose vehicle is too small is still refused.
- [x] **Morning message panel:** WhatsApp-style preview, next send time, auto-send and email switches, dry run and **Send now**.
- [x] **Drivers & links:** copy, open, send or reset each driver's link, and choose who gets the morning message.
- [x] **Driver page** (`/driver-board/[key]`): each driver's own link to see open trips and ask for them, with no login.
- [x] Type-check and lint pass. 14 logic checks pass on made-up data, with the database address pointed at a dead port.
- [x] **Live database untouched:** no migration run, nothing written, nothing sent.
- [ ] **Not opened in a browser.** Starting the app on this Mac would connect to live (local `.env` points at live), so the layout hasn't been checked by eye.
- [ ] **On deploy:** `bash prisma/sql/apply-driver-auto.sh --check` first, then run it **with approval**. It only creates the two new tables (`CREATE TABLE IF NOT EXISTS`) and is safe to run twice.
- [ ] Keep **auto-send off** and **approval on** for every country until a **dry run** of the morning message has been checked.
- [ ] Send one driver link to a test phone and go through ask → approve → assigned.

## 2. OPS — IS number on Driver-Auto (`e0b9367`)

7 files · +59 / −33 · **no database change**

- [x] Each trip card shows a green **"IS 45123"** badge that links to the booking. The booking ref shows next to it in small grey text when it's different.
- [x] No IS number → falls back to **CNTL number**, then **booking ref** (the same rule as the SL Driver Allocation board).
- [x] The search box finds trips by IS number.
- [x] The IS number also shows on Get Bookings requests, *"Busy: IS 44210 · Tue 14 Oct"* warnings, recent decisions, and the Assign window and its confirm prompt. The driver page and morning message use it too.
- [x] Type-check and lint clean. Offline tests pass, including a new check for the IS number and its fallback.
- [ ] Check in a browser together with item 1.

---

## 3. Accounts — Supplier P&L reader for Apple System P&L (`9e101c8`)

3 files · +358 / −60 · **no database change** · `SupplierPnlParser.php`, `SupplierPnlRecordService.php`, `add-pnl-modal.blade.php`

**Problem:** *MY40020 P&L.docx* is the Apple System's own printed P&L (Hotels / Cruises → Attraction → Tour Transfers → Transport). The parser didn't know that layout and fell back to the old text reader. It picked up only the 292 profit line, filed it as *Hotel*, and misread the tour number and guest name.

- [x] **Reads the full document now:**

  | Section | Lines | Total |
  |---|---|---|
  | Accommodation | Furama Bukit Bintang, 4 nights | 2,960 |
  | Tickets | 4 attractions (day, city, per-head rate × 7) | 987 |
  | Transfers | 4 tours | 1,697 |
  | Transport | 2 airport transfers | 520 |

- [x] Cost **6,164**, selling **6,456**, profit **292**, all matching the document and the real payload builder. Tour number 472456, agent, pax, nights, currency and hotel fill in automatically.
- [x] **Older samples:** MY23077 and MY23130 read the same as before. VN40416 and MY23056 now read properly too.
- [x] **Existing record panel:** MY40020 #337 was wrongly labelled *"Apple System sync"*. It's an entry on the PNL Records page, which is why the PNL board search found nothing. The panel now says so, turns amber instead of red and has an **Open #337 ↗** link. The box still has to be ticked before creating, and #337 isn't changed.
- [x] **Repeated warning:** clicking Create without ticking the box used to add another *"already held"* message each time. It now scrolls to the box and flashes it.
- [x] **Broken buttons fixed:** a quoting bug in click handlers stopped typing in booking fields and line cells, *"Use 292.00"*, *"+ Tickets / Transfers…"* and *"Open the Detailed P&L"*. **Corrections made on the review step before this fix were probably never saved.**
- [ ] **Check which booking this is:** the document prints *Is Number: MY40029*, but the file is named *MY40020*. The review step shows both side by side; one click switches to the other number.
- [ ] Not opened in a browser (login needs the production database, which this Mac can't reach). Deploy and try the upload on the server.
- [ ] Find recent P&L records entered through the review step and check whether any edits were lost because of the button bug.

---

## 4. Online Work — Daily Report Excel without Summary tab (`7066d38`)

2 files · +2 / −121 · **no database change** · `daily-report-excel.ts`, `report-downloads.tsx`

- [x] The **Summary tab** is removed. The file opens on the first section tab (Attendance, Daily Filings, Teams, Mail Monitoring or Calls Monitoring, whichever are included).
- [x] The attendance / collaboration totals, *Highlights* list and links to other tabs are gone from the Excel file. **The PDF still has them.**
- [x] The download button now says *"One tab per section"*.
- [x] Type check passes.
- [ ] Download one file and open it to check.

---

## 5. Aahaas mobile app — 1.14.0 committed (`d271cd3b`, not pushed)

9 files · +1024 / −541 · branch `upgrade/rn-0.77-16kb` · `SafeFastImage.jsx`, `Podfile`, `Podfile.lock`, `project.pbxproj`, `package.json`, `SummaryProductCard.jsx`, `DemographicGame.jsx`

- [x] Committed the work from 2 Oct evening: React Native 0.77.3 pods, Podfile C++17 fix, datetimepicker upgrade, iOS cart image fix (`SafeFastImage.jsx`), personalization fix and version **1.14.0 (1)**.
- [x] Release archive at `ios/build/release/Aahaas-1.14.0.xcarchive` (bundle `org.aahaastechlabs.aahaas`, production API `gateway.aahaas.com`).
- [ ] **Push** the commit (branch is 1 ahead of origin).
- [ ] **Upload blocked:** Xcode shows *"No Accounts"* and *"No signing certificate 'iOS Distribution' found"*. The only certificate on this Mac is a development one. Sign in to Xcode (Settings → Accounts) with an Admin / App Manager Apple ID for team `PW6M457Q9S`, then `open ios/build/release/Aahaas-1.14.0.xcarchive` → **Distribute App → App Store Connect → Upload**.
- [ ] Check **cart images** on a real cart and open a **date picker** (neither tested yet).

---

## 6. Still open from earlier (not done on 3 Oct)

- **From 2 Oct:**
  - Daily report: test send from **Auto Reports → Preview**, numbers checked against the ops board; confirm `npm ci` runs on deploy for the new Excel dependency.
  - B2C lead names: deploy `cffa4de`, `b2c-fix-lead-names.ts --ref 14779` dry run → `--apply` with approval, then dry run across all 124 B2C bookings.
  - Payable 2.2VN: `migrate --pretend` then `migrate` with approval, check with real data; decide who can change pay rules.
  - Online Work roster: set `ROSTER_SYNC*` on the server (**`ROSTER_SYNC_SECONDS` must be a number**, fix `.env.production.example` line 194), browser-check, first live Excel write, Nimani's profile, match roster names.
  - Online Work offices: deploy with approval, set India offices' timezone and hours, move India staff (India branch starts using the portal from 3 Oct).
- **From 1 Oct:** MC done SQL (test, then live); Accounts deploy and Log Manager *Preview cleanup*; check `/var/www/invoice-processor` scheduler; re-send 29/09 B2C mails with AHS-14748; `ResyncInvoicePaid` report-mode output; corrected 20–26 Sept weekly OPS report; Task Manager Monthly Excel in real Excel; `SEND_GRAPH_CLIENT_SECRET`.
- **From 25 Sep:** the five OPS `apply-*.sh` scripts (each with `--check` first) and the two Bank Settlements migrations.
- **From earlier:** Checklist VN 2.1v script and first sync; Azure write access to OneDrive; `Mail.Send` in Entra; the three payment migrations; the five live indexes; **rotating the credentials tracked in `web/.env.local.example`**; `AUTH_SECRET`; `DB_READ_HOST` in Amplify.
- **Missing write-ups:** `DAILY_UPDATE` files for 29 Sep – 3 Oct.

---

## Next steps

- [ ] Driver-Auto: browser check, `apply-driver-auto.sh --check` → run with approval, dry run of the morning message, test with one driver link
- [ ] Accounts: confirm MY40020 vs MY40029, deploy the P&L reader fix, check for lost review-step edits
- [ ] Online Work: open a downloaded Daily Report Excel; finish the roster and India office setup
- [ ] Mobile app: push `d271cd3b`, sign in to Xcode and upload 1.14.0
- [ ] Carry-overs from 2 Oct (daily report test send, B2C lead names, Payable 2.2VN migration)
