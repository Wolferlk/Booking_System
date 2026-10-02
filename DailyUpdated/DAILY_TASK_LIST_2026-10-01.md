# Today Daily Task List — 1 October 2026 (Thursday)

**Owner:** Sasindu Diluranga
**Date:** 1 October 2026

| Project | Branch | State at time of writing |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits today (`c314bf3`, `edd948d`) · clean · up to date with origin |
| Accounts System | `REV1` | 1 commit today (`ea25589`) · clean · up to date with origin |
| Aahaas Online Work | `main` | 1 commit today (`8799b6c`) · clean · up to date with origin |
| Aahaas Task Manager | `main` | 2 commits today (`6f0c378`, `46c72a0`) · clean · up to date with origin |
| AHS | `sewminiV3-UI-changes` | No work planned · clean |

**Working rule:** keep live data safe. Read-only checks wherever possible. Get approval before any SQL script, migration, `prisma db push`, email send, third-party write, commit/push/deploy or `pm2` restart. Approval for one does not carry over to the next.

> **About the carry-overs:** there's no `DAILY_UPDATE` for 29 or 30 Sep yet, so this list can't tell which 30 Sep items were finished. Everything from the 30 Sep list is carried as open. Tick off what was already done.

## Main outcome for today

1. **Accounts:** deploy `REV1` (30 Sep B2C fixes + today's **Log Manager**), **re-send the 29/09 B2C mails** with AHS-14748, then use **Preview cleanup** in the Log Manager to get disk space back on the server.
2. **OPS:** run the **MC done SQL** (test database first, then live with approval). Then browser-check the new **MC Report smart filters** and send **one VN movement chart** to yourself to check the new vendor / driver / tour vendor / guide lines.
3. **Task Manager:** open the **Monthly Excel** download in a browser and open the file in **real Excel**.
4. **Online Work:** get **one real email** through the new mail setup, and decide what to do with the old **Full day / Half day leave** types next to the new paid ones.
5. Write the missing `DAILY_UPDATE_2026-09-29.md` and `DAILY_UPDATE_2026-09-30.md`.

---

## 0. Blockers to clear first (high priority)

- [ ] **MC done table (OPS).** `apple-holidays/prisma/sql/2026-09-29-agenda-mc-done.sql` (`ffdd2c3`) still needs to run. Run `apply-agenda-mc-done.sh --check`, then run it on the **test database**, then on live **with approval**. Never `db push`. **The done mark fails until `agenda_mc_done` exists**, so don't deploy `ffdd2c3` or anything after it to live before this. Today's two OPS commits sit on top of it.
- [ ] **Accounts server disk.** Today's investigation found `LOG_LEVEL=debug` on the server, scheduled-task logs that never get cleaned up, and an old copy at `/var/www/invoice-processor` holding a **6.9 GB `laravel.log`** and a **1.3 GB `onedrive_all.log`**. Get space back before the disk fills (Section 4).
- [ ] **Online Work mail secret.** `SEND_GRAPH_CLIENT_SECRET` must be on the server (or SMTP set up). Until then the daily report, leave, approval, ticket and absence emails don't go out. This now includes the emails for the **new paid leave types**.
- [ ] **Accounts production database.** It can't be reached from this Mac, so none of the 30 Sep or 1 Oct Accounts work has been checked against real data. Run every Accounts check **on the server**.

---

## 1. OPS — MC Report smart filters (`c314bf3`, verify)

4 files · +1195 / −10 · **no database change** · new `src/lib/mc-report-filters.ts` and `src/components/mc-report/advanced-filters.tsx`

- [ ] Open **/dashboard/mc-report** with a real date range. Check the **Arrival** (green) and **Departure** (blue) tags on airport rows, and that hovering shows which clue was used.
- [ ] Spot-check how rows are classified on one **SL**, one **VN** and one **SG/MY** file (flight on the date → airport in From/To → "Airport" on first or last day). **"Han Market" must not count as an airport.**
- [ ] Try each **Quick view**: arrivals without a driver, departures without a driver, late & early flights (18:00–06:00), everything unallocated, missing a time, kids on board.
- [ ] **Flow switch** (All / Arrivals / Departures / Any airport / In-tour): the movement and pax counts on the buttons should match the table.
- [ ] **More filters:** time of day, driver / vendor (a tour vendor counts as allocated, like the Ops Board), day of trip, airport, must-have, cancelled files, and the Agent / City / Driver drop-downs. Options that would show no rows should be greyed out.
- [ ] Filter tags remove one at a time; **Reset all** clears everything.
- [ ] **Copy link** opens the same view in another browser, and a reload keeps the filters.
- [ ] The **Arrivals** and **Departures** stat tiles filter the table when clicked.
- [ ] **CSV** and **Excel** exports contain only the filtered rows.

## 2. OPS — VN movement chart roles (`edd948d`, verify)

2 files · +103 / −44 · **no database change** · `generate-agenda-pdf.ts`, `generate-agenda-docx.ts`

- [ ] **Send one VN file to yourself only** (e.g. **VN41518**). Movements with only a tour vendor show a **TOUR VENDOR** line, not "Not assigned".
- [ ] Check that each movement lists only the roles that are filled in: **VENDOR** (+ phone), **DRIVER** (+ phone, vehicle type and plate), **TOUR VENDOR** (+ phone), **GUIDE**.
- [ ] Download the **Word** version (this hasn't been tried): the column header is **Driver / Vendor**, and there's a new **Tour Vendors & Guides** table after the Ground Transport Roster.
- [ ] The same PDF code is used for download, email, WhatsApp and the scheduled auto-send. Check the next **auto-send** in the pm2 log.
- [ ] **Decide:** embed a Unicode font in the PDF? Vietnamese accents are stripped today ("Thảo" prints as "Tho"). This affects all PDF text, not only this change.

## 3. OPS — Carried from 30 Sep

- [ ] **Airport Pickup Timings** (`1f7b3f6`): Settings → Operations page (−/+, quick picks, rounding, preview, Defaults, Save); the departure text on a flight card follows the saved value; arrival **Use as meeting time**; domestic vs international (**VN169 HAN → DAD**); Add to details text; PDF / Word export; **AI Generate** recalculates the meeting times.
- [ ] **MC done mark** (`ffdd2c3`, after Blocker 0): tick turns the row green and un-tick deletes it; tick survives **saving the chart twice**; `/print/mc-report`; `doneByName` / `doneAt` stored.
- [ ] `b238af0` / `b3f4632`: a tour-vendor-only booking counts as allocated on the Ops Board, and the card number matches the ring (e.g. **16 Done** with **16/21**).
- [ ] **Weekly OPS report:** browser-check the week picker (**Send now to everyone**, weekly **Preview**, Latest / Week 1–5). The preview should load in about 20 s, and the *last reconciliation* note should show when the Apple System is down.
- [ ] **Send the corrected 20–26 Sept weekly report** (September, Week 3). Preview, send a test to yourself, then send to everyone **with approval**.
- [ ] **Remove from details / Add to details** on **VN41769**.
- [ ] Watch the pm2 log for the next **Client Confirmed** and **Operations Ready** emails and confirm where each went.
- [ ] **Decide:** should *Remove from details* also be able to hide the whole flight card?

---

## 4. Accounts — Log Manager (`ea25589`, deploy and set up on the server)

13 files · +2582 / −18 · **no database change** (settings and history are in `storage/app/log-manager/`) · **Administration → Log Manager**, super admins only · unit test `tests/Unit/LogTrimmerTest.php`

It **does nothing until switched on**: automatic cleanup and the disk emergency brake are both off by default.

- [ ] Deploy `REV1` **with approval** (together with the 30 Sep B2C commits in Section 5).
- [ ] Open the page as super admin. Check the top tiles (disk use, total log size, biggest file, cleanup on/off) against `df -h` and `du -sh storage/logs` on the server.
- [ ] Check that a **normal user can't open** the page.
- [ ] **Log files tab:** live tail with the error / warning / text filters, **Analyse** (top repeated messages, MB per day), download.
- [ ] Look for **"Read-only"** tags. If the scheduler runs as root and the web server as `www-data`, fix the file owners **with approval**.
- [ ] Click **Preview cleanup** and read it. Only then run it, or turn on the schedule (every 1 / 6 / 12 / 24 h), **with approval**. Keep the gzip copy option on for the first run.
- [ ] Decide whether to turn on the **emergency brake** (cuts every log to 5 MB under 10% free disk). It went off by mistake on this Mac and removed 11.5 MB of the local dev log, so be careful with it.
- [ ] **Stop the growth:** in **Reduce log volume**, raise the level from `debug` to `warning` and/or switch `laravel.log` to daily files **with approval**. Mute the output of noisy scheduled tasks if needed.
- [ ] **Old copy at `/var/www/invoice-processor`:** check whether it still runs a scheduler (`crontab -l` for each user, pm2 / supervisor). If it does, **every job is running twice**. Raise this before turning anything off.
- [ ] To manage the old copy's logs from the page, add `LOG_MANAGER_EXTRA_DIRS="Legacy copy=/var/www/invoice-processor/storage/logs"` to the server `.env` **with approval**.
- [ ] Check that the **History** tab records the runs and settings changes with who did them and the space freed.

## 5. Accounts — Carried from 30 Sep (B2C reports)

- [ ] After deploy, preview the **29/09** invoice mail (`/reports/auto`) and P&L mail (`/pnl/auto`). Both should show **5 orders including AHS-14748** (`f9e2ac5`, `b6a58dc`), and the red **Storefront count check** box should be gone (`90f4684`, `5472145`).
- [ ] **Re-send the 29/09 mails** with *Send now*, date 29/09/2026. Real recipients, so **approval first**.
- [ ] Check the overnight B2C mails for **30/09**. An invoice raised on 30/09 for an order placed on 29/09 should land on the 29/09 mail.
- [ ] Run `ResyncInvoicePaid` **without `--apply`** on the app server (not `35.197.143.222`) and save the output. Check **IS49101_R31** is listed. `--apply` only **with approval**, and keep the `storage/app/repairs/resync-paid-<time>.json` backup.
- [ ] Invoice versions on **/invoice-payments** (latest on Download, Versions panel, red OLD mark, **Download all versions (.zip)**), and the **Dashboard action buttons** switch as super admin and as a normal user.
- [ ] Standing morning checks from [DAILY_TASKS.md](../../Accounts_system/DAILY_TASKS.md): Sync Ledger count, alerts bell, SL booking count, invoice ↔ P&L match.

---

## 6. Aahaas Task Manager — Today's work

| Commit | What | Check |
|---|---|---|
| `6f0c378` | Team Tasks shows dates: new **Created** column, a **Done** date on completed tasks, and the real date under *Due in / Overdue*. Mobile cards too. | Open **Team Tasks** on desktop and on a phone width. `TaskListView.tsx` also draws **My Tasks** and other lists, so check those as well. |
| `46c72a0` | **Monthly Excel** button on Team Tasks and Reports (Leaders and Managers only). 9-sheet styled workbook. New dependency **`exceljs`**. | Download one month through the browser and open it in **real Excel**. Neither has been done yet. |

- [ ] **Download through the browser** as a Manager and as a Leader. Check that a normal member **doesn't see** the button.
- [ ] Open the September file in **Excel** (not just a validator): colours, frozen headers, filters, the Task ID links into the app, and the live total formulas on People / Projects / Teams.
- [ ] Try the dialog: month grid, This month / Last month, future months disabled, Team / Project / Person filters, the optional Daily Updates sheet, and the live preview with ▲/▼.
- [ ] **Decide** on the choices made in the report:
  - a month includes every task **open at any point** in it, not only tasks created that month
  - month boundaries use the **viewer's local time** (the database is UTC)
  - tasks **done within 10 minutes** of creation are left out of the cycle-time average
  - status is shown **as of today**, not as of month end
- [ ] Confirm the server runs `npm ci` on deploy so `exceljs` is installed, and that `next.config.ts` (`serverExternalPackages`) is picked up. Deploy **with approval**.
- [ ] `tsconfig.tsbuildinfo` was committed in `6f0c378`. Consider adding it to `.gitignore`.

---

## 7. Online Work — Paid leave types (`8799b6c`) + carried from 30 Sep

8 files · +58 / −37 · **no database change** (the leave type is stored inside the request)

- [ ] Open the **leave form**: **Leave** (`paid_full_day`) and **HalfDay** (`paid_half_day`) come first, and the picker starts on **Leave** in 3 columns.
- [ ] Submit a test request of each type as a **test employee only**. Check the day count (whole working days, 0.5 for a half day), the clash check against existing leave, and the day being set to leave / half day.
- [ ] **My Leave** page: the two new tiles in the 6-across grid. **HR leave balance**: both count against the shared annual / casual allowance. Check the year calendar too.
- [ ] Check the **HR email** for a new-type request once mail works (Blocker 0).
- [ ] **Decide:** rename the old types to **"No-pay leave" / "No-pay half day"**, or remove them from the form? Past requests show correctly either way.
- [ ] Carried from 30 Sep (nothing checked against real data yet):
  - **Downloads:** Windows x64 / ARM64 installers from the sign-in page while signed out, from S3 with a signed link, and the SHA256 matches. Server has the AWS keys and the `@aws-sdk/*` packages.
  - **Setup guide PDF** in the View pop-up while signed out.
  - **Daily report email:** use **Send to me**. Check the Present / Teams calls / Emails / PBX boxes against a known day, that Teams numbers are real and not "—", and that the Focus card and column are gone.
  - **Attendance:** Period & monthly view with real people, weekends show as Rest (not Gap), one monthly Excel and one CSV download, and tick-and-export on the day view.
  - **Decide:** repo history still has ~25 MB of `.exe` files from `f67fceb`. Cleaning that up rewrites pushed history, so it needs **approval**.
  - Remove the stray duplicate `Aahaas-Online-Work-Employee-Guide (1).pdf` (`7a41cd5`) if it's not needed.
  - Sign-in & access panel, report downloads, Notifications Test sends, the per-person send button and absence alerts: **test employees and yourself only**.
  - Help desk forms, **Support desk** (`/tickets`) and employee **Teams tabs**.
- [ ] Run the production build and type check before the next push.

---

## 8. Still open (not for today unless there's time)

- **From 25 Sep:** five OPS scripts, each with `--check` first and on the test database too:
  - `apply-agenda-mc-details.sh`
  - `apply-agenda-tickets-control.sh`
  - `apply-passenger-special-notes.sh`
  - `apply-ticket-files.sh`
  - `apply-agenda-custom-service-types.sh`

  Also: the two Bank Settlements migrations, and checking the D-3 Driver Allocation / Reconfirmation numbers in the Daily Operations email. Decisions are still needed on ticket files for guests, tours with no agenda, and the unused *"What the mail said"* code.
- **From earlier:**
  - Checklist VN 2.1v script and first sync; the Vietnam agenda includes and Vietnam Booking Checklist scripts
  - Azure write access to OneDrive; `Mail.Send` in Entra
  - the three payment migrations; the five live indexes
  - **rotating the credentials tracked in `web/.env.local.example`**
  - `AUTH_SECRET`; `DB_READ_HOST` in Amplify

---

## Before you stop

- [ ] MC done SQL run on the test database (and live, with approval)
- [ ] Accounts deployed, and the Log Manager **Preview cleanup** read on the server (cleanup run, or the reason written down)
- [ ] Found out whether the old `/var/www/invoice-processor` copy still runs a scheduler
- [ ] 29/09 B2C invoice and P&L mails re-sent with AHS-14748, or the reason written down
- [ ] `ResyncInvoicePaid` report-mode output saved
- [ ] Corrected 20–26 Sept weekly OPS report sent, or the reason written down
- [ ] One VN movement chart (PDF + Word) checked
- [ ] Task Manager Monthly Excel opened in real Excel
- [ ] Online Work: one real email received through the new mail setup
- [ ] All worktrees clean and pushed (with approval)
- [ ] Write `DAILY_UPDATE_2026-09-29.md`, `DAILY_UPDATE_2026-09-30.md` and `DAILY_UPDATE_2026-10-01.md`
