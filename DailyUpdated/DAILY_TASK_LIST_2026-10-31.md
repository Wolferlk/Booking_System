# Daily Task List — 31 October 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 31 October 2026
**Written:** 31 October 2026, 16:00, from git history and working-tree status

| Project | Branch | Work on 31 Oct |
|---|---|---|
| Accounts System | `Master-Live` | 3 commits (`7b3e5a8`, `5a1ae4d`, `3d34725`) · pushed · clean |
| Booking System / OPS | `Master-Dev` | No work · clean apart from the new daily task lists (`LIVE-1.0.0v` still 2 commits ahead) |
| Aahaas Online Work | `main` | No work · clean |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Tested with the real rate sheet (downloaded read-only) and sample lines, **not against the live database, and no real sheet write or email send.**

## What was done

1. **Accounts:** new **Payable 1.3 — VN Packages** (`/payables/v13`): splits each Vietnam package line into tickets, meals, guides and transport using the package rate sheet.
2. **Accounts:** Payable 1.3 shows **real product names** instead of "Attraction #5770".
3. **Accounts:** **ERP Missing Products** tab in the rate sheet, the sheet re-read **4 times a day**, and a **daily 8am email** of missing products.

---

## 1. Payable 1.3 — VN Packages (`7b3e5a8`)

13 files · +2,557 / −2

- [x] Next to Payable 1.0 and 1.1 in the Vietnam board switch and sidebar. Reads the same Vietnam lines as 1.0 (arrival/activity date, D-0…D-8 window).
- [x] Finds each line's package by Apple product id in the booking's agent column (30 Sundays / MMT / Small & Medium), falling back to product name.
- [x] Prices each Merge ID part the way the sheet does (per person × pax for tickets and meals, per group for guides). The rest goes to **Transport**, so the split always adds back to the P&L line. Example: 4-pax Coconut Forest 124.96 → ticket 22.00 + guide 35.00 + transport 67.96.
- [x] Shows "sheet's own rate gives X" beside transport so off-sheet pricing stands out; handles `Inclusive = yes` rows. Ninh Binh at 2 pax matches to the cent.
- [x] Page: parts-vs-P&L bars, money by section, status filters (Split / Needs attention / Not on sheet / Hotels & meals), section tabs, card and list views, 3-tab Excel export, and a rate-sheet drawer (Packages, Sheet doctor, All rows, Settings).
- [x] **Sheet doctor** lists suspected workbook errors; fixes are only suggested, never applied.
- [ ] **Fix in the workbook:** row 2 missing Marble Mountain ticket (#4); row 33 points at #35 (Ninh Binh), probably meant #34 (Water Puppet); row 15 probably missing #14, row 68 #64; row 19 (Mekong ticket) has no price.
- [ ] "Full-day City Tour + … Sen Tai Thu" isn't on the sheet. Add it or confirm it stays one payable.
- [ ] Check 1.3 against real bookings after deploy.

## 2. Payable 1.3 — real product names (`5a1ae4d`)

3 files · +144 / −4

- [x] **Cause:** the shared builder behind Payable 1.0 builds lines without the itinerary, so unknown ids print "Attraction #5770". Left alone because the line name is part of Payable 1.0's payment-ledger key.
- [x] 1.3 only, display only: name taken from the booking itinerary (same as Detailed P&L), then the package rate sheet's Apple id columns, then the VN nett-rate workbook, then the missing-products list.

## 3. ERP Missing Products tab, 4× daily fetch, 8am email (`3d34725`)

12 files · +785

- [x] **"ERP Missing Products" tab:** products (with an Apple number) on bookings arriving in the next 15 days that aren't on the rate sheet, with bookings, IS numbers, arrivals, pax, P&L rate and closest sheet row. Only that tab, columns A–L, is ever written; the sheet reader ignores it by name.
- [x] Written from **Rate sheet → Missing from sheet → Write to the sheet tab** (super-admin, confirmation first); also shown on screen and exported as CSV.
- [x] **Sheet re-read every 6 hours** (00:00, 06:00, 12:00, 18:00); skipped if SharePoint says unchanged. Listed on **Administration → Server Load**.
- [x] **Daily 8am email** on the Auto Reports engine: re-read sheet → find missing → update the tab → email with Excel attachment and workbook link. Still sends if SharePoint fails, saying what failed.
- [x] Recipients pre-filled: kayalvizhi@aahaas.com and thangaraj.yogadharshini@aahaas.com at 08:00 Sri Lanka time. Sends a "nothing to add today" mail unless "Don't send when nothing is missing" is ticked.
- [x] Tested offline (tab layout, attachment, full and empty email) and on an in-memory database (next run 01/11 08:00, bad input refused).
- [ ] After deploy, press **Write to the sheet tab** once and check the workbook.
- [ ] Open **Rate sheet → Daily mail** and press **Save & start** (it won't start by itself).
- [ ] Decide whether to send the mail when nothing is missing.

---

## Still to do today

- [ ] Deploy Accounts (Payable 1.3, names fix, missing products + 8am mail) and press **Save & start** before Sunday 08:00.
- [ ] Pass the Sheet doctor row fixes to whoever owns the rate sheet.
- [ ] Commit or drop the **HRMS** 502 retry change (`onlineWorkPerformance.service.js`: 10 s retry delay, skip fresh lists on restart), uncommitted since 27 Oct.
- [ ] Write the **31 Oct daily update**.

## Carried over

1. **From 30 Oct (Online Work):** check whether the Halloween items (Play now, ad, vampire screen) were deployed and used; tell HR the attendance % will change, then deploy and export one real period; check the nginx password on `/ad/bat`.
2. **From 29 Oct:** PR `LIVE-1.0.0v` → `Master-Dev` (`de5d8ab`, `c542dd6`); deploy OPS and AahaasFlow with the shared service key; run the B2C contact script for older bookings; check 14784; open IT spend dates in a browser; deploy Accounts P&L report fix and check VN 42725 / VN42951.
3. **From 28 Oct:** deploy OPS (flight import, Aahaas Order card, Print tickets, report fix); Update Booking on 15679; print one test ticket sheet; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; deploy Accounts auto B2C invoices.
4. **From 27 Oct:** B2C Sales Report, AI Call Report, Online Work (asiacharm, Asset Management, IT spend, 502 fix); `pnl_date_overrides` migration; B2B quote pipeline decision; asiacharm spelling; 7 calls stuck mid-dial.
5. **From 26 Oct (OPS):** `n8n-project` call server; Travel Quote GPT DB connection and `WHATSAPP_REENGAGE_TEMPLATE`; Operation App build; "Quick call failed".
6. **From 24 Oct:** Meta guest template and VN41510 message; `biometric_daily_attendance` and `BIOMETRIC_DAILY_SYNC=on`; new biometric API key; biometric UTC fix.
7. **From 21 Oct:** transport supplier tables; Mail Scanner; ticket rate sheet dry run.
8. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
9. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
