# Daily Task List — 2 October 2026 (Friday)

**Owner:** Sasindu Diluranga
**Date:** 2 October 2026
**Written:** 3 October 2026, from git history and Claude session history

| Project | Branch | Work on 2 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 3 commits (`b8ff03b`, `ee498ab`, `cffa4de`) · clean · up to date with origin |
| Accounts System | `REV1` | 1 commit (`ca5249e`) · clean · up to date with origin |
| Aahaas Online Work | `main` | 4 commits (`efe6282`, `63dcd54`, `3d5f162`, `676251d`) · clean · up to date with origin |
| Aahaas mobile app (Aahaas_Final) | — | iOS upgrade and release build (evening, **not committed**) |
| Aahaas Task Manager | `main` | No work · clean |
| AHS | `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several of the 2 Oct messages say *"nothing is committed"*. That was true when each message was written. Every commit listed here is now committed and pushed. Nothing has been checked as deployed.

## What was done

1. **OPS:** fixed the **Daily report** headline (shows **46 Today new & updated**), added an **Operations board** section (Today + Next 7 days), and replaced the CSV attachment with a **15-tab styled Excel workbook**.
2. **OPS:** B2C bookings now show the **real lead passenger name** instead of the store login (e.g. **admin6611 → Rithika Annadurai** on booking 14779), plus a one-off repair script.
3. **Accounts:** built **Payable 2.2VN** (`/payables/v22`), which turns every line of Checklist VN 2.1V into a payable sorted by section and pay date.
4. **Online Work:** **Shift roster** for B2C Booking / Flights with two-way Excel sync, shifts that follow the roster, and **multi-office support** (Sri Lanka, India · Bangalore, India · Madurai, Malaysia, Singapore, Vietnam) for the India branch going live.
5. **Aahaas mobile app:** upgraded to **React Native 0.77.3**, fixed iOS cart images, and built the **1.14.0 (1)** release archive.
6. Wrote the **September 2026 monthly task sheet** (`September_2026_Daily_Tasks.tsv`) from git and Claude history.

---

## 1. OPS — Daily report fix + Operations board + Excel (`b8ff03b`)

13 files · +2486 / −100 · **no database change** · new `daily-workbook.ts`, `ops-board-digest.ts`, `ops-board-states.ts` · new npm dependency (see `package.json`)

- [x] Top strip: **Today new & updated** shows **46** (the AppleSystem count). The *"Apple System 46 B2B / 0 B2C"* tile is removed. The *New bookings* card and the email subject use the same 46.
- [x] New **Operations board** section after *Bookings created*, with **Today** and **Next 7 days** blocks counted the same way as the dashboard board:
  - On ground, arrivals and departures, each with pax and a B2B / B2C split
  - B2B, B2C and live total on separate lines, with Hotel Only, cancellation pending and Cancelled on their own lines (cancelled files are never added to totals)
  - The five check cards (Reconfirmation, Call Requests, Driver / Vendor, Tickets, QC1 / QC2): done / total, %, part-done, pending, B2B and B2C
  - *Fully ready* count, and files past D-10 with no reason recorded
  - For the 7 days: a day-by-day table, a country table, and lists of cancelled, Hotel Only and B2C references
- [x] Email size kept under Gmail's ~102 KB clipping limit: the section went from 52 KB to about 32 KB.
- [x] **Excel attachment (.xlsx, 15 tabs):** Overview, New Bookings, Board Today, Board Next 7 Days, 7-Day Outlook, B2B Files, B2C Files, Hotel Only, Cancelled, Countries, D-3 Drivers, Readiness 3 Days, Reconfirmation, Complaints, Upcoming (+ AppleSystem Parity when available). Every tab has a banner, totals, a frozen header with filters and colour-coded status cells.
- [x] Tested on ~230 made-up board rows, with screenshots of the email and the workbook.
- [ ] **Not tested on real bookings:** the live database doesn't accept connections from this laptop. Send a test from **Auto Reports → Preview** and compare the numbers with the ops board **before the next scheduled send**.
- [ ] Make sure the server runs `npm ci` on deploy so the new Excel dependency is installed.

## 2. OPS — B2C lead passenger name (`ee498ab`, `cffa4de`)

8 files · +589 / −25 · **no database change** · new `b2c-lead-name.ts`, `b2c-travellers.ts`, `scripts/b2c-fix-lead-names.ts`

**Problem:** for hotel and activity orders, the B2C import used the store login name (**admin6611**). AahaasFlow (n8n) reads the travellers typed in at checkout, which is where **"Rithika Annadurai"** comes from.

- [x] **New imports** pick the lead passenger in this order: flight passenger list → checkout travellers → login name (last resort).
- [x] **Choosing the lead:** travellers are matched by name, not ID, because customers re-enter themselves on every product. The lead is the adult on the most products; a tie goes to the first adult entered. Names are tidied (e.g. *rithika annadurai* → *Rithika Annadurai*).
- [x] **Existing bookings:** the nightly import repairs them as it sees them. Older bookings like 14779 use `scripts/b2c-fix-lead-names.ts` (dry run by default, `--apply` to rename).
- [x] **Fix (`cffa4de`):** on the live store, `tbl_essentials_preorder` has no `travel_buddy_adult_id` column, so the first server runs failed at the traveller lookup. The lookup now asks the store which tables actually have traveller columns (read-only schema check) and skips the others.
- [x] **Nothing was harmed:** all three earlier runs (including the `--apply` one) stopped before any rename, and the nightly import falls back to the old name on a failed lookup.
- [x] The script now **refuses unknown flags**. The first run typed `--red` instead of `--ref` and silently checked all 124 B2C bookings.
- [ ] Deploy `cffa4de` to the server, then run `npx tsx scripts/b2c-fix-lead-names.ts --ref 14779` (dry run). Check the output, then `--apply` **with approval**.
- [ ] Check 14779 shows **Rithika Annadurai** in the booking system. Then run a dry run across all 124 B2C bookings and review it before applying.

---

## 3. Accounts — Payable 2.2VN (`ca5249e`)

13 files · +3446 / −2 · **one new migration:** `create_payable_v22_presets_table` · page at **/payables/v22** (Payable sidebar group)

- [x] Every line of the **Checklist VN 2.1V** sheet becomes a payable, sorted into **Transport, Day Cruise, Cruise, Tickets, SIC Tours, Guide, Hotel, Meals, Others** from the CODE column. A blank or unknown code is guessed from the text and marked *guessed*.
- [x] **Pay date** from need-to-pay date, arrival, service date, check-in or departure. **Window** D-0 to D-10 (default D-4), plus On day / Through / Range / Overdue and Prev / Next / Today.
- [x] **Filters:** paid status (ACT / Tina / Check / not marked), section, vendor, agent, tour / CNTL number, amount range, date source, overdue only, removed tours. **Saved views** (private or shared, pinned or moving dates, a default view).
- [x] **Export** to Excel, PDF or CSV with chosen columns, grouping, subtotals and summary. Excel can put each group on its own sheet. Layouts save as shared templates.
- [x] Views by section, pay day, vendor, tour or flat list. A side panel explains how each line's pay date was worked out. Original / Minimum price switch. Dark mode and keyboard shortcuts.
- [x] **Gear settings:** pay rule per section (date + fallback + day shift, like Payable 1.1), code → section mapping, add / rename sections. Hotels default to the hotel's payment day from Suppliers Manage.
- [x] **Read-only** on the checklist, P&L and OPS. It only writes its own settings, saved views and templates.
- [x] Tested on the sample *Checklist 2026 (42).xlsx* (26,689 lines): 99.8% got their section from the CODE column. Only ~4% have their own date, so most fall back to the tour's arrival. Excel and PDF exports checked, page rendered in headless Chrome.
- [ ] **On deploy:** `php artisan migrate --pretend`, then `migrate` **with approval**. Until then saving a view shows a message.
- [ ] Open it on the server with **real data** (not possible from this Mac) and spot-check one tour's payables against the checklist.
- [ ] **Decide:** any page holder can change pay rules (logged with name), like Payable 1.1. Is that OK? Deleting presets is super-admin only.
- [ ] **Not done yet:** marking payables as paid on the board. Paid status still comes from the sheet's Paid column.

---

## 4. Online Work — Shift roster (`efe6282`, `3d5f162`, `63dcd54`)

**`efe6282`** · 28 files · +3855 / −8 · **no database change** · new env settings `ROSTER_SYNC`, `ROSTER_SYNC_SECONDS`, `ROSTER_EXCEL_WRITE`

- [x] **Roster in the portal** for B2C Booking and Flights (or any department), kept in sync with the team's Excel file **both ways**. Excel is checked every 2 minutes. If the same cell changed in both places, the head chooses which to keep.
- [x] **Who can edit:** admins and HR edit everything. The department head (Nimhan for B2C) edits their own team, and can add a deputy. Team members see it under **Team roster**.
- [x] **Editor works like the Excel sheet:** drag-select, shift / day-type keys (1–6, O, L, …), copy / paste, undo, *repeat last week*. Saving writes to Excel straight away.
- [x] **Attendance against the roster:** on time, late by N minutes, didn't come in, left early, worked a day off. Overnight shifts (20:30–06:30) handled. Live *today* view, punctuality per person, a 24-hour coverage bar, and change history (Excel or portal).
- [x] Read a copy of the real workbook (October sheet and older months). The sync passed all 17 checks against a simulated copy.

**`3d5f162`** · 9 files · +201 / −48 — **shift follows the roster**

- [x] On days with a roster entry, its hours replace the weekly pattern on the profile *Working shift* card, *My shift*, the daily filing, the daily email's late / left-early figures, the absence alert and web check-in lateness.
- [x] Nothing is overwritten: the weekly pattern stays and is used on days the roster leaves blank. Break length comes from the weekly pattern. Lieu, leave, Poya, sick and OFF count as days off.

**`63dcd54`** · 3 files — tidied PBX report handling and messages in the daily report.

- [ ] Set `ROSTER_SYNC`, `ROSTER_SYNC_SECONDS` and `ROSTER_EXCEL_WRITE` on the server. **`ROSTER_SYNC_SECONDS` must be a number** (e.g. `120`). `.env.production.example` line 194 has `ROSTER_SYNC_SECONDS=on`; `roster-sync.ts` reads it with `Number(...)`, so `on` gives NaN and the Excel check could run almost nonstop. Fix the example and don't copy `on` to the server.
- [ ] **Browser-check** the roster screens. None have been opened yet.
- [ ] **First live Excel write:** make one small edit in the portal and confirm it lands in the real file with the right colours. Then edit Excel and confirm it shows in the portal within ~2 minutes.
- [ ] Check **Nimani's** profile shows the roster week (Fri 2 09:00–19:00, Sun 4 / Mon 5 Off, Tue 6 06:30–16:30).
- [ ] Match roster names against the real B2C accounts (the local database only has 4 test users).
- [ ] **Not changed:** the leave calendar still counts working days from the weekly pattern. Decide whether it should use the roster.

## 5. Online Work — Multiple offices (`676251d`)

28 files · +2363 / −39 · **no database change** (assignments in `.data/offices.json`)

The portal is going to be used by the **India branch from 3 Oct**.

- [x] **Office switcher** in the admin header: Sri Lanka, India · Bangalore, India · Madurai, Malaysia, Singapore, Vietnam, or *All offices*. Shows each office's local time, open / closed, headcount and online count. Filters Dashboard, Employees, Departments, Attendance, Daily filings and Devices, with a coloured *"Showing … only"* bar.
- [x] New **Offices** page (Monitor menu): *Follow the sun* 24-hour line with the shared open window, a card per office, *People by office* with bulk moves, *Recent moves*, and *Edit office* (name, city, timezone, hours, working days, default).
- [x] Office rings on the Dashboard, an Office column and filter on Employees, and the office + local time on the employee profile. Flags are drawn, not emoji (Windows shows flag emoji as letters).
- [x] **Nobody is moved automatically.** Everyone stays in Sri Lanka (the default) until moved. Only admins and HR can move people or edit offices; demo accounts are blocked.
- [ ] Deploy **with approval**, then set the India offices' **timezone and hours** and move the India staff on the Offices page.
- [ ] Check that one India employee's late / attendance figures use their own office hours.

---

## 6. Aahaas mobile app — iOS upgrade and 1.14.0 build (evening, not committed)

Worked late on 2 Oct (continued past midnight).

- [x] **React Native 0.77.3:** reinstalled packages (`npm install --legacy-peer-deps`, because of a react-native-maps conflict) and rebuilt all pods.
- [x] **Build fixes:** gRPC targets set to C++17 in the Podfile; `@react-native-community/datetimepicker` upgraded 6.7.5 → 8.4.4; New Architecture turned off for iOS (React Native Firebase 18.9 doesn't support it, matching Android).
- [x] **Personalization screen** was blank because the backend returns `"already_completed_"` with a trailing underscore.
- [x] App runs on the iPhone 17 Pro simulator against the production backend (FCM token save returns 200).
- [x] **iOS cart images:** likely fix in `SafeFastImage.jsx` (trims and encodes URLs, switches `http://` → `https://` on iOS, resets the error state when the image changes). Used in 10 files.
- [x] Version set to **1.14.0 (1)** and a Release archive built: `ios/build/release/Aahaas-1.14.0.xcarchive` (bundle `org.aahaastechlabs.aahaas`, production API `gateway.aahaas.com`).
- [ ] **Upload blocked:** no Apple ID in Xcode and no *iOS Distribution* certificate on this Mac. Sign in to Xcode with an Admin / App Manager account for team `PW6M457Q9S`, then Organizer → **Distribute App → App Store Connect → Upload**.
- [ ] Check the **cart images** on a real cart and open a **date picker** in the app (neither tested).
- [ ] **Commit** the upgrade, Podfile, image fix and version change.
- [ ] **Decide:** upgrade Firebase to v21+ later? (Dynamic Links is removed in v22.)

---

## 7. Still open from earlier (not done on 2 Oct)

- **From 1 Oct:** MC done SQL (test database, then live); Accounts deploy and Log Manager *Preview cleanup* on the server; check whether `/var/www/invoice-processor` still runs a scheduler; re-send the 29/09 B2C mails with AHS-14748; `ResyncInvoicePaid` report-mode output; corrected 20–26 Sept weekly OPS report; Task Manager Monthly Excel in real Excel; the Online Work mail secret (`SEND_GRAPH_CLIENT_SECRET`).
- **From 25 Sep:** the five OPS scripts (`apply-agenda-mc-details.sh`, `apply-agenda-tickets-control.sh`, `apply-passenger-special-notes.sh`, `apply-ticket-files.sh`, `apply-agenda-custom-service-types.sh`, each with `--check` first) and the two Bank Settlements migrations.
- **From earlier:** Checklist VN 2.1v script and first sync; Azure write access to OneDrive; `Mail.Send` in Entra; the three payment migrations; the five live indexes; **rotating the credentials tracked in `web/.env.local.example`**; `AUTH_SECRET`; `DB_READ_HOST` in Amplify.
- **Missing write-ups:** `DAILY_UPDATE` files for 29 Sep – 2 Oct.

---

## Next steps

- [ ] Daily report: one test send from Preview, numbers checked against the ops board
- [ ] B2C lead names: `cffa4de` deployed, 14779 dry run → `--apply` with approval
- [ ] Payable 2.2VN: migration run on deploy, page checked with real data
- [ ] Online Work: roster env settings on the server, first live Excel write checked, India offices set up and staff moved
- [ ] Mobile app: 1.14.0 uploaded to App Store Connect, changes committed
- [ ] All worktrees clean and pushed (with approval)
