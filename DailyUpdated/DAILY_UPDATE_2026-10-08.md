# Daily Work Update — 08 October 2026 (Thursday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 08 Oct 2026 (OPS: B2C test-booking fix, Movement WhatsApp briefing, real B2C traveller names, Vietnam D-3 driver/vendor details, rebuilt WhatsApp inbox, Ops Board Call Request fix, daily report count now matches Accounts; Online Work: Task Manager sync, web check-in by permission, filing search, Work AI, Director Board at /ceo, Island Rush daily podium; Task Manager: Online Work bridge; Accounts: Exchange Rate page with Time machine and forecast)

---

## Executive Summary

In OPS, **booking 14999 (and any other Aahaas B2C order) can now be marked as a test**. Each movement has a new **green WhatsApp button** that sends that movement to its driver, vendor, guide and tour vendor. **It stays disabled until the template is registered with and approved by Meta.** B2C bookings will show the **traveller's real name instead of "admin6611"** once the names are read from the Aahaas store. **Vietnam D-3 documents now include driver, vehicle vendor, tour vendor and guide details.** The **WhatsApp inbox was rebuilt**, so it no longer jumps to the latest message while you read. The Ops Board **Call Request** column now checks Meta directly. The **daily OPS report now counts the day the same way as the Accounts invoice report**, so 07/10 should read **45 = 29 new + 16 amended**.

Online Work got a **Task Manager sync** for daily filings, **web check-in only for allowed people**, a **filing search page**, a **Work AI** assistant on every admin page, and the **Aahaas Director Board at `/ceo`**, which reads the live OPS, ERP and B2C/B2B databases **read-only**. The Island Rush leaderboard now shows **today's champions**.

Accounts has a new **Exchange Rate page** (`/exchange-rates`) with all 55 CBSL currencies. Its **Time machine** shows the rates on any past date and gives a **backtested forecast for future dates**, with an AI second opinion shown alongside.

> ⚠️ **Two security items need action today (Section 10):** the **OpenAI API keys shown on `/ceo` must be revoked**, and a **private SSH key (`ssh-keys/developer_key`) was committed and pushed** to the Online Work repo.

**One new database script today:** Task Manager `db/schema_05_online_work.sql` (additive, `CREATE TABLE IF NOT EXISTS` only). Nothing in OPS or Accounts needs a database change.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 7 commits | `LIVE-1.0.0v` | Clean · up to date with origin |
| Aahaas Online Work | 10 commits | `main` | Clean · up to date with origin |
| Aahaas Task Manager | 1 commit | `main` | Clean · up to date with origin |
| Accounts System | 2 commits | `REV1` | Clean · up to date with origin |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** some say *"nothing is committed yet"* or *"not deployed"*. That was true when each message was written. **Every change listed here is now committed and pushed.** Nothing has been checked as deployed.

---

## 1. OPS — B2C booking 14999 couldn't be marked as a test

`3703bb4` · 4 files · +304 / −7 · **no database script**

* **Cause:** Aahaas B2C orders arrive in OPS with the bare checkout id (`14999`) as their booking ref and IS number. The Test Bookings register refuses numbers without letters. Accounts files the same order as `AHS-14999`.
* **Fix:** a new `testBookingReference()` sends `AHS-<id>` for B2C bookings with a numeric ref. Mark, restore and the "is it marked?" lookup all use it.
* **Hiding it in OPS lists:** `testBookingRefs()` now matches an `AHS<n>` mark to booking `n`, **but only for Aahaas B2C bookings**, so it can't hide another booking with the same number.

---

## 2. OPS — Movement WhatsApp briefing

`bc39cf5` · 10 files · +1,866 / −1 · **no database script** (settings stored as one row in the existing settings table)

* Each movement has a **green WhatsApp button** next to *It's Leisure Day / Hotel Only / Re-assign*. It sends that one movement to the **driver, transport vendor, guide and tour vendor** through an approved WhatsApp template.
* **Dialog:** recipients filled in from the movement and directories (tick/untick, edit numbers, *Also save this number on the movement*, Add number). The message starts with the IS number, then booking ref, date, meeting time, service type, route, lead guest, pax and details.
* **Different message per person:** the driver sees the vehicle and guide's number, the guide sees the driver's number, the vendor sees both. **The driver's rate is never included.**
* Live preview per recipient with a 1024-character count. If the person messaged us in the last 24 h, the full text follows as a second message.
* **Safety:** same text to the same number within 30 minutes asks for confirmation. Test mode sends everything to the test number. Meta error codes become plain messages.
* After sending, the button shows ✓ sent / ✓✓ delivered / blue ✓✓ read / red failed.
* **History survives a chart Save:** Save recreates movements with new IDs, so a step now moves the WhatsApp history to the new IDs.

> **To switch it on:** Settings → **Movement WhatsApp Briefing** → **Register with Meta**. Approval usually takes minutes, up to 24 h. Until then the send button stays disabled and says why.

**Checked:** type check, lint, and the message text against a real movement. **Not opened in a browser; no real WhatsApp sent.**

---

## 3. OPS — Real traveller names for B2C bookings

`6d41a3e` · 3 files · +175 / −4

* Bookings **14966, 14990, 14959, 14988** show **"admin6611"** (the login name) because OPS only looked in `aahaas_passenger_details`, which customers usually leave empty.
* OPS now also reads the names where Accounts already finds them: `tbl_lifestyle_bookings.lifestyle_adult_details`, `hotel_prebooking.bookingdataset` (paxDetails) and `edu_tbl_booking.student_name`.
* Names are cleaned (*"Mr PRIYA NAIR"* → *"Priya Nair"*). Fillers like *"Adult 1"* or *"undefined undefined"* are ignored, same rules as Accounts.

> **Not fixed yet for the four bookings above.** The new query hasn't been run against the real store, and the existing bookings still need **one script run from a machine that can reach the AWS database**.

---

## 4. OPS — Vietnam D-3 documents now show driver and vendor details

`8c36efc` · 5 files · +59 / −18

* **D-3 automatic Tour Confirmation (agenda PDF):** for **Vietnam bookings only**, each movement now shows **VENDOR / DRIVER (vehicle and plate) / TOUR VENDOR / GUIDE** with phone numbers. Other countries still show *Driver info hidden*. A movement with nobody assigned shows *DRIVER: Not assigned*, same as the manual agenda send.
* **"Full Tour Details & Vouchers" PDF** (QC2 and the WhatsApp *Full* option): section renamed **Drivers, Vendors & Tour Vendors**. Movements with only a vendor or tour vendor are no longer left out. The QC2 checklist line reads *"✅ Driver, vehicle vendor & tour vendor details"*.
* **The driver rate is never printed** in either document.

**Checked:** generated the Full Details PDF from a made-up VN booking. All names and phones printed, the tour-vendor-only movement appeared, and the rate did not.

---

## 5. OPS — WhatsApp inbox rebuilt

`e6b92ce` · 4 files · +2,154 / −807

**Why it kept jumping to the latest message:** every 6 seconds the page reloaded the whole chat and scrolled to the bottom. Now it only updates when something actually changes and only follows new messages if you're already at the bottom. Otherwise a **"3 new ↓"** button appears. Refreshes don't overlap and pause while the tab is hidden.

**Why the chat list was slow:** the server looked up the booking for each chat one at a time. It now does **one lookup for the whole list**.

**New:**

* **Chat list:** All / Unread / Pinned / Country tabs, pinning, booking status badges, smarter timestamps, unread count in the tab title, new-message pop-up with optional sound, live/offline indicator.
* **Chat view:** search inside a chat, *N unread messages* divider, grey/blue/red ticks, full-screen images, in-chat audio/video, copy/quote, 24-hour reply window countdown, export as text.
* **Message box:** instant send with Retry / Discard on failure, saved quick replies (`/`), emoji picker, paste or drag files with preview, per-chat drafts.
* **Templates:** larger window with search and a phone-style preview.
* **Shortcuts:** ⌘K, ⌘F, Alt+↑/↓, Esc.

> **Not opened in a browser.** The local setup points at the live database, and opening a chat there marks its messages as read.

---

## 6. OPS — Ops Board Call Request column

`0f002a5` · 4 files · +138 / −62 · **no schema change**

* The column now shows **Not sent / Sent / Accepted** and gets *Accepted* **from Meta directly**, like the booking page's *Customer allows calls* chip.
* **Likely cause (not confirmed, production DB couldn't be read):** the approval record was one text block in a 64 KB field. After about 300 numbers it stopped saving **without any error**, so new approvals showed *Not sent*.
* **Fix:** one row per phone number in `system_settings` (old block still read, no history lost). For numbers not yet Accepted, the board runs the live Meta check (4 s limit, 8 at a time, cached 10 min) and falls back to the saved record if Meta is slow.
* Labels: *Awaiting customer* → **Sent**, *Approved* → **Accepted**.

> Sends lost while the old record was full can't be recovered. Those bookings show *Not sent* until someone presses **WhatsApp Approval** again, unless the customer already accepted. **The first board load after deploy will be a bit slower.**

---

## 7. OPS — Daily report count now matches Accounts

`f0c474c` · 6 files · +76 / −60

* **07/10/2026 should now show 45 "Today new & updated" = 29 new + 16 amended**, matching the Accounts invoice report.
* **Amendments 22 → 16:** an older booking edited several times in one day now counts once (Accounts rule in `ActivityTabs.php:612`). OPS had counted every revision (R13, R14, R15 = 3).
* **Headline 44 → 45:** the headline was the Apple System's own confirmation count. A new `todayNewAndUpdated()` adds new + amended and is used by the top tile, New bookings card, Bookings created note, CSV, Excel, preview drawer and AI summary.
* Subject line reads **"29 new + 16 amended"**. If the Accounts database can't be reached, it falls back to the old count.

> **Not re-run against live data yet**: 45 / 29 / 16 is what the code should produce, not a result seen.

---

## 8. Online Work

| Commit | What |
|---|---|
| `8895f57` · +997 | **Task Manager sync:** every daily filing (draft or submitted) is copied to Task Manager as that person's Daily Update. People are matched by email or username; anyone else links with a code from **My account → Task Manager**. Failed copies retry every 5 minutes. Needs `TASK_MANAGER_URL` and `TASK_MANAGER_SYNC_SECRET`; **left blank, the sync stays off.** ⚠️ This commit also added `ssh-keys/developer_key` (private key), see Section 10. |
| `7f47acc` | **Web check-in by permission:** the Check in panel on My day is **hidden from everyone by default**. Admins allow it per person under Employees → *Web check-in*. The server also refuses check-in for anyone not allowed. Changes are audit-logged. |
| `15a4bbf` · +1,518 | **Filing search** (`/filings/search`) with date ranges and filters, plus a filing history page under My workday. |
| `0f3e148` · +2,018 | **Work AI:** ✦ button on every admin page (Ctrl/⌘+J). Answers attendance, filing and team-work questions and makes **Excel** and **PDF** reports. **Counts come from the tools, never from the AI.** Read-only, admins only, current office only. ID numbers, contact details and salary are never sent to OpenAI. |
| `be0d274` | **Island Rush:** main podium is now **Today's champions** (since midnight Colombo) with a reset countdown, and a smaller **Hall of fame · all time** strip underneath. Existing scores carry over. |
| `51ae954` · +3,943 | **Aahaas Director Board at `/ceo`:** chat with saved history, answers from the live OPS, ERP and B2C/B2B/flights databases with the SQL behind every number, charts, figure cards, sortable tables, CSV/Excel/PDF downloads, uploads, voice input, a period picker, *director's brief*, **My Board** pins and **Teach the board** rules. Super admins only by default. |
| `3d16b77` | **Key leak fix:** model settings that contain an API key are now ignored (falls back to `gpt-5.4-mini`), quoted keys work, and key-like text in error messages shows as `[hidden key]`. |
| `1cc9175`, `92abdb2` | **Director Board on live data:** connected to OPS (100 tables), ERP (107) and B2C/B2B (535). "Today" now means a **Colombo day** (the first answer said 39 bookings instead of 52 because it counted by UTC). Mixed-currency totals are flagged, and **every connection must confirm it's read-only** or it's discarded (the `appletech` user can write). |

**How the Director Board keeps live data safe:** single `SELECT` only (tested against 22 attack cases), always inside a rolled-back read-only transaction, only the three schemas, row limits and timeouts. Password, token and card columns are hidden; emails, phones and passports are never sent to OpenAI. Nothing is written to a business database.

**Checked:** type check and production build pass. Work AI was tested against the real OpenAI API and a local database with 4 people. The Director Board was tested on a local machine against the live databases. **The live site still needs two steps** (new API key and server settings). **Web check-in, filing search and Island Rush haven't been clicked through in a browser.**

---

## 9. Task Manager and Accounts

### Task Manager — Online Work bridge

`46c499f` · 9 files · +1,300 / −3 · **new script: `db/schema_05_online_work.sql`**

* Receives filings from Online Work and turns them into **Daily Updates**. Requests are signature-checked.
* Accounts are linked by email, username or a one-time code. Unlinked accounts are kept as `REVOKED` so they aren't matched back automatically.
* Conflicts between an Online Work filing and a Daily Update edited in Task Manager are handled, and every filing received is logged.
* The script only adds `tm_*` tables (`CREATE TABLE IF NOT EXISTS`). Needs `ONLINE_WORK_SYNC_SECRET`, which must equal Online Work's `TASK_MANAGER_SYNC_SECRET`.

### Accounts — Exchange Rate page

`cb42c93` · 8 files · +1,876 / −15 · `f70afab` · 5 files · +1,659 / −83 · **no migration**

* **`/exchange-rates`** under Company: all **55 CBSL currencies** plus LKR, any date back to Nov 2006. Nine major currencies use CBSL buying/selling; the rest are estimated from the USD spread and marked *est*.
* Pair cards, trend and compare charts, movers, converter, cross-rate matrix, statistics, a daily move calendar and a history table with CSV. **Copy link** saves the exact view.
* **Time machine:** pick any past date for that day's full board (mosaic, table, sparklines), or a **future date for a forecast**. Six statistical models are each backtested on about 150 past dates and weighted by accuracy. The 50/80/95 % ranges come from real past misses. The page shows whether the forecast beats "rate stays the same" and says so when it doesn't.
* An **AI analyst** (OpenAI) gives a separate figure next to the forecast, not mixed in. Test: **USD→LKR 31 Dec, 331.50**, inside the models' range of 322.8–344.8. The live market rate agreed with CBSL within 0.01 %.
* **Nothing is saved to the rates table on purpose**, so Payable 1.0 and the proforma screens aren't affected. The existing ticker is unchanged. If CBSL is down, it falls back to the stored USD/SGD/MYR/INR rates with a warning.
* **Access:** roles won't see it until the page permission is granted under **Roles & Permissions**.

**Checked:** headless Chrome with real CBSL data (3-month USD mid 330.871 matches the ticker) on a bare test page. **Not yet opened inside the running app with login.**

---

## 10. Follow-Up Items

1. ⚠️ **Revoke the two exposed OpenAI API keys** at platform.openai.com → API keys (they showed on the public `/ceo` page), create a new one, and set it on the live server with valid model settings.
2. ⚠️ **SSH private key in Git:** `ssh-keys/developer_key` was committed in `8895f57` and pushed to the Online Work remote. **Treat it as exposed:** remove it from every server's `authorized_keys`, make a new key, delete the folder from the repo and add it to `.gitignore`. Removing the file alone doesn't take it out of the Git history.
3. **Movement WhatsApp:** Settings → Movement WhatsApp Briefing → **Register with Meta**, wait for approval, then send one test movement in test mode.
4. **B2C names:** run the name script from a machine that can reach AWS for 14966, 14990, 14959 and 14988, and check they no longer show "admin6611".
5. **Daily OPS report:** run Preview for 07/10/2026 and confirm **45 / 29 / 16**.
6. **Browser-check:** the WhatsApp inbox (against a test database, so chats aren't marked read), the Ops Board Call Request column, and the B2C test-booking Mark on 14999.
7. **Task Manager sync:** run `schema_05_online_work.sql` on the Task Manager database, set the same secret on both servers, then save one filing and check it arrives.
8. **Online Work:** allow web check-in for the people who need it (it's now hidden for everyone), and click through filing search and Island Rush.
9. **Accounts:** grant the Exchange Rate page permission to the right roles and open it inside the running app.
10. **Still open from 28 Sep:** a corrected weekly OPS report for 20–26 Sept, `GRAPH_MAIL_CLIENT_SECRET` for Online Work mail, the five OPS scripts and two Bank Settlements migrations from 25 Sep, and the older items (Checklist VN 2.1v, Vietnam scripts, OneDrive write access, payment migrations, `Mail.Send`, **rotating the credentials in `web/.env.local.example`**, `AUTH_SECRET`, live indexes, `DB_READ_HOST`).
