# Daily Task List — 17 November 2026 (Tuesday)

**Owner:** Sasindu Diluranga
**Date:** 17 November 2026
**Written:** 17 November 2026, evening, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 17 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` (+ `feature/booking-dark-uiux`) | 5 commits · **PR #325 merged** into `LIVE-1.0.0v` · pushed · clean · in sync with `origin` |
| Accounts System | `fix/b2c-report-discount`, `feat/vn-missing-tab-auto-prune` → `Master-Live` | 5 commits · **PR #66, #67, #68, #69 merged** into `Master-Live` (`4cb3cdb`) · pushed · clean |
| Online Work | `main` | No work (last commit 10 Nov) |
| HRMS | `v1.0.13` | No work · uncommitted `onlineWorkPerformance.service.js` still open |

> All commits are pushed and merged. **Nothing is confirmed as deployed.** No Node or PHP to run the apps on the laptop: OPS changes had syntax checks only; Accounts changes were PHP-linted where possible but **no report was run end to end**. Live databases were only read (SELECTs through the read-only helper); **nothing was written.**
>
> ⚠️ Several commit messages say "not committed". That was true when written; the work is now committed, pushed and merged.

## What was done

1. **OPS:** booking details **dark-mode fixes** (panels, WhatsApp card, section menu, Travel tile).
2. **OPS:** **Excel MC Generate** for VN bookings (review → save) + optional **15-minute auto-update** from the Movement Chart Excel.
3. **OPS:** Ops Board driver count fixed for Excel-imported drivers (VN40172 0/4); VN Driver Sync **review cards with bulk Apply**; **Confirmation Descriptions** button on the agenda.
4. **Accounts:** **B2C discount fix** — invoices and reports now use the amount after discount, with LKR amounts and the order-date rate; compact B2C report layout.
5. **Accounts:** "ERP Missing Products" tab auto-prune; **agent ID repair** for revision invoices (VN43304_R2).

---

## 1. OPS — booking details dark mode (`5be1df6f`, PR #325 `8cba5918`)

10 files · +949 / −11

- [x] Local `LIVE-1.0.0v` was 4 commits behind; fast-forwarded (nothing lost).
- [x] Workflow / Reach out panels no longer bright orange/green: missing faded-gradient rules added to `gen-booking-dark-css.sh` and re-run.
- [x] "No guest WhatsApp" card: softer border, content centred and stacked on wide screens.
- [x] Right-side section menu no longer covers content; dark see-through style.
- [x] Travel tile dates wrap instead of being cut off.
- [ ] `npm run build` and check a booking in dark mode.

## 2. OPS — Excel MC Generate + auto-update (`eddec1c3`)

14 files · +2,280 / −18 · no new tables, no migration

- [x] **Excel MC Generate** button on the movement chart toolbar for VN bookings. Reads the Movement Chart Excel through Microsoft Graph (read-only, 3-min cache).
- [x] Review screen: each sheet row marked New / Changed / Same / Only in OPS with old → new per field and tick boxes; checks pax, dates outside trip, flight numbers.
- [x] Fills date, location, from, to, details, meal plan, meeting time (handles ranges), service type, driver contact (only if a phone is in the Vendor cell).
- [x] **Confirm & save** uses the normal chart save; **Load into editor** to adjust first. "Sheet updated · N" shows later Excel changes.
- [x] **Auto-update every 15 min** for Excel-built charts (**off by default**, admin switch). Updates fields still holding an Excel value or empty; adds new rows; drivers left to VN Driver Sync.
- [x] Never deletes or blanks, no WhatsApp; > 60 field changes or > 20 new rows held back for review. One transaction per booking; movement ids unchanged.
- [x] Logged in agenda logs ("Updated automatically from the Movement Chart Excel"); live reload; save-conflict prompt; per-chart Pause; admin Run now.
- [ ] `npm run build`, try on one VN booking, then switch auto-update on for one chart first.

## 3. OPS — board, Driver Sync, descriptions (`b56daf92`, `d37ffe72`, `59d7f2df`)

- [x] **Ops Board driver count:** Excel-imported drivers are saved as typed name + phone; the board only counted registered links, so VN40172 showed 0/4. Now counts typed drivers. (`/4` vs `/6` is deliberate: Own Arrangement excluded.)
- [x] **VN Driver Sync review cards:** one card per movement (sheet lines left, system agenda right, match bar, meeting-time difference). Tick boxes, "Select all ready to apply", sticky bar "Apply N selected" with confirm and progress; failures stay ticked. Hand-typed drivers still replaced one at a time.
- [x] **Confirmation Descriptions** button (edit mode, next to Get Raw Data): fetches the AppleSystem confirmation, preview with counts (Will change / Same / No entry / Not placed), Exact / Good / Please check labels; "Please check" starts unticked. Loads into the draft only; Undo. Matching logic tested on sample data.
- [ ] Type-check (node_modules missing) and open each screen after deploy; check VN40172 on the board.

## 4. Accounts — B2C discount fix (`0a90747`, `6cdc212`, `a85416f`, PRs #66, #67)

- [x] **Cause:** storefront pricing snapshot has discount 0, so every discounted Lifestyle order since at least September was invoiced at the **pre-discount price** (e.g. AHS-16141 37.91 → should be 34.12; AHS-16131 293.38 → 248.26).
- [x] `B2cPnlService.php`: new invoices take the line discount off (flights excluded).
- [x] Invoice report email + Excel (AAHAAS sheet): **Before discount · Discount · Invoiced amount**, LKR under each and the rate. P&L report and `/pnl` page use net sale and profit (AHS-16141 profit 1.89 instead of 5.68).
- [x] Older invoices recalculated on the fly from read-only storefront lookups; stored rows unchanged; falls back to stored figures if lookup fails.
- [x] Rate: order-date rate (dashboard uses today's rate → 4–5 cent USD difference). Stored rate > 2% off order-date rate is ignored (fixes AHS-16061 rate 263.66 → 332.3363, invoiced 15.05).
- [x] Compact B2C table: removed Received, CNTL, Handler, Travel date, Sales person, GST no; "Tour start" → Service date. Excel also drops Invoice Conversion / Conversion Rate. Combined AHDS + B2C reports unchanged.
- [ ] Deploy and send one test invoice report and P&L report on the server.
- [ ] **Decide (live write, needs approval):** correct stored invoices (AHS-16141 shows USD 3.79 due) and P&L rows. Run `b2c:pnl-resync --dry-run` first; list affected invoices and back up before any change.
- [ ] **Decide:** keep order-date rate or match the dashboard's today rate?

## 5. Accounts — missing-products prune + agent ID repair (`0192af4`, `031acc1`, PRs #68, #69)

- [x] **ERP Missing Products tab:** on each sync that finds the workbook changed (6-hourly `vn-packages:fetch` or Fetch button), products now on the rate sheet are taken off; partial agent coverage just drops those agents. Writes only columns A–L of that tab, only when something changes; shares a lock with the full write.
- [x] "✓ Now on the rate sheet" log (60 newest, Merge IDs warning), row-1 sync banner, fetch message lists removed Apple ids, Settings switch (on by default).
- [x] **Agent ID repair (VN43304_R2):** missing ID now copied from an earlier invoice of the same booking (IS number match only, never placeholders, newest wins). Apple System lookup retries by quotation number from the tour ref (507007CNTL → 507007). Used by the repair board, Correct button, invoice generation and `FillInvoiceAgentIdJob`.
- [ ] Deploy, then check VN43304_R2 shows `AI0000466412617` and the next workbook sync prunes correctly.

---

## Still to do today

- [ ] **Accounts:** deploy `Master-Live` (discount fix, prune, agent ID repair, plus earlier Vendor Payable / Reconciliation / Gemini / invoice design) — run `php artisan migrate --pretend` first for the Vendor Payable tables.
- [ ] **OPS:** type-check and build `LIVE-1.0.0v` on a machine with Node, then redeploy.
- [ ] Decide on correcting stored B2C invoices / P&L rows (approval + backup required).
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; merge `61f2ac06`; check invoice PDF/logo and AI… agent ref; Reconciliation download check; Agent Management short-name keywords; "Sri Lanka" in address decision.
2. **From 14 Nov:** type-check Bulk Issue desk / Ticket Issue workspace; Vendor Payable migration.
3. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default (`auto_guest_engage_on_assign_enabled`); AI-call re-point decision.
4. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; 2 old `AutoReportMailTest` failures.
5. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Meta template submissions; Online Work deploy; driver app build.
6. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
