# Daily Task List — 7 October 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 7 October 2026
**Written:** 7 October 2026, from git history and working-tree status

| Project | Branch | Work on 7 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | No new commits · clean apart from the untracked 6 Oct task list · up to date with origin |
| Accounts System | `REV1` | 6 commits (`661ab81`, `adfa8f0`, `dfcd5c5`, `54fba89`, `72cf3bc`, `8b71c36`) · clean · up to date with origin |
| Aahaas Online Work | `main` | 2 commits (`7611f65`, `fd40ff7`) · up to date with origin · ⚠️ untracked `ssh-keys/` folder |
| Aahaas Task Manager | `main` | 1 commit (`fb2b790`) · clean · up to date with origin |
| Aahaas mobile app (`Desktop/Aahaas_f/Aahaas_Final`) | `upgrade/rn-0.77-16kb` | Uncommitted: iOS deployment target 12.4 → **15.1**, build number 1 → **2** in `project.pbxproj` (late 6 Oct) |
| AHS | `sewminiV3-UI-changes` | No work · clean |

> **About the commit messages:** several say *"not committed or deployed yet"*. That was true when written; every commit below is now committed and pushed. **Nothing is confirmed as deployed**, and nothing was checked against the live database.
>
> **Git author:** today's commits are signed **`WOLFERLK`**, not *Sasindu Diluranga* as before. Check `git config user.name` if that wasn't intended.

## What was done

1. **Accounts:** B2C P&L **flights showing 0.00** fixed — prices now come from the booking's `originPayment`, then the checkout line's `total_price`, when the usual fare is missing (AHS-14921…14946).
2. **Accounts:** B2C report **preview kept stale 0.00 rows** after its own sweep had fixed them, and a re-sync guard kept the zeros — both fixed.
3. **Accounts:** B2C **Customer column names the lead passenger** instead of the shared storefront login (`admin6611`, `admin@it.aahaas.com`), with a read-only check command and unit tests.
4. **Accounts:** found that the Aahaas admin's **"Show PNL" button looks up the wrong order** (order 14946 is read as order-line 14946, an April 2025 transfer) — an admin dashboard bug, not ours.
5. **Online Work:** **Work from** marks (Office / Home / Client) on the Attendance page, and a new **My attendance** page for employees.
6. **Online Work:** **Island Rush leaderboard** with podium, cups and the player's own rank.
7. **Task Manager:** dev admin login can be switched on per server with **`TM_DEV_ADMIN=on`** (for dev-work.aahaas.com).

---

## 1. Accounts — B2C flight prices showing 0.00 (`661ab81`, `adfa8f0`, `dfcd5c5`)

`B2cPnlService.php` · +97 / −5 · `B2cPnlCheck.php` · +13 · **no database change**

- [x] Cause: the report read a flight's price only from `revalidationData.pricing`; for 5 bookings that has no fare, so sale and cost came out 0.00 (pax counts were right).
- [x] Fallback 1: the booking's **`originPayment`** — total charged, base fare, tax — the same place the Aahaas admin reads flight prices from (`basefair` / `basefairs`, `taxfair` / `taxfairs`, `priceData.*`).
- [x] Fallback 2: the checkout line's own **`tbl_checkouts.total_price`**, in the paid currency, when the payload has no fare at all.
- [x] Snapshot-priced flights: cost = base fare + tax; sale = that less the discount. A flight snapshot with no fare is skipped and the line keeps its payload price.
- [x] Amounts like `"1,234.50"` are now read correctly.
- [x] `b2c:pnl-check` shows the flight pricing found in the payload.
- [x] Bookings that already had a price are unchanged. Tested offline with sample data only.
- [ ] Run `b2c:pnl-check` on the 5 real orders on the server and compare with the admin statement.

> **Profit on flights will be small:** total charged minus base fare and tax. The booking data records no airline commission.

## 2. Accounts — Stale 0.00 rows in preview and re-sync (`54fba89`, `72cf3bc`)

`PnlReportSource.php`, `B2cPnlService.php`, `B2cPnlSyncService.php`, `B2cPnlResync.php` · +25 / −2 · **no database change**

- [x] **Preview:** the day's rows were read before the pre-send sweep ran, so rows the sweep re-priced still showed old figures (AHS-14921…14946 on 06/10/2026). Now, if the sweep created or updated anything, fresh rows are read and take priority.
- [x] **Re-sync guard:** rows stored as *snapshot-priced* at 0.00 were protected from being overwritten. The guard now lets them update when the snapshot was read this run and simply has no usable figures.
- [x] `b2c:pnl-resync` no longer counts a row as changed when nothing was written.
- [ ] After deploy: re-sync 06/10/2026 and check AHS-14921…14946 have real costs in the preview and the email.

## 3. Accounts — Customer name = lead passenger (`8b71c36`)

8 files · +1,040 / −44 · new `B2cCustomerNameResolver.php`, `B2cCheckoutSessionService.php`, `B2cCustomerNames.php`, `tests/Unit/B2cCustomerNameTest.php` · **no database change**

- [x] Orders placed through AI Commerce sit on the shared login, so the P&L and invoice said *"admin6611"*. They now name the **lead passenger**: from the checkout session (`travel_ai_checkout_sessions`) first, then the booking's own travellers.
- [x] Session table shape is read from the live schema, not assumed; a missing or unreadable table just falls back. **SELECT only**, on the read-only `b2c` connection.
- [x] New settings in `config/b2c.php`: `B2C_CUSTOMER_NAME_MODE` (`shared` default / `always`), `B2C_SHARED_ACCOUNTS` (default `admin6611,admin@it.aahaas.com`), `B2C_CHECKOUT_SESSION_TABLE`.
- [x] `php artisan b2c:customer-names 14921 14926 …` (read-only) shows account, session name, travellers, resolved name, its source and what's stored now; `--schema` describes the session table.
- [x] Unit tests added. Stored rows take the new name on their next B2C P&L sync.
- [ ] On the server: `b2c:customer-names --schema`, then the 5 orders; confirm the names.
- [ ] Closes the **14779 `admin6611`** item from 2 Oct once checked.

## 4. Accounts — Admin dashboard "Show PNL" bug (found, not fixed)

- [x] The admin product page's **Show PNL** sends the **order** number (14946), but the backend looks it up as an **order-line** number. Line 14946 is #ORD3433, a Nuwara Eliya → Bentota transfer from April 2025.
- [x] So the USD 156.25 / 125.33 / 30.92 in the screenshot are not this flight's figures.
- [ ] Raise it with whoever owns the Aahaas admin dashboard (`AahaasAdmin` backend) or fix it there.

---

## 5. Online Work — Work from marks and My attendance (`fd40ff7`)

14 files · +773 / −8 · new `work-location-store.ts`, `api/attendance/location/route.ts`, `work-place.tsx`, `me/attendance/page.tsx` · **no database change** (JSON in `.data/workday/locations/`)

- [x] `/attendance`: **Work from** column with Office / Home / Client buttons (click again to clear); bulk marking from the bottom bar; a filter with counts; *Worked from* totals in "The day at a glance".
- [x] Only admins and HR can mark; no future days and nothing older than two years; every change goes to the audit log.
- [x] `/me/attendance`: month view (24 months back), summary boxes, one row per day (status, where, who marked it, arrival, last activity, hours, active time, *corrected* tag), **Download CSV**.
- [x] Where they worked: admin mark first, then the employee's own daily filing, else "—".
- [x] Tested in headless Chrome, light and dark, with test accounts and a temporary data folder; type check passes.
- [ ] Location isn't in the admin Excel / CSV exports or the *Period & monthly* grid yet — decide whether to add it.
- [ ] Browser check with a real admin and a real employee.

## 6. Online Work — Island Rush leaderboard (`7611f65`)

6 files · +464 / −59 · new `island-rush-store.ts`, `api/me/island-rush/route.ts` · scores in `.data/island-rush.json`

- [x] Score card has **🎯 Your trip** and **🏆 Leaderboard** tabs; slides to the leaderboard after ~2 s.
- [x] Animated podium with 🥇🥈🥉 cups, 👑 on #1, **YOU!** tag, and a **RANK #n** strip with distance to the next player.
- [x] Player is always taken from the session; scores over 40,000 rejected; max 8 saves a minute; demo accounts not saved. Names shortened (*"Sasindu D."*).
- [x] Fixed: **NEW BEST!** now compares against your best on the board, not just this browser.
- [x] The *Play Island Rush* pill is removed — tapping the island is the only way in.
- [ ] ⚠️ Keyboard and screen-reader users now have **no way into the game** — decide whether to bring back an accessible button.
- [ ] Note: the hub now shows other players' short names and scores (the comment on the page says no one else's data is sent).

---

## 7. Task Manager — Dev admin on dev server (`fb2b790`)

`src/lib/devAdmin.ts` · +4 / −3

- [x] Why dev failed and live worked: live has a real `admin@aahaas.com` user in its database (created by a local sign-in against live); dev doesn't.
- [x] Built-in admin login now also works on any server with **`TM_DEV_ADMIN=on`**; first sign-in creates or reactivates the user there.
- [ ] Add `TM_DEV_ADMIN=on` on the **dev server only**, restart, sign in at dev-work.aahaas.com.
- [ ] ⚠️ **Do not set it on live.** The live `admin@aahaas.com` / `admin@123` user (5 Oct item) still needs disabling or a real password.

## 8. Mobile app (uncommitted)

- [x] `project.pbxproj`: iOS deployment target **12.4 → 15.1**, `CURRENT_PROJECT_VERSION` **1 → 2**.
- [ ] Commit it, or revert if it was only for a local build.
- [ ] Build and upload **1.14.1** (still waiting on an Admin / App Manager Apple ID, team `PW6M457Q9S`).

---

## 9. Still open from earlier

- **From 6 Oct:** run the `test_bookings` migration on Accounts with approval, deploy OPS + Accounts, mark / restore one booking; deploy `c214fd6` (`/b2b/tickets`, `/b2b/pnl` error); test one dry run and one real send on each auto-report page; export a large Ticket P&L PDF; reply to Hishani with the day-filing table; remove the hub preview harness if unused.
- **From 5 Oct:** ⚠️ Task Manager dev admin on live; browser checks of the drivers performance card, WhatsApp mini chat, Cxl Requested column, roster templates and Workplace hub; one real Flight Tickets email; OpenAI key on the server; **rotate the credentials** removed from `apple-holidays/.env.example`.
- **From 3 Oct:** Driver-Auto browser check, `apply-driver-auto.sh --check` → run with approval; Accounts MY40020 vs MY40029.
- **From 2 Oct and earlier:** daily report test send; Payable 2.2VN migration; `ROSTER_SYNC*` env; MC done SQL; OPS `apply-*.sh` and Bank Settlements migrations; payment migrations and live indexes; rotate `web/.env.local.example` credentials; `AUTH_SECRET`; `DB_READ_HOST`.
- **Housekeeping:** `ssh-keys/` is untracked in Online Work — make sure it's in `.gitignore` and never committed. `DAILY_TASK_LIST_2026-10-06.md` is untracked in Booking System. `DAILY_UPDATE` files for 29 Sep – 7 Oct are still missing.

---

## Next steps

- [ ] **Accounts:** deploy today's B2C fixes, re-sync 06/10/2026, check AHS-14921…14946 costs and customer names
- [ ] **Accounts:** deploy `c214fd6` and the Test Bookings migration (with approval)
- [ ] **Task Manager:** set `TM_DEV_ADMIN=on` on dev only; deal with the live dev-admin login
- [ ] **Online Work:** browser-check Work from / My attendance; decide on exports and game accessibility
- [ ] **Admin dashboard:** report the Show PNL order-vs-line lookup bug
- [ ] **Git:** fix the commit author name if `WOLFERLK` wasn't intended; protect `ssh-keys/`
