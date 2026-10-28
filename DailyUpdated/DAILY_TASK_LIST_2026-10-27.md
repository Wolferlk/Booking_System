# Daily Task List — 27 October 2026 (Tuesday)

**Owner:** Sasindu Diluranga
**Date:** 27 October 2026
**Written:** 27 October 2026, from git history and working-tree status

| Project | Branch | Work on 27 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 6 commits (`a2390f0`, `d042ca4`, `14f9349`, `2291381`, `f9bc5dc`, `5f2ef33`) · pushed · clean |
| Accounts System | `Master-Live` | 2 commits (`984dabc`, `e2b48da`) · pushed · clean |
| Aahaas Online Work | `main` | 7 commits (`d167424`, `d4d02bc`, `5c4cf38`, `bb68cdc`, `1ef12d8`, `4762c02`, `7e3c8c3`) · pushed · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Most of it was checked only with type-check, lint or sample data, **not in a browser or against the real database.**

## What was done

1. **OPS:** **Sales Report** reworked: every amount shows its currency, then the report was changed to **B2C only**.
2. **OPS:** B2C **test orders** get their own section and are left out of every sales figure.
3. **OPS:** fixed **"Preview failed"** on Auto Reports after the B2C-only change.
4. **OPS:** **AI Call Report** fixed (9 → 4,238 calls for Jul–Sep) with new feedback and warnings sections.
5. **Accounts:** **P&L travel-date corrections** (arrival, day, stay, attraction) that survive re-syncs, plus the ERP release guide.
6. **Accounts:** **/pnl/db faster**, with a new loading screen.
7. **Online Work:** **@asiacharm.aahaas.com** emails can register and sign in.
8. **Online Work:** **Asset Management** — dialog scrolling, Issue desk, QR sticker sheets.
9. **Online Work:** new **IT Expense & Subscription Management** module (`/it-spend`) and three rounds of fixes.
10. **Online Work:** cause of the portal **502 errors** found and limited.

---

## 1. Sales Report — currencies, then B2C only (`a2390f0`, `d042ca4`, `14f9349`)

4 files · +166 / −25, then 6 files · +127 / −462

- [x] Explained the "1.3M" tile: **INR 1,347,073**, the INR invoices only among the 41 new B2B invoices on 26 Oct. Other currencies were left out and the tile never said "INR".
- [x] Every amount now shows its currency and full figure, side by side and never converted (e.g. "USD 2,380 + LKR 184,500"). Labels fixed for **Outlook** (solid colours instead of translucent).
- [x] Report changed to **B2C only**: top strip with store orders, store sales value and B2C bookings filed, each against the day before. Sections: Where to look, funnel, B2C store, B2C bookings, then the quote pipeline.
- [x] B2B sources are no longer read. Partner and invoice sheets removed from the Excel file; the AI summary is told never to mention B2B. New alerts when store orders move 20% or more, or there are none.
- [ ] **Decide:** the quote pipeline that was kept is mostly B2B ("Bangalore B2B Team", "Madurai B2B Team"). Remove it if the report must be purely B2C.
- [ ] Run against the real store database after deploy (only sample data so far; email is 71 KB, under Gmail's limit).

## 2. Sales Report — B2C test orders (`2291381`)

4 files · +108 / −23

- [x] An order is a test when it is marked in the existing test-booking register as `AHS-<order id>`. Releasing the mark puts it back in the figures.
- [x] Test orders are out of the order count, sales value, products, categories and the day-before comparison.
- [x] New **Test orders** section (grey TEST tag, who marked it and why), a "2 test excluded" note in the top strip, and a **B2C Test Orders** sheet in Excel and the CSV fallback.
- [x] If the register can't be read, nothing is hidden and the report shows a "Read with care" warning.

## 3. Auto Reports — "Preview failed" fix (`f9bc5dc`)

3 files · +17 / −13

- [x] Cause: the preview still read the B2B fields removed in section 1 ("Cannot read properties of undefined (reading 'length')").
- [x] Preview API now sends B2C data; preview tiles are **B2C orders**, **Test orders (excluded)** and **B2C bookings**; the Sales Report page wording says B2C only.
- [ ] Open the preview on `/dashboard/reports/auto` after deploy.

## 4. AI Call Report — full call counts and feedback (`5f2ef33`)

3 files · +1,251 / −44

- [x] **Why it showed 9:** the call system's API returns at most 500 bookings, so 4,229 of 4,238 calls for 1 Jul – 30 Sep were dropped. The report now reads the call tables directly by date, with no row caps. Read-only, and it falls back to the API path with a "figures may be low" badge if the read fails.
- [x] **Warnings & issues:** every call rated bad or warning, plus alerts, filterable by Reconfirmation / On-tour / Post-tour.
- [x] **Reconfirmation:** confirmed, change requested, special requests, wrong dates/flights/passengers/contact.
- [x] **On-tour:** guest sentiment and bad vs good for hotel, meals, driver and vehicle.
- [x] **Post-tour:** average rating out of 10, NPS, would / would not recommend, not home safely.
- [x] **Operational warnings:** past calls still pending (including 7 stuck mid-dial since August), bookings never reached, reasons for missed or failed calls. Booking table has a Feedback column, 100 rows a page.
- [ ] Check the report, PDF/email and CSV for Jul–Sep after deploy.
- [ ] Look at the 7 calls stuck mid-dial since August.

## 5. Accounts — P&L travel-date corrections + release guide (`984dabc`)

13 files · +2,324 / −8

- [x] In Detailed P&L, staff can correct a booking's **arrival**, one **itinerary day**, one **hotel/cruise stay** or the day an **attraction** falls on, then reset or restore a correction.
- [x] Corrections are kept beside the Apple System data, not written into it, so a nightly re-sync keeps them. Each is an absolute date, so a re-sync can't shift it twice. Dates far from the Apple System's date are refused as typos.
- [x] Reaches the Detailed P&L (sheet, PDF, XLSX), the PNL board's arrival filter and **Payable 1.0** stay dates. **No figure, cost or price is changed.**
- [x] `docs/RELEASES.md`: ERP LIVE **1.2.2V** / DEV **1.2.3V**, version rules, release steps and history.
- [ ] Run the migration on live (`2026_10_27_120000_create_pnl_date_overrides_table`): `php artisan migrate --pretend`, then `php artisan migrate`.
- [ ] Correct one booking's dates on DEV and check the Detailed P&L and Payable 1.0.

## 6. Accounts — faster /pnl/db + loading screen (`e2b48da`)

5 files · +454 / −24

- [x] The cancelled/test booking check was the slowest part: it ran once per cancelled booking ever recorded. It now reads the reference columns once and matches them in PHP. Checked against the old matching on 24 tricky references (`IS 48715`, `VN40170_R2/R2`, `sg40095_r1` …); all agreed.
- [x] Bookings, Sell, Cost and P&L tiles reuse the per-currency totals query instead of a separate full read. No database writes, migrations or schema changes.
- [x] New loading screen: animated chart, the date range (amber over 4 months), five timed steps, a timer with "usually ~6.2s", rotating tips, and a Stay on this page button after a long wait.
- [ ] Time the page on real data after deploy (the live database can't be reached from this Mac).

## 7. Online Work — asiacharm.aahaas.com sign-in (`d167424`)

10 files · +326 / −10

- [x] Allowed domains are now `aahaas.com` and `asiacharm.aahaas.com` for register, sign-in and the help-desk form. The desktop agent's C# API has the same rule.
- [ ] **Confirm the spelling.** The request said `asiacharm.aahass.com`; `asiacharm.aahaas.com` was used.

## 8. Online Work — Asset Management updates (`d4d02bc`)

13 files · +1,177 / −72

- [x] **Dialogs:** fixed header with a scrolling body, Save pinned at the bottom with a live summary, and a "2 to fix ↑" badge for errors.
- [x] **Issue desk** (Assignments tab): search an employee or team, see what they hold and what's missing from their kit, tick free items in their office, hand over in one click and print a handover form. A phone with a SIM brings the SIM along.
- [x] **QR sticker sheets:** pick devices, choose Avery 21 / 24 / 14 / 65 or plain A4, copies per device, start at sticker N, live A4 preview and a printer nudge in 0.5 mm steps.
- [ ] Print one test sheet on the real label paper and check alignment.

## 9. Online Work — IT Expense & Subscription Management (`5c4cf38`, `bb68cdc`, `1ef12d8`, `4762c02`)

26 files · +5,243 / −4, then 13 files · +550 / −163

- [x] New module at **IT spend** (`/it-spend`). Never writes to the live database; records are kept under `.data/it-spend/`. Access by country/office with **View**, **Manage** and **Approve**; an approver can't approve their own payment. Only the **last 4 card digits** are ever stored.
- [x] Services, payments, payment methods, dashboard (weekly, monthly, top 5, next week), payment calendar, 12-month forecast, card exposure, alerts, savings, KPIs, price history, activity log and a 7-sheet Excel export.
- [x] **Fixes:** Edit button no longer closes straight away (`modal.tsx`). Payments take one **tax-included total**, today's exchange rate is looked up automatically, and invoice no., due date and period are filled in, with a warning if that period is already paid.
- [x] Usage, top-up and one-time services need no price. All prices are tax-included totals (forecast no longer adds tax twice).
- [x] New **card statement** (12-month chart, waiting payments, history by month) and **paid payments on the calendar** with a "Show paid" switch.
- [ ] The automatic rate uses `open.er-api.com`, so the live server needs internet access (otherwise it falls back to the saved rate).
- [ ] Open the module in a browser; it hasn't been started yet because that would also start the scheduled jobs.

## 10. Online Work — portal 502 errors (`7e3c8c3`)

1 file · +27 / −1

- [x] The portal didn't crash. **PM2** restarted it when it ran out of memory, and nginx returned **502 Bad Gateway** until it came back. The repeated "Online Work performance API error: 502" lines in HRMS are HRMS calling the portal during those restarts.
- [x] Cause: HRMS refreshes the 7, 14 and 30-day performance lists and retries on failure, and the mailbox reads stacked up. All list requests now share one concurrency limit (`employee-performance-api.ts`).
- [ ] Deploy and check that HRMS stops logging 502 errors and PM2 stops restarting the portal.

---

## Still to do today

- [ ] Deploy `ops.aahaas.com` (Sales Report, test orders, preview fix, AI Call Report, plus the 26 Oct changes).
- [ ] Deploy Online Work (asiacharm sign-in, Asset Management, IT spend, 502 fix).
- [ ] Run the `pnl_date_overrides` migration and deploy Accounts.
- [ ] Write the **27 Oct daily update**.

## Carried over

1. **From 26 Oct (OPS):** deploy the traveller-experience call server (`n8n-project`) before the ops app; set the Travel Quote GPT DB connection (`WA_SHARED_DB_*` or `SALES_CRM_DB_*`) and `WHATSAPP_REENGAGE_TEMPLATE`; build a new Operation App for the alert tones and test it on a phone; find the root cause of "Quick call failed".
2. **From 24 Oct:** register the guest message template with Meta and send the queued VN41510 message; create `biometric_daily_attendance` on live and set `BIOMETRIC_DAILY_SYNC=on`; share a new biometric API key; deploy the biometric UTC timestamp fix.
3. **From 21 Oct:** create the transport supplier tables (`apply-transport-suppliers.sh --check`); Mail Scanner migration and first real scan; ticket rate sheet dry run.
4. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
5. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
