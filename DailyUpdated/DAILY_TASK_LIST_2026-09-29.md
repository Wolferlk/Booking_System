# Today Daily Task List — 29 September 2026 (Tuesday)

**Owner:** Sasindu Diluranga
**Date:** 29 September 2026

| Project | Branch | State at time of writing |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 2 commits today · **MC Report "done" mark uncommitted** (5 modified, 4 new files) |
| Accounts System | `REV1` | No work yet today · clean |
| Aahaas Online Work | `main` | 9 commits today · **2 files uncommitted** (`graph.ts`, `use-live-report.ts`) |
| Aahaas Task Manager | `main` | No work planned |
| AHS | `sewminiV3-UI-changes` | No work planned |

**Working rule:** keep live data safe. Read-only checks wherever possible. Get approval before any SQL script, migration, `prisma db push`, email send, third-party write, commit/push/deploy or `pm2` restart. Approval for one does not carry over to the next.

## Main outcome for today

1. Finish, commit and prepare the **MC Report "done" mark** (OPS). The table must be created before it deploys.
2. **Browser-check yesterday's OPS work** and send the **corrected 20–26 Sept weekly report**.
3. **Get Online Work mail actually sending.** Add the secret, run one "Send to me", then click through today's notification, sign-in/access and download features.
4. Check yesterday's **Accounts** changes once deployed.

---

## 0. Blockers to clear first (high priority)

- [ ] **Online Work mail secret.** The variables were renamed today to `SEND_GRAPH_CLIENT_ID` / `SEND_GRAPH_CLIENT_SECRET` (`f9d05ec`). Add the **secret on the server** under the new name. Until then the daily report, leave, approval, ticket and absence emails do not go out. SMTP was also added today (`f59f921`), so confirm which transport the Daily report page reports as ready. Check `.env.production.example` for any SMTP settings that are required.
- [ ] **MC done table.** `prisma/sql/2026-09-29-agenda-mc-done.sql` is new and has not run anywhere. Run `apply-agenda-mc-done.sh --check` first, then run it on the **test database**, then on live **with approval**. Never `db push`. The done mark will fail until the `agenda_mc_done` table exists.
- [ ] Confirm no real secret is committed in either `.env*.example` file.

---

## 1. OPS — MC Report "done" mark (in progress, uncommitted)

Files: `schema.prisma` (`AgendaMcDone`), `lib/mc-done.ts`, `api/mc-report/done/`, `api/mc-report/route.ts`, `dashboard/mc-report/page.tsx`, `print/mc-report/page.tsx`, `api/bookings/[ref]/agenda/route.ts`.

- [ ] Finish the feature. The Sri Lanka desk ticks off a movement and the row turns green. Un-ticking deletes the row.
- [ ] **Check that the mark survives a chart save.** The agenda route must move the done row to the new agenda item id, the same way `AgendaMcDetail` is moved. Save a chart twice and confirm the tick is still there.
- [ ] Confirm the print view (`/print/mc-report`) shows done rows the way the desk expects.
- [ ] Confirm who ticked the row and when it was ticked (`doneByName`, `doneAt`) are shown or at least stored.
- [ ] Type check and lint, then commit with approval.

## 2. OPS — Today's Ops Board commits (verify)

- [ ] `b238af0`: a **Tour Vendor** now counts as an allocation, and the column is called **Driver / Vendor**. Check a booking that has only a tour vendor.
- [ ] `b3f4632`: the Driver / Vendor card number matches the ring (e.g. **16 Done** with **16/21**). Check on the live board after deploying.

## 3. OPS — Carried from 28 Sep

- [ ] **Browser-check the week picker**, especially **Send now to everyone** (it crashed the page before `5162834`). Also check a weekly **Preview** and the Latest / Week 1–5 buttons.
- [ ] **Send the corrected weekly report for 20–26 Sept** (September, Week 3). Preview it first, then send a test to me, then send to everyone **with approval**.
- [ ] Check the **"took too long" fix**. The preview should load within about 20 s even when the Apple System is slow. If it can't reach the Apple System, the yellow *last reconciliation* note should show.
- [ ] Click **Remove from details** on **VN41769**. Only the traffic / weather note should remain. Then check that **Add to details** brings the text back and nothing saves until you press Save.
- [ ] **Watch the pm2 log** for the next Client Confirmed and Operations Ready emails, and confirm where each one went: agent email, Mail Box directory, or `confirm.booking@aahaas.com`.
- [ ] **Decide:** should *Remove from details* also be able to hide the whole flight card?

---

## 4. Accounts — Carried from 28 Sep (after deploying `102e277`, `487da2e`)

- [ ] On **/invoice-payments**, check that **Download** returns the latest version even from an old revision's row.
- [ ] Open the Versions panel. Check the order, the green/red labels, the value chart, View / Download for each version, and **Download all versions (.zip)**.
- [ ] Open **one old version of each invoice type**. Check that the red top band doesn't cover the header on templates that print to the page edge.
- [ ] Find an old version whose source email is gone and which was never edited in Invoice Studio. It should download **without** the mark, but its file name should still say OLD. Decide whether that is acceptable.
- [ ] In **Page Master**, check the **Dashboard action buttons** switch as a **super admin** (can change it) and as a **normal user** (greyed out, and the server rejects the change).
- [ ] Run the standing morning checks from [DAILY_TASKS.md](../../Accounts_system/DAILY_TASKS.md): the Sync Ledger count, the alerts bell, SL booking count, and invoice ↔ P&L match.

---

## 5. Online Work — Today's work (nothing clicked through yet)

| Commit | Check |
|---|---|
| `9a54cb9` | Personal communication metrics for the signed-in user. Compare them against a known day. |
| `f59f921`, `f9d05ec` | Mail transport. See Blocker 0. After adding the secret, use **Send to me** on the Daily report page **before** turning the daily report on. |
| `2162310` | Custom subject line for the daily report. Check that the placeholders are filled in. |
| `b3b9555` | **Sign-in & access panel** on `/employees/[id]`. Test **set new password** and **remove login, then re-register** on a **test employee only**. Neither has been tested against the database. |
| `ff4f241` | Report downloads (PDF / Excel). Open both files and check they match the page. |
| `c1a9382` | **Notifications settings** (+2,266 lines): approval, leave, ticket and absence emails, with preview and test. Use **Test** to send to yourself only. |
| `9108c36` | A send button for each person in "Who it would email". **Don't send to real staff while testing.** |
| `176fccd` | Custom message and reminder fields for absence alerts. Check that the preview reflects them. |

- [ ] Finish or discard the **uncommitted** changes in `lib/graph.ts` and `components/live/use-live-report.ts`.
- [ ] Carried from 28 Sep: click through the help desk forms and the **Support desk** (`/tickets`). Open a few employee **Teams tabs** and compare against activity you know about. Check that the new setup PDF opens in the View pop-up without signing in.
- [ ] Run the production build and type check before pushing.

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

---

## Before you stop

- [ ] MC done mark committed, and its SQL checked (`--check`) at least on the test database
- [ ] Corrected 20–26 Sept weekly report sent, or the reason it wasn't written down
- [ ] Online Work: one real email received through the new mail setup
- [ ] Both worktrees clean and pushed (with approval)
- [ ] Write `DAILY_UPDATE_2026-09-29.md`
