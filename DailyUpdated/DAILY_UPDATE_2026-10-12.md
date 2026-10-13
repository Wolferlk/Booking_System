# Daily Work Update — 12 October 2026 (Monday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 12 Oct 2026 (Online Work: check-in figures for every employee, profile pictures from figures with a hand crop, the boss badge `AHS000`, a new Face Terminal page for the office door, Terminal IDs from the Excel sheet, and a cinematic Office TV at `/tv/view`)

---

## Executive Summary

Today's work was all on **Online Work**, in six parts:

* **Check-in figures:** each person can now have their own figure in the boardroom. The employee or an admin can upload one, or an admin can bulk-import a whole folder.
* **Profile pictures:** made automatically from the figure, with a new **hand crop**.
* **Boss badge:** swiping `AHS000` opens a gold Director boardroom and does **not** mark attendance.
* **Face terminal:** a new **Face terminal page** connects the Hikvision DS-K1T320 at the door. A face scan files attendance by the same rules as a badge scan.
* **Terminal IDs:** a new page reads the HR Excel sheet and links each terminal number to an employee.
* **Office TV** (`/tv/view`): rebuilt as a cinematic team hall. It rests on the OPS view, and each check-in plays a welcome followed by a team photo.

`main2-design` was **merged into `main`** this morning (PR #9 and #10). Since then all work goes straight onto `main`.

**No commits in OPS or Accounts today.** Task Manager's staff photos work is **still uncommitted**.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | No commits today | `LIVE-1.0.0v` | Clean · up to date |
| Aahaas Online Work | 18 on `main` (incl. 2 merges) | `main` | Pushed · clean · `main2-design` fully merged |
| Accounts System | No commits | `REV1` | Clean · INR invoice migration from 10 Oct still to run |
| Aahaas Task Manager | No commits | `main` | **Uncommitted:** staff photos (5 new files, from 09 Oct) |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** many say *"nothing is committed or deployed"*. That was true when each message was written. **Every change listed here is now committed and pushed.** Nothing has been checked as deployed.

> ⚠️ **Still open:** `ssh-keys/developer_key` (a private SSH key) is **still tracked in the Online Work repo** (Section 7).

---

## 0. Late on 10 Oct (after that day's update)

`0fa7582` · merged as PR #8

* **New entry into WTC on the badge page:** a gold targeting reticle locks onto the WTC East doorway. The camera then dives in through light-speed streaks, and the doorway opens as a circular portal onto the lobby.
* The black letterbox bars and the white flash are gone.
* **Checked:** frame-by-frame in headless Chrome, and the production build passes. **Not listened to:** the new target-lock sound.

---

## 1. Online Work — Check-in figures for every employee

`50fe292` · 24 files · +1,556

**Three ways to add a figure:**
* the employee uploads it from **My account**;
* an admin uploads it from the employee's page;
* an admin bulk-imports a folder from **Settings → Check-in figures**, with files named by employee code.

At check-in, **an uploaded figure always beats the AI-painted one.**

* **Figure panel:** shows a mini boardroom preview of the figure. It also shows whether the background is transparent, who uploaded the figure, and its size and date.
* **Solid backgrounds:** a photo with a solid background gets a **"✦ Remove background with AI"** button, which uses OpenAI. If the result still isn't transparent, the original is kept.
* **Bulk import:** files are matched by name, and subfolders count, so `AHS004.png`, `ahs007.png` and `extra/AHS012_final.png` all match.
  * A review board tags each file *New*, *Replaces current*, *Duplicate*, *No employee with this code* or *Not a picture*. You can untick any file.
  * Three files upload at a time.
  * Afterwards, a coverage ring shows who still has no figure.
* **Storage:** every upload is turned upright, trimmed, fitted into 1024×1536 and saved as transparent WebP (the 1.85 MB sample became 152 KB). Figures are stored in `.data/badge-figures/`, not in the database. Every admin change is audited.
* `sharp` is now a direct dependency.

> **nginx:** production caps uploads at 2 MB and times out at 120 s. A new rule allows 25 MB and 200 s on the figure routes, but **it only applies once the nginx config is deployed**. The same file also puts a **password prompt on the whole site**. If that file is what's live, phones scanning a badge will get a password box first. **Needs checking.**

**Checked:** upload and permission rules against the real routes, and the bulk importer driven in Chrome, all with the database switched off and `AHS004.png` as the sample. **Not tested** against real employees.

---

## 2. Online Work — Profile pictures from figures, and a hand crop

`5071410` (+525) · `57fa242` (+381)

* **Automatic headshot:** when someone gets a figure and has no profile picture, the server finds the head, crops a headshot onto a dark teal-glow background and makes it their profile picture.
  * A photo the person uploaded themselves is **never overwritten**.
  * Removing the figure removes the headshot made from it.
  * Figures with a solid background don't get one.
* **Bulk button** *"Give N people a profile picture from their figure"*: only fills gaps, so running it twice adds nothing. Admins only.
* **✂ Adjust the crop by hand:** drag or resize a square frame, with a round live preview, then *Save picture*. This works on solid-background photos too. It's on **My account** and on the admin employee page. It asks before replacing a self-uploaded photo.

> **Limits:** replacing the figure re-cuts the picture automatically, so a hand crop is lost and has to be redone. The **crop-frame animation on the profile page hasn't been seen** after its last fix, because the browser test crashed.

---

## 3. Online Work — Boss badge (`AHS000`)

`f38ae03` · `4472919` · `698e7d7`

* **No attendance:** swiping `/me/profile/AHS000` marks no attendance.
* **What it shows instead:** the same seafront ride and "Built for change" screen, then the boardroom with the boss's figure on a **gold stand**, the labels *Role Director · Access Full board*, and a spoken *"Good morning, Mr. … Kumar! Your Director Board is ready."*
* **Enter Director Board** opens `/ceo`.
* **Boss panel:** at the top of **Settings → Check-in figures**. It holds the boss's figure, ID and name. A new default figure is used for people with no photo.
* **Fix for "Save ID and name" (500 on live):** the boss details were being written to `.data/boss/`, which the live server most likely can't write. They are now saved next to the check-in figures, a folder the live server is known to write to. Any future failure shows the real reason on screen.

> **Before it works live:** deploy, upload the boss figure in the Boss panel (`AHS000.png` only exists on this Mac), then press **Save ID and name** again. `AHS000` must belong to an active employee. `/ceo` must stay public for the button to go straight in.
>
> **Check the name:** the greeting in `f38ae03` says **"Paradeep"**, but the later commits use **"Pradeep"**. Confirm the spelling in the Boss panel.

> **Repo note:** `4472919` committed `SampleImage /AHS_Defult.png` (1.6 MB, folder name has a trailing space), even though earlier notes said to keep that folder out of git.

---

## 4. Online Work — Face Terminal page (Hikvision DS-K1T320)

`e9e2ee2` · 14 files · +1,683 · then `63de315`

New page at **`/settings/face-terminal`** (under Fleet):

* **What it shows:**
  * a live drawing of the terminal with the latest face (refreshes every 5 s);
  * today's counts: faces, late, not recognised and unknown IDs;
  * a live door list, an *In today* list and arrivals by hour.
* **Setup:** a step-by-step *Connect a terminal* guide that turns green as each step is done.
* **Managing terminals:** rename, switch off, issue a new address, remove, or *Simulate* (a pretend scan that doesn't touch attendance).
* **Attendance rules (same as the badge):** the terminal's Employee ID must be the portal code (e.g. `AHS001`). The **earliest face of the day is the arrival**, and late or on time follows the person's shift. Days that were admin-corrected, on leave or a holiday are never touched. Backlog scans are filed at the time the face was seen. The boss files nothing.
* **Hours from the terminal:** a switch, **off by default**. When on, it can only *raise* hours already counted, never lower them.
* **Storage:** scan history is kept in `.data/face-terminal/`, which must survive redeploys.
* **Later (`63de315`):** a face from someone already in today now replays the welcome on the TV, like a repeat badge scan. A later face no longer relabels an earlier QR arrival as "face".

> **To connect the terminal:**
> 1. Deploy, and copy the updated `infra/nginx/online-work.conf` to the server so the terminal skips the password prompt.
> 2. Press **Add terminal** on the page.
> 3. On the device, set up **HTTP Listening**: `online-work.aahaas.com`, port 443, HTTPS, JSON, and the URL shown on the page. Leave ISUP off.
> 4. Set the device clock to UTC+05:30 with NTP on.
> 5. Enrol people with their portal code as the Employee ID.

**Checked:** events shaped like the terminal's (photo attached, duplicate, unknown face, door events, wrong address, boss code), with the database switched off. **Not tested** with the real device.

---

## 5. Online Work — Terminal IDs from the Excel sheet

`ebc4efa` · 39 files · +5,540 · plus linking in `e73fca3`

* **Terminal Emp No.:** each employee now has one. It sits on their page under Employee ID, along with when the terminal last saw them.
* **Settings → Terminal IDs:**
  * a coverage bar;
  * **Fetch sheet → preview → Apply** (only ticked rows are saved);
  * an *Everyone* table with inline edit and a CSV download.
* **Matching rules:**
  * Rows are matched by **System Employee ID** and checked against the email.
  * Leading zeros don't matter (`0001` = `1`).
  * Each person has one number.
  * A number already held by someone else is refused on the employee page and flagged *"moves from …"* in the sheet.
* **On the Face Terminal page:** each unmatched ID has a picker, with a match suggested from the name typed on the terminal (`0016` → Sasindu). Linking also files that ID's **last 36 hours of scans** as attendance.
* **Unchanged:** `employee_code` is only read, never changed. Terminal numbers live in the terminal's data file, not the database.

**Checked:** the real sheet was read (67 rows, all 7 columns found). 7 rows marked *"Review name / alias"* start unticked. Dilaxani and Divya are skipped because they have no system ID, and Arun is *"not on the terminal"*. **Apply was not pressed, because it writes attendance.** The local database has no AHS codes, so it must be run on production.

---

## 6. Online Work — Office TV (`/tv/view`)

`e73fca3` · `39698c5` · `951219f` · `06a74ca` · `e1c0702` · `8c4e1b1` · `611b364`

* **Team hall:** everyone in today stands in a photoreal "Aahaas team hall" (night version in the evenings) as their own figure, with a name tag, arrival time and a gold **First in** tag.
  * People without a figure show as a teal hologram.
  * Up to 60 people fit in risen rows.
  * Figures breathe and sway, and a Mexican wave sometimes rolls through the crowd.
* **On a check-in:**
  1. A portal door opens and the figure builds out of particles.
  2. *"Welcome, NAME"* types out and a voice greets the person.
  3. The person flies into their spot, and a camera flash retakes the team photo.

  Any check-in source triggers this: face, badge, web, desktop agent or an admin mark.
* **Between check-ins:** the TV rests on **`https://ops.aahaas.com/view`**. After each arrival, the team photo stays up for 25 s and then the OPS view returns.
* **Settings → Office TV:** a switch for the OPS view and its address. TVs follow within seconds, with no reload.
* **Repeat badge scans** play *"Welcome back"* without changing attendance. Several swipes within a minute count as one.
* **Boss entrance** (`611b364`): when the boss arrives, the TV plays its own animation and sound.
* **"TV showed 0" fix:** the live feed `/api/tv/office` answered **503**. The likely causes are fixed, and any further failure returns an error code. The TV now counts Present, Late and Half day the same way the Attendance page does, so people an admin marked present are included.

> **Privacy:** `/tv/view` needs no sign-in, so anyone with the link sees first names, arrival times and figures. Setting `TV_VIEW_KEY` on the server makes the link require `?key=…`.
>
> **Sound:** the TV needs one click to allow sound, or Chrome started with `--autoplay-policy=no-user-gesture-required`.

**Checked:** type check and production build. Demo mornings (`?demo=1`, `?demo=60`) in headless Chrome. **Not tested:** real check-ins, the real TV, and the OPS view's live data (Cloudflare blocks headless Chrome).

---

## 7. Follow-Up Items

1. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete the folder from the repo and add it to `.gitignore`.
2. **Deploy Online Work and the nginx config.** The config raises the figure upload limits and lets the face terminal skip the password prompt. **Check whether the site-wide password prompt is live**, since it would block badge scans on phones.
3. **After deploy:**
   * open `/api/tv/office`, which should show about 54 present; if not, send the error code;
   * press **Save ID and name** in the Boss panel and upload the `AHS000` figure;
   * confirm *Paradeep / Pradeep*.
4. **Face terminal:** set up HTTP Listening and the clock on the device, enrol faces with portal codes, and check that the first real scan appears on the page and the TV.
5. **Terminal IDs:** *Fetch sheet* on production, review the 7 alias rows, then *Apply*.
6. **Decide:**
   * `TV_VIEW_KEY` for the TV link;
   * secret tokens in QR links, or office-network-only scans (still open from 10 Oct);
   * whether repeat faces at the door should replay on the TV with a cooldown.
7. **Remove** the committed `SampleImage /` folder from the repo.
8. **Still open from 10 Oct:**
   * Accounts INR invoice migration;
   * Employee IDs *Apply* on production, and HR emails for the 19 people;
   * Task Manager staff photos commit and the `schema_05` / `schema_06` SQL;
   * a real phone check-in with sound.
9. **Still open from 09 Oct and earlier:**
   * OpenAI key revocation;
   * `DIRECTOR_BOARD_PUBLIC`;
   * Movement WhatsApp **Register with Meta**;
   * the B2C traveller name script;
   * the OPS report 45 / 29 / 16 for 07/10;
   * `GRAPH_MAIL_CLIENT_SECRET`;
   * the pending OPS and Bank Settlements scripts.
