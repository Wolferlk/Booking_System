# Daily Task List — 6 October 2026 (Tuesday)

**Owner:** Sasindu Diluranga
**Date:** 6 October 2026
**Written:** 6 October 2026, from git history and working-tree status

| Project | Branch | Work on 6 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits (`506a2b2`, `eb82995`) · clean · up to date with origin |
| Accounts System | `REV1` | 4 commits (`c8bd35c`, `c214fd6`, `5d9ee7b`, `659fc5f`) · clean · up to date with origin |
| Aahaas Online Work | `main` | 4 commits (`9885f5b`, `b1085e6`, `de38b3d`, `5d619db`) · clean · up to date with origin |
| Aahaas Task Manager | `main` | No new work · `da53d8f` is now **pushed** · clean |
| Aahaas mobile app (`Desktop/Aahaas_f/Aahaas_Final`) | `upgrade/rn-0.77-16kb` | Late 5 Oct: version bump to **1.14.1 (551)** (`41b24224`) + Parinda's Refund / FareCard work · clean |
| AHS | `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several say *"nothing is committed"* or *"not committed or deployed"*. That was true when written; every commit below is now committed and pushed. **Nothing is confirmed as deployed**, and most of it has not been opened in a browser.

## What was done

1. **OPS + Accounts:** **Test Bookings** finished end to end — Accounts register, screen, migration and tests; OPS Mark / Restore banner on the booking page, with clear error messages while the migration is pending.
2. **Accounts:** fixed the **error on `/b2b/tickets` and `/b2b/pnl`** caused by yesterday's routes change (`deleted_at` missing on live `b2b_ticket_coupons`).
3. **Accounts:** Ticket P&L **PDF export** paginated so large exports don't run out of memory.
4. **Accounts:** **Dry runs no longer show as SUCCESS** in auto-report history; real sends need the mail server to accept the message.
5. **Online Work:** roster **solid shift tiles** and new two-row colour picker (Hishani's requests).
6. **Online Work:** **Day filing** fixes from Hishani's feedback (9 points — 5 bugs fixed, 1 improved, 3 by design).
7. **Online Work:** **Workplace hub** artwork (`HubOrbit`) and the **Island Rush** mini game.
8. **OPS:** confirmed `a0bdf55` (5 Oct, 18:35) holds the WhatsApp mini chat rework — the open item from yesterday is closed.

---

## 1. Test Bookings — Accounts (`c8bd35c`) + OPS (`506a2b2`, `eb82995`)

**Accounts:** 35 files · +2,578 / −19 · **new table `test_bookings`** (migration `2026_10_05_120000_create_test_bookings_table.php`)
**OPS:** 15 files · +1,013 / −42 · reads / writes the same register in the Accounts database

- [x] Accounts: `TestBookingRegistry`, `TestBookingService`, `TestBookingController` and a **Test Bookings** page (`test-bookings/index.blade.php`) with access rules in `config/access.php`.
- [x] Hidden from: Dashboard, Invoices, Invoice Payments, Payable V1 / V11, DB P&Ls, invoice / P&L reports, B2B bookings and tickets, B2C report, Apple / B2C day cohorts, sync parity / ledger repair.
- [x] Report emails (daily summary, auto report, B2B flights / tickets, P&L auto report) get a **Test bookings** note listing what was left out.
- [x] Feature tests (`TestBookingRegisterTest.php`, in-memory SQLite): mark / release, invoices and P&Ls hidden, unknown refs and paid bookings need confirmation, email rendering.
- [x] OPS: `POST /api/bookings/[ref]/test-booking` (mark / restore), banner on the booking page, test bookings left out of the bookings list, export, quick stats and report counts. Role-checked.
- [x] OPS error handling (`eb82995`): failures sorted into *register not set up* / *Accounts database not answering* / *other error*, each with its own message; returns **409 / 424 / 422** instead of 502; the Mark button is replaced by *"Test Bookings not available yet — migration pending"* while the table is missing.
- [x] OPS type-check passes (3 old errors in untouched files).
- [ ] **Run the migration** on the Accounts server (`php artisan migrate`) — with approval.
- [ ] Mark and restore one real booking; check it leaves and returns to every report, in both OPS and Accounts.
- [ ] Deploy both sides.

## 2. Accounts — `/b2b/tickets` and `/b2b/pnl` error fix (`c214fd6`)

1 file · +34 / −6 · `B2bTicketService.php` · **no database change**

- [x] Cause: yesterday's routes change (`7229dc6`) filtered `b2b_ticket_coupons` on `deleted_at`, which the live B2B table doesn't have, so both pages failed.
- [x] New `hasColumn()` check (cached) and `liveCoupons()` helper; all four readers (routes, destination filter, search, destination dropdown) use it.
- [x] Checked against throwaway SQLite with and without `deleted_at` — both give *CMB ⇄ MAA*. Nothing ran against live.
- [ ] **Deploy** — live `/b2b/tickets` and `/b2b/pnl` stay broken until this goes out (if `7229dc6` is already live).

## 3. Accounts — Ticket P&L PDF export (`5d9ee7b`)

2 files · +45 / −9 · `B2bTicketPnlExportService.php`, `ticket-pnl-pdf.blade.php`

- [x] Maximum rows per PDF set as a constant; ticket list split into several tables so big exports don't run out of memory.
- [ ] Export a large date range and open the PDF.

## 4. Accounts — Dry runs labelled honestly (`659fc5f`)

11 files · +103 / −34 · `ReportScheduleRun.php`, `AutoReportService.php`, Auto P&L / Invoice / B2B report controllers and views, `B2bTicketReportReconciler.php` · **no database change**

- [x] Dry runs show as **DRY RUN · NOT EMAILED**; real sends as **SENT**. Older dry-run rows relabel themselves once deployed.
- [x] Status filter gains *Dry run (not emailed)*; "sent in 30 days" counts only real emails; B2B ticket board no longer counts dry runs as sent.
- [x] A send is only **SENT** once the mail server accepts it; if mail is set to the log driver, the run is **FAILED** with a message saying so.
- [x] Each email's **Message-ID** is written to the log for tracing in Office 365.
- [ ] Do one dry run and one real send on each of the three auto-report pages after deploy.

---

## 5. Online Work — Roster solid tiles (`9885f5b`)

4 files · +115 / −48 · `roster-board.tsx`, `roster-palette.tsx`, `roster-strip.tsx`, `roster-types.ts`

- [x] Worked shifts are **solid colour tiles** with a soft shine; bold start time, faded end time.
- [x] Text colour picked from tile brightness (white on dark, dark shade on light) — checked against every picker colour.
- [x] Leave, holidays and off days keep the light tint.
- [x] New picker: **Deep** row (Dark red … Slate) and **Light** row (Blush … Mist), with preview, name on hover and ✓; *Custom* still works.
- [x] Deeper default colours by time of day; same tiles in toolbar chips, template editor preview and profile strip.
- [ ] Show Hishani in a browser.

## 6. Online Work — Day filing feedback (`b1085e6`)

7 files · +129 / −28 · `filings/page.tsx`, `day-filing.tsx`, `day-jump.tsx` (new), `task-import.tsx`, `workday-store.ts`, `workday-types.ts`, `globals.css`

| # | Report | Result |
|---|---|---|
| 1 | WFH / Client site disabled | By design — needs an approved arrangement; hint and hover text explain it |
| 2 | "Filed late" tag removed on update | **Fixed** — worked out from first submit time |
| 3 | Data not cleared after submit | By design — the form is that day's record |
| 4 | Draft save allowed after submit | **Fixed** — hidden in UI and refused by the server |
| 5 | Background scrolls behind modal | **Fixed** — all dialogs lock the page |
| 6 | No way forward after pasting text | **Fixed** — footer with Cancel and *Read with …* button |
| 7 | AI reader / Built-in rules do nothing | Caused by #6 |
| 8 | No date between Earlier / Later | **Improved** — date picker + *Today* link |
| 9 | Invalid shift timings accepted | **Fixed** — zero-hour shifts and break ≥ shift refused (night shifts still allowed) |

- [ ] Reply to Hishani with the table above; ask her to re-test.

## 7. Online Work — Workplace hub art and Island Rush (`de38b3d`, `5d619db`)

27 files · ~+1,750 · `hub-orbit.tsx` (new), `hub-game.tsx` (new, 915 lines), `scripts/hub-art.mjs` (new), hub images re-generated and smaller

- [x] `hub-art.mjs` generates hub artwork from the Aahaas logo with the OpenAI image API; `plain: true` option for prompt-only images.
- [x] `HubOrbit` animates the logo and workplace chips in the hub hero.
- [x] **Island Rush** (45-second game in the hero): catch travel emoji, avoid storms and bugs, coins / clock / heart / frenzy specials, combos up to ×5, score card with ranks and personal best (stored in the browser).
- [x] Played full rounds in headless Chrome, light and dark, no console errors; type-check passes.
- [x] **6 image generations** used on the OpenAI key (4 game sprites + 2 regenerations).
- [ ] Remove the temporary hub preview harness if it isn't needed.
- [ ] Decide whether the game should be on for all staff or behind a setting.

---

## 8. Mobile app (`41b24224`, late 5 Oct)

- [x] Version bumped to **1.14.1 (551)** in `android/app/build.gradle` and the iOS project — yesterday's uncommitted `build.gradle` item is closed.
- [x] Merged Parinda's **Refund** screens (`RefundCard`, `RefundSheet`) and **FareCard** refactor (`205e4773`, `698d5760`).
- [ ] Build and upload **1.14.1 (551)** (1.14.0 upload from 3 Oct is still open — Xcode needs an Admin / App Manager Apple ID, team `PW6M457Q9S`).
- [ ] Check refund flow, cart images and the date picker on a device.

---

## 9. Still open from earlier

- **From 5 Oct:** ⚠️ **Task Manager dev admin** (`admin@aahaas.com`, user id 24) exists on live — check whether the hard-coded password works on taskmanager.aahaas.com and disable it if so; browser checks of the drivers performance card, WhatsApp mini chat, Cxl Requested column, roster templates and Workplace hub; send one real Flight Tickets email; set the OpenAI key on the server; re-test sign-in / quick sign-in / password reset; **rotate the credentials** removed from `apple-holidays/.env.example`.
- **From 3 Oct:** Driver-Auto browser check, `apply-driver-auto.sh --check` → run with approval, morning-message dry run, one test driver link; Accounts MY40020 vs MY40029; open a downloaded Daily Report Excel.
- **From 2 Oct:** daily report test send; B2C lead names (`--ref 14779` dry run → `--apply`); Payable 2.2VN migration; `ROSTER_SYNC*` env; India offices setup.
- **From 1 Oct and earlier:** MC done SQL; Log Manager *Preview cleanup*; `/var/www/invoice-processor` scheduler; 29/09 B2C mails with AHS-14748; OPS `apply-*.sh` and Bank Settlements migrations; payment migrations and live indexes; rotate `web/.env.local.example` credentials; `AUTH_SECRET`; `DB_READ_HOST`.
- **Missing write-ups:** `DAILY_UPDATE` files for 29 Sep – 6 Oct.

---

## Next steps

- [ ] **Accounts:** deploy `c214fd6` first — fixes the live `/b2b/tickets` and `/b2b/pnl` error
- [ ] **Task Manager:** check the dev-admin login on live
- [ ] **Test Bookings:** run the `test_bookings` migration with approval, deploy OPS + Accounts, mark / restore one booking
- [ ] **Accounts:** deploy dry-run labelling and PDF pagination; test one dry run and one real send
- [ ] **Online Work:** reply to Hishani; browser-check roster tiles, day filing and the hub
- [ ] **Mobile:** upload 1.14.1 (551) and test refunds on a device
