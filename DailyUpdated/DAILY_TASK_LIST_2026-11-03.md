# Daily Task List — 3 November 2026 (Tuesday)

**Owner:** Sasindu Diluranga
**Date:** 3 November 2026
**Written:** 3 November 2026, afternoon, from git history and working-tree status

| Project | Branch | Work on 3 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits (`5ebf417`, `5b44de3`) · pushed · clean |
| Accounts System | `b2c-payables-arrival-date` (new) | 1 commit (`4b9164d`) · pushed · clean · **not merged into `Master-Live`** |
| Aahaas Online Work | `main` | 8 commits (`b02c004` … `539153e`) · pushed · **4 modified + 4 new files uncommitted** (earlier-day filing / backfill access) |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Several commit messages say "nothing is committed or deployed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Checked with type-check / build (and a local load test for Online Work), **not against the live databases, no real email sent.**

## What was done

1. **OPS:** B2C amended orders shown as **versions** — 15833 (V2) is the active booking, 15726 (V1) is blurred and locked as "replaced".
2. **OPS:** **carry-over review** — TE can move the team's work from 15726 to 15833 after checking it; nothing moves automatically.
3. **Accounts:** **B2C Payables arrival date** column, filter and new default pay basis.
4. **Online Work:** faster `/me` page, 502/slowness fixes (nginx + DB pool), password reset by email code, roster **Import Excel** with AI, leave email fixes, **cancel approved leave**, leave email thread view, **equipment for the boss + People tab** on Assets.

---

## 1. OPS — B2C booking versions (`5ebf417`)

10 files · +994 / −6

- [x] **Why there were two bookings:** #15833 was imported at 11:07 on 2 Nov, before the version-aware importer (`77e3cbc`, 15:59), so it became its own booking.
- [x] **15833 (active):** green "Active booking · store version 2 of 2" card, V1 → V2 timeline, side-by-side comparison of 15726 vs 15833 with changed rows highlighted.
- [x] **15726 (replaced):** violet "Old version · replaced" banner with **Open active booking 15833 →**; page blurred and locked, **Peek at old version** to read it.
- [x] **Bookings list:** 15726 hidden; searching either number shows both with V1 / V2 badges.
- [x] When the amended order already has its own booking, the update is no longer copied onto the old booking.
- [x] Linking happens on open after deploy; the import run links others within ~10 minutes.
- [ ] After deploy, open 15726 and 15833 and check the banner, timeline and list search.

## 2. OPS — carry-over review for TE (`5b44de3`)

7 files · +887 / −2

- [x] Amber strip on 15833: "Waiting for Travel Experience: N things the team did on 15726…" with **Review carry-over**.
- [x] Carries over (after TE confirms): hotel reconfirmations (same hotel + check-in only), AI-call plan, daily WhatsApp time, manual edits (only into empty fields), guest notes / emergency contacts.
- [x] On 15726: pauses AI calls, turns off daily messages, cancels queued WhatsApp (all ticked by default, reversible) so the guest isn't contacted twice.
- [x] Agenda, drivers, tickets and payments are listed for TE but **not copied**.
- [x] Safe: no schema change (state in `system_settings`), nothing deleted, one DB transaction, stale reviews refused, only TE / GT_TE / admins can apply, logged to activity log.
- [x] Replaced bookings are skipped by daily-message automations and AI-call auto-enrolment even before the review.
- [ ] After deploy, run the review once on 15833 with the TE team.

## 3. Accounts — B2C Payables arrival date (`4b9164d`)

5 files · +79 / −26 · branch `b2c-payables-arrival-date`

- [x] Arrival = earliest check-in / service date across the order (flights only count if the order has nothing else).
- [x] New **Arrival** column, **Arrival** option in Date basis, arrival in "By order" headers and in the Excel export.
- [x] New pay basis **"Booking arrival date"**, now the default. Saved default (service date, 0-day offset) switches to arrival automatically; vendors with their own terms keep theirs.
- [x] No migration needed. PHP syntax check, templates build, payment-date calculation checked on sample dates.
- [ ] Merge `b2c-payables-arrival-date` into `Master-Live` and deploy.
- [ ] Check a few real bookings' arrival and payment dates after deploy.

## 4. Online Work (8 commits)

- [x] **`/me` loads faster** (`b02c004`): page streams in parts; Mail / Teams / Calls cards wait for Microsoft max 6 s with a placeholder; new loading screen and button spinner.
- [x] **Load test + server fixes** (`e914795`): 60 simulated users, no errors (~1 s avg, 3 s worst, no memory leak). Likely causes: **nginx 20 req/s per IP** (whole office shares one IP) and **8-connection DB pool**. Fixes in `infra/nginx/online-work.conf`, `.env.production.example`, call-report caching.
- [x] **Password reset with emailed code** (`134869c`): new `password-reset.ts`, reset form, demo-sandbox handling.
- [x] **Roster ⇪ Import Excel** (`7bb9608`): AI reads any roster layout; review screen for cell meanings, person matching, days to take, overwrite rules and preview; nothing saved until **Save**.
- [x] **Leave email not sent** (`abf1671`): send outcome is always recorded ("✕ not sent" with cause); admins get **Send the email now**.
- [x] **Cancel approved leave** (`8a609ba`): until the last leave day; confirmation panel with days returned, recipients, reason required; reply in the same email thread.
- [x] **Employee resend + email thread view** (`863772e`): **✉ Send it to HR now / ↻ Send the email again** on own waiting leave (1-min wait, one delivered copy max); clickable thread like a mail client.
- [x] **Equipment for the boss + People tab** (`539153e`): boss (AHS000) selectable in Issue desk / Assign / Stock issue; new **People** tab on Assets; equipment panels on employee profile and `/me`.
- [ ] **Uncommitted — earlier-day filing (backfill access):** 7-day filing window; admin can open older days for one person from the employee page, auto-closing on a chosen date. Files: `backfill-access.ts`, `earlier-day.tsx`, `backfill-access.tsx`, `api/employees/[id]/backfill/`, plus edits to `me/workday/page.tsx`, `employees/[id]/page.tsx`, `photos/route.ts`, `workday-store.ts`. Finish, build and commit.
- [ ] Deploy and apply the nginx + DB pool changes on the server.
- [ ] Kieu's 10:53 leave: after deploy, press **Send the email now** (or Kieu uses the new button); check `journalctl -u aahaas-online-work` for `[leave]` warnings around 10:53.
- [ ] Set the password-reset mail settings from `.env.production.example` on the server.

---

## Still to do today

- [ ] **Redeploy OPS** from `LIVE-1.0.0v` (amendments, versions, carry-over, monthly report, auto tickets, WhatsApp Retry/Report).
- [ ] **Accounts:** `php artisan migrate` (`b2c_order_amendments`), redeploy `Master-Live`, then merge and deploy the arrival-date branch.
- [ ] **Fix Meta billing (error 131042)**, then use WhatsApp **Retry failed**.
- [ ] Commit the Online Work backfill work and deploy Online Work with the new PM2 / nginx config.
- [ ] Commit or drop the **HRMS** 502 retry change (uncommitted since 27 Oct).
- [ ] Write the **3 Nov daily update**.

## Carried over

1. **From 2 Nov:** `php artisan b2c:order-chains` preview; compare **Store order mix** for October with AahaasFlow; send a test **Monthly Business Review**; check the next Apple import creates draft tickets; decide on Prev / In OPS in the OPS card; re-download the "Ticketing, Flights & Visa" roster; set department heads; remove the old `pradeep.kumar@aahaas.com` BCC; decide on department heads approving leave in the portal.
2. **From 31 Oct (Accounts):** deploy Payable 1.3 + missing products; press **Write to the sheet tab** once; **Rate sheet → Daily mail → Save & start**; pass Sheet doctor row fixes to the rate-sheet owner.
3. **From 30 Oct (Online Work):** Halloween items check; tell HR attendance % will change and export one period; nginx password on `/ad/bat`.
4. **From 29 Oct:** PR `LIVE-1.0.0v` → `Master-Dev`; deploy OPS + AahaasFlow with the shared service key; B2C contact script for older bookings; check 14784; IT spend dates; check VN 42725 / VN42951.
5. **From 28 Oct:** Update Booking on 15679; test ticket sheet print; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; Accounts auto B2C invoices.
6. **From 27 Oct and earlier:** B2C Sales / AI Call reports; `pnl_date_overrides` migration; B2B quote pipeline decision; 7 calls stuck mid-dial; `n8n-project` call server; Travel Quote GPT DB; Operation App build; Meta guest template; biometric daily sync + new API key + UTC fix; transport supplier tables; Mail Scanner; ticket rate sheet dry run.
7. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
8. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
