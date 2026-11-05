# Daily Work Update — 22 October 2026 (Thursday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 22 Oct 2026 (Driver app: Vehicle Vendor login with fleet tabs, pause a running day, entrance tickets per day, photo upload fix; WhatsApp: IS-number search and real delivery ticks; daily ops mail B2B count fixed; Accounts: MY/SG ticket sheet importer; Online Work: one daily report email per country)

---

## Executive Summary

**OPS — Driver app (Aahaas CORE):**
* **Vehicle Vendor login:** vendors sign in with their vendor portal login and get 5 tabs (Home, Trips, Get trips, Fleet, Me). From the app they can assign drivers and vehicles, request open trips for the fleet, and add drivers, who get a WhatsApp sign-in code.
* **Pause a running day:** the driver picks a reason and roughly how long. While paused, km and driving time stop counting. Ops sees "On break" on the live board. **Needs one new table** (`apply-trip-pauses.sh`).
* **Entrance tickets per day:** drivers upload ticket files day by day, can add tickets bought at the gate, and **can't finish a trip until every ticket has a file**.
* **Photo uploads fixed:** vehicle, odometer, profile, ticket and WhatsApp photos failed with "No internet connection". The cause was Expo SDK 57's own fetch, not the network.

**OPS — WhatsApp (website + mobile app):**
* **Search by IS number** ("VN 12345", "vn-12345", "VN12345"), booking ref, CNTL, guest name, phone or message text. Each result shows why it matched.
* **Ticks now show the real status** (sent / delivered / seen / not delivered). They stay on one grey ✓ until **n8n forwards Meta's status updates** to OPS. That is a setting in n8n, not code.

**OPS — Reports:**
* **Daily ops mail:** the B2B tile now shows **38 (27 new + 11 amended)**, the same as New bookings. The Excel lists all 38 files.
* **Mobile "Booking not found" fix committed:** the app's bridge now reads from the same server the app called.

**Accounts:**
* **MY/SG ticket rate sheet importer** (`suppliers:import-ticket-rates`) committed. It only previews unless told to apply, only adds missing attractions, and can be undone. **Not run on live yet.**

**Online Work:**
* **One daily report email per country** (Sri Lanka, India, Malaysia, Singapore, Vietnam) plus an "All countries" email. Today's 3 recipients move to the Sri Lanka email.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS (driver app, WhatsApp, reports) | 9 commits | `LIVE-1.0.0v` | Pushed · clean |
| Accounts System | 1 commit | `REV1` | Pushed · clean |
| Aahaas Online Work | 1 commit | `main` | Pushed · clean |

> **About the commit messages:** some say *"Nothing is committed"*. That was true when the message was written. **Every commit listed here is now pushed.** Nothing has been checked as deployed. **None of the app changes have been tried on a real phone yet.** Most server changes were checked only with type-check and lint, because production reads are blocked from this Mac.

> **Committed after yesterday's task list:** the two "not committed" items from 21 Oct section 9 are now in Git: OPS bridge fix `4620051` and Accounts ticket-rate importer `f776d8b`.

---

## 1. Driver app — Vehicle Vendor login and fleet tabs

`b87e322` · 52 files · +3,076 / −457 — new `(vendor)` screens, `lib/mobile/vendor.ts`, `lib/vendor-login.ts`, `api/mobile/vendor/*`

* **Welcome screen:** Driver stays the big red card. **Vehicle Vendor** gets its own dark card below it. "Company login" is now a small pill above the footer.
* **Sign-in:** vendors use the same e-mail or phone and password as the **vendor portal**. The portal and the app now share one login check, so changing the portal password signs the app out.
* **What vendors get (5 tabs):**
  * **Home:** drivers on the road now (km today, last seen); counts of drivers, vehicles and trips that need a driver; a "needs your attention" list (no driver, driver not on the app, unpaired driver/vehicle, waiting requests).
  * **Trips:** To do / Upcoming / Past. Open a trip to see its day-by-day plan and pick a driver and vehicle. The rules match the portal: Sri Lanka gets one driver for the whole tour, other countries are assigned per movement. The app warns about a busy driver or too few seats, but the vendor can still assign. The driver gets a push notification.
  * **Get trips:** the same open-trip board drivers use, but requested for the fleet. It shows how many of the vendor's drivers are free on those days.
  * **Fleet:** drivers (on the app / code sent / not joined, one-tap **Send code** on WhatsApp, **Share steps**) and vehicles (number plate, seats, photos, paired driver).
  * **Me:** company details, portal link, call operations, sign out.
* **Driver WhatsApp sign-in:** a vendor must give each new driver a WhatsApp number that no other driver uses. A 6-digit code goes out straight away, and the driver enters it with **"I already have a code"**. If the vendor changes the number, the old phone is signed out.
* **A vendor's own drivers can't take trips themselves:** their Get trips tab is hidden, the server refuses their requests, and they no longer get the morning open-trip messages.
* **How live data is protected:** no new tables, no schema change. Vendors write only the driver, vehicle and assignment fields the portal already writes, and only for their own fleet. **Nothing is ever deleted** (drivers and vehicles are switched off). A driver with upcoming trips can't be switched off. **Driver rates are never sent to the app.**

**Checked:** type-check and lint on server and app. **Not tried on a phone or against a database.** The local server points at the live database, so it wasn't run here.

---

## 2. Driver app — Pause a running day

`dbc9fac` · 16 files · +1,261 / −42 — `pause.tsx`, `lib/pause.ts`, `mobile/sessions.ts`, new SQL `2026-10-22-trip-pauses.sql`

* **Pause trip** button under the live card. The driver picks a reason (Meal, Guest stop, Fuel, Rest, Prayer, Vehicle problem, Personal, Other). Meal is picked automatically around lunch or dinner. The driver also picks a rough length (15 min – 2 h, or "Not sure").
* **Paused card:** a ring that fills to the planned length and turns red when the break runs over, km frozen with a lock icon, driving time so far, and the next stop with a countdown ("in 25m" / "10m late"). **Swipe to resume**, or tap "End the day".
* **Safety nets:**
  * a reminder notification when the planned time is up;
  * a red **"You're driving"** banner (or a notification) if the car goes above about 20 km/h while paused;
  * on resume, if the car moved more than 1 km, the app asks **"Was the guest in the car?"**. Yes adds those km to the trip, no leaves them off.
* **Works offline:** pause and resume take effect on the phone straight away and are sent when the signal comes back.
* **Full map and end of day:** the map shows "PAUSED · 12:34" with an orange panel. The day-done card shows "2 breaks · 1h 05m". The "on the road" clock no longer counts breaks.
* **Ops side:** the web Driver App board and the staff app show *"On break · Meal · 25 min / 45"*. It turns red on overrun or a vehicle problem. A moving car shows *"Paused but moving · 45 km/h"*. A **Vehicle problem** break alerts staff straight away. Km driven during a break are stored on the break and never added to the day by mistake.

**Before it works on live:** from `apple-holidays/`, run `bash prisma/sql/apply-trip-pauses.sh`. It creates one table and asks first. Until then, Pause shows "Breaks are not switched on" and the trip keeps running.

**Checked:** type-check and lint. **Not tried on a phone.** The background "you're driving" warning only works in a development build, not Expo Go.

---

## 3. Driver app — Entrance tickets per day

`acbe821` · 9 files · +712 / −8 — `trip-tickets.tsx`, `lib/mobile/tickets.ts`, `api/mobile/trips/[ref]/tickets/*`

* Each day shows a **ticket count** next to the km pill (e.g. 1/2). It turns red when the day has started and a ticket still has no file. Each ticket has an **Upload** button (camera, several photos, or PDF).
* **Add ticket:** for a ticket bought at the gate. The driver enters a name, quantity, day and photo. It's saved as a draft ticket on the booking, shows on the web **Tickets & Vouchers** page, and ops get a push notification.
* A red banner shows how many tickets are still missing. A driver can press and hold to remove a file they uploaded.
* **Finishing the trip:** the finish screen lists missing tickets before the feedback QR, and **the server refuses to finish** while any are missing, so an older app version can't skip the step.
* **What counts:** tickets, water and cruise items, plus tickets typed in by hand on the web. Hotels, transport, flights and OTHER lines (invoices) are left out. **Prices and the Accounts receipt are never sent to the driver.** Driver uploads show on the web as "(driver)".
* ⚠️ **The ticket's day is a best guess:** most P&L tickets aren't linked to a day, so each ticket is placed on the day whose stops mention the same place (e.g. "Yala National Park with Jeep Safari" goes on the day that drives to Yala). If nothing matches, a whole-trip driver sees it under "Trip tickets". A transfer-only driver doesn't see it at all. **Check this on a couple of real bookings.**
* **Needs `ticket_files` on live:** if `prisma/sql/apply-ticket-files.sh` hasn't been run, uploads are refused with a message, and the finish check is switched off so it doesn't block every trip.
* The test driver (`sandun@mail.com`) sees sample tickets. Test uploads are refused and never block finishing.

**Checked:** type-check on server and app, lint on the app. **Not tried on a phone or real bookings.**

---

## 4. Driver app — Photo upload fix

`c1cee62` (app part: `upload.ts`, `wa/[phone].tsx`)

* **What was wrong:** the internet was fine. Expo SDK 57 replaces the built-in fetch, and its version won't send files attached the old React Native way. The upload failed on the phone before reaching the server, and `api.ts` shows any failed request as **"No internet connection"**.
* **Fix:** a new `filePart()` helper reads the photo with `expo-file-system` in the format Expo's fetch accepts. It covers all three places that had the bug:
  * vehicle, odometer and profile photos;
  * trip ticket uploads;
  * photos and files in WhatsApp chat.

**Checked:** type-check and lint. **Please take one vehicle photo again in Expo Go to confirm.**

---

## 5. WhatsApp — Search by IS number (website + app)

`c1cee62` (website: `whatsapp/page.tsx`, `api/whatsapp/lookup`, `whatsapp-inbox-search.ts`, +576 / −47 overall) · `ac83a57` (app: `chats.tsx`, +167 / −13)

* **Search by:** IS number in any form ("VN 12345", "vn-12345", "VN12345"), booking ref or CNTL, **any passenger's name** (not only the WhatsApp display name), deal name, phone (spaces, dashes and + ignored), and message text (3+ letters). Typing "VN" finds every chat linked to a VN file.
* **Ops page:**
  * one-click 🇻🇳 VN… 🇱🇰 IS… 🇸🇬 SG… 🇲🇾 MY… buttons;
  * each result says why it matched (IS no. / Guest / Message), with a yellow highlight;
  * a "Found by" row (e.g. "IS no. 9 · Message 3") that filters on click;
  * the IS number on the booking tag and in the chat header;
  * **files that match but have never been messaged** are listed with Start chat / Open chat;
  * Enter opens the top result.
* **Mobile app:** results appear as you type. About 0.3 s after you stop, the full server search adds guest and message matches. It has the same country buttons and highlights, and files with no chat are listed with Start chat.

**Checked:** type-check and lint on website and app. **Not opened, not tried on real data.** Type "VN" plus a known IS number and check the right chats come up.

---

## 6. WhatsApp — Real delivery ticks (website + app)

`83a5e13` (website, 4 files, +28 / −10) · `60a8250` (app, 2 files, +6 / −5)

| Tick | Meaning |
|---|---|
| grey ✓ | Sent |
| grey ✓✓ | Delivered |
| blue ✓✓ | Seen |
| red ⚠ | Not delivered |
| clock | Sending |

* **Chat list** on both the website and the app always showed grey ✓✓ on outgoing messages. It now shows the **real last-message status**. Hovering (web) or long-pressing (app) shows it in words. The app's wording now matches the website ("Seen", "Not delivered").
* **Order fix:** Meta's updates can arrive out of order. A message's status now only moves forward, so a late "sent" can't turn a blue tick grey again. "Failed" always applies.
* ⚠️ **Why every message shows one grey ✓:** Meta sends status updates to **one address per WhatsApp number**, and for the Operations number that address is **n8n**, which doesn't forward them. **Fix in n8n (no code):** in the workflow that receives the Meta webhook, forward the `statuses` part to:

```
POST https://ops.aahaas.com/api/webhooks/whatsapp-status-signal
Header: x-inbound-secret: <WHATSAPP_INBOUND_SIGNAL_SECRET>
Body:   the Meta webhook body as-is (or just { "statuses": [...] })
```

* Only messages sent after that change will update. To confirm, open **`/api/whatsapp/diagnostics`** as admin and check its receipts section.
* The app gets its chat list from the website, so **the website must be deployed first**.

**Checked:** type-check and lint. **Not opened in a browser or on a phone.**

---

## 7. OPS — Daily ops mail: B2B count matches New bookings

`d7b3fe1` · 4 files · +119 / −19 — `report-html.ts`, `daily-workbook.ts`, `report-data.ts`

* **Mail:** the B2B tile now reads **"B2B 38 · 27 new + 11 amended"**, the same as New bookings. Before, it counted only the 34 bookings AppleSystem confirmed that day, which left out edited older files. B2C still shows the storefront count. If Accounts can't be reached, the tile falls back to the old AppleSystem count.
* **Excel:**
  * the **New Bookings** tab lists all 38 files, one row each: new/amended, ref, invoice no., country, agent, guest, status, dates, pax, invoice amount, first raised, age, revisions, and **Intake** (how it reached our system);
  * the 34 AppleSystem confirmations move to a new **AS Confirmed** tab;
  * Overview shows 38;
  * a file not in our system yet shows blank booking columns and *"Not filed here"*, so it doesn't drop off the list.
* The report data now keeps the full list of bookings, not just two totals.

**Checked:** with made-up data (27 + 11), where the tile and the sheet both show 38. **Not on real data** (the Accounts DB timed out from this laptop). `scripts/daily-report-render.mts` is still broken in places from earlier changes. Only the copy used for this test was fixed.

---

## 8. OPS — Mobile "Booking not found" fix committed

`4620051` · `lib/mobile/bridge.ts`, `api/mobile/web/[...path]/route.ts`, `booking/[ref].tsx` (+ the 21 Oct task list file)

* The bridge now forwards to **the same server the app called**, instead of an env URL that might point at another host or database. That mismatch is the likely reason a booking listed on the home screen showed "not found" on its detail page.
* Only `*.aahaas.com` and env-listed hosts are allowed, so a forged Host header can't redirect a session. Each response has an **`x-aahaas-bridge`** header naming the host that answered.
* The app's "not found" message was also updated.

**Not deployed.** After deploy, reopen a booking that failed before and check `x-aahaas-bridge`. Still waiting on **one failing ref** from OPS to confirm the cause.

---

## 9. Accounts — MY/SG ticket rate sheet importer

`f776d8b` · `ImportTicketRateSheet.php` (+773) + `Sample files/Supplier /malaysia and singapore tickets final.xlsx`

* **Don't use the Import button on the Attractions tab for this sheet.** It doesn't recognise "Attraction Name" / "Adult Rate". It would also add the region headings (GENTING, Penang, LANGKAWI…) and the "* Bird Paradise" lines as attractions.
* **`php artisan suppliers:import-ticket-rates`:**
  * **Preview by default.** It saves a CSV plan. Nothing is written without `--apply`, which also asks for confirmation.
  * **Only adds missing attractions.** Existing ones are never renamed or overwritten. Small differences still match ("Ticket Only", Malacca/Melaka, plurals).
  * **Holds back look-alikes** for a person to decide. Approve them one at a time with `--include-rows=MY:16,SG:61`.
  * **Payment portal names** follow Payable: TVG → Travel Vago, GT → Global Tix, Bemyguest → Be My Guest, direct → Direct Purchase. This matters because a new attraction's portal can become the payment portal on matching payable lines.
  * **Reads the sheet's layout:** region headings set the area, "Direct" rows use the direct-supplier prices, Mandai pass parks go into inclusions.
  * **Can be undone:** `--revert=<batch>` switches off what it added (never deletes) and keeps anything edited by hand since.

**Checked:** on a scratch copy only. **Nothing added to live Suppliers Manage yet.** The command has to be run on the Accounts server.

---

## 10. Online Work — One daily report email per country

`ead1356` · 15 files · +721 / −236 — `daily-report-mail.ts`, `daily-report-region.ts`, `daily-report-console.tsx` and others

* **Daily report page → Delivery:** a card each for **All countries, Sri Lanka, India, Malaysia, Singapore, Vietnam**, each with its own To/CC/BCC and a "Sends" tick. Send time, sender, sections, Excel and subject are shared.
* **In the email:** "Daily report · India", *"Here's how Wednesday went in India"*, the country in front of the subject (or wherever the new `{country}` tag is placed), and a file name like `Aahaas-Daily-Report-India-2026-10-21.xlsx`.
* A new **Email** picker chooses which version to preview, download or send. History has an **Email** column.
* **Current setup:** today's 3 recipients (sasindu@, pradeep.kumar@, hr@) **move to the Sri Lanka email**, still sent at 00:05. It now covers **only Sri Lanka people**. The other emails stay off until recipients are added.
* **Choices made (tell me if any should change):**
  * Bangalore and Madurai share one **India** email.
  * A country's email only includes people placed in that country's offices on the Offices page.
  * **PBX calls** appear only in the Sri Lanka and All-countries emails, because the PBX file lists extensions, not people.
  * Shared mailboxes (like hr@) count as Sri Lanka.
  * All times stay in **Colombo time**.
  * If one country's email fails, only that one is retried.
  * Switching an email on after 00:05 doesn't send it for a day that has already passed.

**Committed and pushed, not deployed.** Not checked in a browser.

---

## 11. Follow-Up Items

1. **Deploy `ops.aahaas.com`:** this ships the bridge fix, vendor login, pause, tickets, WhatsApp search/ticks, the daily mail B2B count, Ops Board and Sadun's test trips.
2. **Run on live (from `apple-holidays/`):**
   * `bash prisma/sql/apply-trip-pauses.sh` (pause);
   * `bash prisma/sql/apply-ticket-files.sh` if not run yet (ticket uploads);
   * `bash prisma/sql/apply-transport-suppliers.sh --check`, then run it (supplier picker, 21 Oct);
   * `bash prisma/sql/apply-trans-recon.sh --check`, then run it (Trans-Reconsultation, 19 Oct).
3. **n8n:** forward Meta's WhatsApp `statuses` to `/api/webhooks/whatsapp-status-signal` with `x-inbound-secret`. Then check `/api/whatsapp/diagnostics`.
4. **Driver app on a phone:**
   * take one vehicle photo again (upload fix);
   * sign in as a vehicle vendor and assign a driver;
   * pause and resume as Sadun;
   * upload a ticket and try to finish a trip with one missing;
   * check the ticket-day guess on 2 real bookings.
   * The vendor login, pause, tickets and attachments need **a new EAS build** to reach Play testers. Upload versionCode 4 to Closed testing → Alpha and **Send app for review** if not done.
5. **WhatsApp search:** type "VN" and a known IS number on the website and in the app.
6. **Daily ops mail:** check tomorrow's mail. The B2B tile should equal New bookings, and New Bookings / AS Confirmed tabs should both be in the Excel.
7. **Accounts:**
   * run `suppliers:import-ticket-rates` (preview) on the server, review the CSV with the ticketing team, then `--apply`;
   * still open: `b2c:lead-probe 15453 15455`, `php artisan migrate` (Mail Scanner + SharePoint archive), Mail Scanner roles and one real scan.
8. **Online Work:**
   * deploy (`npm install` for Sharp, `npm run build`, restart `aahaas-online-work`), which ships the per-country report, Halloween v2 (`/ad/1`), CCTV notice (`/ad/2`) and the employee page;
   * add recipients for the other country emails;
   * check the Sri Lanka email after 00:05.
9. **Still open from 19–21 Oct:**
   * B2C guest names (`--stand-ins`, `b2c-fix-lead-names.ts`);
   * AppleSystem Sync preview (IS49403);
   * "Settle from Aahaas" on one MYR order;
   * package-notes print (`/print/booking/IS49242`);
   * **what calls `/api/cron/customer-daily-briefing` on Amplify**;
   * grant Trans-Reconsultation to Accounts roles;
   * Malaysia 16–30 Sep sheet.
10. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
11. **Missing write-ups:** daily updates for **17, 19 and 21 Oct**.
