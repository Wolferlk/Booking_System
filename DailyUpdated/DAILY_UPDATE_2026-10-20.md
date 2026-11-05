# Daily Work Update — 20 October 2026 (Tuesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 20 Oct 2026 (Driver app "Aahaas CORE": renamed, new icons, Play Store closed-test steps, test driver account with fake trips, more accurate GPS km, full redesign of every tab, car marker and full-screen live map; Online Work: Halloween advert at `/ad/1`, faster employee page)

---

## Executive Summary

**OPS — Driver app (Aahaas CORE):**
* **Renamed** to **"Aahaas CORE"**, with new iPhone and Android icons and a Play Store icon. **versionCode 4** started building on EAS.
* **Play Console:** the closed test (Alpha) has no release yet. I wrote down the steps to upload the `.aab`, finish the dashboard tasks and send it for review.
* **Test driver account** for `sandun@mail.com` (Sadun Eric): the server gives this account made-up trips (1 ongoing, 2 upcoming, 2 finished). **No booking, P&L or ops record is ever written**, and actions that would reach ops are refused.
* **GPS km is more accurate:** bad points and jumps are dropped before km is counted, and the server's km figure is shown in the app.
* **Every tab redesigned** (Today, My trips, Get trips, Score, Me): gradient headers with the logo, day-by-day banners, animated cards, a new swipe button with vibration, and a floating bottom bar.
* **Car on the map** that turns with the road, plus a **full-screen live map** with a speedometer, km counter, timer and next stop.

**Online Work:**
* **Halloween advert** for the office TV at **`/ad/1`** (85 s, music, countdown to 30 Oct). Opens without sign-in. Committed and pushed, **not deployed**.
* **Employee page loads faster:** reads now run together, and a loading skeleton shows straight away. **Not committed yet.**

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS (driver app + mobile API) | 11 commits | `LIVE-1.0.0v` | Pushed · clean |
| Aahaas Online Work | 1 commit | `main` | Pushed · **3 files not committed** (employee page) |
| Accounts System | None (last one `0031942`, 19 Oct) | `REV1` | Pushed · clean |

> **About the commit messages:** some say *"I haven't committed anything"*. That was true when the message was written. **Every commit listed here is now pushed.** Nothing has been checked as deployed, and **none of the app changes have been seen on a real phone yet.**

> **Committed after yesterday's task list:** OPS `b36d2fc` and Accounts `0031942` (Trans-Reconsultation P&L picker, 18:14 on 19 Oct). These are already in the 19 Oct task list, section 5.

---

## 1. Driver app — more accurate GPS km

`3903d97` · 5 files · +213 / −24 — `location.ts`, `trip-control.tsx`, `mobile/geo.ts`, `mobile/sessions.ts`

* New speed and hop limits drop GPS points that are impossible (jumps, points while standing still).
* Distance is counted from a fixed **anchor point**, so small GPS drift no longer adds up to fake km.
* After points are uploaded, the app shows **the km the server worked out**, so phone and server agree.

**Checked:** type-check. **Not tested on a real drive.**

---

## 2. Driver app — "Aahaas CORE" name, icons and Play Store

`ebeaef2` (2 files) · `78692d6` (12 logo files) · `ecd5808` (3 files)

* **Name:** the app is now **"Aahaas CORE"** in `app.json`, and the descriptions on the Me screen were updated.
* **Logos:** the design files (Play Store icon 512, feature graphic 1024×500, banner) are kept in `Aahaas_Operation_App/APP_logos/`.
* **iPhone icon:** `icon.png` is now a full 1024×1024 square with no transparent corners. Apple rejects transparent icons.
* **Android icon:** new `adaptive-icon.png`, with the logo at 72% on navy (`#062476`), so the "A" and both orbit dots stay visible when Android cuts the icon into a circle.
* **Play Console icon:** `~/Desktop/Aahaas-CORE-build/play-icon-512.png` updated. It needs to be uploaded in the store listing.
* **Android build:** **versionCode 4** started building on EAS. Upload that `.aab` instead of versionCode 3.
* **Play Console steps (closed test is not live yet):**
  1. Closed testing → Alpha → **Create new release**. Upload the `.aab`, name it `1.0.0 (n)`, add release notes, then **Save** (don't roll out yet).
  2. Dashboard → *Set up your app*: finish every item that has no green tick. After the upload, a **Location permissions** item will appear. It needs the background-location text and a YouTube video link.
  3. When everything is ticked, click **Send app for review**.
  4. Optional: limit Production countries to **Sri Lanka, Vietnam, Malaysia, Singapore** (now 177 + rest of world).
* The splash screen still shows the old red Aahaas mark.

---

## 3. OPS — Test driver account with fake trips

`6a49fc6` · 10 files · +262 / −3 — mobile API (`lib/mobile/sandbox.ts` and others)

* When **`sandun@mail.com` (Sadun Eric)** signs in, the server creates trips in code. **Every other driver gets their real trips exactly as before.**

| Trip | Dates (move with the current week) | State |
|---|---|---|
| TEST-SBX-261019-ONG | Mon 19 → Sun 25 Oct, 7 days | Ongoing: Monday done (38.4 km), today ready for "Start day" |
| TEST-SBX-261019-UP1 | 27 → 29 Oct | Upcoming |
| TEST-SBX-261019-UP2 | 3 → 6 Nov | Upcoming |
| TEST-SBX-261019-DN1 | 13 → 15 Oct | Finished, 232 km |
| TEST-SBX-261019-DN2 | 9 → 11 Oct | Finished, 232 km |

* **How live data is protected:**
  * No booking, agenda, assignment, P&L or ops record is created or changed. The only writes go to the app's own trip, day and GPS tables, all marked `TEST-SBX`.
  * The ops live map and the "driving now" count ignore test trips. Staff get no notifications, and finishing a trip doesn't alert ops.
  * Help request, hand-over, vehicle check, profile change and claiming an open trip are refused with *"Test driver account — not sent to operations"*.
* Get trips still shows the real open trips. He can look at them but can't claim them. Guest-portal and feedback QR codes on test trips lead to "not found".

**Before it can be tested:** deploy `ops.aahaas.com`, run `bash prisma/sql/apply-driver-app.sh` on live if it hasn't been run, and someone must receive the one-time sign-in code (WhatsApp or `sandun@mail.com`).

**Phone test plan:** use the **installed build** (Expo Go can't track with the screen off). Start day, allow location *All the time*, lock the phone and drive 5–10 km, then compare with Google Maps or the odometer. The km should update about every 30 s. End day, Start day again the next day, and Finish trip on Sunday (feedback step is skipped).

**Checked:** offline with a fake database; a dry run returned real trips unchanged for a normal driver. **Not on the live server yet.**

---

## 4. Driver app — Today screen and swipe button

`ee46130` (8 files, +728 / −128) · `3819033` (16 files, +705 / −138)

* **Swipe button:** rebuilt with gesture-handler and reanimated for smoother movement, vibration while sliding and on completion, and chevron hints.
* **Live day card:** km driven, next movement and the route on a map (Google Maps on Android when a key is set, otherwise an animated sketch), with a radar pulse for GPS. The GPS path is saved on the phone so it survives restarts.
* **Ready card** before the day starts, with a gentle bob.
* **Today screen, top to bottom:**
  * **Greeting banner:** a painted Sri Lankan road scene that changes with the time of day (sunrise, blue sky, moonlit road), with the driver's photo, *"Good afternoon, Sadun 👋"*, the date, and bell and SOS buttons.
  * **Vehicle photos** to-do card with a wiggling camera.
  * **Trip card** leads with the **guest's name**, a "Day 2 of 7" chip, an Open trip button and a progress bar. On the last day it turns gold and says to show the feedback QR.
  * **Day done:** dusk-purple card with stars and today's km. The confusing second swipe is gone. *"Ended by mistake? Continue today"* is now a small link that asks you to confirm first.
  * **Today's journey:** time bubbles, from/to dots, a Navigate button, and a dotted road with a little car. Hotels are lilac cards and flights look like boarding passes. The trip screen uses the same look.
  * **Read my day aloud** button, **Next trip** countdown, **This month** tiles (km, days driven, upcoming).
  * **Bottom bar:** floating and rounded, with the active tab in a red bubble and a small vibration on each tap.
* Small server changes in `api/mobile/notifications` and `mobile/sessions.ts`.
* One edit script corrupted `trip-control.tsx` on the way. It was restored from the last commit and the changes were applied again. All checks pass.

**Checked:** type-check, lint, and the app bundles for Android and iOS. **Not seen on a phone.**

---

## 5. Driver app — Car marker and full-screen live map

`dcf937d` (`route-map.tsx`, +112 / −38) · `7738136` (5 files, +192 / −3)

* **Car on the map:** a top-down white car with a red stripe, inside a red halo, replaces the blue dot. It **turns to face the way you're driving**, worked out from the last few GPS points. The route is a glowing red line, and a green dot marks where the day started.
* **Full-screen live map** (tap the map or **Full map**):
  * **Top 3/4:** drag, zoom and traffic; **Follow car** / **Whole route** toggle; a back button; a *LIVE · DAY 2* badge with a green or amber dot for the GPS mode.
  * **Bottom 1/4:** a speedometer (green → amber → red), a km counter that counts up, trip km, the on-the-road timer, and the next stop with a **Go** button that opens navigation.
  * Updates live as new GPS points arrive.
* **Android without a Google Maps key:** the drawn route on a dark grid with the car pointing the right way. With a key, it's a real Google map.

**Checked:** type-check, lint, and bundles for Android and iOS. **Not tried on a phone or a real drive.** In Expo Go the car only moves while the app is open.

---

## 6. Driver app — My trips, Get trips, Score and Me redesign

`4cea85c` (12 files, +799 / −226) · `3ab715e` (4 files, +60 / −8) · `fd1ab91` (3 banner images)

* **All four tabs** now start with a gradient header that has the Aahaas logo, a title, a short live summary and an icon. Cards slide in one after another.
* **My trips:** *"3 coming up · 2 finished · 464 km driven"*. Upcoming / Finished tabs with a sliding pill. Each trip card has a coloured date block (red running, green ready, blue upcoming, grey finished), the guest name, the reference, the start point, and chips for dates, days, pax and km. The running trip is a navy card with *"RUNNING · DAY 2 OF 7"* and a progress bar.
* **Get trips:** *"5 open trips need a driver"*. ⚡ badges for Today and Tomorrow, the route as city chips, the first legs as time bubbles, and a **Request** button that changes to *Requested* with an hourglass. Requests waiting for approval have a **Withdraw** button. Warnings (busy dates, too many guests) show as amber notes.
* **Score:** the ring draws in and the number counts up, stars pop in, there are six stat tiles, earned badges are gold and locked ones grey with a padlock, km per month shows as bars, and guest comments show as speech bubbles (green praise, pink complaints).
* **Me:** a navy profile banner with a *DRIVER* pill and a photo ring, a vehicle card with the plate drawn like a real number plate and a *Photos due* badge, coloured icons on My details, language chips with flags, menu rows with short explanations, and a red Sign out button.
* **Header finish (`3ab715e`, `fd1ab91`):** the new `BrandBackdrop` makes the header look like the app icon: dark navy corners, a blue glow top-left, a red-to-magenta glow bottom-right, and a thin blue-to-red orbit arc with two glowing dots. The banner images were updated.

**Checked:** type-check, lint, and bundles for Android and iOS. **Not seen on a phone.**

> **OpenAI key:** used for **7 images** today (road banners, car, illustrations). It is still the exposed key from `LIVE_ENV.md`. **Rotate it once the design work is done.**

---

## 7. Online Work — Halloween advert for the office TV

`6888838` · 9 files · +582 / −1

* **The advert:** `src/ads/halloween-2026.html`. It plays for 85 s with every detail from the poster, AI pictures, music and sound effects, a live countdown to **30 October**, and a fullscreen button. 6 pictures in `public/ad/halloween/` (~390 KB).
* **Address:** `src/app/ad/[id]/route.ts` serves it at **`/ad/1`**. Each new advert takes one line and gets the next number. `/ad/2` shows "not found".
* **No sign-in:** `/ad/...` was added to the open list in `middleware.ts`, the same way `/tv` is. Advert pages can also be shown inside another app's frame (for signage apps). Every other page still requires sign-in and still blocks framing.
* **On the TV:** tap once for sound (browsers block it until someone taps), and press **F** for fullscreen.

**Checked:** type-check; `/ad/1` opens without sign-in and all pictures load; other pages still ask for sign-in. **Not watched all the way through in a browser.** **Not deployed.** To deploy, follow `infra/DEPLOY.md`: pull, `npm run build`, restart `aahaas-online-work`.

---

## 8. Online Work — Faster employee page (not committed)

`employees/[id]/page.tsx`, `lib/repo.ts`, new `employees/[id]/loading.tsx` · +59 / −32

* All the profile reads (timeline, app usage, shift, roster, exit date, badge figure, and the rest) now **run together** instead of one after another.
* New **loading skeleton**, shown as soon as a name is clicked, so the list never looks frozen.
* Mail / Teams comms on the employee panel were changed as part of this.

**Not committed, not checked.** Run the type-check, open a few employee pages, then commit.

---

## 9. Follow-Up Items

1. **Driver app (Aahaas CORE):**
   * when the versionCode 4 `.aab` is ready, upload it to Closed testing → Alpha, finish the dashboard tasks (including Location permissions with the video link), then **Send app for review**;
   * upload the new 512 icon in the store listing; decide whether the **splash screen** should get the new logo too;
   * today's redesign, live map and car need **a new build (versionCode 5)** to reach Play testers;
   * optional: limit Production countries to SL, VN, MY, SG.
2. **Test driver account:** deploy `ops.aahaas.com`; run `apply-driver-app.sh` on live if needed; make sure someone can receive Sadun's sign-in code; follow the phone test plan in section 3 and **compare the km with the odometer**.
3. **Online Work:** commit and deploy the Halloween advert and the employee page change, then open `/ad/1` on the office TV once with sound.
4. ⚠️ **OpenAI key:** used for 7 more images today. **Rotate it** with the other exposed secrets.
5. **Still open from 19 Oct:**
   * B2C guest names: `php artisan b2c:customer-names --stand-ins` on live; `scripts/b2c-fix-lead-names.ts` on OPS;
   * AppleSystem Sync preview on dev (IS49403);
   * check "Settle from Aahaas" on one real MYR order;
   * open one package-notes WhatsApp document and `/print/booking/IS49242`;
   * **Trans-Reconsultation:** run `apply-trans-recon.sh --check`, then run it; grant the page to Accounts roles; generate Malaysia 16–30 Sep and import the desk Excel;
   * Daily Trip Briefing: **find what calls `/api/cron/customer-daily-briefing` on Amplify** (every 5–10 min);
   * SharePoint archive: `php artisan migrate`, set the settings, upload one report.
6. **Still open from 17 Oct and earlier:** Online Work deploy (`npm install` for Sharp) and HRMS paged API checks; Marketing Arena Leaders Dashboard on the real database; B2C Update Booking (`b2c_order_versions` migration, secrets, test on 15077); decide the *highest version + 1* fix; Accounts server load (`pnl_records` queries, Low-load preset); remove `ssh-keys/developer_key` and the door bridge token from Git history; the missing **17 and 19 Oct daily updates**.
