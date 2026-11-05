# Daily Task List — 17 October 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 17 October 2026
**Written:** 17 October 2026, 15:50, from git history and working-tree status

| Project | Branch | Work on 17 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | No commits · **uncommitted:** AppleSystem sync preview with tick boxes (3 files, +619 / −187) · 16 Oct daily update not yet committed |
| Aahaas Online Work | `main` | 3 commits (`238f005`, `cde410f`, `451b51f`) + merged PR #11 (`7ea8e3c`, Hari's HRMS employee API) · clean · up to date with origin |
| n8n / Marketing Arena | `AIImproved-V5` | 1 commit (`275d17ae`) + merge (`1929eaa1`) · Leaders Dashboard |
| Accounts System | `REV1` | No commits · clean · up to date with origin |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several say *"nothing is committed or deployed"*. That was true when written; every commit below is now committed and pushed. **Nothing is confirmed as deployed**, and nothing was checked against live data.

## What was done

1. **Online Work:** "Office" now means a **face or fingerprint scan** at the office terminal; everyone else who worked counts as **home** (or client site if HR or their filing says so).
2. **Online Work:** fixed the **504** on the HRMS employee-performance API — results now come back in **pages** (20 per page, max 50) with a 25-second limit per employee.
3. **Online Work:** attendance sheets show **Shift**, **WorkAgent in → out** and **Biometric in → out** as separate columns; Ask AI keeps the two sources apart and has a new `attendance_times` tool.
4. **Online Work:** merged Hari's **HRMS employee API** (PR #11).
5. **Marketing Arena:** new **Leaders Dashboard** at `ai.aahaas.com/marketing-arena/leaders-dash` (nine pages).
6. **OPS (in progress):** AppleSystem **Sync** now previews changes with tick boxes before saving.

---

## 1. Online Work — Office only with face or fingerprint (`238f005`)

12 files · +252 / −93 · **no database change**

- [x] **Office** = face scan (code 75) or fingerprint (code 38), or a terminal mode that needs one. Nothing overrides it, not even an admin.
- [x] Card, PIN, QR badge, web check-in, daily filing and admin marks **don't** count as office.
- [x] Present / late / half-day with no face or fingerprint scan → **Home** by default (before: "—").
- [x] Office claims with no scan behind them are counted as home with a **"! office?"** warning for HR.
- [x] Register, My attendance and reception desk show **◉ Face ID** / **◎ Fingerprint**; the Office button is locked for admins (server refuses it too).
- [x] Daily filing warns that "Office" only counts with a scan.
- [x] Type check passes; face/fingerprint detection test passes 15/15.
- [ ] Check against **real terminal scans** on the office terminal after deploy.

## 2. Online Work — HRMS performance API 504 (`cde410f`)

`employee-performance-api.ts` · +59 / −9

- [x] Cause: the endpoint scored **every employee in one request**, each needing several seconds of Microsoft Graph calls; Cloudflare cuts requests at 100 s.
- [x] Now paged: `?page=1&pageSize=20` (max 50), 8 employees at a time, 25 s per employee. A slow one returns `performance_timeout` and the rest of the page still comes back.
- [x] Response adds `total`, `page`, `pageSize`, `totalPages`, `hasMore`.
- [ ] **Deploy** and call the live endpoint with the token — confirm a full page finishes under ~75 s.
- [ ] Tell Hari / the HRMS side the API is now **paged** so they loop over `hasMore`.

## 3. Online Work — Shift, WorkAgent and Biometric columns (`451b51f`)

12 files · +474 / −36 · new `agent-span.ts`, `attendance-times.tsx` · **no database change**

- [x] Employee sheet and admin register: **Shift** (roster or weekly pattern; days off show the reason), **WorkAgent in → out**, **Biometric in → out**. Late start / early finish (>15 min) in amber.
- [x] WorkAgent times come from the agent's own 5-minute activity records, so a locked PC overnight doesn't stretch the end time.
- [x] Biometric = first and last terminal punch, including card/PIN, with "Face ID · 4 punches" under each time.
- [x] CSV and daily report Excel get the new columns (+ "Punched by").
- [x] Ask AI always names which source a time came from; new `attendance_times` tool (up to 62 days, shift vs both sources).
- [x] Type check passes. **Not tested on real data** — the dev database has no attendance or agent rows.
- [ ] After deploy, compare a few days with the live terminal and agent logs.
- [ ] Note: the terminal keeps only the **last 5,000 scans**, so older months show no biometric times; overnight shifts don't get late/early highlights.

## 4. Marketing Arena — Leaders Dashboard (`275d17ae`, `1929eaa1`)

15 files · +3,408 / −3

- [x] Nine pages: Executive, Acquisition, Engagement, Booking funnel, Itineraries, Repeat customers, Customers, AI outlook, Data rules.
- [x] Merged with the incoming Desks, Referrals and Flight Bookings work on `AIImproved-V5`.
- [x] Check script passes, frontend builds, every page loads in Chrome — **fake in-memory database only**.
- [ ] Run against the **real database** and sanity-check the funnel and repeat-customer numbers.
- [ ] Deploy to `ai.aahaas.com`.

## 5. OPS — AppleSystem Sync with preview (uncommitted)

`as-sync/route.ts`, `as-booking-sync.ts`, `applesystem-actions.tsx` · +619 / −187

- [x] `POST { preview: true }` returns proposed changes and **writes nothing**; `POST { selection }` applies only the ticked fields, sections (itinerary, accommodations, passengers, emergency contacts) and conflicts.
- [x] A **fingerprint** guards against stale previews: if AppleSystem changed in between, the route returns **409** with the fresh preview.
- [x] An empty body still applies everything (scripts and older clients).
- [ ] Finish the UI, type check and build.
- [ ] Try it on dev with **IS49403** and a booking with field-edit conflicts.
- [ ] Commit and push; also commit `DAILY_UPDATE_2026-10-16.md` and this file.

---

## Still to do today

- [ ] Finish and commit the OPS AppleSystem sync preview (section 5).
- [ ] Deploy Online Work (`npm install` needed — Sharp was added on 16 Oct) and check sections 1–3 live.
- [ ] Write the 17 Oct daily update.

## Carried over from 16 Oct

1. **B2C Update Booking (OPS + Accounts):** `php artisan migrate` on the Accounts server (`b2c_order_versions`); confirm `ACCOUNTS_INTEGRATION_SECRET` = `OPS_INTEGRATION_SECRET` / `OPS_REPAIR_SECRET`, and `ACCOUNTS_APP_URL` / `OPS_BASE_URL`; check the B2C revision email setting; test on dev, then open **15077** and restore the agent if it's B2C.
2. **Decide:** apply the *highest version + 1* fix to the OPS email / OneDrive versioning (currently *active version + 1* can overwrite V4's history).
3. **OPS on dev:** Report Studio (saving a template writes to the DB); GT_VN_USER WhatsApp inbox and mini chat; hide *create template* for that role?; view2 takeovers on the screen.
4. **Online Work on the office TV:** Call to room, notice templates / position / sound, white Board Room call, farewell TV show; send one real farewell note; try a rename. Active calls are lost on server restart.
5. ⚠️ **Security:** rotate the exposed **OpenAI key** (`LIVE_ENV.md`) and other secrets before go-live; remove `ssh-keys/developer_key` and the door bridge token from Git history.
6. ⚠️ **Accounts server load:** kill long `pnl_records` queries, apply the *Low-load preset*, check `crontab -l` / `pm2 list`.
7. **Older items:** see 15 Oct update item 8 — mobile app go-live, Online Work + nginx deploy, Accounts INR invoice migration, `GRAPH_MAIL_CLIENT_SECRET`, pending OPS and Bank Settlements scripts.
