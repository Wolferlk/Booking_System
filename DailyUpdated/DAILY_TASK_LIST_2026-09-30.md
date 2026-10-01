# Today Daily Task List — 30 September 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 30 September 2026

| Project | Branch | State at time of writing |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 1 commit today (`1f7b3f6`) · MC done mark committed yesterday (`ffdd2c3`) · clean · up to date with origin |
| Accounts System | `REV1` | 5 commits today · clean · up to date with origin |
| Aahaas Online Work | `main` | 8 commits today · clean · up to date with origin |
| Aahaas Task Manager | `main` | No work planned · clean |
| AHS | `sewminiV3-UI-changes` | No work planned · clean |

**Working rule:** keep live data safe. Read-only checks wherever possible. Get approval before any SQL script, migration, `prisma db push`, email send, third-party write, commit/push/deploy or `pm2` restart. Approval for one does not carry over to the next.

## Main outcome for today

1. **Accounts:** deploy today's B2C report fixes, then **re-send the 29/09 B2C invoice and P&L mails** so AHS-14748 is included. Run `ResyncInvoicePaid` in report mode on the server.
2. **OPS:** run the **MC done SQL** (test database first, then live with approval), then check the new **Airport Pickup Timings** setting on a real agenda.
3. **Online Work:** get **one real email** through the new mail setup, then check the new **Attendance period view** and the daily report numbers against real data.
4. Clear the 29 Sep carry-overs: the corrected **20–26 Sept weekly OPS report** and the browser checks.

---

## 0. Blockers to clear first (high priority)

- [ ] **MC done table (OPS).** `prisma/sql/2026-09-29-agenda-mc-done.sql` is committed (`ffdd2c3`) but has not run anywhere. Run `apply-agenda-mc-done.sh --check`, then run it on the **test database**, then on live **with approval**. Never `db push`. **The done mark fails until the `agenda_mc_done` table exists**, so don't deploy `ffdd2c3` to live before this.
- [ ] **Online Work mail secret.** `SEND_GRAPH_CLIENT_SECRET` must be on the server (or SMTP set up). Until then the daily report, leave, approval, ticket and absence emails don't go out.
- [ ] **Accounts production database.** It isn't reachable from this Mac, so every Accounts fix today is untested against real data. All the checks in Section 2 must be run **on the server**.

---

## 1. OPS — Airport Pickup Timings (`1f7b3f6`, verify)

11 files · +578 / −54 · **no database change** (one `flight_pickup_rules` row in `system_settings`, written only when someone saves)

- [ ] Open **Settings → Operations → Airport Pickup Timings**. Check the −/+ buttons (15-minute steps), quick picks, rounding options, the live preview timeline, **Defaults** and **Save timings**.
- [ ] Save a non-default value (e.g. 2 h 30 m departure) and check it shows on an agenda flight card as *"Suggested pickup · 2 hrs 30 min before departure"*. Check that clicking it takes an admin to the setting.
- [ ] Check an **arrival** row: *"Suggested meeting · 45 min after landing"* and the new **Use as meeting time** button.
- [ ] Check domestic vs international is picked correctly, e.g. **VN169 HAN → DAD** should use the domestic value.
- [ ] **Add to details** text uses the new numbers. Existing saved text doesn't update by itself (Remove from details, then Add to details).
- [ ] Export one agenda to **PDF** and **Word** and check the times.
- [ ] Run **AI Generate** on one test booking and check that the meeting time on each airport row is recalculated from the setting.

## 2. OPS — MC Report "done" mark (`ffdd2c3`, after Blocker 0)

- [ ] Tick a Sri Lanka movement: the row turns green. Un-tick it: the row is deleted.
- [ ] **Save the chart twice** and check the tick is still there (the done row must move to the new agenda item id, like `AgendaMcDetail`).
- [ ] Check `/print/mc-report` shows done rows the way the desk expects, and that `doneByName` / `doneAt` are stored.

## 3. OPS — Carried from 29 Sep

- [ ] `b238af0`: a booking that has **only a Tour Vendor** counts as allocated on the Ops Board (column **Driver / Vendor**).
- [ ] `b3f4632`: the Driver / Vendor card number matches the ring (e.g. **16 Done** with **16/21**) on the live board.
- [ ] **Browser-check the week picker**, especially **Send now to everyone**, a weekly **Preview** and the Latest / Week 1–5 buttons.
- [ ] **Send the corrected weekly report for 20–26 Sept** (September, Week 3). Preview, send a test to me, then send to everyone **with approval**.
- [ ] Check the **"took too long" fix**: preview loads within about 20 s, and the yellow *last reconciliation* note shows when the Apple System can't be reached.
- [ ] **Remove from details / Add to details** on **VN41769**.
- [ ] **Watch the pm2 log** for the next Client Confirmed and Operations Ready emails and confirm where each one went.
- [ ] **Decide:** should *Remove from details* also be able to hide the whole flight card?

---

## 4. Accounts — Today's B2C report work (deploy and verify on the server)

| Commit | What | Check |
|---|---|---|
| `f9e2ac5` | Both B2C daily mails count every storefront order by **order date** (catch-up step `B2cDayCohort.php`, Colombo day for the timers, invoice timer covers 2 days). | After deploy, the 29/09 mails should show **5 orders including AHS-14748**. `REPORT_B2C_PREFLIGHT=false` turns the catch-up off if needed. |
| `b6a58dc` | Fixed **0 orders on 29/09** in the B2C P&L report caused by `f9e2ac5` (second fetch now reads B2C + B2B and only adds). | Open the **29/09 B2C P&L preview** on `/pnl/auto`. It should list the day's orders. |
| `90f4684`, `5472145` | Removed the red **Storefront count check** box from both the invoice and the P&L mail. | Preview both mails. The box should be gone; the catch-up sync still runs. |
| `7ae6231` | New `ResyncInvoicePaid` command: compares each invoice's saved Paid figure with its actual payments. | Run it **in report mode only** on the app server (not `35.197.143.222`, which is an old copy). Check **IS49101_R31** is in the list. |

- [ ] Deploy `REV1` **with approval**.
- [ ] Preview the 29/09 invoice mail (`/reports/auto`) and P&L mail (`/pnl/auto`). Both should show 5 orders.
- [ ] **Re-send the 29/09 mails** with *Send now*, date 29/09/2026. These go to real recipients, so **approval first**.
- [ ] Watch tonight's B2C mails for 30/09 (built just after midnight Colombo). Check that an invoice raised today for an order placed yesterday lands on yesterday's mail.
- [ ] Run `ResyncInvoicePaid` without `--apply` and read the list. Only use `--apply` **with approval**, and keep the `storage/app/repairs/resync-paid-<time>.json` backup.
- [ ] Carried from 29 Sep: Invoice versions on **/invoice-payments** (latest on Download, Versions panel, red OLD mark on one old version of each invoice type, **Download all versions (.zip)**), and the **Dashboard action buttons** switch as super admin and normal user.
- [ ] Standing morning checks from [DAILY_TASKS.md](../../Accounts_system/DAILY_TASKS.md): Sync Ledger count, alerts bell, SL booking count, invoice ↔ P&L match.

---

## 5. Online Work — Today's work (nothing checked against real data yet)

| Commit | What | Check |
|---|---|---|
| `f67fceb`, `5879a57` | New Windows download card (x64 / ARM64). Installers moved to **S3** (`s3://ops.aahaas/online-work/agent/`) behind a 5-minute signed link. | Download both installers from the sign-in page **while signed out** and check the SHA256 matches. |
| `7a41cd5` | Setup guide PDF served from `public/guides/` so the View pop-up works. | Open the View pop-up on the sign-in page while signed out. |
| `ce5aad4` | Daily report email: new top boxes (Present, Teams calls, Emails, PBX calls), removed "awaiting reply" items. | Use **Send to me** and compare the four numbers with a known day. |
| `73336d7` | Teams messages and calls from Microsoft's one-day report; empty days skipped. | Confirm real numbers show, not "—". The "all-zero rows = not published" assumption is **unchecked**. |
| `2f5c31d` | Removed Avg focus card and Focus column. | Check in the same test email. |
| `f7aaf1c`, `171f1ba` | **Attendance:** Period & monthly view, filters, monthly Excel / CSV export, tick-and-export on the day view. | Open with real people. Check weekends show as Rest, not Gap. Download one monthly Excel and one CSV. |

- [ ] **Repo size:** `f67fceb` (pushed) still has the two `.exe` files (~25 MB) in history. Decide if that's acceptable or needs a history clean-up (**approval required**, it rewrites pushed history).
- [ ] A stray duplicate `Aahaas-Online-Work-Employee-Guide (1).pdf` was committed in `7a41cd5`. Remove it if not needed.
- [ ] Confirm the server has the AWS keys and the new `@aws-sdk/*` packages installed, so the download route works in production.
- [ ] Carried from 29 Sep: **Sign-in & access panel** (set new password, remove login and re-register) on a **test employee only**; report downloads (PDF / Excel); **Notifications settings** Test sends to yourself only; per-person send button (**no real staff while testing**); absence alert custom message / reminder in the preview.
- [ ] Carried from 28 Sep: click through the help desk forms and **Support desk** (`/tickets`), and open a few employee **Teams tabs** against known activity.
- [ ] Run the production build and type check before the next push.

---

## 6. Still open (not for today unless there's time)

- **From 25 Sep:** five OPS scripts, each with `--check` first and on the test database too:
  - `apply-agenda-mc-details.sh`
  - `apply-agenda-tickets-control.sh`
  - `apply-passenger-special-notes.sh`
  - `apply-ticket-files.sh`
  - `apply-agenda-custom-service-types.sh`

  Also: the two Bank Settlements migrations, and checking the D-3 Driver Allocation / Reconfirmation numbers in the Daily Operations email. Decisions are still needed on ticket files for guests, tours with no agenda, and the unused *"What the mail said"* code.
- **From earlier:**
  - Checklist VN 2.1v script and first sync; the Vietnam agenda includes and Vietnam Booking Checklist scripts
  - Azure write access to OneDrive; `Mail.Send` in Entra
  - the three payment migrations; the five live indexes
  - **rotating the credentials tracked in `web/.env.local.example`**
  - `AUTH_SECRET`; `DB_READ_HOST` in Amplify



## Before you stop

- [ ] MC done SQL run on the test database (and live, with approval)
- [ ] 29/09 B2C invoice and P&L mails re-sent with AHS-14748, or the reason it wasn't written down
- [ ] `ResyncInvoicePaid` report-mode output saved
- [ ] Corrected 20–26 Sept weekly OPS report sent, or the reason written down
- [ ] Online Work: one real email received through the new mail setup
- [ ] All worktrees clean and pushed (with approval)
- [ ] Write `DAILY_UPDATE_2026-09-30.md`
