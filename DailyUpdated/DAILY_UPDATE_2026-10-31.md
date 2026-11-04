# Daily Work Update — 31 October 2026 (Saturday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 31 Oct 2026 (Accounts: new Payable 1.3 — VN Packages split by rate sheet; real product names instead of "Attraction #5770"; ERP Missing Products tab, sheet re-read 4× a day and a daily 8am missing-products email)

---

## Executive Summary

**Accounts — Vietnam package payables:**
* **New Payable 1.3 — VN Packages** (`/payables/v13`): each Vietnam package line is split into **tickets, meals, guides and transport** using the package rate sheet. The split always adds back to the P&L line exactly. Example: 4-pax Coconut Forest **124.96 → ticket 22.00 + guide 35.00 + transport 67.96**.
* **Sheet doctor** found **errors in the rate workbook** (rows 2, 15, 19, 33, 68). These need fixing by whoever owns the sheet. Fixes are only suggested, never applied.
* **Real product names** on 1.3 instead of placeholders like "Attraction #5770".

**Accounts — Missing products:**
* New **"ERP Missing Products"** tab in the rate workbook: products on bookings arriving in the next 15 days that aren't on the sheet.
* Sheet now **re-read every 6 hours**.
* **Daily 8am email** of missing products to the VN desk. ⚠️ **It won't start by itself:** after deploy, press **Save & start**.

| Project | Commits on 31 Oct | Branch | Worktree / remote |
|---|---:|---|---|
| Accounts System | 3 commits | `Master-Live` | Pushed · clean |
| Booking System / OPS | — | `Master-Dev` | No work |
| Aahaas Online Work | — | `main` | No work |

> **About the commit messages:** they say *"Nothing is committed or deployed"*. That was true when they were written. **All 3 commits are now pushed to `Master-Live`.** **Nothing is deployed.** Tested with the real rate sheet (downloaded read-only from SharePoint) and made-up sample lines. **Not tested against the live database. No real sheet write or email send yet.**

---

## 1. Payable 1.3 — VN Packages

`7b3e5a8` · 13 files · +2,557 / −2 — `PackageRateBook.php`, `PackageSplitter.php`, `PayableV13Controller.php`, `payables/v13/index.blade.php`, `FetchPackageRates` command

**Where:** `/payables/v13`, next to Payable 1.0 and 1.1 in the Vietnam board switch and the sidebar.

**How it works**
* Reads the same Vietnam lines Payable 1.0 shows, by arrival or activity date, with the same **D-0…D-8** window.
* Finds each line's package row by **Apple product id**, looking first in the booking's own agent column (**30 Sundays / MMT / Small & Medium**). If the id isn't on the sheet, it falls back to the product name.
* Looks up the package's **Merge IDs** (e.g. "2,3,5") and prices each part the way the sheet does: per person × pax for tickets and meals, one figure per group for guides.
* **Whatever is left goes to Transport**, so each split always adds back to the P&L line exactly.

**What the real sheet showed**
* The 2…10 pax columns are the per-person transport rate, with the parts charged on top. The exception is rows marked **Inclusive = yes**, where the rate already includes the parts.
* Each split shows **"sheet's own rate gives X"** next to the transport figure, so a line sold off the sheet stands out. Ninh Binh at 2 pax matches to the cent.
* A package that lists its own ID (row 2 → "2,3,5", row 15 → "15") is read as its own transport.

**On the page**
* A bar showing each line's parts against its P&L amount, plus money by section across the board.
* Status filters: **Split / Needs attention / Not on sheet / Hotels & meals**.
* Section tabs, card view, flat list and a **3-tab Excel export**.
* Rate-sheet drawer with **Packages, Sheet doctor, All rows, Settings** tabs.

⚠️ **Rate workbook rows to fix (from Sheet doctor):**

| Row | Problem |
|---|---|
| 2 | Never includes the Marble Mountain ticket (#4), so its cost lands in transport |
| 33 | Points at #35 (Ninh Binh package). Probably meant #34 (Water Puppet ticket) |
| 15 | Probably missing #14 |
| 68 | Probably missing #64 |
| 19 | Mekong ticket has no price |

* **"Full-day City Tour + … Sen Tai Thu"** isn't on the sheet. It shows as "Not on sheet" with the closest rows suggested, and stays one payable.

**Checked:** every PHP file and view compiles. Tested against the real rate sheet with sample lines. **Not run on real bookings.**

---

## 2. Payable 1.3 — Real product names

`5a1ae4d` · 3 files · +144 / −4

* **Problem:** some lines showed **"Attraction #5770"** instead of the product name.
* **Cause:** the builder behind Payable 1.0 makes product lines without the booking's itinerary. When the Apple System name cache doesn't know an id, it prints the placeholder.
* **Why the shared builder was left alone:** the line name is part of Payable 1.0's **payment-ledger key**. Changing it could detach existing payments from their lines.
* **Fix (1.3 only, display only, read-only):** for each placeholder, 1.3 uses the first name it finds in:
  1. the booking's own itinerary (the same way the Detailed P&L names its rows, so both pages match);
  2. the package rate sheet's three Apple id columns;
  3. the VN nett-rate workbook in use;
  4. a name already recorded on the missing-products list.

---

## 3. ERP Missing Products tab, 4× daily sheet fetch, 8am email

`3d34725` · 12 files · +785 — `PackageSheetWriter.php`, `VnPackageMissingReportSource.php`, `vn-package-missing-report.blade.php`

**"ERP Missing Products" tab (same Excel file)**
* Lists **products** (lines with an Apple product number) on bookings arriving in the **next 15 days** (today + 14) that aren't on the rate sheet. Hotels and free-text charges are left out.
* Each row: Apple number, name, agent column, number of bookings and IS numbers, first and last arrival, pax, P&L rate seen, and the closest row already on the sheet. Soonest arrival first.
* **Safety:** the system only ever writes that one tab, and only **columns A–L**. It never renames, deletes or edits any other tab. The sheet reader ignores the tab by name, so nothing written there can be read back as a rate.
* Written from **Rate sheet → Missing from sheet → Write to the sheet tab** (super-admin only, asks for confirmation). The same pane shows the list on screen and exports CSV.

**Sheet fetch 4 times a day**
* Re-read every 6 hours (**00:00, 06:00, 12:00, 18:00**). If SharePoint says the file hasn't changed, nothing is written.
* Shown as a job on **Administration → Server Load**, where it can be re-timed or stopped.

**Daily 8am email**
* Runs on the existing **Auto Reports** engine, so run history, retries and SharePoint backup work as for other reports.
* Each run: re-read the sheet → find missing products → update the tab → email the list in the body, with an Excel attachment and a link to the workbook.
* The re-read happens just before the list is built, so a product added that morning isn't reported as missing.
* If SharePoint can't be read or written, the mail still goes and says what failed.
* Recipients, CC, send time, arrival window and on/off are under **Rate sheet → Daily mail** (super-admin only). Pre-filled with **kayalvizhi@aahaas.com** and **thangaraj.yogadharshini@aahaas.com** at **08:00 Sri Lanka time**.
* By default it sends even when nothing is missing ("nothing to add today"). Tick **"Don't send when nothing is missing"** to keep it quiet.
* ⚠️ **It won't start by itself.** After deploy, open that pane and press **Save & start**. Saving sends nothing. The first mail goes at the next 08:00.

**Checked:** offline with sample data (tab layout exactly A–L, Excel attachment, full and empty email). On a throwaway in-memory database, saving the schedule gave next run **01/11 08:00** and bad input was refused. Confirmed the new tab can't be read as rates. **Not tested:** the real workbook write and a real email send.

---

## 4. Pending actions / Next steps

| # | Action | Owner / where |
|---|---|---|
| 1 | **Deploy Accounts** from `Master-Live` (Payable 1.3, names fix, missing products + 8am mail) | Accounts server |
| 2 | Open **Rate sheet → Daily mail** and press **Save & start** | Accounts → `/payables/v13` |
| 3 | Press **Write to the sheet tab** once and check the workbook | Accounts → `/payables/v13` |
| 4 | Check Payable 1.3 splits against real bookings | Accounts |
| 5 | Fix rate-sheet rows 2, 15, 19, 33, 68 | Rate sheet owner |
| 6 | Add "Full-day City Tour + … Sen Tai Thu" to the sheet, or confirm it stays one payable | VN desk |
| 7 | Decide whether the 8am mail should send when nothing is missing | VN desk |
| 8 | Commit or drop the **HRMS** 502 retry change (`onlineWorkPerformance.service.js`), uncommitted since 27 Oct | HRMS |

Items carried over from 21–30 Oct are listed in [DAILY_TASK_LIST_2026-10-31.md](DAILY_TASK_LIST_2026-10-31.md).
