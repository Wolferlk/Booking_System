# Daily Work Update — 15 October 2026 (Thursday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 15 Oct 2026 (Accounts: correct cancellation counts in the daily mails, Server Load settings page; Online Work: daily report fixes (off days, shifts, groups, meeting time), photos on daily filing, phone layout for My Workday, Offboard fix, quicker notice take-down, live environment guide; OPS: cancelled-booking popup fix)

---

## Executive Summary

**Accounts System:**
* **Cancellation cards fixed:** *AHDS cancelled (month to date)* and *Today cancelled* in the Daily P&L and Daily Invoice mails now count **every** cancelled booking, including those cancelled only in OPS. Before, the month card showed 2.
* **Server Load page** (Administration → Server Load, super admins only): stop or re-time the background jobs and page auto-refresh that keep the server busy. **With nothing saved, every timing stays as it is today.**

**Online Work:**
* **Daily report fixes** from the 7 reported issues: roster off days no longer show as *Absent*, rostered shift vs. filing hours are shown side by side, *Unassigned* groups are filled from the department, and meeting time is no longer zero.
* **Photos on the daily filing** (up to 12 a day), and a **phone layout** for `/me/workday` with a camera button.
* **Offboard / Reinstate fixed:** every offboard was being refused before it reached the database.
* **Special notices** can now be taken down from the TV screen itself or from an **"● On air"** bar on any admin page.
* **`LIVE_ENV.md`:** every environment variable the live system reads, with no secret values.

**OPS:** the **"Mark as test booking" popup** on a cancelled booking now opens full screen instead of squashed and blurred inside the red banner. Yesterday's **P1001 database report** is now committed.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Accounts System | 3 commits | `REV1` | Pushed · clean |
| Aahaas Online Work | 5 commits | `main` | Pushed · clean |
| Booking System / OPS | 1 commit | `LIVE-1.0.0v` | Pushed · clean |

> **About the commit messages:** some say *"nothing is committed"*. That was true when each message was written. **Every change listed here is now committed and pushed.** Nothing has been checked as deployed.

> ✅ **Yesterday's uncommitted work is now in:** the notice-cast fixes (`888e19b`) and the P1001 report (`20a46b0`).

---

## 1. Accounts — Cancellation counts in the daily mails

`c4b772d` · 7 files · +452 / −32

* **Why it was wrong:** both cards only counted cancellations with a **"-CXL" cancellation invoice** in Accounts. Most cancellations are made in OPS and never get one. The month card also only counted bookings first confirmed in that same month, which is why it showed **2**.
* **What they count now:**
  * **AHDS cancelled (month to date):** every booking cancelled from the 1st to the report's last day, cancelled in OPS or in Accounts, however old the booking.
  * **Today cancelled:** every booking cancelled in that report's period, by the same rule.
  * Days are judged in **Sri Lanka time**. **Test bookings** (e.g. MY40105) and cancellations later **recovered** are left out.
* **Other visible changes:**
  * OPS-only cancellations appear in the mail's cancelled table and the CANCELLED sheet, marked **"cancelled in OPS"**, with 0 money (no invoice), so **money totals don't change**.
  * When the count differs from the number of cancellation invoices, the card says so, e.g. *"· 9 with a cancellation invoice"*.
  * If OPS can't be read when a mail is built, the cards fall back to the old invoice-based count.

**Checked:** new `CancellationWindowCountTest` added. **Not checked against a real mail yet.**

---

## 2. Accounts — Server Load settings page

`9787e60` (13 files, +626 / −19) · `277379c` (12 files, +543 / −31)

* **What was keeping the server busy:**
  * The **Apple System sync status** query on `pnl_records`: the P&L page and Daily Updates asked for it **every 4 seconds from every open tab** during a sync, counting every Apple System row with no index. **Fixed:** the result is now shared for 30 seconds (adjustable).
  * The **notification bell** asks the server every 60 seconds from every tab of every user, including background tabs.
  * Two old 5-minute jobs, **`pnl:fetch`** (decodes up to 1,000 emails per run) and **`emails:process`**, duplicate what Settings → Fetching already does. Neither was protected against two copies running at once; **now they are**.
  * The dashboard itself does **not** poll; it loads once when opened.
* **The page (Administration → Server Load):**
  * **Background jobs:** Running / Stopped and a timing (every 1 min to every 24 h) for the mailbox jobs, SL driver-advance snapshot, cancellation recovery sweep, and (in `277379c`) email fetching, OneDrive sync and chat polling. Changes apply from the next minute.
  * **Page auto-refresh:** seconds for the bell, sync progress, Fetching page, Last-minute live page and chat presence (0 = off), plus *Pause all page auto-refresh* and *bell skips background tabs*.
  * **Query reuse:** how long the `pnl_records` sync summary is shared.
  * **Low-load preset** and **Original timings** buttons fill the form; nothing changes until **Save**. A server-load estimate updates as you edit.
  * Saved to `storage/app/performance/settings.json`, **not the database, no migration**. If the file is missing, everything runs as today. Each save is logged with who made it.

**Checked:** PHP and Blade compile; default timings land on the same minutes as before. **Not opened in the browser or run on the server.** The long-running queries were **not stopped**, because the live database can't be reached from the Mac (see Follow-Up 1).

---

## 3. Online Work — Daily report fixes

`1892aa1` · 25 files · +1,054 / −89 — from the 7 issues reported this morning

1. **Off days shown as Absent (Nimani, Ashwak, Vinith):** anyone the roster gives the day off, or whose weekly shift has no work that day, now shows as **Off day**, using the roster's own word where there is one (*Lieu day*, *Poya*, *Out of office*). Applies to the **daily email**, the **daily Excel** (new *"Roster says"* column), the **attendance screen** (Off day badge and filter) and the **month view** and its Excel. Off-day people are left out of the absent count and attendance rate. A Poya or holiday on the roster counts even when the person's own cell is blank.
2. **Kasun's two shifts:** the top of the report used the roster (12:00–21:30), the filings section used the hours typed on his filing (9:00–6:00). The filings tab now shows **"Rostered shift"** and **"Hours on filing"** with ⚠ when they differ. The filing form warns on a mismatch and offers **"Use rostered hours"**. Most likely the filing was saved before the roster was filled in.
3. **Groups showing "Unassigned":** assigning a department never updated the monitoring group. Unassigned groups are now filled from the department, including just before the daily report is built. **Groups an admin chose by hand are never changed.**
4. **Meeting time showing zero:** two causes fixed. Newer Microsoft meeting records sometimes keep the person's ID in a different field; both are now checked. Meetings joined from a link not on the person's calendar now count as **"Not on calendar"**. Where exact times are missing, time is estimated from the meeting length and marked **≈**.

**Checked:** type-check. **Not compared with real meetings yet**; please compare the next report.

---

## 4. Online Work — Photos on the daily filing and phone layout

`1892aa1` · `a290589` (6 files, +198 / −50)

* **Photos:** a new Photos section on the daily filing. Add one or many, drag them in, or paste a screenshot (Ctrl/⌘+V). Shrunk in the browser before upload, real images only, **12 per day**. Thumbnails show in the admin filings view; the Excel shows a photo count.
* **`/me/workday` on phones — problems fixed:**
  * **Save and Submit were hidden** behind the phone's navigation bar. They now float above it with full-width buttons and the status or error.
  * **iPhones zoomed in** on every field (inputs now 16px).
  * **Buttons too small to tap** (now 40–44px); task *Details* / *Remove* are ▾ / ✕, and removing a filled task asks first.
  * **Photo delete** only appeared on hover; the ✕ is now always visible.
* **Layout:** 7-day strip on one row with ✓ / ◐ / ○, shift start and end side by side, swipeable task status, a large **"+ Add another task"** button.
* **New for phones:** **Camera** and **Gallery** buttons, swipe between photos, bottom-sheet pop-ups, and **"Bring them back"** if the tab reloads before saving.
* The shared input and button changes also help other phone forms (leave, shift requests). Desktop look is unchanged.

**Checked:** type-check. **Not opened on a phone yet.**

---

## 5. Online Work — Offboard / Reinstate fix

`2c57e0b` · 2 files

* **Cause:** the two database statements that switch an account off and back on (`DEACTIVATE_USER`, `REACTIVATE_USER`) were added with the Offboard button but never put on the **allowlist** in `account-store.ts`. So every offboard was refused before reaching the database, and **nothing was changed**.
* **Fix:** both added to the allowlist. This also fixes **Reinstate** (Employees → Former employees) and **cancelling a scheduled exit**.

**Checked:** type-check. **Not clicked through.** To confirm, open Piyumindya's offboard dialog and press *Offboard Piyumindya now* (restart the dev server if the old error still shows).

---

## 6. Online Work — Office TV: notice fixes and quicker take-down

`888e19b` (6 files, +352 / −7) · `8088071` (6 files, +240 / −4)

* **Notice-cast fixes (yesterday's uncommitted work):** emojis in a notice headline keep their colours; the Settings preview renders only in the browser.
* **Taking a notice down**, now three ways, all clearing every TV within about **3 seconds**:
  1. Settings → Office TV → **■ Take down** (click twice), as before.
  2. **On the TV screen itself**, when signed in as an admin: move the mouse and a red **"■ Take down this notice"** button appears (click twice), or press **Delete**. Office TVs that aren't signed in never show it.
  3. **From any admin page:** while a notice is up, a red **"● On air"** bar shows the title and time, with *Take down* and *Edit*. It refreshes every 15 seconds.
* **"Until a time"** when posting removes the notice by itself.

---

## 7. Online Work — Live environment guide

`Online-work/Project/LIVE_ENV.md` (in `888e19b`)

* Every environment variable the live system reads, taken from the code (`process.env.*` and the agent API), the live topology (portal, agent API, EC2, RDS, Nginx, systemd) and a ready-to-paste `.env.production`.
* **No secret values:** every secret is written `<<SET ON SERVER>>`. It notes that the DB password, Graph client secret, OpenAI key, AWS keys and mailbox passwords that were in `.env.local` / `.env.example` are **exposed and must be rotated before go-live**.
* `.env.production.example` updated to match.

---

## 8. OPS — Cancelled booking popup fix

`20a46b0` · `modal.tsx`, `bookings/[ref]/page.tsx`

* **Problem:** on a cancelled booking, the **"Mark as test booking"** popup opened squashed and blurred inside the red *Booking Cancelled* box. Cancelled pages fade everything except the first block, and the new test-booking control had pushed the banner out of first place, so the faded banner was clipping the popup.
* **Fix:**
  * **All popups** now attach to the top level of the page, so nothing can trap or clip them. This also fixes the **Seal** popup and the **emailed-code** check in that banner.
  * The cancelled banner is no longer faded and shows in **full red**. The rest of a cancelled page is still shaded.
* The popup change affects every popup in the app. Every popup was checked; none relies on a form outside itself.

**Checked:** type-check. **Not opened in the browser.**

---

## 9. Follow-Up Items

1. **Accounts server load (urgent):** on the server, list the long `pnl_records` queries and stop only the `SELECT`s:
   ```sql
   SELECT id, user, time AS seconds, state, LEFT(info, 200) AS query
   FROM information_schema.processlist
   WHERE command = 'Query' AND time > 30 AND info LIKE '%pnl_records%'
   ORDER BY time DESC;
   CALL mysql.rds_kill_query(<id>);
   ```
   Then after deploying: press **Low-load preset** → **Save**; stop the two old mailbox jobs if Settings → Fetching already does them; run `crontab -l` and `pm2 list` (an older copy at `/var/www/invoice-processor` may run every job twice); set production logs to **info**; check CPU in CloudWatch / Performance Insights; decide on an index on `pnl_records (source, as_synced_at)` (schema change, not made). Run `php artisan schedule:list` **on the server**, not from the Mac.
2. ⚠️ **Door bridge token in Git history** (from 14 Oct, commit `70af0aa`): click **New token** in Settings → Reception and restart the bridge.
3. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete it from the repo and add it to `.gitignore`.
4. ⚠️ **Rotate exposed secrets before go-live** (listed in `LIVE_ENV.md`): DB password, Graph client secret, OpenAI key, AWS keys, mailbox passwords.
5. **Accounts:** check tomorrow's Daily P&L and Daily Invoice mails for the new cancellation counts; plus 14 Oct items still open (`php artisan migrate`, `XE_ACCOUNT_ID` / `XE_API_KEY`, B2C Payables on live data, lead passenger email in `travel_ai_checkout_sessions`, re-run the full test suite).
6. **Online Work:**
   * open `/me/workday` on a phone and try photos, camera and Save / Submit before deploying;
   * offboard Piyumindya to confirm the fix;
   * compare the next daily report's off days, shifts, groups and meeting time with reality;
   * test notice take-down from the TV screen and the On air bar;
   * keep the door bridge running on an office PC and set it to start automatically;
   * restart the dev server on `:3100` (`/tv/view` returned 500) and click through reception, TV views, reminders and OOO; decide whether OOO days should carry hours.
7. **OPS:** open a cancelled booking and check the *Mark as test booking*, *Seal* and emailed-code popups; run the read-only checks in the P1001 report, then apply config changes A1–A3.
8. **Still open from 13 Oct and earlier:** mobile app go-live and iPhone test, movement descriptions on *Get trips*, OPS Excel kit, Download all figures / *Work from* / TV policy panel, Online Work + nginx deploy, `/api/tv/office`, Boss panel, face terminal and Terminal IDs *Apply*, `SampleImage /`, `TV_VIEW_KEY`, Accounts INR invoice migration, Employee IDs and HR emails, Task Manager staff photos, OpenAI key revocation, `DIRECTOR_BOARD_PUBLIC`, Movement WhatsApp *Register with Meta*, B2C traveller name script, the OPS report for 07/10, `GRAPH_MAIL_CLIENT_SECRET`, and the pending OPS and Bank Settlements scripts.
