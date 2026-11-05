# Daily Task List — 21 October 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 21 October 2026
**Written:** 21 October 2026, from git history and working-tree status

| Project | Branch | Work on 21 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 5 commits (`9924adb`, `eea9e5b`, `b81d793`, `1512fa1`, `af99659`) · pushed · **2 files not committed** (mobile bridge) |
| Accounts System | `REV1` | 4 commits (`f0ec6b5`, `6bcb055`, `11ed975`, `0fab982`) · pushed · **1 new command not committed** (`ImportTicketRateSheet.php`) + sample Excel |
| Aahaas Online Work | `main` | 2 commits (`cc4f8e6`, `388cca2`) · pushed · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Most of it was checked only with type-check, lint or offline tests, **not in a browser, on a phone or against the real database.** The one exception is the Ops report count fix (section 3), which was checked against live figures.

> **Committed after yesterday's update:** Online Work `4f5b3f5` (faster employee page with loading skeleton, 18:49 on 20 Oct). It is now committed and pushed, but not deployed.

## What was done

1. **OPS + Accounts:** **Supplier picker** on MC Report, OPS Trans-Recon and Accounts Trans-Recon, with bank-details badges and "By supplier" totals.
2. **OPS mobile app (staff side):** rebuilt the **WhatsApp chat, Chats list, Bookings, booking detail and MC Report**, and added a new **Ops Board** page.
3. **OPS:** the **Ops activity report now matches the invoice report** (47 = 47 for 20 Oct, checked live).
4. **OPS:** **Customer Daily Trip Details** card in Ops Settings for the default send time and on/off switch.
5. **Driver app:** test driver Sadun now has **14 test trips** (3 today), with "also today" trips on the Today screen.
6. **Accounts:** **Daily Invoice Report shows the B2C guest name** instead of `admin6611`, plus a read-only **`b2c:lead-probe`** command for AHS-15453 / 15455.
7. **Accounts:** new **Mail Scanner** page at `/mail-scanner` (tags mails such as Cancellation through Graph; Excel and PDF export).
8. **Online Work:** **Halloween advert v2** (120 s, 6:00 PM, live countdown) and a new **CCTV notice** at `/ad/2`.
9. **Not committed:** OPS mobile bridge follows the request host (likely fix for "Booking not found"), and the Accounts **ticket rate sheet import** command.

---

## 1. Supplier picker — MC Report, OPS Trans-Recon, Accounts Trans-Recon (OPS `eea9e5b`, Accounts `11ed975`)

OPS 19 files · +1,790 / −33 · Accounts 3 files · +143 / −17

- [x] **MC Report:** new Supplier column. The picker searches Accounts → Suppliers Manage (supplier bank details and drivers) and tolerates typos and word order. It suggests "used last time" and close matches with a %, shows a bank badge, can set the same supplier on several rows, and has **Register supplier** with a duplicate check ("Use this?").
- [x] **OPS Trans-Recon:** Driver · Supplier column. Refresh from MC fills it but keeps hand changes. Also a **No supplier** filter, a **By Accounts supplier** table in the Report tab, and both columns in the Excel export.
- [x] **Accounts Trans-Recon:** Driver and Supplier columns with a bank badge (bank name + last 4 digits only), a **By supplier** bar that filters on click, search by driver/supplier, and 3 new Excel columns.
- [x] Safety: two new tables, no existing table changed. Pages work as before until the SQL is run. OPS can only **add** suppliers (never edit or delete, never bank details). A supplier change on an approved line sends it back to Pending.
- [ ] **Create the tables** from `apple-holidays/`: `bash prisma/sql/apply-transport-suppliers.sh --check`, then run it.
- [ ] Check that the live supplier table has the **Business type** and **Phone** fields (added in August). If it doesn't, the picker shows an error.
- [ ] Try it in a browser: pick a supplier on MC Report, then confirm it appears on the OPS sheet and on the Accounts page with the right bank badge.

## 2. OPS mobile app — staff screens rebuilt + Ops Board (`af99659`)

15 files · +2,603 / −269

- [x] **WhatsApp chat:** WhatsApp formatting, links, date separators, read ticks, a 24h-window countdown, a booking strip, attachments (blocked outside 24h), templates with name/ref filled in, quick replies (`/`, `{name}`, `{ref}`), retry, drafts, search, photo viewer, Call / Copy / Export.
- [x] **Chats list:** country tabs, All / Unread / Needs reply, "Waiting 2h" badges, grouping by day, search by booking ref.
- [x] **Bookings:** country tabs, live count cards, the same filters as the web page (remembered), and country-locked users see their own country.
- [x] **Booking detail:** country header with trip progress, an at-a-glance strip, a next-movement card. It now **opens even if the status buttons fail**, and searches the ref when the booking isn't found.
- [x] **MC Report:** country tabs, Day / 3 days / Week, driver coverage, 7 filters, call/WhatsApp the driver, edit desk figures, Tickets Control (VN), mark done (SL) and multi-select. Shared summaries **never include the driver rate**.
- [x] **Ops Board** (More): % ready ring, on ground / arriving / departing, D-10 and pending-cancellation alerts. Only Accounts, the VN ground desk and admins can open it.
- [ ] **Deploy `ops.aahaas.com`**. Ops Board says "not enabled" until the bridge change is live.
- [ ] **New EAS build** for attachments (new document picker package).
- [ ] ⚠️ **"Booking not found":** get **one failing ref** from OPS so the real cause can be found (see section 9).
- [ ] Open every rebuilt screen in Expo Go against real data.

## 3. OPS — Activity report matches the invoice report (`b81d793`)

1 file · +68 / −13 — `lib/reports/activity-split.ts`

| 20 Oct 2026 | Invoice report | Ops before | Ops after fix |
|---|---:|---:|---:|
| New + amended same day | 30 (7 + 23) | 46 (7 + 39) | **30** |
| Old amendments | 17 | 9 | **17** |
| Total | 47 | 55 | **47** |

- [x] Cause: 16 revisions on 13 bookings (e.g. `VN42435_R3`, `_R4`) had no base number on the invoice row, so each was counted as a new booking. The booking number is now read from the invoice number, the same way Accounts does it.
- [x] **Checked against live figures for 20 Oct.**
- [ ] Compare one more day (e.g. 21 Oct) after deploy.

## 4. OPS — Daily Trip Briefing default time in Ops Settings (`1512fa1`)

4 files · +133 / −1

- [x] Settings → Operations → **Customer Daily Trip Details**: time box + quick buttons (07:00–20:00), **Automatic daily send** on/off, a note on which day's plan is sent (before 12:00 → today).
- [x] Same default the booking page shows. Checked every 5 min, so no restart is needed. Guest's local time. Bookings with their own time or Off keep it. The server now **rejects invalid times**.
- [x] "Change default time" on the booking page opens this card (Super Admin / Ultra Super Admin only). TE users still use AI Call Bot → WhatsApp.
- [ ] ⚠️ Still open from 19 Oct: **find what calls `/api/cron/customer-daily-briefing` on Amplify** (every 5–10 min). Without it nothing is sent.

## 5. Driver app — More test trips for Sadun (`9924adb`)

5 files · +322 / −5 (includes the 20 Oct daily update file)

- [x] `sandun@mail.com` now gets **14 test trips, 3 of them today**. The Today screen lists the extra trips under **"also today"**.
- [x] Still created in code only: no bookings or OPS records; writes go only to the app's `mobile_*` trip tables. Checked offline with a fake database.
- [ ] Goes live with the next `ops.aahaas.com` deploy. Then sign in as Sadun and follow the phone test plan (20 Oct update, section 3).

## 6. Accounts — B2C guest name in the Daily Invoice Report (`f0ec6b5`, `6bcb055`)

`InvoiceReportService.php` + test (+160 / −5) · `B2cLeadProbe.php`, `B2cCustomerNames.php` (+270 / −1)

- [x] Email table and Excel attachment show the guest (AahaasFlow's order: Confirm panel → payment link → AahaasFlow booking row → travellers). Only `admin6611`-style rows are looked up. Saved invoices are not changed. If the lookup fails, the saved name is printed as before.
- [x] Traveller column shows the lead passenger when there's no traveller list. The customer count no longer treats all `admin6611` orders as one customer.
- [x] Live output showed every known source is **empty for AHS-15453 and AHS-15455**. Added **`php artisan b2c:lead-probe 15453 15455`**: SELECT only, 5 s per query, max 5 rows per table, indexed tables only.
- [x] `b2c:customer-names` has a separate "Payment link / Flow" column.
- [ ] **Run `b2c:lead-probe 15453 15455` on the Accounts server** and send the output. Then point the report at the right place.
- [ ] Still open: `b2c:customer-names --stand-ins` on live → review → decide on `--apply`; `scripts/b2c-fix-lead-names.ts` on OPS.

## 7. Accounts — Mail Scanner (`0fab982`)

19 files · +3,859 / −2 — `/mail-scanner`, under Bookings

- [x] Pick a date range + tags (e.g. Cancellation). It reads mail subject and body through Graph and gives **one row per booking** with file number and arrival date.
- [x] **Rules first** (0–100 score per tag, only the newest part of a reply, policy boilerplate ignored). AI modes: **Off / Smart (default, gpt-4o-mini on borderline mails only, cached) / Strict**. AI file numbers or dates are dropped unless they appear word-for-word in the mail.
- [x] Checks against the system (read-only): arrival date mismatch, cancelled by mail but still active, not found, no file number, mail sent after arrival.
- [x] Live scan with progress, Stop and resume. Charts, booking table, mail viewer with highlights. **Excel** (summary, per tag, Needs Review, register, method) and a **PDF** report.
- [x] Tested on the Mac with an in-memory DB, fake mailbox and faked AI. The PDF renders.
- [ ] `php artisan migrate` on the Accounts server (`2026_10_21_120000_create_mail_scan_tables`).
- [ ] Give the page to the right roles (`config/access.php`). Check that the Graph app can read the mailbox.
- [ ] Run one real scan (e.g. 1 Jul → 1 Oct, Cancellation) in **Off** mode first, then Smart, and spot-check 10 rows.

## 8. Online Work — Halloween advert v2 and CCTV notice (`388cca2`, `cc4f8e6`)

Halloween 5 files · +410 / −126 · CCTV 3 files · +456 / −3

- [x] `/ad/1` Halloween: **120 s**, **6:00 PM** everywhere, a full-screen live countdown (blood moon + tombstones), a haunted door opening, a jack-o'-lantern jump-scare, a darker mood, and new music. Countdown checked in Chrome at TV size (9 d 1 h 33 m to Fri 30 Oct, 6:00 PM).
- [x] `/ad/2` **CCTV Recording Notice** ("cameras and voice are recorded across the office").
- [x] Office TV board now shows only **one office** (default Sri Lanka). `TV_OFFICE=<code>` picks another; `TV_OFFICE=all` shows everyone.
- [ ] **Deploy Online Work** (`infra/DEPLOY.md`: pull, `npm install` (Sharp), `npm run build`, restart `aahaas-online-work`). This also ships the 20 Oct employee page change.
- [ ] Watch the full 120 s loop **with sound** on the office TV, and open `/ad/2`.
- [ ] Check the TV board still shows everyone expected in Colombo after the `TV_OFFICE` change.

## 9. Not committed

**OPS** — `lib/mobile/bridge.ts`, `api/mobile/web/[...path]/route.ts` (+34 / −3)

- [x] `bridgeOrigin(req)` now forwards to **the same deployment the app called**, instead of an env URL that may point at another host or database. This is the likely cause of "Booking not found": the home screen and detail page read different databases. The host is allow-listed (`*.aahaas.com` or env hosts) so a forged Host header can't redirect sessions. The response has an `x-aahaas-bridge` header showing which host answered.
- [ ] Type-check, commit, deploy. Then reopen a booking that failed and check `x-aahaas-bridge`.

**Accounts** — `ImportTicketRateSheet.php` + `Sample files/Supplier /malaysia and singapore tickets final.xlsx`

- [x] `php artisan suppliers:import-ticket-rates` adds the missing MY/SG attractions from the ticketing rate sheet to Suppliers Manage. It's a dry run by default with a CSV plan. Insert-only, with similar names held back for review. Portals use the registry spelling (TVG → Travel Vago, GT → Global Tix). `--apply` is journalled and `--revert=<batch>` undoes it.
- [ ] Run the dry run, review the CSV plan with the ticketing team, then commit. Decide whether the sample Excel should be in Git.

---

## Still to do today

- [ ] Commit the OPS bridge fix and the Accounts ticket-rate command.
- [ ] Deploy `ops.aahaas.com` (Ops Board, bridge fix, Sadun's test trips, supplier picker code).
- [ ] Run `apply-transport-suppliers.sh --check` on dev.
- [ ] Write the **21 Oct daily update** (and the missing **17 and 19 Oct** ones).

## Carried over

1. **Driver app (Aahaas CORE):** upload the versionCode 4 `.aab` to Closed testing → Alpha, finish the dashboard tasks (Location permissions + video link), **Send app for review**. Upload the 512 icon. Decide on the splash screen. A new build (versionCode 5) is needed for the 20–21 Oct redesign and attachments.
2. **Test driver account:** run `apply-driver-app.sh` on live if needed, make sure someone receives Sadun's sign-in code, do a real drive and **compare km with the odometer**.
3. **From 19 Oct:**
   * AppleSystem Sync preview on dev (IS49403);
   * check "Settle from Aahaas" on one real MYR order;
   * one package-notes WhatsApp document and `/print/booking/IS49242`;
   * **Trans-Reconsultation:** `apply-trans-recon.sh --check` then run it; grant the page to Accounts roles; generate Malaysia 16–30 Sep and import the desk Excel;
   * SharePoint archive: `php artisan migrate`, settings, upload one report.
4. **Marketing Arena Leaders Dashboard:** run against the real database, then deploy to `ai.aahaas.com`.
5. **B2C Update Booking (OPS + Accounts):** `b2c_order_versions` migration, matching secrets/URLs, test on 15077.
6. **Decide:** *highest version + 1* fix for OPS email / OneDrive versioning.
7. ⚠️ **Security:** rotate the exposed **OpenAI key** (`LIVE_ENV.md`) and other secrets. The key was used again for the 20–21 Oct images, and Mail Scanner Smart mode will also use OpenAI. Remove `ssh-keys/developer_key` and the door bridge token from Git history.
8. ⚠️ **Accounts server load:** kill long `pnl_records` queries, apply the *Low-load preset*, check `crontab -l` / `pm2 list`.
9. **Older items:** mobile app go-live, Online Work + nginx deploy, Accounts INR invoice migration, `GRAPH_MAIL_CLIENT_SECRET`, pending OPS and Bank Settlements scripts.
