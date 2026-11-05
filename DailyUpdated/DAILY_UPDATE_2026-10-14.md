# Daily Work Update — 14 October 2026 (Wednesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 14 Oct 2026 (Accounts: B2C Payables, B2C P&L in local currencies, B2C invoice emails in the n8n thread; Online Work: reception desk with door control, Office TV view rotation, meeting reminders and special notices, Out of office on rosters; OPS: database outage report)

---

## Executive Summary

**Accounts System:**
* **B2C Payables (BNG)** at `/b2c/payables`: every Aahaas B2C order line becomes a payable to the vendor who sold it, with payment-date rules per vendor and settle-and-remit.
* **B2C P&L in local currencies:** every figure in USD plus INR, MYR, SGD or VND, at the rate of each order's own date (CBSL buying, CBSL selling or Xe).
* **B2C invoice emails:** a new invoice drafts its customer email **inside the same email thread n8n started**. By default it waits for review. Emails now use the **customer's real name**, never the shared `admin6611` login.

**Online Work:**
* A new **reception desk** at `/reception`: who's here (office vs. working from home), door control through a **door bridge**, the latest door events and the next 7 days of meetings.
* **Office TV:** rotates through several views, plays **meeting reminders** at T-10 and T-5, and broadcasts admin **special notices**.
* **Out of office (OOO)** as a new roster day type.

**OPS:** a written report on the **"Can't reach database server" (P1001)** errors on the PM2 server, with the likely cause and a fix plan. **Report only, nothing changed.**

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Accounts System | 4 commits | `REV1` | Pushed · clean |
| Aahaas Online Work | 8 commits | `main` | Pushed · **Uncommitted:** small notice-cast fixes (4 files, +19 / −6) |
| Booking System / OPS | No commits | `LIVE-1.0.0v` | **Uncommitted:** `docs/db-unreachable-p1001-report.md` (new) |
| Online Work docs | — | — | New: `Portal_Data_Sources_Guide.md` / `.pdf` |

> **About the commit messages:** several say *"nothing is committed"*. That was true when each message was written. **Every change listed here is now committed and pushed**, except where marked uncommitted. Nothing has been checked as deployed.

> ⚠️ **New today:** commit `70af0aa` in Online Work has the **door bridge token in its message** (now in Git history). Click **New token** in Settings → Reception and restart the bridge with the new command (Section 9).

---

## 1. Accounts — B2C Payables (BNG)

`e30948e` · 17 files · +4,076

* **Where:** `/b2c/payables`, in the sidebar under **Payable**. It works like Payable 1.0, but each Aahaas B2C order line is a payable to the vendor who sold it.
* **Finding the vendor** (strongest source first):
  1. `checkouts_more_data.vendor_id`, saved when the order was placed;
  2. the product's own vendor column (`tbl_lifestyle`, `hotels`, `edu_tbl_education`, `tbl_product_listing`), the same joins the Aahaas admin payable report uses;
  3. providers with no vendor row (Bridgify, Globaltix, flight provider) are still grouped as payees.
  * Login and identity columns (password, NIC) are never read.
* **Payment date per vendor:** count from the service date, booking date, hotel check-out or the storefront's payment date, add or subtract days, then optionally move it to a weekly or monthly run. The default is **3 days before service** (the admin's existing rule). Any single line can have its own date.
* **On the page:**
  * tabs per category, payment / service / booked date filters, the **D-0…D-8** strip and an overdue view;
  * vendor currency or USD;
  * bars for how many lines found their vendor and how many vendors have bank details;
  * per line: status (pending / process / hold), actual payable, checked tick, notes and history;
  * **Settle vendor:** pay several lines with one reference and slip, then get a **remittance advice PDF**;
  * a **Vendors** list (no terms yet / no bank details / on hold) with Excel export.

> **Live data safety:**
> * Nothing is written to the B2C database and existing tables aren't changed.
> * Cost comes from the same P&L engine as `/b2c/pnl`, so payable always matches P&L cost.
> * Every payment is re-checked against the live order. Overpaying, mixing vendors or currencies, and paying held lines are refused.
> * Cancelling a payment only marks it cancelled, and only a super admin can do it.

**Checked:** on fake in-memory data only. **Not run against live data**, because the live B2C database can't be reached from the Mac.

---

## 2. Accounts — B2C P&L in USD + INR / MYR / SGD / VND

`92b8adf` · 13 files · +1,904

* **"View in" bar:** USD only, or USD + INR / MYR / SGD / VND. Each Sale, Cost and Profit cell shows the converted amount under the USD one, with a column for the rate used.
* **Totals:** converted Sale / Cost / Profit, the average rate and its range, and how much the total would differ at today's rate.
* **Compare rates:** chips switch between CBSL buy, CBSL sell and Xe without changing the setting.
* **Order popup:** one card per currency with the order-date rate, the converted figures and how far the rate has moved since.
* **Downloads:** PDF and Excel (list and single order) include the converted columns and the rate used.
* **Setting:** Settings → Aahaas B2C. **CBSL buying** is the default.
* **How the rate is picked:**
  * **Weekends and holidays** use the last published rate (a Saturday order uses Friday's), and the page shows which day.
  * **"EST" tag:** CBSL publishes buy/sell only for USD and SGD. INR, MYR and VND use the middle rate widened by that day's USD buy/sell gap.
  * **Second opinion:** each rate is compared with the ECB rate; a red dot means more than 1.5% apart (no VND from ECB).
  * **Locked rates:** a past day's rate is stored once and never changes. Today's is provisional and refreshed hourly.

**Checked:** against live CBSL data. Today's USD→INR came out at **92.7346 buying / 97.8997 selling**, the same as the dashboard ticker. 7 new tests pass. **Not opened in the browser yet.**

---

## 3. Accounts — B2C invoice emails in the n8n thread

`6188070` (18 files, +2,463) · `197eaf6` (5 files, +182)

* **What it does:** when a B2C invoice is created, the system drafts its email to the customer **in the same email thread** as the n8n booking confirmation. It uses the same thread ID and `Re: Your booking with Aahaas — order #…`, so it groups in both Gmail and Outlook. It goes to the **lead passenger email**, never the shared `admin6611` login.
* **B2C Invoices page:**
  * a new **Mail** column: Review & send, Needs address, Sending (with countdown and stop), Sent, New revision not sent, Failed;
  * a **review screen** with To / Cc / Bcc, a live preview of what the customer will see, and a **Thread** tab of every email sent for that order;
  * **Review N emails** steps through waiting drafts with *Send & next*;
  * a Mail filter.
* **Settings → Aahaas B2C → Customer invoice mail:** mode (**Review first** by default, Send automatically, Off), a separate setting for revisions, hold time (10 min default), sender, reply-to, Cc / Bcc, default message and signature.
* **Safeguards:** automatic mode holds for review if there's no email, the order is a test booking or the invoice is cancelled. A new revision cancels the old unsent email. The same email can't be sent twice. Invoices created before turning it on are never sent by themselves. The internal email and the n8n project are unchanged.
* **Real customer names (`197eaf6`):** the greeting, Guest row, review header and order popup use the stored name only when it's a real person. Otherwise they look up the lead passenger, or say *"Dear Customer"*. Old drafts are corrected on open and again before sending. A warning shows if the **invoice PDF itself** still says `admin6611`.

**Checked:** all 17 invoice-mail tests pass (on the in-memory test database). The full suite has **14 failures that were there before** these changes. The full suite wasn't re-run after `197eaf6`. **No email has gone to anyone**, and the lead passenger email field in the live `travel_ai_checkout_sessions` table is **not confirmed**.

---

## 4. Online Work — Reception desk and door bridge

`7f3d6a1` (18 files, +2,513) · `ea4a5ab` · `9e410df` · `70af0aa`

* **Where:** `/reception`, behind a desk password that an admin changes in **Settings → Reception**.
* **Layout (reorganised):**
  * **Top:** meetings beside the door controls. A **today timeline** with a red needle for now; the meeting in progress glows green, meetings with outside guests are gold. Below it, *up next / in progress* and the list for the next 7 days, from 3 Microsoft 365 calendars.
  * **Bottom — Who's here now:** **At the office** (figure cards for door face scans, badge check-ins or office filings) and **Working from home** (compact list, with a *Client site* tag). Counters for office, home, late, on leave and not in yet, plus a two-level ring.
* **Door:** press-and-hold **Unlock**, plus Controlled / Remain open / Remain closed (the last two ask to confirm). The **latest 5 door events** are shown, the same as the terminal's Real-Time Event page. The portal now keeps the terminal's door events, not only faces.
* **Door bridge (`ea4a5ab`):** the portal is in the cloud, so it can't reach the terminal at `192.16.26.5` directly. A small Node.js bridge runs on an office computer. Settings → Reception gives a ready-made command; Settings then shows *● Connected from <computer>*. The command now saves into the user's own folder first (the Windows PowerShell-as-Administrator issue).

**Checked:** 22 checks against a fake Hikvision terminal; the lock screen and 40 real meetings on the dev server; screenshots at desktop and phone width on a separate copy. That caught and fixed two bugs: a clock hydration error and an oversized late-arrival time. **The bridge must stay running**; if that computer sleeps, the door buttons stop.

---

## 5. Online Work — Office TV: views, meeting reminders and special notices

`29df4bf` (9 files, +1,200) · `48ade86` (12 files, +958) · `202063c` (11 files, +1,763)

* **Views between check-ins** (Settings → Office TV): the ops view is always first. **＋ Add a view** with a name, address and seconds (10–3600), up to 12 more. Each can be renamed, timed, reordered, paused or removed. Every view stays loaded in its own frame and fades in with no white flash. A check-in pauses the rotation. **V** skips to the next view. TVs pick up changes without a reload.
* **Meeting reminders:** full screen for about 18 s at **T-10** and again at **T-5** (red, "STARTING SOON"). A radar sweep and bell, a live countdown dial, the meeting name, room / Teams, and attendees flying in with their check-in figures. The announcer reads it out. It plays after the boss's entrance and before waiting check-ins, and **only once per screen**. **Only first names** are shown; outside guests show as "Guest".
* **Special notices:** an admin writes a message in Settings → Office TV, previews it on a small copy of the wall and broadcasts it. Tones: info, celebrate, warning and more, with an icon picker. The wall plays a *"SPECIAL NOTICE"* broadcast, then keeps it as a full wall or a banner until it's replaced, taken down or reaches its end time.
* **Uncommitted fixes:** emojis in a notice headline keep their colours (no gradient silhouette), and the Settings preview renders only in the browser to avoid a time-zone hydration error.

**Checked:** type-check and a settings test against a temp file. Reminders were watched in demo mode on a separate copy. **Not seen with a real meeting**, and the `:3100` dev server still returns 500 for `/tv/view`.

---

## 6. Online Work — Out of office on rosters

`05bef60` · 5 files

* **How:** select roster cells and click **Out of office** (next to Short leave) or press **U**. The cell shows a teal **OOO**. It's in the legend and the shortcut hints.
* **Counted as a duty day away from the desk** (client visit, embassy, airport): not a day off, not absent, and not *worked on a day off*.
* **Excel:** written as `OUT OF OFFICE` with a light blue fill; reading back recognises *Out of office* or *OOO*.
* **Limit:** an OOO cell has no hours, so it adds no rostered hours. Adding hours is a small follow-up if wanted.
* No database change (cells are JSON).

**Checked:** type-check only. **Not seen in a browser.**

---

## 7. OPS — Report: "Can't reach database server" (P1001)

`apple-holidays/docs/db-unreachable-p1001-report.md` · **uncommitted · report only**

* **What the log shows:** P1001 on different models (`Booking`, `systemSetting`), with successful runs in between. So the database **isn't down**; it's **overloaded**, and new connections time out at 10 s. `AsReconcile ... parity=false` is a side effect of the outage, **not a real drift**.
* **Likely cause:** `aahaas-prod-database-4` has hit **503 / 500 connections** and **~99.8% CPU** on hourly ticks before. It's shared by OPS (PM2 and Amplify), Payable, Apple Accounts, B2C and n8n. The raw `mysql2` clients open a **new connection per call**. About **20 schedulers** in one process fire on the same minute, and each first reads `systemSetting` (99 call sites).
* **Suggested fixes (none made):**
  * **Config:** one PM2 instance in fork mode; set `DB_POOL_LIMIT`, `DB_CONNECT_TIMEOUT` etc.; set `DB_READ_HOST` to a replica; per-app DB users with connection limits; lower `wait_timeout`.
  * **Small code:** cache `systemSetting` reads; a DB-down circuit breaker for schedulers; stagger start times; make AsReconcile fail fast; pool the `mysql2` clients.
  * **Structural:** a separate scheduler process, **RDS Proxy**, and move `invoice_processor` off the primary.

---

## 8. Online Work — Live database and screen data guide

`Online-work/Project/Portal_Data_Sources_Guide.md` (+ `.pdf`)

* Covers the live database (AWS RDS Singapore, `ahds_online_work`), the four data sources, the tables and columns, and how each table reaches the **Employees, Attendance, Rosters, Daily filings and Employee profile** screens, plus fixed rules and known issues.
* It names every credential and where it's kept, but **contains no password or secret value**.

---

## 9. Follow-Up Items

1. ⚠️ **Door bridge token in Git history:** commit `70af0aa` has the token in its message. Click **New token** in Settings → Reception and restart the bridge with the new command.
2. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete it from the repo and add it to `.gitignore`.
3. **Accounts deploy:**
   * `php artisan migrate` on the server (new tables: B2C payables, `b2c_fx_rates`, `b2c_invoice_mails`);
   * add `XE_ACCOUNT_ID` and `XE_API_KEY` if Xe is wanted (until then the Xe option uses a free daily market rate, labelled as such);
   * check B2C Payables against live data;
   * confirm where the lead passenger email is in `travel_ai_checkout_sessions`;
   * re-run the full test suite (14 failures already there).
4. **Online Work:**
   * commit the notice-cast fixes;
   * keep the door bridge running on an office PC and set it to start automatically;
   * restart the dev server on `:3100` and click through reception, TV views, reminders, special notices and OOO;
   * decide whether OOO days should carry hours.
5. **OPS database:** run the read-only checks in Section 3 of the report, then apply the config changes (A1–A3) and commit the report.
6. **Still open from 13 Oct:**
   * mobile app go-live (SQL script, deploy, WhatsApp template, hourly cron, `MOBILE_BRIDGE_ORIGIN`) and a test on the iPhone;
   * decide on hiding movement descriptions on *Get trips*;
   * finish and commit the OPS Excel kit;
   * check Offboard / Reinstate, Download all figures, *Work from* and the TV policy panel.
7. **Still open from 12 Oct and earlier:** Online Work + nginx deploy, `/api/tv/office`, Boss panel, face terminal and Terminal IDs *Apply*, `SampleImage /`, `TV_VIEW_KEY`, Accounts INR invoice migration, Employee IDs and HR emails, Task Manager staff photos, OpenAI key revocation, `DIRECTOR_BOARD_PUBLIC`, Movement WhatsApp *Register with Meta*, B2C traveller name script, the OPS report for 07/10, `GRAPH_MAIL_CLIENT_SECRET`, and the pending OPS and Bank Settlements scripts.
