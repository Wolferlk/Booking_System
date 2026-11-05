# Daily Task List — 4 November 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 4 November 2026
**Written:** 4 November 2026, evening, from git history and working-tree status

| Project | Branch | Work on 4 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 8 commits + PR **#319 merged into `Master-Dev`** (`a68b5a7`) · pushed · clean · `LIVE-1.0.0v` now 5 commits ahead of `Master-Dev` |
| Accounts System | `b2c-payables-arrival-date` | No work · clean · arrival-date branch still **not merged into `Master-Live`** |
| Aahaas Online Work | `main` | 8 commits (`9349859` … `6f3cceb`, incl. 3 Nov evening) · pushed · clean |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Several commit messages say "nothing is committed or deployed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Checked with type-check / lint / build and sample renders, **not against the live databases, no real WhatsApp or email sent.**
>
> ⚠️ Some Online Work commit messages don't match their files (`6f3cceb` carries the OPS PDF message but changes the Reports studio; `4b9dece` / `5ff2741` messages are swapped with the asset label changes). The sections below follow the files.

## What was done

1. **OPS:** new **Agent Daily Digest** — daily WhatsApp/email to agents (e.g. 30 Sundays) with on-ground, arrival and departure lines, drivers and vendors.
2. **OPS:** digest fixes — Meta template status bar, "Driver pending" only when nobody is allocated, pending counts recounted on old links.
3. **OPS:** T-3 **Full Details + Vouchers** PDF reworked (no status, lead guest section, driver per day, S3 ticket images, no blank pages) + **Guest Emergency Contacts** in Settings.
4. **OPS:** 3 type errors fixed (0 left); PR #319 `LIVE-1.0.0v` → `Master-Dev` merged.
5. **Online Work:** earlier-day filing (backfill access) committed; **admin access list + portal switch + boss account and boardroom screen**; **Daily filings report** with AI summary; SIM data/voice costs; new handover form; device owner transfer.

---

## 1. OPS — Agent Daily Digest (`89693df`, `41fa147`)

New page in the sidebar next to Driver-Auto · 3 new tables (`prisma/sql/2026-11-04-agent-digest.sql`)

- [x] Filters by agent (30 Sundays / 30sundays / Thirty Sundays all match) and country (LK, VN, SG, MY or all). Cancelled, draft and test bookings left out.
- [x] Recipients: WhatsApp numbers and/or emails per digest, plus internal email copies.
- [x] Built from **blocks**: each picks bookings by on-ground, arrival, tour start, activity or departure date, for same day / next day / +N days.
- [x] Agenda-line or tour view: trip no., IS/CNTL no., lead guest, pax, "Day 3/7", hotel, flight, driver + phone + vehicle, driver vendor, guide, tour vendor. Sri Lanka lines use the booking's driver.
- [x] Editable template (opening/sign-off with placeholders, detailed/compact) with live phone and email preview.
- [x] Daily auto-send at a chosen time and time zone; optional skip when empty. Tabs: **Tomorrow's sends**, **Sent history** (exact message per person + saved copy).
- [x] Safe: reads bookings only, writes only its 3 tables, no driver rates/prices, auto-send **off** by default, "Send test" only to the typed number/email, one send per person per day, no retry loop on WhatsApp failure.
- [ ] **Run `bash prisma/sql/apply-agent-digest.sh` on live** (use `--check` first) before deploying.
- [ ] Set up the 30 Sundays digest, send a test, then switch on auto-send.

## 2. OPS — digest fixes (`02681f9`, `e4a645d`, `2d815d6`)

- [x] **Meta template:** the template was already created by the first "Submit to Meta" click; later 400s were "already exists". Bar now shows Meta's real status (Pending / Approved / Rejected / Paused) with **Check again**; Submit button only when the template doesn't exist.
- [x] **"Driver pending"** only when nobody is allocated. A driver, vehicle, tour vendor or driver vendor on the line counts as covered (applies to WhatsApp, email, full-update page, counts and Tomorrow's sends).
- [x] **Old `/digest/...` links** showed stale "2 pending / 77 pending": new `withFreshPending()` recounts from saved lines each time ("whole tour" sections keep their saved count).
- [ ] After deploy, check the template status in **Sent history**. If rejected, get the reason from WhatsApp Manager → Message templates.
- [ ] Decide whether a driver vendor alone should count as covering a line.

## 3. OPS — T-3 Full Details + Vouchers PDF (`270a04c`)

11 files · +1,222 / −402 · also affects the T-7 Tour Confirmation PDF and the Word version

- [x] Status removed from header, Booking Summary and voucher pages (also ticket cost); header shows travel dates.
- [x] One **"Lead Guest & Passengers"** section: lead guest card + passenger table with LEAD tag, Adult/Child (age), nationality.
- [x] **Guest Emergency Contacts** card in Settings: add / remove / reorder, tag by country, preview. Overlapping name/role/phone text fixed.
- [x] Itinerary descriptions removed; driver, vehicle + plate, guide, tour vendor, transport company and pickup time under each day.
- [x] **Ticket images now read from S3** (were only looked for on the server's disk), extra ticket files included, PDF e-tickets embedded as pages, WebP → JPEG, "Open voucher online" link as fallback.
- [x] **Blank pages fixed** (footer was written below the margin).
- [x] Rendered locally with JPG, PNG, WebP and PDF tickets.
- [ ] After deploy, add the emergency contacts in Settings and generate T-3 for one real booking.

## 4. OPS — type fixes and merge (`747744f`, `a68b5a7`)

- [x] 3 type errors fixed (unused `computeQCStatus` export removed; `Uint8Array` for image and upload responses). Same bytes sent, no behaviour change.
- [x] **PR #319 merged** `LIVE-1.0.0v` → `Master-Dev` (closes the 29 Oct carry-over).
- [ ] Open a new PR for the 5 commits since the merge (digest fixes, type fixes, T-3 PDF).

## 5. Online Work (8 commits)

- [x] **Earlier-day filing** (`9349859`, 3 Nov 17:57): filing limited to the 7-day strip on the server; admin opens earlier days per person (today / 7 / 30 days / until off) from **Earlier filing days** on the employee page; audit-logged. ⚠️ Old submitted filings are now locked too.
- [x] **Admin access + boss account** (`301ca4b`, 20 files · +1,810): passwordless "Admin" button removed; admin portal access now from a list (`admin-access.json`, starts with sasindu@, hr@, hr2@); **My workspace | Admin portal** switch; **Settings → Admin access** page; boss account for pradeep.kumar@bcdtravel.lk with a cinematic **boardroom** welcome screen. No DB changes.
- [x] **Daily filings report** (`ee1d768`): new Reports card; **Detailed** (by employee / by date) or **AI summary** (OpenAI, 12 h cache, local fallback); Excel, PDF, CSV. Limits: drafts excluded, "missing days" ignores leave/rosters, no print preview.
- [x] **Reports studio follow-up** (`6f3cceb`): preview route, report studio and data changes.
- [x] **SIM Data cost / Voice cost** fields (`7504fe2`), carried over in batch registration. Monthly cost is still the only figure in spend totals.
- [x] **Handover & Liability form** (`4b9dece`, `5ff2741`): follows the paper form, accessories ticks, declaration and return slip, choose devices, optional one form per item. NIC and designation print blank.
- [x] **Device owner transfer** (`cf050ec`): change a device's owner and handle move requests.
- [ ] Decide: are Data/Voice cost a breakdown of Monthly cost, or added to it?
- [ ] Check every current admin is on the new access list **before** deploying (the old passwordless login is gone); use the "add back" section.
- [ ] Daily filings report 502: cause not found yet. Check the server log after deploy.

---

## Still to do today

- [ ] ⚠️ **Security:** commit `301ca4b` message (pushed to GitHub) contains the **boss account password in plain text**. Change that password from **Settings → Admin access** before deploying, and don't reuse it.
- [ ] **OPS:** run the agent-digest SQL on live, then **redeploy OPS** (amendments, versions, carry-over, digest, T-3 PDF, WhatsApp Retry/Report).
- [ ] **Accounts:** `php artisan migrate` (`b2c_order_amendments`), redeploy `Master-Live`, merge and deploy the arrival-date branch.
- [ ] **Fix Meta billing (error 131042)**, then WhatsApp **Retry failed**.
- [ ] **Online Work:** deploy with the PM2 / nginx / DB pool changes; tell staff about the 7-day filing limit.
- [ ] Commit or drop the **HRMS** 502 retry change (uncommitted since 27 Oct).
- [ ] Write the **3 Nov and 4 Nov daily updates**.

## Carried over

1. **From 3 Nov:** check 15726 / 15833 versions and run the carry-over review with TE; check real B2C payable arrival and payment dates; Kieu's 10:53 leave email (**Send the email now**); password-reset mail settings on the server.
2. **From 2 Nov:** `php artisan b2c:order-chains` preview; compare **Store order mix** with AahaasFlow; test **Monthly Business Review**; check Apple import auto-tickets; Prev / In OPS decision; re-download the "Ticketing, Flights & Visa" roster; set department heads; remove old `pradeep.kumar@aahaas.com` BCC; department heads approving leave decision.
3. **From 31 Oct (Accounts):** deploy Payable 1.3 + missing products; **Write to the sheet tab**; **Rate sheet → Daily mail → Save & start**; Sheet doctor row fixes to the rate-sheet owner.
4. **From 30 Oct (Online Work):** Halloween items check; tell HR attendance % will change and export one period; nginx password on `/ad/bat`.
5. **From 29 Oct:** deploy OPS + AahaasFlow with the shared service key; B2C contact script for older bookings; check 14784; IT spend dates; check VN 42725 / VN42951.
6. **From 28 Oct:** Update Booking on 15679; test ticket sheet print; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; Accounts auto B2C invoices.
7. **From 27 Oct and earlier:** B2C Sales / AI Call reports; `pnl_date_overrides` migration; B2B quote pipeline decision; 7 calls stuck mid-dial; `n8n-project` call server; Travel Quote GPT DB; Operation App build; Meta guest template; biometric daily sync + new API key + UTC fix; transport supplier tables; Mail Scanner; ticket rate sheet dry run.
8. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
9. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
