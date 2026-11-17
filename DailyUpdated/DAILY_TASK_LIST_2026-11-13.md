# Daily Task List — 13 November 2026 (Friday)

**Owner:** Sasindu Diluranga
**Date:** 13 November 2026
**Written:** 16 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 13 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 10 commits (`a7741024` … `ffdfa75f`) · pushed |
| Accounts System | `Master-Live` | No work |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No work · uncommitted change still open |

> All commits are pushed. **Nothing is confirmed as deployed.** Node was not available on the laptop for most of the day, so most changes were **not type-checked or built**; checked by reading only. **Run `npx tsc --noEmit` and `npm run build` before deploying.**
>
> ⚠️ Commit `a7741024` has the generic message "Implement code changes…" and shows −2,461 lines in 1 file (the `api responssample.md` sample file was deleted). Commit `d5f7bf8e` also added `.claude/settings.json`.

## What was done

1. **OPS:** guest **phone/WhatsApp country-code validation** + international phone input; corrected numbers re-point the AI-call service.
2. **OPS:** **Guest WhatsApp card** on the booking page and **4 guest-number chips** on the MC report.
3. **OPS:** **Guest Autopilot** — automatic call-approval request, AI-call registration and 2 reminders; switching off needs an emailed code.
4. **OPS:** booking page **top card redesign**; Guest Autopilot activity timeline.
5. **OPS:** **Booking Logs** (section history drawers + `/dashboard/logs` page).
6. **OPS:** **Care tab** in the WhatsApp trip panel; agent digest contact-line cleanup and better error reporting.

---

## 1. OPS — guest number validation (`d5f7bf8e`, `a7741024`)

7 files · +949 / −44

- [x] New contact-reach API and international phone input with country-code checks for guest/agent phone and WhatsApp.
- [x] Daily plan and feedback read the booking directly, so a fixed number is used from the next run.
- [x] Saving a changed guest WhatsApp updates the **production AI-call service**, only if it was dialling the old guest number. Logged in activity log.
- [x] No automatic AI-call registration on save from this change; "Set up" opens AI Calls with the number filled in.
- [ ] **Decide:** keep the automatic re-point to the live call service, or make it a manual step?

## 2. OPS — Guest WhatsApp card + MC report chips (`9d3b4cb2`, `1766a895`)

- [x] Booking page card: green (valid number, Daily plan · Feedback · AI calls, copy / wa.me / change), amber (no country code, one-click **Fix → +91…**), gradient "Tap to assign" (no number, with picker of numbers on the booking).
- [x] Only roles that can edit contacts can change it; client logins don't see it.
- [x] MC report guest chips: 🟢 WhatsApp · 🟠 phone only · 🟡 no country code · 🔴 missing. Search matches WhatsApp numbers; new "Guest WhatsApp" row.
- [ ] After deploy, check one booking of each type (valid, no country code, no number).

## 3. OPS — Guest Autopilot (`46a14b78`, `ae8c9f8f`)

15 files · +1,019 · then 3 files · +464

- [x] When a guest WhatsApp is assigned: send call-approval request → register for AI calls → Reminder 1 after 24 h → Reminder 2 after another 24 h → Allowed / No response.
- [x] Stops early on cancel, trip end, number change or calls off. Same number saved twice does nothing.
- [x] Switches: 💬 **Auto messages** and 🤖 **Auto AI calls**. Turning **off** needs reason + 6-digit emailed code; turning on is one click. Audit trail on the booking.
- [x] Activity view: "Guest allowed WhatsApp calls" banner, tiles (daily plans, AI calls, guest mood), D1/D2… timeline, last AI call summary. Read-only.
- [x] Stored in `system_settings`; no migration.
- [ ] ⚠️ **Once live, saving a guest WhatsApp on any booking messages that real customer and registers AI calls.** Global off switch: `auto_guest_engage_on_assign_enabled = false`. Decide if it should start off.
- [ ] Build and test on one internal booking before deploy.

## 4. OPS — booking page top card (`b29c81aa`)

- [x] Bigger booking ref; 4 tiles (Travel + nights, Travellers, Value, Departs in — red within 7 days).
- [x] Buttons grouped: **Workflow** (Delete moved here), **Open & manage**, **Reach out**. Empty panels hide.
- [x] Guest WhatsApp card and Guest Autopilot side by side under it.
- [ ] `npm run build` and open a booking to check.

## 5. OPS — Booking Logs (`44a995eb`)

18 files · +1,659

- [x] Clock-icon **History** button on each section (overview, contact, passengers, flights, accommodation, movement chart, Guest Autopilot) with old → new values.
- [x] New **Booking Logs** page `/dashboard/logs` (Super Admin sidebars): search, filters, "Failed / not sent only", shareable URL, default last 7 days.
- [x] Daily-plan failure reasons now recorded (max once per booking per 20 h).
- [ ] **Needs approval:** new table `booking_event_logs` on live. Run `bash prisma/sql/apply-booking-event-logs.sh --check` first, then without `--check`.
- [ ] Run `npm install --legacy-peer-deps` / `npx prisma generate` on the server.

## 6. OPS — Care tab and agent digest (`ffdfa75f`, `cc6f0dd6`, `bade27d7`)

- [x] **Care tab** in the WhatsApp trip panel: care ring, journey rail (Permission → Reconfirm → On tour → Feedback), Up next countdowns, call-permission steps, day-by-day plans and calls, reconfirmation, feedback, last call summary. "Guest care" card on Trip overview. Read-only (`guest-care/route.ts`).
- [x] Agent digest: one Contact line per stop, duplicate numbers removed (`+84 912…` = `0912…`), numbers pulled out of vendor names, "Driver pending" → "⚠️ Contact pending".
- [x] Agent digest error reporting: failure counts and last error details.
- [ ] `npx tsc --noEmit` and open a chat in the inbox to check the Care tab.
- [ ] **Decide:** remove the separate 🚐 vehicle line from the digest?

---

## Still to do today

- [ ] Install Node on the laptop (or use another machine) to type-check and build the 12–13 Nov OPS work.
- [ ] Approve and run `booking_event_logs` SQL on live.
- [ ] Decide the Guest Autopilot default before deploy.

## Carried over

1. **From 12 Nov:** VN Driver Sync SQL + cron pinger; `as-cancel-sweep` scheduler; B2B console channel decision; old tour vendors decision; leaderboard deploy.
2. **From 11 Nov:** security items; agent-digest + WhatsApp-group SQL; OPS redeploy and PR; Accounts migrate + deploy; Online Work deploy; Meta billing `131042`; driver app build.
3. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
