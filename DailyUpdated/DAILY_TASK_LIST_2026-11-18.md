# Daily Task List — 18 November 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 18 November 2026
**Written:** 21 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 18 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v`, `fix/vn-checklist-sync-now` | 2 commits · **PR #326 merged** into `LIVE-1.0.0v` · pushed |
| Accounts System | `feat/vn-missing-tab-auto-prune` → `Master-Live` | 1 commit · **PR #70 merged** into `Master-Live` (`f373017`) · pushed |
| Online Work | `perf/slow-employee-pages`, `feature/roster-timezone-overnight-shifts` → `main` | 3 commits · **PR #16, #17, #18 merged** into `main` (`7254687`) · local `main` is 6 behind `origin` (pull needed) |
| HRMS | `v1.0.13` | No commits found · repo not checked from this laptop |

> All commits are pushed and merged. **Nothing is confirmed as deployed.** OPS and Online Work changes passed a type check only; the Accounts fix was PHP-linted but **not run**. Nothing was written to a live database.
>
> ⚠️ Several commit messages say "not committed". That was true when written; the work is now committed, pushed and merged.

## What was done

1. **Accounts:** found why **every Fetching task stopped** (P&L sync, invoice mail, agent ID repair) since 17 Nov 17:19 — a stale 24 h `fetch:auto-run` lock. Fixed with a 30-minute lock + "Overdue" warning.
2. **OPS:** **Sync now** on Payable 2.2VN (ERP) fixed — the OPS route it calls did not exist.
3. **OPS:** Auto reports page — **Edit** from the ⋯ menu on a schedule card now opens.
4. **Online Work:** rosters in **VN or LK time** + **night shifts**; faster employee pages.
5. **Online Work:** **department heads approve leave** in their own portal; boss can **approve by replying to the email** (AI reads the reply).

---

## 1. Accounts — stale scheduler lock + agent ID sweep (`4e02782`, PR #70 `f373017`)

3 files · +37 / −13

- [x] **Cause:** all Settings → Fetching tasks go through one dispatcher, `fetch:auto-run`, using `withoutOverlapping()` with no argument (24 h lock). The 17:19 run on 17 Nov died (pm2 restart / deploy), the lock was never released, and the scheduler skipped every minute after. Pages kept showing a "next run" in the past.
- [x] `routes/console.php`: own mutex name (old stale lock ignored) and a bounded lock — a dead tick blocks the dispatcher for **30 minutes at most**. Running tasks are still protected by `FetchSchedule::activeRun()`.
- [x] Agent IDs page: red **"Overdue by … — the scheduler is not dispatching"** badge when a due run is > 15 min late.
- [x] `AgentIdRepairService`: the free first half of an automatic run now also fixes invoices whose earlier invoice of the same booking already has a real ID.
- [ ] Deploy, then confirm the Fetching tasks run again and **VN43307_R2** gets `AI0000464856402`.

## 2. OPS — VN checklist "Sync now" route (`c0fa7536`, PR #326 `7773cb8a`)

1 file · +67

- [x] The ERP button calls OPS `/api/cron/vn-checklist-sync-now`; that route didn't exist, so every click failed. The 2-hourly automatic sync was never broken.
- [x] New `src/app/api/cron/vn-checklist-sync-now/route.ts`: same sync as the checklist page's own Sync now. Writes nothing if the workbook hasn't changed; refuses to start a second run.
- [x] Needs the shared secret (`ACCOUNTS_INTEGRATION_SECRET` or `CRON_SECRET`) — the ERP already sends it.
- [x] Returns a readable message ("Synced — 380 tours: 2 new, 5 changed, 0 removed") or the real error; logged as a manual sync by "Accounts: <user>".
- [ ] Deploy OPS, then click Sync now on Payable 2.2VN once.

## 3. OPS — Auto reports ⋯ menu (`09536282`)

2 files · +121 / −8 (also added the 17 Nov daily task list)

- [x] **Cause:** the menu closed 150 ms after the ⋯ button lost focus, so the click never reached "Edit".
- [x] `dashboard/reports/auto/page.tsx`: focus-loss timer removed; menu closes on outside click or Escape; each item (Edit, Send test, Send now, Pause/Resume, Delete) closes the menu first, then acts.
- [ ] Open the page after deploy and try Edit on one schedule.

## 4. Online Work — roster time zones, night shifts, speed (`de31e1f` PR #16, `f106ae4` PR #17)

PR #16: 13 files · +799 / −87 · PR #17: 13 files · +53 / −20

- [x] **"Times in" LK ⇄ VN switch** on the roster header (remembered per person per roster); banner explains the conversion; cells, tooltips, cover strip and arrival times follow the choice. Typed hours and templates converted automatically. Team-level clock option in Roster settings.
- [x] **Night shifts:** ☾ New night shift (21:00 → 09:00), quick shapes, "length from start" buttons, "+1 / next day" markers. Overnight shift still counts on the day it starts.
- [x] Same LK ⇄ VN switch and night shapes on the employee's weekly shift and "My shift" form. A VN shift starting 00:00–01:29 is refused with an explanation (it would land on the previous LK day).
- [x] **Slow employee pages:** link prefetch turned off across employee lists; lighter attendance / mail / Teams metrics queries.
- [ ] Excel workbook still in Sri Lanka time — a VN-time workbook imported with "Import Excel" would be read as LK time.

## 5. Online Work — leave approvals by heads + email replies (`a7b7e1b`, PR #18 `7254687`)

20 files · +1,114 / −19

- [x] **Team leave** page (`/me/team-leave`): heads see their team's pending leave, who else is away, Approve / Reject. Nobody can decide their own leave. Decision goes into the leave's email thread.
- [x] **Approve by email:** the portal reads replies in the leave thread (HR's and the employee's mailbox), only from that leave's approvers. OpenAI classifies approve / reject / question / not an answer with a confidence score; ≥ 85 % and clear → decided automatically ("Pradeep Kumar (by email)"). Anything less waits for HR.
- [x] HR sees each reply with quote + confidence and Confirm / Misread / Not an answer buttons; ✉ Check email replies button; Settings → Leave → **Answers by email** (apply / suggest only / off) + confidence slider.
- [x] Automatic check every 5 min, **production only**; off locally unless `LEAVE_REPLY_WATCH=on`.
- [ ] Set `PORTAL_URL` on the server (optional `OPENAI_LEAVE_MODEL`); confirm Graph can read `hr@aahaas.com`.
- [ ] **Decide:** "apply clear answers" or **"Suggest to HR only"** — the portal trusts the reply's sender address, which can be faked. Reply text + employee name + dates go to OpenAI.
- [ ] `npm ci`, `npm run typecheck`, `npm run lint`, then deploy Online Work.

---

## Still to do today

- [ ] **Accounts:** deploy `Master-Live` (stale-lock fix + everything from 17 Nov) — run `php artisan migrate --pretend` first for the Vendor Payable tables.
- [ ] **OPS:** build `LIVE-1.0.0v` on a machine with Node and redeploy (Sync now route, ⋯ menu, 17 Nov work).
- [ ] **Online Work:** pull `main`, type-check, deploy; decide the email-reply mode.
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 17 Nov:** decide on correcting stored B2C invoices / P&L rows (`b2c:pnl-resync --dry-run`, approval + backup); order-date rate vs dashboard rate; try Excel MC Generate on one VN booking before switching auto-update on; check VN40172 on the board; check VN43304_R2 agent ID.
2. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; merge `61f2ac06`; check invoice PDF/logo and AI… agent ref; Reconciliation download check; Agent Management short-name keywords; "Sri Lanka" in address decision.
3. **From 14 Nov:** type-check Bulk Issue desk / Ticket Issue workspace; Vendor Payable migration.
4. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default (`auto_guest_engage_on_assign_enabled`); AI-call re-point decision.
5. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; 2 old `AutoReportMailTest` failures.
6. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Meta template submissions; driver app build.
7. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
