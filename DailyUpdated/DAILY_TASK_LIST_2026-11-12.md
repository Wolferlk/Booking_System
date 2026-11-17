# Daily Task List — 12 November 2026 (Thursday)

**Owner:** Sasindu Diluranga
**Date:** 12 November 2026
**Written:** 16 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 12 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 15 commits (`37806743` … `2d87d896`) · pushed |
| Accounts System | `Master-Live` | 4 commits (`ec3d694`, `47d1c9d`, `32d6bd9`, `e090994`) · pushed |
| Online Work | `main` | No work (last commit 10 Nov, `1c07162`) |
| HRMS | `v1.0.13` | No work · uncommitted `onlineWorkPerformance.service.js` still open |

> All commits are pushed. **Nothing is confirmed as deployed.** OPS work was checked with type-check / lint and tests on fake rows only, **not against the live databases, no real WhatsApp sent.** Accounts leaderboard tests ran on in-memory SQLite.

## What was done

1. **OPS:** WhatsApp inbox **number switcher** (Operations / Aahaas / Apple / Singapore / Supplier).
2. **OPS:** Daily Sales Report split into **Aahaas B2B** (B2B portal + AI Chat) and **Aahaas B2C**.
3. **OPS:** **VN Driver Sync** from the OneDrive movement chart (Microsoft Graph); old VN Vendor Sync retired; better matching, meeting time, guest contact fill, new filters.
4. **OPS:** **AppleSystem cancellation check** (daily + date range) → "Requested to cancel", assignment lock, new **Cancellations** tab.
5. **OPS:** Daily **ticket WhatsApp at 14:30** + 3 new Ops Board columns; MC report select-all for daily plans; Agent filter on All Bookings; **NEW / RE-CONFIRMED** labels; Word download fix.
6. **Accounts:** **Top 10 agents / Top 10 file handlers** leaderboard in the B2B invoice mail (daily, weekly, monthly).

---

## 1. OPS — WhatsApp inbox number switcher (`37806743`)

11 files · +639 / −14

- [x] Chips above the tabs: Operations · Aahaas · Apple · Singapore · Supplier · All numbers, each with chat count and unread badge. Opens on Operations.
- [x] All / Unread / Pinned / Country / Groups tabs work inside the picked number.
- [x] Chats to a non-Operations number get a coloured tag; header warns the reply goes out from Aahaas Operations.
- [ ] After deploy, check the switcher with real chats on each number.

## 2. OPS — Daily Sales Report B2B / B2C split (`facb11ee`)

36 files · +2,805 / −58

- [x] B2B portal + AI Chat = **Aahaas B2B**; all other channels = **Aahaas B2C**. B2B is never added to B2C totals.
- [x] Email: share bar, two side-by-side cards, B2B order list with channel badges. Excel "B2B Store" sheet + Channel column; subject, CSV, preview tile and AI summary use the split.
- [x] Rendered with fake orders matching the screenshot. Type-check: usual 12 errors only.
- [ ] **Decide:** should "B2B console" (Travel Quote GPT) orders count as B2B or B2C? (`B2B_CHANNELS` in `sales-report-data.ts`)

## 3. OPS — VN Driver Sync (`edcb6d86`, `a1fb8a55`, `aa211f61`)

- [x] Reads "(VN TEAM) Movement Chart 2026 (Final).xlsx" from OneDrive via Microsoft Graph (same login as Checklist VN 2.1 mirror).
- [x] Vendor column → movement driver; Local contact / Type of Car left alone; Text Message ignored. Short service names mapped; 56 duplicate rows counted once.
- [x] **Old VN Vendor Sync retired:** timer off, "Fetch now" does nothing, cron answers "retired", sidebar link removed. ~681 tour vendors it wrote are left in place.
- [x] Matching on From / To / Details / Location (city); new "sure" rule; AI only for close calls. VN40138 test rows all matched as sure.
- [x] Copies sheet **Meeting Time** only when the movement has none; fills **guest contact** only when the booking has none and the name matches a passenger.
- [x] Filters: Movement day / Arrival day, day chips (VN time), date range, search, driver, confidence, matched by, phone, min match %, sort.
- [ ] Run `bash prisma/sql/apply-vn-driver-sync.sh` (3 new tables), redeploy, change pinger to `/api/cron/vn-driver-sync`.
- [ ] First "Sync all now" in **Suggest** mode, review, then switch to Auto.
- [ ] ⚠️ Filling guest contact starts automatic guest WhatsApps for that booking. Switch "Fill guest contact" off in Settings if not wanted yet.
- [ ] **Decide:** remove the ~681 old tour vendors? Fill guide and vehicle type from the sheet?

## 4. OPS — AppleSystem cancellation check (`8450b57c`, `e64b962f`)

17 + 3 files · +2,092

- [x] Daily check from 07:00 Colombo: AppleSystem bookings created in the last 2 days now at status 3 → **Requested to cancel** (PENDING_CANCELLATION); Accounts get the usual approval email. Never cancels by itself.
- [x] Amendments left alone (re-checks the IS number; another confirmed quotation = amendment). Started tours, non-Apple, already cancelled/requested and Accounts-rejected bookings never touched.
- [x] Manual date-range check (Created/Arrival, up to 92 days) with **Preview** and run history.
- [x] MC report / Ops Board show "Requested to cancel" + purple AppleSystem tag; **Assign locked** for new drivers/vendors everywhere; driver brief skipped. Guides and tickets still allowed.
- [x] New **Cancellations** tab (`/dashboard/new-as-booking?tab=cancel`): flow header, countdown, "Run today's check now", queue, history, settings.
- [x] Tested on fake data (33 checks passed). No schema change.
- [ ] Set an external scheduler to call `/api/cron/as-cancel-sweep` with `CRON_SECRET` every hour (Amplify won't run it by itself).
- [ ] After deploy, run **Preview** for a date range first.

## 5. OPS — Ops Board, MC report, All Bookings (`7bbc2795`, `994f1402`, `103c31d1`, `2fc95481`, `9bc7a0a4`, `76533939`, `2d87d896`)

- [x] **Tickets to guest at 14:30:** every issued, not-yet-sent ticket, once per ticket. Files inside the 24 h window, otherwise template with download links. Logged as `[TICKETS-SENT]`. Only tickets issued after first run go automatically.
- [x] Ops Board columns: **Tickets Sent**, **Driver Details**, **CS Calls D1·D2·D3**; summary cards; Guest comms panel with Preview / Send now. (21 fake-data checks passed.)
- [x] Ops Board opens on **Arrivals**.
- [x] MC report hides **cancelled** and **test** files by default (Show / Only buttons).
- [x] MC report **Daily WhatsApp** select-all / invert / by day / by location; send button shows real message count; cancelled files never picked.
- [x] All Bookings: **Agent filter** (multi-select, case-insensitive) and one clear date row (Arrival / Created). Exports follow the filter.
- [x] **Word download fixed:** missing `resolveNoDriverNeeded` import (from `d6e902c`) broke Word for every booking.
- [x] **NEW / RE-CONFIRMED** labels on All Bookings from the Apple API (read-only). Matched Parinda's 6 files. Small cache in `system_settings`.
- [ ] After deploy: download Word for VN41822; check the 14:30 ticket send on one booking; use **Send now** for older tickets.
- [ ] Saved Report Studio templates will now hide cancelled/test files too. Tell users.

## 6. Accounts — invoice mail leaderboards (`ec3d694`, `47d1c9d`, `32d6bd9`, `e090994`)

- [x] Top 10 agents and Top 10 file handlers panels after the "Invoice amount" cards (AHDS B2B mail only). Medals, share pills, billed per currency (never mixed).
- [x] Weekly / monthly mails: headings say Today / This week / This month.
- [x] Ranks **only files created in the period** (new + created & amended same day). 11/11 mail: 14 instead of 27.
- [x] Name matching: "Esther" → "Esther R", titles ignored, spacing/case ignored ("Make My Trip" = "MakeMyTrip"). Agents never folded into longer names.
- [x] 5 leaderboard tests pass (SQLite in memory).
- [ ] 2 old `AutoReportMailTest` tests fail ("Unique agents" card no longer printed). Already broken before. Decide whether to update them.
- [ ] Deploy and check the next daily B2B mail.

---

## Still to do today

- [ ] **OPS:** run VN Driver Sync SQL, redeploy, set the two cron pingers (`vn-driver-sync`, `as-cancel-sweep`).
- [ ] **Accounts:** deploy `Master-Live` with the leaderboard.
- [ ] All Priority 0 security items from 11 Nov.

## Carried over

1. **From 11 Nov:** all security items (DB root password, port 3306, boss password, OpenAI key, Git history cleanup); agent-digest + WhatsApp-group SQL; OPS redeploy and PR; Accounts migrate + deploy; Online Work ticket backup and deploy; Meta billing `131042`; driver app build.
2. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
