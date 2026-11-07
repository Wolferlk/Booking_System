# Daily Task List — 6 November 2026 (Friday)

**Owner:** Sasindu Diluranga
**Date:** 6 November 2026
**Written:** 6 November 2026, 17:57, from git history and working-tree status (remotes fetched first)

| Project | Branch | Work on 6 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 7 commits (`07ab8e5` … `f98e45e`) + 2 from 5 Nov evening (`c219c1c`, `c95ed32`) · pushed · clean · now 18 commits ahead of `Master-Dev`, no open PR |
| Accounts System | `test-bookings-panel-order-date` | No new work · clean · **PRs #57, #58, #59 all merged into `Master-Live`** (see correction below) |
| Aahaas Online Work | `main` | 4 commits (`78958a6` … `03d8f3a`) · pushed · 1 uncommitted file (`asset-inventory.tsx`, one blank line only) |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Several commit messages say "uncommitted" or "not committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Today's work was checked with type-check / lint / build, automated checks and fake data, **not on real phones, real WhatsApp, Meta, OpenAI or live data.**
>
> ⚠️ **Correction to the 3–5 Nov lists:** they said the Accounts branches weren't merged. That was wrong. `b2c-payables-arrival-date` was merged on 3 Nov (#57), and `b2c-same-order-versions` (#58) and `test-bookings-panel-order-date` (#59) on 5 Nov. The Accounts job is now only migrate and deploy, and deploying `Master-Live` brings all three with it.
>
> ⚠️ **Keep `ORDER_VERSION_MODE=same_order` off on live**, as in the 5 Nov list.

## What was done

1. **OPS:** **WhatsApp booking group chats**: one booking with many contacts, three-pane screen, trip panel and AI suggested replies.
2. **OPS / driver app:** **Get trips** now gives each driver a daily pick matched to the vehicle type, with a new screen design and daily limits.
3. **OPS / driver app:** vehicle forms now ask for **guests (pax)**, with checks on each vehicle type's range.
4. **Driver app:** drivers must **call operations first** on the "I can't continue this trip" screen; emergency number added.
5. **OPS:** the bad 5 Nov merge is repaired (27 emptied image and sound files, plus the tunnel script).
6. **Online Work:** **Still open from earlier days** tray on Daily filing, QA fixes (offboard popup, search ×, SIM flicker, dropdowns), Excel, employee list and speed fixes, and **asset delete**.

---

## 1. OPS — WhatsApp booking group chats (`093367e`, `f98e45e`)

42 file changes across the two commits · 6 new tables (`wa_booking_groups`, `wa_booking_group_members`, `wa_group_sends`, `wa_group_participants`, `wa_group_messages`, `wa_group_channels`)

- [x] **One group per booking:** pick a booking and the guest joins; choosing it again opens the existing group. Add contact suggests the agent, drivers and guides, or any number.
- [x] **Three panes:** groups and contacts · one thread with name and role, and reach per message (e.g. 3/4) · order details, suggested replies, trip materials and the real-group option. On phones the right pane is a drawer.
- [x] **Trip materials:** Day-7, Day-3, Daily, Itinerary, Flights, Hotels, Driver, each with status and Auto switch. Preview, then confirm.
- [x] **AI suggested replies:** up to 3 per guest message, drafted from the booking and the last 14 messages. They only fill the chat box, and no prices or driver rates go to OpenAI.
- [x] **Two kinds of group:** **Inbox group** (up to 20, private messages merged into one OPS thread, works once deployed) and **Real WhatsApp group** (8 maximum, invite link, needs Meta's Official Business Account).
- [x] Tested with fake data: 25 logic checks, reply merging, Meta's refusal, and desktop and phone widths with no console errors.
- [ ] **Run `bash prisma/sql/apply-wa-booking-groups.sh` on live** (use `--check` first) before deploying. It only creates the 6 tables and is safe to run twice.
- [ ] Try on one real booking: real WhatsApp, real OpenAI, and read the quality of the suggested replies.
- [ ] Check the gateway serves `gpt-4o-mini`; if not, set `OPENAI_WA_SUGGEST_MODEL`.
- [ ] Link the existing test group to a booking (it has none).
- [ ] Tell staff: anything typed in the chat box goes to **everyone in the group, including drivers and agents**; in an inbox group people can't see each other; and a contact on another trip will have those messages show here too.
- [ ] Apply to Meta for the **Official Business Account** if real groups are wanted. Real-group code is the least proven (Meta's docs don't confirm details such as PDFs in groups).

## 2. OPS / driver app — Get trips (`3c5b8f9`, `3a6838f`)

- [x] **Matched to vehicle type:** 1–3 guests car, 4–5 flat roof, 6–8 high roof; bigger groups go to minibuses and buses that seat them, at least a third full. A vehicle's saved seats still apply.
- [x] **Daily limit:** drivers up to 5 trips, vendors up to 10. The list changes at midnight in their country and differs per person.
- [x] **Weighted pick:** trips today or tomorrow appeared about 3.6× as often as trips a week or more away. Days they're already booked are hidden.
- [x] **New screen:** daily bars, "New picks in …" countdown, gold top pick, Perfect fit badge, "More trips are waiting" card. Vendors match on any active vehicle in their fleet. No new tables.
- [ ] **Decide:** should a high roof with 9 seats get 9 guests? Code still sends 9+ to minibuses and buses only.
- [ ] **Decide:** vehicles saved only as "Van" get 4–8 guests. Keep that, or treat them as flat roof or high roof?
- [ ] **Decide:** the WhatsApp `/driver-board` link still lists every open trip and drivers can request from it, which gets around the new limits.
- [ ] After deploy, watch for flat roof and high roof drivers seeing few or no trips if most bookings are 1–3 guests. Ops should keep watching the staff Driver-Auto page, because a trip can go unseen.
- [ ] Check the **Driver-Auto tables are on live** (`prisma/sql/apply-driver-auto.sh`); the last note said they weren't. Older apps get the shorter list as soon as the server deploys.
- [ ] Translate the new text (English only for now: Sinhala, Tamil, Vietnamese).

## 3. OPS / driver app — vehicle guests (`f230edd`)

15 files · +239 / −86 · new `vehicle-details.ts`, check script `npm run vehicles:details`

- [x] Vehicle forms use a **guest picker** instead of seat count, in the app, the vendor dashboard and driver registration.
- [x] Server checks each vehicle type's guest range on registration and on vehicle add and edit.
- [x] A vehicle saved before the ranges keeps its number until someone changes it.
- [ ] Register one driver and add one vendor vehicle after deploy (the commit message records no test run).

## 4. Driver app — call operations first (`dd9d312`)

6 files · +61 / −14

- [x] **"I can't continue this trip":** the Why box and Send stay locked until the driver taps Call operations. Text in English, Sinhala and Tamil.
- [x] **Trips not started:** the button now shows as soon as the trip is theirs. No server change needed.
- [x] **Emergency number** +94 70 681 2853 on the Help and can't-continue screens and the vehicle-problem pause sheet.
- [x] "I need help" and guest-won't-rate screens stay unlocked, so an accident can still be reported straight away.
- [ ] Have someone check the Sinhala and Tamil wording.
- [ ] Test on one iPhone and one Android after the build (the leave-and-return check differs on each).
- [ ] **Decide:** should the sign-up pending and vendor account screens also use the new number? They still show +94 70 722 4229.
- [ ] Know the limit: leaving the app for 5 seconds counts as a call, and older apps can still send without calling.

## 5. OPS — merge repair (`c219c1c`, `c95ed32`, `07ab8e5`)

- [x] `c219c1c` added 0-byte images and sounds; merge `c95ed32` kept them over the real files, which broke the driver-app iOS bundle, and dropped the exec bit on `start-cf-tunnel.sh`.
- [x] `07ab8e5` put the 28 files back to `fe8bd99`. Checked today: **0 empty image or sound files** tracked, and the script is executable again.
- [ ] Find what made the 0-byte commit on 5 Nov at 18:53, so it doesn't happen again.

## 6. Online Work — daily filing tray (`78958a6`)

12 files · +693 / −35

- [x] Cause: unfinished tasks only carried one day, and "Carried over" tasks vanished the next day.
- [x] **Still open from earlier days** tray on Daily filing: last 45 days, most urgent first, "Day 4" counter. Answers: Done today, Still on it, Blocked, Not needed (with Undo).
- [x] **My filings** shows how each task ended without rewriting old days; managers see the same in Search filings. Finished time counts on the day it was finished.
- [x] Agent version `1.0.4` went in with this commit (the 5 Nov uncommitted change is closed).
- [ ] After deploy, check the tray with a real employee's filings (the commit's testing notes are blank).
- [ ] Publish the 1.0.4 agent installers if they aren't on S3 yet (not checked).

## 7. Online Work — QA fixes (`b54375d`, `ab95b97`)

- [x] **Offboard popup** (`b54375d`, 32 files): buttons stay visible at all 9 screen sizes; says what's missing; about 20 other popups can now scroll.
- [x] **Search ×** on about 30 more boxes (empty-box bug fixed in `ab95b97`). Esc in a popup clears the search only.
- [x] **SIM button flicker** gone (164 frames → 0).
- [x] **Excel button** follows the tab and says why it's greyed out (7 tabs checked).
- [x] **Employee list:** own office first, others shown as "Works from Chennai" with **Move asset there**; team list caps of 20 and 60 removed.
- [x] **Speed:** Dashboard, Employees and Assets load in parallel, and shared reads happen once per page.
- [ ] Check the **dropdown fix on Windows** (issues 1 and 2: not proven to solve them).
- [ ] Measure the speed gain on live (only the build was checked).
- [ ] Deploy all of `main`, never `b54375d` on its own.

## 8. Online Work — asset delete (`03d8f3a`)

4 files · +103 / −19

- [x] `dev-onlineWork` has **no asset tables** (30 tables checked read-only). Real assets are in `inventory.json` on the app server. `ahds_online_work` and other databases there weren't checked.
- [x] **Delete:** never-issued assets by anyone managing the office; assets with history by module owners only, with a reason and the typed tag; assets with someone or out for repair can't be deleted.
- [x] Audit log records who and why; the record moves to a private archive in `inventory.json`. Tags aren't reused.
- [x] 7 refusal cases and 3 deletes passed on fake data; button rules checked in a browser.
- [ ] Test through a signed-in session on a real `inventory.json` (back the file up first).
- [ ] Tell QA that stock lines have no delete, so Overview and Stock can still download Excel.
- [ ] **Decide:** add a Restore button? Restoring is by hand for now.
- [ ] Commit or drop the blank line in `asset-inventory.tsx`.

---

## Still to do today

- [ ] ⚠️ **Security (new):** change the **`dev-onlineWork` database root password** (it was pasted into a chat) and close **port 3306** to the internet; it could be reached directly from this Mac.
- [ ] ⚠️ **Security:** confirm the boss account password from `301ca4b` (plain text in a pushed commit message) has been changed.
- [ ] **OPS:** run the agent-digest and WhatsApp group SQL on live (`--check` first), then **redeploy OPS** (groups, Get trips, vehicle checks, digest, T-3 PDF, same-order reads, amendments, WhatsApp Retry/Report).
- [ ] **OPS:** open a PR for the 18 commits ahead of `Master-Dev`.
- [ ] **Driver app:** new build for iOS and Android (Get trips design, call-first, guest picker). The app has no over-the-air updates.
- [ ] **Accounts:** `php artisan migrate` (`b2c_order_amendments`, plus the same-order migration) and deploy `Master-Live`.
- [ ] **Same-order rollout:** find and close the n8n gap, check the card gateway's test merchant accepts an id like `15726-V3-K7QZ`, and only then switch on (§11 of the rollout doc).
- [ ] **Online Work:** check every admin is on the new access list, then deploy with the PM2 / nginx / DB pool changes; tell staff about the 7-day filing limit.
- [ ] **Fix Meta billing (error 131042)**, then WhatsApp **Retry failed**.
- [ ] Commit or drop the **HRMS** 502 retry change (uncommitted since 27 Oct).
- [ ] Write the **3, 4, 5 and 6 Nov daily updates** (none in the folder yet).

## Carried over

1. **From 5 Nov:** after OPS deploy, check the 15912 card and 15726 / 15833, the digest popups in a browser, and **Archived** digests; after Accounts deploy, check AHS-15875 in the 03/11 mail; after Online Work deploy, **Send again** on RPT-WVXWXG, send one real report through Microsoft 365, find why the portal restarted (`journalctl`), test the assign list, use **Master edit** to fill EMP IDs.
2. **From 4 Nov:** set up the 30 Sundays digest, send a test, switch on auto-send; check the Meta template status in Sent history; decide whether a driver vendor alone covers a line; add emergency contacts and generate T-3 for one real booking; decide if Data/Voice cost is part of Monthly cost.
3. **From 3 Nov:** check 15726 / 15833 versions and run the carry-over review with TE; check real B2C payable arrival and payment dates; Kieu's 10:53 leave email (**Send the email now**); password-reset mail settings on the server.
4. **From 2 Nov:** `php artisan b2c:order-chains` preview; compare **Store order mix** with AahaasFlow; test **Monthly Business Review**; check Apple import auto-tickets; Prev / In OPS decision; re-download the "Ticketing, Flights & Visa" roster; set department heads; remove old `pradeep.kumar@aahaas.com` BCC; department heads approving leave decision.
5. **From 31 Oct (Accounts):** deploy Payable 1.3 + missing products; **Write to the sheet tab**; **Rate sheet → Daily mail → Save & start**; Sheet doctor row fixes to the rate-sheet owner.
6. **From 30 Oct (Online Work):** Halloween items check; tell HR attendance % will change and export one period; nginx password on `/ad/bat`.
7. **From 29 Oct:** deploy OPS + AahaasFlow with the shared service key; B2C contact script for older bookings; check 14784; IT spend dates; check VN 42725 / VN42951.
8. **From 28 Oct:** Update Booking on 15679; test ticket sheet print; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; Accounts auto B2C invoices.
9. **From 27 Oct and earlier:** B2C Sales / AI Call reports; `pnl_date_overrides` migration; B2B quote pipeline decision; 7 calls stuck mid-dial; `n8n-project` call server; Travel Quote GPT DB; Operation App build; Meta guest template; biometric daily sync + new API key + UTC fix; transport supplier tables; Mail Scanner; ticket rate sheet dry run.
10. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
11. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.

---
