# Daily Work Update — 13 October 2026 (Tuesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 13 Oct 2026 (OPS: new Aahaas mobile app for iPhone and Android with a Driver login and a Company login; Online Work: "Work from" set by door scans, Office TV controls, download all figures, and employee offboarding)

---

## Executive Summary

**OPS:** a new **Aahaas mobile app** (iPhone and Android, built with Expo) is in `apple-holidays/Aahaas_Operation_App/driver-app/`. It has two sign-ins:

* **Driver:** the day plan and trip flow, km tracking, Get trips with a full day-by-day preview, score, vehicle photos and a red help button.
* **Company:** for OPS staff, with the same e-mail and password as ops.aahaas.com. It gives them bookings, the MC Report, the WhatsApp inbox, team chat and drivers on the phone.

The app writes only to **9 new `mobile_*` tables**, which **don't exist yet**. Until they do, the app does nothing. **Nothing touched the live database.**

**Online Work:**
* *Work from* now shows **Office** when someone scanned at the door.
* Admins get a **policy panel and remote commands** for the Office TV.
* **⬇ Download all figures** saves every check-in figure as a ZIP.
* A full **Offboard / Reinstate** flow for employees who leave.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 4 commits | `LIVE-1.0.0v` | Pushed · **Uncommitted, in progress:** shared Excel house style (`excel-kit.ts`, daily workbook moved onto it) |
| Aahaas Online Work | 4 commits | `main` | Pushed · clean |
| Accounts System | No commits | `REV1` | Clean · up to date |
| Aahaas Task Manager | No commits | `main` | **Uncommitted:** staff photos (5 new files, from 09 Oct) |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** several say *"nothing is committed"*. That was true when each message was written. **Every change listed here is now committed and pushed**, except the Excel work in Section 4. Nothing has been checked as deployed, and **the mobile app hasn't been opened on a phone or run against a server yet.**

> ⚠️ **Still open:** `ssh-keys/developer_key` (a private SSH key) is **still tracked in the Online Work repo** (Section 9).

---

## 1. OPS — Aahaas mobile app: Driver login

`6113642` · 123 files · +16,511

The design uses big buttons and a high-contrast screen. Languages: **English, Sinhala, Tamil and Vietnamese**.

* **Sign in:** drivers who already registered use that phone or e-mail. The first time, they get a 6-digit code by WhatsApp or e-mail and choose a password.
* **Today:** one swipe for each next step: *start trip → start day → end day → finish trip*.
  * **Start trip** shows the guest's trip-portal QR (the driver can skip it).
  * **Start day** turns on location and counts km and time.
  * **Finish trip** unlocks only after the guest sends the feedback form. If the guest won't rate, the driver can ask OPS to let them finish.
* **Day plan:** Navigate buttons, tonight's hotel and flights. An AI **"Read my day"** button reads the plan aloud in the driver's language.
* **Get trips:** request open trips, using the same rules as the Driver-Auto board.
* **Score:** rating, grade, km, guest comments and badges. **Rates and agent names are never shown.**
* **Vehicle photos every 60 days:** OpenAI does a first check for blur, damage or a wrong plate. OPS then approve or ask for a retake.
* **Red help button:** calls OPS, or sends the driver's GPS position to every OPS phone. **"I can't continue this trip"** asks OPS for a driver change.
* **Reminders:** a new trip, the night before, each driving morning, and vehicle photos due.
* **Ground team view:** a live map of drivers, km today, drivers with no GPS, drivers who haven't started, and requests to approve. The same board is on the web at **`/dashboard/driver-app`**.

> **Live database safety:**
> * The app writes only to the new `mobile_*` tables.
> * Existing rows change only when someone in OPS clicks approve, and only the named fields: a driver's bank, phone or e-mail, and approved vehicle photos.
> * The SQL file (`prisma/sql/2026-10-13-driver-app.sql`) only **creates** tables.
> * Small edits to existing files: `middleware.ts` lets the app's sign-in through, `tsconfig.json` excludes the app folder, and `schema.prisma` has the new models added at the end.

**Checked:**
* **Mobile app:** type-check, lint, Expo health check (21/21) and the iOS build.
* **Web:** type-check shows only the 3 errors already on the branch, and lint is clean.

**Not tested:** on a phone or against the server. The local `.env` points at the live database, so it wasn't run locally.

---

## 2. OPS — Rebrand and Company login

`225b7ea` (50 files, +2,168) · `6b0a535`

* **Rebrand:**
  * The app is now called **"Aahaas"**: a white design in the logo's red, with the red "A" icon and splash, and the *"Aahaas · uniquely yours"* wordmark.
  * The welcome screen has two cards, **Driver** and **Company**.
* **Company login:** every staff role signs in with their ops.aahaas.com account. Ultra Super Admin also enters the critical password.
* **Home:**
  * today's numbers: on tour, arriving, leaving, unread WhatsApp, drivers on the road;
  * booking search;
  * today's arrivals and departures.
* **Bookings:** search by ref, IS number, guest or agent, with quick filters.
* **Booking page:**
  * the person's own status buttons and the operation checklist;
  * guests, flights and hotels;
  * the agenda with a WhatsApp brief per movement;
  * tickets, P&L and status history.
* **Booking actions:** PDF and Agenda Word, the guest portal link, Tour Confirmation on WhatsApp, guest chat, agent e-mail, feedback and complete. A cancellation **request** uses the same e-mailed code as the web.
* **Chats:** the WhatsApp inbox (threads, linked booking, photos and files) and team chat.
* **Drivers:** each driver's score, rating, vehicle photos, call and WhatsApp.
* **MC Report:** one day or a week, with *needs driver*, airport and allocated views.

> **How live data stays safe:**
> * The app copies none of the website's logic. It calls the website's own functions **as the signed-in person** (through `bridge.ts`), so every permission and country limit matches the web.
> * Every change is logged as **"via aahaas-app"**.
> * **Web-only on purpose:** deleting a booking, full cancellation, restoring old versions, bulk changes, deleting drivers, vehicles or vendors, saving the movement chart, and driver allocation.
>
> **Possible setup step:** the server calls its own public address (ops.aahaas.com) to run these actions. If Cloudflare or Amplify blocks that, set **`MOBILE_BRIDGE_ORIGIN`**.

**Checked:** same checks as Section 1, with no new web errors. **Not tested** against a server or on a phone.

---

## 3. OPS — Get trips: full day-by-day plan before requesting

`31c610c` · 4 files · +211

* **Trip cards:** each one previews the first two movements and has a **See day-by-day plan** link.
* **Plan screen header:** file number, country, dates, days, guests, vehicle type, cities in order, and *Today / Tomorrow / In N days*.
* **Warnings:** a clash with the driver's own trips, more guests than seats, or a day plan not on the chart yet.
* **One card per day:** each movement's times, route, description, service type and meal plan, a map link, *"Free day — no driving"*, and that night's hotel.
* **Request this trip** (or **Take this trip**) at the bottom. The screen reloads when opened, so a trip someone else just took shows as no longer open.
* **Server:** `open-trips/route.ts` now also returns descriptions, meal plans, end times and hotels. Agent and guest contacts are still left out.

> **Decision needed:** the movement description is free text typed by the team, so it **could contain a guest's name**. That name would then be visible to drivers before the trip is theirs. The alternative is to show only the route and times until the trip is assigned.

---

## 4. OPS — In progress: one house style for every Excel file (uncommitted)

* **New file:** `src/lib/excel-kit.ts`, a shared kit for ops workbooks. Each data tab names itself, explains how it was counted and carries a live `SUBTOTAL` row that follows filters. It also adds in-cell data bars, breakdown tabs, heatmaps and a dashboard canvas.
* **Daily report workbook:** `daily-workbook.ts` has been moved onto the kit (+265 / −465).
* **Not done yet:** the kit's header says the weekly, Ops Board and MC workbooks will use it too, but they **haven't been switched yet**.
* **Not committed or tested yet.**

---

## 5. Online Work — "Work from" follows the door scan

`c009347` · 6 files

* **What it does:** on the Attendance page, **Work from** now shows **Office** for anyone who scanned their face or fingerprint at the office terminal that day. The cell is labelled *"Door scan"*.
* **Priority:**
  1. a manual mark by admin or HR (always kept);
  2. a terminal scan;
  3. the person's own daily filing.
* **Overruling a scan:** click *Home* or *Client*. Clicking that manual mark again removes it, and the day goes back to the scan.
* **My Attendance:** shows the same, including in its CSV.
* **Ignored:** simulated scans, the boss and unknown faces.

> **Limit:** the terminal log keeps the latest **5,000 scans** (several weeks for one door). Older days fall back to the daily filing.

**Checked:** type check. **Not tested** against the live terminal or live page.

---

## 6. Online Work — Office TV policy and remote commands

`f831a63` · 14 files · +1,133

* **TV policy:** controls the sound, visibility and behaviour of each TV moment, such as the boss entrance and badge scans. It includes **volume** and **quiet hours**.
* **Remote commands:** **sound check** and **reload**, sent from the Settings panel.
* **Live changes:** the TV picks up policy changes without a reload.
* **Preview panel:** tests settings before they go to the screens.

---

## 7. Online Work — ⬇ Download all figures

`308ea8f` · 3 files · +220

* **Where:** a new button on **Settings → Check-in figures** saves every figure as one ZIP.
* **File names:** one file per person, named by employee code (`AHS004.webp`), so the folder can be edited and dropped straight back into the bulk importer.
* **`figures.csv`:** each person's code, name, department, figure source (uploaded or AI-painted), file name and date. People with no figure are listed at the end.
* **Special cases:** the boss goes in `_boss/`, and people with no code go in `_no-employee-code/`.
* **Options:** *Include AI-painted figures* (on by default) and *Convert all to PNG*.
* **Access:** admins only, and every download is audited.

**Checked:** the download against sample figures, in both modes. **Not seen** in a browser, because the dev server on `:3100` needs a restart.

---

## 8. Online Work — Offboarding and former employees

`681b1ff` · 17 files · +1,085

* **⇥ Offboard:** a new button on the profile, next to the status badges. The form asks for:
  * Resigned or Terminated;
  * the last working day and the notice date;
  * whether access ends **now** or **after the last working day**;
  * the reason, plus a confirmation tick.
* **When access ends:**
  * The person can't sign in, and anyone still signed in is logged out on their next click. Before, they kept access for up to 8 hours.
  * The desktop agent is signed out. This also closes a loophole where a switched-off account could reappear in the agent's sign-ups and be re-enabled with one click.
  * They drop out of Employees, attendance, face and QR check-ins, and the TV.
  * Their HR record is marked Resigned or Terminated, which opens its *Exit and clearance* section.
* **Nothing is deleted.**
* **Employees → "N former employees":**
  * search, with Resigned / Terminated filters;
  * the HR record stays viewable, for service letters;
  * **↺ Reinstate** brings the account back with all its history and the old password;
  * scheduled exits are listed at the top with *Cancel exit*.
* **Rules:**
  * only super admins and managers can offboard;
  * nobody can offboard themselves;
  * only a super admin can offboard another super admin.

> **Before deploying:**
> * Scheduled exits are saved in `scheduled-exits.json` in `HR_RECORDS_PATH`, which the live server already writes to.
> * The server checks it every 10 minutes. `EXIT_SCHEDULER=off` disables the check.
> * Accounts already switched off in the database also appear as former employees, with no reason or date.

**Checked:** offboarding logic against a test HR folder (bad input, scheduled exits, cancel, reinstate, audit). The former-employees query was run read-only. **Not clicked through** in a browser.

---

## 9. Follow-Up Items

1. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete the folder from the repo and add it to `.gitignore`.
2. **Mobile app go-live, in order:**
   1. `bash prisma/sql/apply-driver-app.sh --check` to see which database it targets, then run it without `--check`.
   2. Deploy the web app.
   3. **Driver App page → WhatsApp code template**, then wait for Meta approval. The WhatsApp number is rated **LIMITED** by Meta, so until approval codes go by e-mail.
   4. Call `/api/cron/mobile-notify` hourly on Amplify.
   5. Set `MOBILE_BRIDGE_ORIGIN` if the server can't reach ops.aahaas.com.
3. **Try the app on the iPhone 14 Pro:** run `npx expo start` in `driver-app`, then open it in Expo Go. In Expo Go, km only count while the app is on screen and push notifications don't work. A proper build needs an Apple Developer account ($99/yr).
4. **Decide:** hide movement descriptions on *Get trips* until a trip is assigned?
5. **OPS Excel kit:** move the weekly, Ops Board and MC workbooks onto it, test the files, then commit.
6. **Online Work:**
   * restart the dev server on `:3100`;
   * click through Offboard, Reinstate and Download all figures;
   * check *Work from* against a real door scan;
   * try the TV policy panel and remote commands on the real TV.
7. **Still open from 12 Oct:**
   * deploy Online Work and the nginx config, and check the site-wide password prompt;
   * check `/api/tv/office` after deploy;
   * Boss panel: *Save ID and name* and the `AHS000` figure, and confirm *Paradeep / Pradeep*;
   * connect the face terminal;
   * Terminal IDs *Apply* on production;
   * remove `SampleImage /` from the repo;
   * decide on `TV_VIEW_KEY` and QR link tokens.
8. **Still open from 10 Oct and earlier:**
   * Accounts INR invoice migration;
   * Employee IDs *Apply*, and HR emails for 19 people;
   * Task Manager staff photos commit and SQL;
   * OpenAI key revocation;
   * `DIRECTOR_BOARD_PUBLIC`;
   * Movement WhatsApp **Register with Meta**;
   * the B2C traveller name script;
   * the OPS report 45 / 29 / 16 for 07/10;
   * `GRAPH_MAIL_CLIENT_SECRET`;
   * the pending OPS and Bank Settlements scripts.
