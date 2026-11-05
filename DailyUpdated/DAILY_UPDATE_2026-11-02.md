# Daily Work Update — 2 November 2026 (Monday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 2 Nov 2026 (B2C store amendments handled end to end in OPS and Accounts; monthly report: Guest Voice, AI outlook and corrected store-order counts; Apple imports create tickets automatically; WhatsApp Retry failed + Report; Payable 2.2VN Sync now; Online Work: roster Excel/Email/AI plan and leave approvers)

---

## Executive Summary

**B2C store amendments (OPS + Accounts):**
* **One booking, not two:** when the store replaces an order (e.g. **#15833 amends #15726**), OPS keeps booking 15726 and saves the new order as **version 2**. Accounts keeps one P&L row and raises invoice revision **AHS-15726R2**, so payments already received carry across.
* **Applied automatically in OPS:** OPS runs Update Booking by itself and shows **"UPDATED BOOKING — ATTENTION PLEASE"** on the booking, plus a blinking **"N updated bookings"** chip in the header. Only for bookings first sold on an earlier day. Same-day corrections are applied quietly.
* **Accounts needs one new table:** migration `2026_11_02_120000_create_b2c_order_amendments_table`.

**OPS — Monthly Business Review:**
* **Store orders counted correctly:** split into **B2B Packages / B2B Flights / B2C** using AahaasFlow's rule and counted by booking date. This fixes October's **313 B2C orders (+469%)**, which included agency orders and old orders imported late.
* **New sections:** Guest Voice (AI calls, feedback forms, desk ratings) and an **Outlook** written with OpenAI: 2-month booking forecast, complaint fixes, growth ideas.
* **Clean-up asked for today:** Prev / In OPS columns and the "Imported into OPS this month" block removed. First tile renamed **"This month new & updated"**.

**OPS — Other:**
* **Apple API imports create tickets automatically** (draft tickets from the quote's P&L). Tested offline on **VN42614**.
* **WhatsApp inbox:** new **Retry failed** and **Report** buttons. ⚠️ Most of today's failures are probably **Meta billing block (error 131042)** since 1 Nov. Fix the payment in Meta Business Manager first.

**Accounts:** **Sync now** button on Payable 2.2VN (asks OPS to re-read the checklist workbook straight away).

**Online Work:** roster **Download Excel / ✉ Email / ✦ Plan with AI**, fix for Excel "file is damaged" on departments with "&", 502 server-config fixes, and **mandatory leave approver** with a per-person "keep informed" list.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 10 commits | `LIVE-1.0.0v` | Pushed · clean |
| Accounts System | 2 commits | `Master-Live` | Pushed · clean |
| Aahaas Online Work | 4 commits | `main` | Pushed · clean |

> **About the commit messages:** several say *"Nothing is committed or deployed"*. That was true when they were written. **Every commit listed here is now pushed.** **Nothing has been deployed.** All three systems need a redeploy before any of this is live. Most changes were checked only with type-check, lint and build, because the live databases can't be reached from this Mac.

---

## 1. B2C store amendments — OPS

`77e3cbc` · 20 files · +1,278 / −46 · `9613bd0` (part) · `3aa0594` · 7 files · +167 / −20

**Import and versioning**
* An amendment **no longer creates a second booking**. Booking 15726 gets a notice. If the original was never imported, the booking is created under 15726.
* If #15833 was already imported as its own booking, OPS warns that the **duplicate must be cancelled by hand**.
* **Update Booking** reads #15833 and saves it as a new booking version. Lines carried over from the old order are matched to existing P&L lines, so they aren't added twice or marked as removed.
* No OPS schema change: it uses existing settings storage.

**Automatic apply**
* When an amendment is found, OPS runs Update Booking itself and applies only the changes a person would see pre-ticked.
* **Never touched:** status, drivers, tickets, agenda, payments, and P&L lines confirmed by Accounts. Fields edited in OPS since the last store update aren't overwritten. They are listed on the banner as **"left for you"**.
* A failed apply retries up to 3 times, then is left for a person with the error shown.
* The 5-minute watch check now also catches amendments to **trips already under way**, which the importer alone missed.
* **Auto-apply ON/OFF** switch on the B2C page. On by default, super admins only.

**"Attention please"**
* **Booking page banner:** new order number, date, what changed, items left for review, duplicate warning, and an **"I've checked it"** button.
* **Header chip:** "N updated bookings" on every page, linking to the B2C page's **Booking updates** panel.

**Also fixed**
* Daily reconciliation report: an amendment no longer counts as a new order or as missing from OPS.
* B2C import preview: #15833 shows as **"Amendment → updates booking"** instead of "Will import".

**Checked:** type-check and lint. **Not tried on real data.**

---

## 2. B2C store amendments — Accounts

`b9e3504` · 28 files · +1,663 / −68

* **P&L:** AHS-15726 keeps **one P&L row**, updated to #15833's figures and still dated the day it was first sold. The old order #15726 can no longer overwrite it.
* **Invoice:** #15833 raises revision **AHS-15726R2**, so payments already received carry across. #15726 is never invoiced again. Automatic, with an on/off switch on **Settings → Aahaas B2C**. The customer email for a revision still **waits for review** by default.
* **B2C pages:** invoices show "v2 · amends #15726" and "Amended → #15833". The replaced order is left out of the totals. The P&L page shows "v2 · order #15833".
* **Daily mails, Sync Ledger and B2C payables** no longer count an amendment as a new sale.
* **Notice:** only for amendments of a booking sold on an earlier day. It shows in the topbar bell and in a **"Booking updates"** box on `/b2c/invoices`, with Acknowledge.
* **Earlier duplicates:** new command `php artisan b2c:order-chains` lists amendments already recorded as separate bookings before this fix. It changes nothing without `--apply`, and even then only hides stray P&L rows (reversibly). It never touches invoices.
* **Unit tests added:** `tests/Unit/B2cOrderChainTest.php`.

⚠️ **Run `php artisan migrate` on live** for the new `b2c_order_amendments` table.

---

## 3. Monthly Business Review — store order counts

`77e3cbc` (report part) · `9613bd0` · 10 files · +385 / −15 · `90abf15` · `e664b78` · `58ecd2e`

**Why October's 313 was wrong**
* It counted every store order OPS **imported** in October, including agency orders that AahaasFlow puts under B2B Packages and B2B Flights.
* It used the **import date**, not the booking date. Old orders imported late all landed in October, which is probably where **"+469%"** came from.

**What the report shows now**
* **"Aahaas store orders"** section: All orders, B2B Packages, B2B Flights and B2C, each compared with last month. A table splits B2C into packages and flights and has a Cancelled row.
* Counted **by store booking date**, with AahaasFlow's B2B/B2C rule. Fully cancelled orders and test orders are listed separately.
* The B2C number in the headline box, email subject, intro sentence, Excel scorecard and AI summary uses the new count. If the store can't be read, the report says **"could not be read"** instead of showing a wrong number.
* **New OPS card "Store order mix"** on `/dashboard/b2c`: same boxes and table, step between months, read-only.

**Changes asked for later today**
* Removed the **Prev** and **In OPS** columns ("By board" now shows only Board and Orders), the **"Imported into OPS this month"** block, and the "N live orders are not filed in OPS yet" line.
* New tiles: **This month new & updated** (e.g. "980 new + 140 amended", same accounts-ledger count as the daily mails), **Old amendments** (with how far back the oldest goes), **Completed trips** (departure date inside the month).
* Subject now reads like *"Monthly Business Review · October 2026 · 1093 this month new & updated, 151 old amendments, …"*. The Auto Reports preview drawer uses the monthly tile name when set to Monthly. The daily report keeps "Today new & updated".

**Checked:** AahaasFlow rule matched its own code in **18/18 test cases**. Report rendered with sample data. Type-check and lint pass.

**Things to know**
* AahaasFlow's tab numbers (500 / 60 / 279 / 173) **won't match**: they cover the 500 most recent orders, not a month.
* Only travel orders are counted (no shop goods), across **all countries**.
* The **Store order mix card in OPS still has Prev / In OPS columns**. Left as is until asked.
* ops.aahaas.com still shows the old layout until OPS is redeployed from `LIVE-1.0.0v`.

---

## 4. Monthly Business Review — Guest Voice and Outlook

`76c393f` · 11 files · +1,897 / −129

**Guest Voice**
* **AI operation calls:** calls made vs assigned, good / warning / bad by stage (pre-, on-, post-tour), post-tour rating out of 10 and NPS, and which on-tour areas were rated bad (hotel, driver, meals, vehicle).
* **Calls that need a look:** each bad or warning call with the reason.
* **Guest feedback forms:** score per area, plus guest remarks in their own words.
* **Desk feedback:** the TE desk's average rating.
* AI-call figures use the same code as the **AI Call Report** page, so they match it for the same dates.

**Outlook (OpenAI gpt-4o)**
* **Next 2 months' forecast:** a card per month with expected number, range and a one-line reason, plus a 12-month history chart.
* **Complaint fixes:** 3–5 themes with cause, fix and owning team.
* **How to grow the business:** 4–6 points, each quoting a figure from the report.

**Accuracy and privacy**
* Forecast base and range are **calculated in code** from monthly history (test bookings excluded). OpenAI's estimate is shown only if it falls inside that range. No seasonal adjustment until the ledger has a full year, and the email says so.
* Complaint counts come from report data. Themes OpenAI invents are dropped.
* **No guest names, phones or emails are sent to OpenAI.** If AI is off or fails, only the statistical forecast is shown.

**Workbook:** new sheets **Guest Voice**, **Call Issues**, **Guest Remarks**, **Outlook**. Overview opens with the forecast and an AI-calls tile. **Bug fixed:** the B2C tile had pushed "Forward book" off the Overview sheet.

---

## 5. Apple API imports create tickets automatically

`3f59233` · `as-auto-tickets.ts` (new), `as-booking-import.ts`, `applesystem.ts`

* Every new booking imported from the Apple system gets its tickets **when it is created**, without pressing **"Generate Tickets from P&L"**.
* Covers every import path (background watch, daily import, manual button, file handler, public API, AI assistant), because they all use the shared import function.
* **Safe by design:** draft tickets only; never edits or deletes; same tag as the button, so no duplicates; new bookings only; if anything fails the booking is still created and the button still works.
* **Off switch:** `as_auto_tickets_enabled = false` in `system_settings`. No row means on.
* **Tested offline on VN42614:** SIC Bana Hills with lunch (3 × $149.10) and SIC Marble | Hoi An | Lantern | Basket (3 × $100.50). Hotel ($98.10) and transport ($19.26) left out, same as the button.

No database queries or schema change.

---

## 6. WhatsApp inbox — Retry failed and Report

`4f244f9` · 13 files · +1,330 / −7 (incl. task lists 28–31 Oct)

⚠️ **Read first:** today's failures are probably **Meta's billing block (error 131042)**, which started on **1 Nov**. A retry fails the same way for any chat outside the 24-hour window, which covers most daily plans. **Fix the payment in Meta Business Manager → Billing, then retry.** The retry window shows a yellow warning when it sees this error.

**Retry failed**
* Lists every message that failed today (number, booking ref, type, reason) and shows the count before sending.
* Resends the way a normal reply would go now: plain text inside the 24-hour window, otherwise the approved guest template.
* Retried messages get an amber **"resent"** mark and are never sent twice.
* Only **staff replies, daily plans and feedback invites** are resent. Attachments, automated messages (portal reminder, QC auto-send) and numbers Meta says can't be helped are listed as skipped with the reason.

**Report**
* Ranges: Today, Yesterday, Last 7 / 30 days, This month, or custom (up to 93 days).
* Sent / delivered / read / failed / received with percentages, number of chats, breakdown by message type and by day, failure reasons with counts, **Download CSV**.
* The Vietnam desk login only sees Vietnam bookings.

**Checked:** type-check and lint. **Not tried on real data.**

---

## 7. B2C API error handling

`5f8e3fb` · 4 files · +81 / −8 — better error handling and response parsing in `b2c/overview`, `b2c/preview` and `b2c-db.ts`, with clearer errors on the B2C page.

---

## 8. Accounts — Payable 2.2VN "Sync now"

`9286344` · 5 files · +58

* New **Sync now** button between "Synced … ago" and Saved filters.
* Asks OPS to re-read the checklist workbook straight away instead of waiting for the **2-hour timer**, then reloads the board.
* **Safe:** no change if the workbook hasn't changed; can't force a full re-read; a second press during a running sync does nothing; Accounts still writes nothing to the checklist, P&L or OPS. Anyone who can open Payable 2.2VN can use it.

**Checked:** PHP and TypeScript compile, route registered, templates build. **Not tested end to end.**

---

## 9. Online Work — 502 fix, Roster and Leave

**502 errors: PM2 restart loop fixed** — `4574c6a`
* **Cause 1:** PM2's 1 GB limit is on total memory, while Node's heap alone can reach 1 GB, so PM2 kept killing the app (**3,811 restarts**). Each restart left Nginx with nothing to talk to, which showed as a 502.
* **Cause 2:** builds deleted `.next` under the live app (`ENOENT … prerender-manifest.json`).
* **Fix:** new `infra/pm2/ecosystem.config.cjs` (memory limit 1800 MB, `keepAliveTimeout` 75 s, 10 s restart grace, restart backoff) and `infra/pm2/deploy.sh`, which builds into `.next-build` while the live app keeps serving, then swaps.
* **Confirm on server:** `grep -c "max-memory-restart" /root/.pm2/pm2.log`. A large number confirms cause 1.
* Tested locally only. **Server not changed yet.**

**Roster: Excel, Email, Plan with AI + more 502 config** — `4e49a50` · 14 files · +1,432 / −10
* **Download Excel:** styled workbook with **Roster** (shift tiles, weekends, Poya/holiday columns, hours/nights/days off), **Summary** (incl. longest working run, red if more than 6) and **Daily cover** (thin days in red). Prints landscape, one page wide.
* **✉ Email:** type addresses or add the whole team, optional note, sent from the HR mailbox with the workbook attached. Each send appears in the notifications mail log.
* **✦ Plan with AI:** drafts the month from the previous two. Fill empty days only or redo the month, with instructions like "Kasun on leave 10–14". **Nothing is saved** until "Keep it · Save". **↶ Revert AI draft** restores the board. It never changes past days or existing leave. OpenAI sees people only as P1, P2…
* **502:** server-config fixes in `deploy.sh`, nginx `online-work.conf` and the systemd service.

**Roster Excel "file is damaged" fix** — `0b8b0b6`
* **Cause:** department names with "&" (e.g. "Ticketing, Flights & Visa") were written straight into the print footer, where "&" starts an Excel command.
* **Fix:** "&" is now written as "&&". Colour rules also got their own priority numbers as a precaution.
* **Please re-download the roster for that department and open it in Excel.** Files downloaded before the fix stay broken.

**Leave: mandatory approver and "keep informed" list** — `3155408` · 12 files · +642 / −35
* **Rules (enforced on the server):** an employee's **department head** goes on To with HR (🔒, can't be removed). A department head's leave goes to the **Boss, Pradeep Kumar (pradeep.kumar@bcdtravel.lk)**. With no head set, it goes to the Boss and the form says why. Anyone can tick **Copy the boss** once or always.
* **Route card:** You → Head/Boss (must approve) → HR → anyone copied.
* **Keep informed:** each person keeps their own list (+ Add someone, ★ always tick, ✕ remove), saved server-side.
* Approver and copied people stay on the request, so decision, withdrawal and late-document emails reach the same thread. The email has a new **Approval** row. The Boss's name and email are editable in **Settings → Leave**.

**To check:**
* Department heads must be set.
* The BCC setting still has **pradeep.kumar@aahaas.com**, so he may get two copies. Remove it if bcdtravel.lk is correct.
* Department heads **can't approve in the portal yet** (the approvals page needs admin or team-lead).

**Checked:** TypeScript compiles, production build succeeds. **Not opened in a browser, no real email or OpenAI call sent.**

---

## 10. Pending actions / Next steps

| # | Action | Owner / where |
|---|---|---|
| 1 | **Fix Meta billing (error 131042)**, then use WhatsApp **Retry failed** | Meta Business Manager → Billing |
| 2 | **Redeploy OPS** from `LIVE-1.0.0v` | Vercel |
| 3 | **Run `php artisan migrate`** on live Accounts, then redeploy `Master-Live` | Accounts server |
| 4 | Run `php artisan b2c:order-chains` (preview only) to list earlier duplicate amendments | Accounts server |
| 5 | After deploy: open **Store order mix** on `/dashboard/b2c` for October and compare with AahaasFlow | OPS |
| 6 | After deploy: send a test **Monthly Business Review** and check the new layout, Guest Voice and Outlook | OPS → Reports → Auto |
| 7 | Check **#15833 / #15726** in OPS (banner, version 2) and Accounts (AHS-15726R2) | OPS + Accounts |
| 8 | Check the next Apple import creates draft tickets | OPS → Tickets |
| 9 | Decide: remove Prev / In OPS from the OPS **Store order mix** card too? | Ops / management |
| 10 | Deploy Online Work with the new `infra/pm2/deploy.sh` + PM2 config; re-download the "Ticketing, Flights & Visa" roster in Excel; set department heads; remove old BCC address | Online Work |
| 11 | Decide: let department heads approve their team's leave in the portal? | HR / management |
