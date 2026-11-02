# Daily Task List — 30 October 2026 (Friday)

**Owner:** Sasindu Diluranga
**Date:** 30 October 2026
**Written:** 31 October 2026, from git history and working-tree status

| Project | Branch | Work on 30 Oct |
|---|---|---|
| Booking System / OPS | `Master-Dev` | No work · clean (`LIVE-1.0.0v` still 2 commits ahead) |
| Accounts System | `Master-Live` | No work · clean |
| Aahaas Online Work | `main` | 4 commits (`1416d10`, `cef3fbe`, `1b7024e`, `e096b27`) · pushed · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Checked with TypeScript, `next build` and headless Chrome, **not on a real TV, phone or projector, and not against the real database.**

## What was done

1. **Online Work:** **▶ Play now** on every TV control row, and a new spooky opening for the **Halloween ad** (`/ad/1`).
2. **Online Work:** **Oxanium** and **Caveat** fonts served locally.
3. **Online Work:** **Attendance** — full Excel export, office vs WFH, leave shown properly, and a new **Holidays** page.
4. **Online Work:** **vampire projector screen** (`/ad/bat`) with a **phone remote** (`/ad/bat/r`) for the Halloween party.

---

## 1. Office TV — Play now + Halloween ad (`1416d10`)

7 files · +425 / −39

- [x] **▶ Play now 🔊** on the ops view and every row (including paused ones): puts that page on every TV within ~3 s, fresh and with sound, for that row's seconds, then the rotation resumes. Plays with sound even if "Views' sound" is muted; stays silent if TV sound is off, in quiet hours or if the screen is muted. Check-ins, boss, meetings, notices and room calls still play over it.
- [x] Ad had **no sound on the TV** (audio waited for a click); it now starts its own sound and follows TV mute and volume.
- [x] New opening **"Spooky broadcast"** (~9.5 s: sirens, ON AIR, ATTENTION — AAHAAS FAMILY!, BREAKING ticker) and second scene **"TODAY IS THE DAY!"** (~11 s: blood moon, witch, lightning, jack-o'-lanterns, "TONIGHT • 6:00 PM • AAHAAS OFFICE, WTC COLOMBO" and a live countdown). Wording changes at 6 PM and after midnight. Loop now ~140 s.
- [x] Announcer line is sent to the TV to read out (needs the TV's voice setting on and one click).
- [ ] Deploy before 6 PM and press ▶ Play now on "Marketing areana" to check it on the wall.

## 2. Local fonts (`cef3fbe`)

12 files · +25 / −29

- [x] **Oxanium** (HUD and badge page, variable weights) and **Caveat** (farewell cards) imported locally in `index.ts`; `oxanium-latin.woff2` added.

## 3. Attendance — export, office/WFH, leave, holidays (`1b7024e`)

17 files · +2,377 / −303

- [x] **Excel export** (CSV gets the same day-by-day columns): Summary per person (attendance, office/WFH/client, punctuality, leave by type, holidays, absent, not filed, hours, filter-aware totals); Calendar with codes (PO, PW, LO, ½W, ML/PL/HL, RQ, HOL); Daily detail; new **Leave** and **Holidays** sheets; one sheet per person for 15 people or fewer.
- [x] **Day view:** tiles for At the office, Work from home, On leave, Leave requested; "On leave today" card; holiday/special-day banner.
- [x] **Period grid:** corner letter for place (O/W/C), leave codes, row counts, a ledger of exact leave dates, and new filters "Leave waiting" and "Worked from home".
- [x] **Holidays page** (`/attendance/holidays`): year of calendars, click / shift-click to add, three kinds (day off, special hours, WFH day), limit to offices, preview sentence and hours bar.
- [x] **Attendance % will change:** approved leave and holidays no longer count against anyone, half day = 0.5, nobody is late on a special-hours day if on time for the special start, hand corrections always kept.
- [ ] Tell HR the attendance % figures will change before deploying.
- [ ] Open the pages in a browser and export one real period (only checked on made-up data).

## 4. Vampire screen + phone remote (`e096b27`)

17 files · +2,115 / −2

- [x] Projector **`/ad/bat`** and phone remote **`/ad/bat/r`** (QR code in the corner, hideable). Both public; the only shared-code change is one line in `middleware.ts`. `/ad/1` and `/ad/2` unchanged.
- [x] Phone controls: touch pad (bats, lightning, blood, bite, grave hands, BOO!, vampire, bat trails), torch hunt, creatures, sky and storm, scares, cartoon bats that spell any word, your own text spoken by the vampire or carved on a tombstone, settings (mute, volume, full screen, calm, auto show at 3 levels) and a 45-second **Full Terror** sequence.
- [x] 8 photoreal images generated with the OpenAI key into `public/ad/bat/` (`npm run bat:art` remakes them, using `gpt-image-2` / `gpt-image-1.5`). All sounds generated live in the browser; voice is the computer's text-to-speech.
- [x] Tested in headless Chrome: 20 effects from a simulated phone, no script errors; production build passes.
- [ ] Click the projector page once on the night (browsers need it for sound and full screen).
- [ ] Try it on a real phone and projector; shake-to-summon untested.
- [ ] Check whether nginx's site-wide password applies to `/ad/bat` on live.

---

## Still to do today

- [ ] Deploy Online Work before the 6 PM Halloween party (Play now, ad, vampire screen, fonts) and test on the wall TV and projector.
- [ ] Deploy the attendance changes once HR knows the % figures will change.
- [ ] Write the **30 Oct daily update**.

## Carried over

1. **From 29 Oct:** PR `LIVE-1.0.0v` → `Master-Dev` (`de5d8ab`, `c542dd6`); deploy OPS and AahaasFlow with the shared service key; run the B2C contact script for older bookings; check 14784; open IT spend dates in a browser; deploy Accounts P&L report fix and check VN 42725 / VN42951.
2. **From 28 Oct:** deploy OPS (flight import, Aahaas Order card, Print tickets, report fix); Update Booking on 15679; print one test ticket sheet; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; deploy Accounts auto B2C invoices.
3. **From 27 Oct:** B2C Sales Report, AI Call Report, Online Work (asiacharm, Asset Management, IT spend, 502 fix); `pnl_date_overrides` migration; B2B quote pipeline decision; asiacharm spelling; 7 calls stuck mid-dial.
4. **From 26 Oct (OPS):** `n8n-project` call server; Travel Quote GPT DB connection and `WHATSAPP_REENGAGE_TEMPLATE`; Operation App build; "Quick call failed".
5. **From 24 Oct:** Meta guest template and VN41510 message; `biometric_daily_attendance` and `BIOMETRIC_DAILY_SYNC=on`; new biometric API key; biometric UTC fix.
6. **From 21 Oct:** transport supplier tables; Mail Scanner; ticket rate sheet dry run.
7. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
8. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
