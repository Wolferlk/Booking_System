# Daily Work Update — 10 October 2026 (Saturday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 10 Oct 2026 (Online Work: Employee IDs sync from the SharePoint sheet; new QR badge check-in page at `/me/profile/<EMP_ID>` rebuilt as a cinematic, game-style sequence with sound, voice and a 3D figure; Accounts: INR invoices for B2C bookings)

---

## Executive Summary

Most of today's work was on **Online Work**. There is a new **Employee IDs page** in Settings that reads the HR SharePoint sheet and sets each person's employee code. The QR badge link `/me/profile/<EMP_ID>` now opens a **check-in page with no login needed**: one swipe marks the person present. That page was then rebuilt during the day into a **cinematic, game-style sequence**: a Colombo seafront ride from One Galle Face to WTC, a "Built for Change" AI travel screen, an Aahaas boardroom, and the person's own 3D figure, with music, sound effects and an OpenAI voice.

In **Accounts**, the B2C Invoices page can now make an **INR invoice** for a booking. It is a separate record, so the USD invoice, its payments and its PDF are never changed. **It needs a migration on the server before the button shows.**

**No commits in OPS today.** Task Manager's staff photos work is **still uncommitted**, unchanged since yesterday.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | No commits today | `LIVE-1.0.0v` | 08 and 09 Oct daily updates not yet committed |
| Aahaas Online Work | 2 on `main` + 8 on `main2-design` | `main2-design` | Pushed · `main2-design` is 8 commits ahead of `main`, not merged · **Uncommitted:** small fixes to `badge-check-in.tsx` and `badge-sounds.ts` |
| Accounts System | 1 commit | `REV1` | Clean · up to date with origin |
| Aahaas Task Manager | No commits | `main` | **Uncommitted:** staff photos (5 new files, from 09 Oct) |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** several say *"nothing is committed or deployed"*. That was true when each message was written. **Every change listed here is now committed and pushed**, except the two small uncommitted files above. Nothing has been checked as deployed.

> ⚠️ **Still open:** `ssh-keys/developer_key` (a private SSH key) is **still tracked in the Online Work repo** (Section 4).

---

## 1. Online Work — Employee IDs from the SharePoint sheet

`892e9f0` · 7 files · +514 · on `main`

**Settings → Employee IDs → Configure:** paste the SharePoint link and click *Save link*.

* **Fetch sheet** downloads the workbook through Microsoft Graph and matches each row to a system user **by email**. It shows who changes (current code → code from the sheet) and which rows were skipped and why. **Nothing is written at this step.**
* **Apply N changes** reads the sheet again and sets each person's employee code, using the same save as the employee page, so **every change is audited** under the person who clicked it.
* **Skipped rows, with the reason shown:** no email or no ID, an email no user has, an email or ID that appears twice in the sheet, or an ID that already belongs to someone else.
* People not in the sheet keep their current code; the sheet never clears one. Column headers are found by name in the first 15 rows, so moving columns doesn't break it.
* **Fix:** the Excel reader (ExcelJS) crashed on the QR code images in the sheet. Images are now stripped before reading. `jszip` was added to `package.json` as a direct dependency.

> **Before relying on it:** the 19 people added earlier have **no email in the sheet**, so they'll be skipped until HR fills them in. Only exact email matches get an ID (a misspelled address like `kasun.tjilakarathna@` only matches if that account exists). The local `.env.local` points at the dev database (4 users), so **Apply must be run on the production server** to set codes for real staff.

**Checked:** type check, and the sheet reader on a test Excel file. **The SharePoint link has not been fetched, the page hasn't been opened in a browser, and no IDs were written.**

---

## 2. Online Work — QR badge check-in page (`/me/profile/<EMP_ID>`)

### First version

`7955399` · 15 files · +2,145 / −2 · on `main`

* The QR badge link now opens a page **without a login**, and **one swipe marks the person present** for today.
* **Safety limits:** it only ever marks *present for today*. It never checks anyone out, and never changes a day that already has an arrival, an admin correction or leave. Each phone is limited to **12 scans a minute**, and every check-in is logged with the phone's IP address and browser.
* A late arrival is still recorded as late, but the screen shows a friendly *"You're all checked in"*.
* The avatar is painted once by OpenAI from the person's profile photo, saved and reused every day after. People with no photo get a generic figure.

### Rebuilt as a cinematic, game-style sequence

`cae81c0`, `5df2d3e`, `56ecc96`, `d4d5354`, `d16e58f`, `15401e3`, `bb12d6a`, `cf6ff1c` · on `main2-design` (not merged)

| Step | What the person sees |
|---|---|
| **Landing** | A photo-real golden-hour panorama of the Colombo seafront, with a "One Galle Face · you are here" marker and a "WTC East · 1.3 KM" marker that counts down |
| **Swipe** | The camera pans past Galle Face Hotel, One Galle Face, Shangri-La, Altair, the Lotus Tower, the Old Parliament and the clock tower to the WTC twins, each with a small landmark tag |
| **Dive** | Impact hit, letterbox bars, and the camera dives into WTC East's doorway, then a white flash into the lobby |
| **AI travel screen** | "AAHAAS · AI TRAVEL MODE": a holographic globe with flight arcs from Colombo (CMB) to Dubai, Malé, Delhi, Singapore, Bangkok, London, Paris, Tokyo and Sydney; "BUILT FOR / CHANGE"; the voice says *"Welcome to an AI-native travel company"*; an AI agent log ticks off Flights, Hotels, Itineraries and Quotes |
| **Boardroom** | A realistic Aahaas boardroom with the **Aahaas logo and "BUILT FOR CHANGE" on the wall**; the lights flicker on and the camera pulls back to the table and the Colombo view |
| **Person appears** | A column of light, then the person's 3D figure assembles from particles, feet first, with a targeting frame and callouts |
| **Results card** | "Achievement unlocked", then *"Check-in confirmed"*, a typed *"Good morning, Sasindu!"*, a daily message, arrival time, status, and **Enter Online Platform** (goes to `/workplace`) |

* **Sound:** cinematic music, seafront and lobby ambience, effects for each step, and an OpenAI voice greeting. All effects are made in the browser. The shared welcome line is one static file (`public/qr/welcome.mp3`), so it costs nothing per scan. A 🔊 button mutes it.
* **Art:** the panorama, lobby and boardroom were painted with OpenAI (the boardroom used the real logo file as reference). `npm run qr:art` repaints them. The reference photos are kept out of Git in `.data/qr-art/refs/`.
* **Fixes during the day:** the sign-in middleware would have blocked the art and sound for phones that aren't logged in (`/qr/` is now let through); a dark strip on the top-right edge before the swipe, and a thin bright line across the screen from the sun flare, were both fixed.
* **Off switches:** `QR_CARTOON_FROM_PHOTO=off` stops profile photos being sent to OpenAI; `QR_VOICE=off` turns off the personal voice.

> **Decision needed — guessable links:** anyone with an employee's link can mark that person present, and codes like `AHS001` are easy to guess. Options: put a **random secret token** in each QR link instead of the plain ID, or **only accept scans from the office network**.

> **OpenAI cost:** one full-body image per employee (made once, then reused), plus at most six short voice clips per person. What's sent: the profile photo (for the figure) and the first name (for the voice).

**Checked:** production build, and the full flow in headless Chrome at phone and laptop size with a **demo employee and a faked check-in reply**. **Not tested:** real attendance against the database, a figure painted from a real profile photo, the personal voice, and how the sound actually sounds (headless Chrome has no audio).

---

## 3. Accounts — INR invoices for B2C bookings

`7fb75f9` · 10 files · +2,075 / −5 · **migration needed**

* **₹ INR button** on each invoiced row of the B2C Invoices page. A dot shows status: **green** saved, **amber** the USD invoice changed since, **red** void.
* **Separate record:** the INR invoice lives in two new tables. The USD invoice, its payments, its PDF and the reports are **never changed**. That's why the B2B *Edit & Convert* couldn't be reused: it converts the invoice itself.
* **Rate:** CBSL (same as B2B Edit & Convert), live market, a fixed rate, or typed in. *Rescale* moves to a new rate and keeps edits; *Fresh from USD* rebuilds from the USD invoice.
* **Editing:** every line, fee, tax, discount, bill-to, booking detail and note. You can type an exact total (e.g. ₹3,300) and the difference is spread across the lines.
* **Preview and PDF:** a live preview shows exactly what prints. PDFs use **dompdf**, which the app already has, so Puppeteer isn't needed.
* **Versions:** each save is a new version; *History* restores any of them. *Void* keeps the record and prints "VOID".
* **Settings (⚙):** default rate source, fixed rate, rate adjustment %, decimals, rounding (₹1 / ₹10 / ₹100), optional GST, number suffix (`AHS-15064` → `AHS-15064-INR`), title, footer, INR bank details and terms.
* **Shared change:** the PDF renderer used by Edit & Convert got two optional settings. Existing invoices print exactly as before.

**Checked:** 18 checks on a throwaway SQLite copy (conversion, save, edit, exact total, restore, rescale, settings, void, PDF), and the USD invoice row stayed byte-identical. PDF and popup checked in headless Chrome. **Not tested:** the live-market rate, and the page inside the running app with login. **Live data was never touched.**

> **Before it shows on the live site:** run `php artisan migrate --pretend`, then `php artisan migrate` (`2026_10_10_120000_create_b2c_inr_invoices_tables.php`, creates two new tables only). Until then the INR button stays hidden, so the page is safe to deploy first.

---

## 4. Follow-Up Items

1. ⚠️ **SSH private key still in Git:** `ssh-keys/developer_key` is still tracked in Online Work. Remove it from every server's `authorized_keys`, make a new key, delete the folder from the repo and add it to `.gitignore`.
2. **Decide:** secret tokens in the QR links, or office-network-only scans, before the check-in page goes live.
3. **Check-in page:** commit the two uncommitted fixes, merge `main2-design` into `main` when approved, then test **one real check-in** on a phone (with sound), a figure from a real profile photo, and the voice greeting.
4. **Employee IDs:** run *Fetch sheet* against the SharePoint link on production, review the changes, then *Apply*. Ask HR to add emails for the 19 people with none.
5. **Accounts INR invoices:** deploy, run the migration on the server, then make one INR invoice with login and check the PDF. Test the live-market rate.
6. **Task Manager:** finish and commit the staff photos work; run `schema_05_online_work.sql` and then `schema_06_staff_photos.sql`.
7. **Still open from 09 Oct:** confirm the exposed OpenAI keys were revoked; decide on turning sign-in back on for `/ceo` (`DIRECTOR_BOARD_PUBLIC=off`); live checks of the Director Board, attendance correction, Productivity and Reports pages; check Accounts Auto Reports all sent.
8. **Still open from 08 Oct and earlier:** Movement WhatsApp **Register with Meta**, the B2C traveller name script for 14966 / 14990 / 14959 / 14988, the OPS report showing **45 / 29 / 16** for 07/10, browser checks of the WhatsApp inbox and Ops Board, a corrected weekly OPS report for 20–26 Sept, `GRAPH_MAIL_CLIENT_SECRET`, and the pending OPS and Bank Settlements scripts.
