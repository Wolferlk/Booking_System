# Daily Work Update — 09 October 2026 (Friday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 09 Oct 2026 (Online Work: Director Board follows Accounts and OPS rules, emails full reports with Excel + PDF, new look and phone layout; attendance correction fix for quick sign-in; Productivity section on each employee page; rebuilt Reports page with Department performance; Accounts: Auto Reports no longer stop silently when one schedule fails; Task Manager: staff photos in progress)

---

## Executive Summary

Most of today's work was on the **Aahaas Director Board (`/ceo`)** in Online Work. It now follows the **Accounts system's own rules** for invoice, P&L and payables questions, and the **OPS rules** for bookings, the movement chart, drivers and the daily operations report. It can **email what it finds**: a full written report with figures, charts drawn in the email, every table, and an **Excel and PDF attached**. Only `@aahaas.com` addresses are allowed. It also got a **new look with the Aahaas logo** and a proper **phone layout**.

Also in Online Work: **attendance corrections no longer fail for people who signed in with quick sign-in**, each employee page has a new **Productivity section** (score out of 100 across attendance, device, mail, Teams and PBX), and the **Reports page was rebuilt**. Every report now downloads a real file, and there's a new **Department performance** report.

In Accounts, **one failing Auto Report no longer stops every schedule after it**. Out-of-memory crashes are now recorded in the history and the schedule moves on, instead of crashing again every minute with nothing on the page.

**No commits in OPS today.** Task Manager has **uncommitted** work on staff photos (Section 6).

**No database scripts were committed today.** An uncommitted Task Manager script `db/schema_06_staff_photos.sql` is in progress. Yesterday's `schema_05_online_work.sql` is still waiting to be run.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | No commits today | `LIVE-1.0.0v` | Up to date with origin · yesterday's daily update not yet committed |
| Aahaas Online Work | 9 commits | `main` | Clean · up to date with origin |
| Accounts System | 1 commit | `REV1` | Clean · up to date with origin |
| Aahaas Task Manager | No commits · work in progress | `main` | **Uncommitted:** staff photos (5 new files) |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** several say *"nothing is committed or deployed"*. That was true when each message was written. **Every Online Work and Accounts change listed here is now committed and pushed.** Nothing has been checked as deployed.

> ⚠️ **Still open from yesterday:** `ssh-keys/developer_key` (a private SSH key) is **still tracked in the Online Work repo**, and the exposed OpenAI keys still need revoking if that hasn't been done (Section 7).

---

## 1. Online Work — Director Board follows Accounts and OPS rules

### Accounts rules

`319e7d9` · 2 files · +384

* **Daily invoice report tool:** a question like *"yesterday's B2B AHDS invoice report"* now uses the daily invoice mail's own rule. It counts **bookings, not invoice rows** (each booking's latest invoice that day, Colombo time), split into new, new & updated, old amendments and cancelled, with money per currency and per agent. Test bookings, B2B-agent orders placed through the B2C website, and void cancellations are left out.
* That explains the earlier mismatch: the screenshot counted **102 invoice rows**, not bookings.
* For other accounting questions the AI now follows the Accounts pages' rules: latest invoice revision only, the AHDS vs B2C P&L split, **never adding currencies together**, and links to the matching page on invoice-processor.aahaas.com.
* **Limits:** small differences from the emailed workbook are possible (cancellation look-ups and the B2C order-date rule aren't copied exactly), and the board says so in its answers. It can't make the Accounts system's own invoice or P&L PDFs.

> **Decision needed:** an exact-match feed through a read-only connection inside the Accounts app was blocked, because it would use a shared token while `/ceo` is public. The safe route is to turn sign-in back on for `/ceo` first (`DIRECTOR_BOARD_PUBLIC=off`) and then approve it. The Accounts repo was left unchanged.

### OPS rules

`0fb95c5` · 8 files · +1,528 / −10

| You ask | Matches OPS page | What you get |
|---|---|---|
| *"Open booking VN42529"* | `/dashboard/bookings/…` | Full booking card: guests, flights, hotels, day-by-day agenda with driver, vehicle (with photos), vendor, guide, rate, km and MC-done, tickets, payments, status history, complaints, feedback, reconfirmation calls, plus the Accounts invoice and P&L |
| *"Tomorrow's movement chart"* | `/dashboard/mc-report` | Every movement and who's assigned, **movements with no driver**, splits by country, vendor, driver and day. Hotel-only and leisure days are left out of the gaps |
| *"Today's operations report"* | `/dashboard/reports/auto` | Created, on ground, 3-day driver readiness, 10-day reconfirmations, complaints |
| *"Rank our drivers / vendors / guides"* | `/dashboard/ground/analytics` | Trips, guests, ratings, complaints, and the same 0–100 score and A+…D grade as OPS |

* Two new animated cards: **Operations day** (live tiles, readiness ring, a track per tour on ground) and **Booking** (progress stepper, tabs, itinerary timeline with red *"No driver yet"* alerts, Open in OPS button).
* **Privacy fix:** masking missed OPS column names. **Bank account numbers are now always masked.** Phones, passports and licence numbers are shown to you but hidden from the AI. Passport numbers are left off the booking card.
* Fixed a bug where a partner name with an apostrophe broke the query.
* **Known differences from OPS:** readiness checks drivers only (not tickets), and partner complaints don't use OPS's keyword analysis.

**Checked:** every OPS query passes the read-only guard, both cards render with sample data, type check and build pass. **Not checked against live data.**

---

## 2. Online Work — Director Board emails full reports

`0ce6950` · 4 files · +273 / −3 · `9962a7c` · 6 files · +503 / −32

* Ask *"send this to sasindu@aahaas.com"* and the board **sends the email**.
* **First version's problem:** emails were one-line notes with no attachments, because the board only remembered its written replies, not its tables. It now remembers the tables, charts, figures and images from each answer. If they've expired (6 hours or a restart), it re-runs the analysis before sending.
* **The email is a full report:** the question, period and scope, headline answer, key figures by currency, breakdown, risks, an Insight section and how the figures were worked out. Figure cards and **bar charts drawn in plain HTML** (they show in Outlook and Gmail), and every table (first 50 rows).
* **Attached by default:** an **Excel file** (one sheet per table, every row) and a **PDF** (full report with charts, page numbers, up to 500 rows per table).
* **Mailbox:** the portal's existing report SMTP mailbox, or `DIRECTOR_SMTP_USER` / `DIRECTOR_SMTP_PASSWORD`.
* **Limits, because `/ceo` is public:** only `@aahaas.com` addresses (look-alike domains refused), at most 10 per email, 20 emails per hour per person. It only sends when explicitly asked. Every attempt is logged under a new **Director Board** notification label. `DIRECTOR_MAIL=off` switches it off.

**Checked:** a sample email and PDF were rendered and look right. **No real email has been sent.**

---

## 3. Online Work — Director Board new look and phone layout

`4ebfa20` · 2 files · +243 / −55

* **Aahaas logo** on a white disc with a glow and a circling spark that speeds up while the board is thinking. It appears in the sidebar, the phone top bar, the welcome screen, beside each answer and on the locked page.
* Floating headline words, a red → violet → blue gradient on *"board"*, a glowing chip per connected system (OPS, ERP, B2C, Workforce), a rotating border on the director's brief card, and cards that lift on hover.
* The question box cycles through example questions, the send button pulses once you type, and a ↓ button jumps back to the latest answer.
* **Phones:** swipeable question cards, a compact icon-only top bar, 16px input text so iPhones don't zoom in, and **no sideways scrolling**.

**Checked:** in Chrome at desktop size and at 390px wide. **Only the opening screen was checked, not a full conversation.**

---

## 4. Online Work — Attendance correction failed after quick sign-in

`083766f` · 3 files · +37 / −9

* **Cause:** quick (one-tap) sign-in gives the session a stand-in id like `quick:<key>` when it can't find the person's row in `users`. The correction looked people up only by that id, found nothing and refused to save. That's also why that person's own day showed **Absent** with *"Nothing was ever filed"*.
* **Fix:** if the id doesn't match, the correction looks the person up by **sign-in email or username, among active accounts only**, and signs the record and audit log with their real id. Bulk corrections are covered too.

> If the error still shows, that email has no row in `users`. An admin needs to add the person under **Employees** with the same email, then they sign out and back in.

**Checked:** type check. **Not tried in a browser.**

---

## 5. Online Work — Productivity section and rebuilt Reports page

`771aa56` · 25 files · +5,506 / −51 · `62d08a6` · −136 (old report builder removed) · `3e8c6a8` · −55 (test sample-data file removed)

### Productivity section on each employee page

* Sits under *Employee record* and covers the **last 7, 14 or 30 complete days, ending yesterday**.
* **Score out of 100** with a level (Excellent → At risk) and a confidence rating. A score built from only 2 of 11 measures is flagged as low confidence.
* A five-point shape for **Attendance, Device, Mail, Teams and PBX**, a *What stands out* summary, one card per channel with raw figures, and a daily rhythm grid. Days with no data are hatched, not shown as zero.
* **11 measures**, each scored against a target shown on screen. **A measure with no data is left out, never scored as zero**, so someone without a PBX extension isn't marked down for zero calls.
* Admins can set each measure to **Off / 1× / 2× / 3×** per person or pick a preset (Balanced, Call desk, Mail desk, Back office). Changes are logged.

> **Targets are starting guesses** (70 % active time, 75 % time in work apps, a full shift's hours). Adjust them in `productivity-model.ts` and `productivity.ts` to match the team.

### Reports page rebuilt

* Five report cards, and **all of them now produce real files** (Excel, CSV, PDF). Before, four showed a fake *"Queued"* message.
* **Department performance (new):** one row per employee with department, present / absent / late days, emails received / sent / replied, daily filings, active hours, and a **productivity rate out of 100**.
* **Attendance register, activity, application usage and device health** are now real queries.
* **Filters:** date ranges, departments or people, rating, *Only show* (late, absences, missing filings, perfect attendance), attendance and lateness thresholds, and sliders for the productivity formula. The download matches the preview exactly, and the URL keeps the filters so a view can be shared.
* **Preview:** headline numbers, highlights, a clickable department ranking, a daily attendance chart and a sortable employee table with per-person score breakdown.
* **Print preview:** a designed A4 landscape page with a section picker, for Print or Save as PDF.
* **Off days and leave never count as absent:** roster OFF, lieu or holiday shows as an off day, and roster leave, sick or approved leave shows as leave.
* **Recent exports** is now a real history. *Again* rebuilds the file from current data; files are never stored.

> **Things to know:** the attendance register's **Excel and CSV** still use the old export, which doesn't know about approved leave requests (preview and PDF do). Teams data only goes back about 28 days, email covers only monitored people, and PBX depends on uploaded call reports. Each source is labelled complete, partial or unavailable instead of showing zeros.

**Checked:** type check, a small test of the scoring maths, and the department report with made-up data (API, Excel, CSV, PDF and print view). **Not opened in a browser with data, and not run against live data.**

---

## 6. Accounts and Task Manager

### Accounts — Auto Reports stopped silently

`787e98d` · 2 files · +174 / −23 · **no migration**

* **One schedule's failure no longer stops the rest.** Before, an error ended the whole command, so **every report due later that morning went unsent**. Each schedule now runs on its own, and a failure is written to its history.
* **Out-of-memory crashes:** a split P&L / invoice send builds both businesses in one process, far past the server's 128 MB. The limit is now raised to **1 GB** for this command, with no time limit.
* **Fatal errors are recorded:** before, a crash left no history row and didn't move the next run time on, so the schedule **crashed again every minute** and took the ones behind it down too, while the page still showed the last good send. Now the run is marked **failed** with the reason and the schedule moves to its next time.
* **Split reports:** a failure while building a B2B / B2C split is now recorded against both businesses, instead of the emails simply never arriving.

### Task Manager — staff photos (uncommitted)

* **Not committed yet.** In progress: a public `/photos` link where each person finds their name and adds **up to five clear, front-facing photos**, with a photo-quality check and admin routes.
* New script **`db/schema_06_staff_photos.sql`** (adds `tm_user_photos`, `CREATE TABLE IF NOT EXISTS` only), plus `photoQuality.ts`, `staffPhotos.ts` and the photo API routes.

---

## 7. Follow-Up Items

1. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete the folder from the repo and add it to `.gitignore`.
2. ⚠️ **OpenAI keys:** confirm the two keys exposed on `/ceo` yesterday were revoked and the new key is on the live server.
3. **Decide:** turn sign-in back on for `/ceo` (`DIRECTOR_BOARD_PUBLIC=off`). The board can now read live business data and send email, and that would also allow the exact-match Accounts feed.
4. **Director Board, after deploying:** ask *"yesterday's AHDS invoice report"* and compare it with yesterday's daily mail; open a booking and *"tomorrow's movement chart"* and compare with OPS; ask a question with a table and chart, then *"send it to sasindu@aahaas.com"*, and check the Excel and PDF arrive.
5. **Attendance correction:** have the affected person save a correction; if it still fails, add them under Employees with the quick sign-in email.
6. **Productivity and Reports:** open a few employee pages and the Department performance report with live data, and agree the productivity targets with HR before anyone relies on the scores.
7. **Accounts Auto Reports:** after deploying, check tomorrow morning's schedules all sent, and look in the history for any *failed* rows with a reason.
8. **Task Manager:** finish and commit the staff photos work; run `schema_05_online_work.sql` and then `schema_06_staff_photos.sql`.
9. **Still open from 08 Oct:** Movement WhatsApp **Register with Meta**, the B2C traveller name script for 14966 / 14990 / 14959 / 14988, checking the daily OPS report shows **45 / 29 / 16** for 07/10, browser checks of the WhatsApp inbox and Ops Board, allowing web check-in for the people who need it, and granting the Exchange Rate page permission in Accounts.
10. **Still open from earlier:** a corrected weekly OPS report for 20–26 Sept, `GRAPH_MAIL_CLIENT_SECRET`, the five OPS scripts and two Bank Settlements migrations from 25 Sep, and the older items listed on 28 Sep.
