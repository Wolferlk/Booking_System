# Daily Task List — 19 October 2026 (Monday)

**Owner:** Sasindu Diluranga
**Date:** 19 October 2026
**Written:** 19 October 2026, 18:20, from git history and working-tree status

| Project | Branch | Work on 19 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 7 commits (`69ecc29`, `0ccc3c7`, `c50c539`, `4c253e7`, `e55318f`, `6642e5b`, `b36d2fc`) · clean · up to date with origin |
| Accounts System | `REV1` | 7 commits (`ddf2dfe`, `f7e4345`, `a6d046a`, `9e0a494`, `54638bf`, `0bd65e7`, `0031942`) · clean · up to date with origin |
| Aahaas Online Work | `main` | No commits · clean |
| n8n / Marketing Arena | `AIImproved-V5` | No commits · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> Everything below is committed and pushed. **Nothing is confirmed as deployed**, and most of it has only been checked with type-check / lint / offline tests — **not in a browser or against the real database.**

## What was done

1. **OPS + Accounts:** B2C bookings booked on the `admin6611` login now show the **real guest's name, email and phone** (from the payment link and AahaasFlow), not the login.
2. **OPS:** AppleSystem **Sync preview with tick boxes** (carried from 17 Oct) committed.
3. **Accounts:** B2C **charged → booked** check per order (charged currency, rate, USD), new AahaasFlow-style B2C invoice, and "Settle from Aahaas" uses the order's rate.
4. **OPS:** WhatsApp / email booking **PDF, Word and print page include all package notes**.
5. **OPS + Accounts:** new **Trans-Reconsultation** sheets (MC → transport cost check against P&L, approved by Accounts), with **Excel import**, DETAILS → P&L matching, and a **P&L picker** that also reads the Accounts P&L.
6. **OPS:** Daily Trip Briefing — **default send time**, per-booking override, and guide / tour vendor / driver in the message.
7. **Accounts:** **SharePoint archive** for report files (new table + admin page).

---

## 1. B2C guest name instead of `admin6611` (OPS `69ecc29`, Accounts `ddf2dfe`)

OPS 11 files · +1,192 / −196 (includes the AS sync preview) · Accounts 7 files · +412 / −32

- [x] OPS: new `b2c-confirmed-lead.ts` picks the guest in AahaasFlow's order; never accepts a login-like name or the account name.
- [x] OPS: on `admin6611` orders the booking's contact email/phone become the guest's. Importer, per-booking Sync and `b2c-fix-lead-names.ts` only rename a lead still named after the login.
- [x] Accounts: `B2cLeadSourceService` — invoice modal, payments panel, invoice body and P&L modal show the guest.
- [x] Accounts: `php artisan b2c:customer-names --stand-ins` lists P&L rows still named after a login; `--apply` renames only those (logged, figures untouched).
- [ ] Run `--stand-ins` on live, review the list, then decide on `--apply`.
- [ ] Run `scripts/b2c-fix-lead-names.ts` on OPS after deploy.

## 2. OPS — AppleSystem Sync preview (`69ecc29`)

`as-sync/route.ts`, `as-booking-sync.ts`, `applesystem-actions.tsx`

- [x] Committed (was uncommitted on 17 Oct). Preview writes nothing; only ticked fields/sections are applied; stale preview → 409.
- [ ] Try on dev with **IS49403** and a booking with field-edit conflicts.

## 3. Accounts — B2C charged → booked check and new invoice (`f7e4345`)

11 files · +658 / −5

- [x] Rate is taken from the order: store checkout rate → effective charged rate (with note) → today's rate as "reference only" for refunded/cancelled orders.
- [x] Shared panel in both modals, e.g. *Charged MYR 16,327.00 ÷ 4.1610 = USD 3,923.86 ✓*. Storefront amounts now show their currency.
- [x] New B2C invoice (MYR + USD per line, totals and balance in both), fits one A4 page via DomPDF.
- [ ] ⚠️ "Settle from Aahaas" now converts MYR at the **order's rate** — suggested amounts change for non-USD orders. Check one real MYR order.

## 4. OPS — Package notes in PDF / Word / print (`0ccc3c7`)

4 files · +54 / −40

- [x] All ten note sections (Value Added Services … Client Request) on a new page at the end; empty ones skipped. One list in `booking-package-notes.ts`.
- [x] Covers every send path (confirmation, full details, QC auto-sends, manual WhatsApp, agent/ops emails), Word version, and `/print/booking/[ref]` (checkbox per section).
- [ ] Send one real WhatsApp document on dev and open `/print/booking/IS49242` in a browser.

## 5. Trans-Reconsultation — OPS sheets + Accounts approval

OPS `c50c539` (22 files · +3,113), `4c253e7` (13 files · +1,429), `e55318f`, `b36d2fc` · Accounts `9e0a494`, `54638bf`, `0bd65e7`, `0031942`

- [x] **OPS board** `/dashboard/trans-reconsultation`: per country (MY, SG, VN, SL) two half-month sheets, "Generate from MC", P&L pairing with confidence %, rates like `100+58 DNR` = 158, Refresh from MC never overwrites typed fields, Report tab + Excel export, Send to Accounts.
- [x] **Excel import** with preview: finds header row, fills merged cells, detects country/period, pairs rows to MC (29/29 correct on the Malaysia sample, offline). OpenAI only for unknown headers or "Ask AI to pair".
- [x] **DETAILS → P&L description** on import (overrides auto guesses, never a hand pick).
- [x] **P&L picker** per line: best 3 fits, OPS P&L + Accounts P&L lists, or type one; share one P&L line across several movements (split by rate). "Pair N from Accounts P&L" and "use today's 4.xx" FX button.
- [x] **Accounts** Payable → Trans-Reconsultation: approve / not-approve (with reason), bulk and tolerance approve, note to OPS, lock, export. Writes only approval and lock fields.
- [x] Fixed: sheet sent to Accounts but not shown (script loaded before jQuery); added "Waiting on Accounts" strip.
- [ ] **Create the tables:** `bash prisma/sql/apply-trans-recon.sh --check` from `apple-holidays/`, then run it (adds two tables only). Until then both pages show "not set up".
- [ ] Grant the **Trans-Reconsultation** page to Accounts roles (under Payable).
- [ ] Generate the **Malaysia 16–30 Sep** sheet on real data, import the desk Excel, check the pairings and differences before relying on them.
- [ ] Confirm MY40086 / MY40087 now pick up their Accounts P&L lines; save an FX rate and check line 14458 (40.30 USD).
- [ ] Pre-existing ESLint error in the agenda route (line 205, missing rule plugin) — not from today.

## 6. OPS — Daily Trip Briefing send time (`6642e5b`)

9 files · +455 / −114

- [x] TE → AI Call Bot → WhatsApp Auto: **Default send time** (18:00).
- [x] Per booking: Default / own time / off. Saved as settings rows — no DB change.
- [x] Message now has guide, tour vendor and driver (names and phones only, never rates). Checked offline with VN42032.
- [x] Time is local per country (before, everyone got 18:00 Vietnam time — SL guests got it at 16:30). Before 12:00 sends today's plan, 12:00+ sends tomorrow's.
- [ ] ⚠️ **Scheduler on live:** `/api/cron/customer-daily-briefing` must be called **every 5–10 min**. `vercel.json` changed, but Amplify doesn't read it — check what actually calls it.
- [ ] Guide names go out as typed (e.g. "Phuong Nam - Hanoi driver's manager") — tell OPS to clean the movement chart names.

## 7. Accounts — SharePoint report archive (`a6d046a`)

15 files · +2,174 / −5

- [x] `SharePointArchiveClient`, `report_archive_files` migration, admin page for settings and file status.
- [ ] `php artisan migrate` on the Accounts server, set the SharePoint settings, and upload one report to test.

---

## Still to do today

- [ ] Run `apply-trans-recon.sh` on dev and open both Trans-Reconsultation pages in a browser.
- [ ] Write the **19 Oct daily update** (and the missing **17 Oct** one).

## Carried over

1. **Online Work (17 Oct):** deploy (`npm install` needed — Sharp added 16 Oct); check office = face/fingerprint, paged HRMS performance API (< ~75 s per page), Shift / WorkAgent / Biometric columns against live data; tell Hari the API is paged (`hasMore`).
2. **Marketing Arena Leaders Dashboard:** run against the real database, then deploy to `ai.aahaas.com`.
3. **B2C Update Booking (OPS + Accounts):** `php artisan migrate` (`b2c_order_versions`); confirm `ACCOUNTS_INTEGRATION_SECRET` = `OPS_INTEGRATION_SECRET` / `OPS_REPAIR_SECRET` and `ACCOUNTS_APP_URL` / `OPS_BASE_URL`; check the B2C revision email setting; test on dev, then open **15077**.
4. **Decide:** *highest version + 1* fix for OPS email / OneDrive versioning.
5. **OPS on dev:** Report Studio, GT_VN_USER WhatsApp inbox and mini chat, view2 takeovers.
6. **Online Work on the office TV:** call to room, notices, Board Room call, farewell show.
7. ⚠️ **Security:** rotate the exposed **OpenAI key** (`LIVE_ENV.md`) and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
8. ⚠️ **Accounts server load:** kill long `pnl_records` queries, apply the *Low-load preset*, check `crontab -l` / `pm2 list`.
9. **Older items:** mobile app go-live, Online Work + nginx deploy, Accounts INR invoice migration, `GRAPH_MAIL_CLIENT_SECRET`, pending OPS and Bank Settlements scripts.
