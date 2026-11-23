# Daily Task List — 21 November 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 21 November 2026
**Written:** 21 November 2026, afternoon, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`) — **day still in progress**, covers commits up to 12:39

| Project | Branch | Work on 21 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 1 commit straight on `LIVE-1.0.0v` (`ea0f049a`) · pushed · clean · in sync with `origin` |
| Accounts System | `Master-Live` | 2 commits straight on `Master-Live` (`6b0290f`, `66d889e`) · pushed · clean · in sync with `origin` |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No commits found · repo not checked from this laptop |

> All commits are pushed. **Nothing is confirmed as deployed.** Accounts changes passed PHP / template / JS syntax checks only; **the new Settings page was not opened in a browser**. Live databases were only read (SELECTs); **nothing was written.**
>
> Two rules decided today:
> - **Apple System is the source of truth** in OPS — OneDrive never updates a booking imported from the Apple System.
> - **Apple System (API) is the correct P&L basis** in the ERP — Ex-Sheet re-pricing is opt-in only.

## What was done

1. **OPS:** **OneDrive can no longer overwrite Apple System bookings** (TC and P&L files skipped); OneDrive only creates a booking when the Apple System definitely doesn't have it.
2. **Accounts:** **Detailed P&L opens on Apple System (API)** by default; Ex-Sheet is the opt-in view.
3. **Accounts:** new **Settings → PNL Rates Replacer** page to switch off auto Ex-Sheet re-pricing and restore stored P&Ls to Apple System rates in stages.

---

## 1. OPS — Apple System bookings never updated from OneDrive (`ea0f049a`)

2 files · +175 / −42

- [x] **Why:** OneDrive's TC picker read supplier vouchers ("BOOKING CONFIRMATION - ASIA CHARM TRAVEL…pdf") as the TC and rewrote VN40813 and ~50 other bookings (dates, hotels, itinerary, agent, currency). 1,474 Apple-System-imported bookings (since Jun 2026) had been modified by OneDrive.
- [x] `onedrive-monitor.ts`: before reading any file, checks whether the booking was imported from the Apple System. If so, **both TC and P&L files are skipped** — nothing downloaded, nothing sent to the AI. Logged as **SKIPPED** — "Booking was created from the Apple System — OneDrive files never update it".
- [x] For a ref not yet in OPS:

  | Apple System lookup | What happens |
  |---|---|
  | Has the booking | Imported from the Apple System; OneDrive file not used |
  | Definitely has no such booking | Created from the OneDrive TC |
  | Lookup failed / quote can't be mapped | Nothing created; SKIPPED "import it from the Apple System by hand" |

- [x] `booking-reconcile.ts`: new `notFound` flag on the existing lookup for the definite "not found" signal.
- [x] Unchanged: OneDrive still saves the folder link ("OneDrive / SharePoint" button); supplier vouchers are never treated as a TC.
- [ ] Deploy, then check the OneDrive log shows SKIPPED for an Apple System booking.
- [ ] **Decide:** may OneDrive still amend bookings it created itself?
- [ ] **Decide (live write, needs approval):** repair the bookings already overwritten by OneDrive (VN40813 + others) — re-import from the Apple System; list affected bookings and back up first.

## 2. Accounts — Detailed P&L defaults to Apple System (`6b0290f`)

1 file · +30 / −19 · `detailed-pnl-scripts.blade.php`

- [x] Every booking opens on **Apple System (API)** (first in the switch, marked "default"); Ex-Sheet rates still one click away.
- [x] If a corrected booking is shown on API figures, a warning says the stored P&L still holds Ex-Sheet figures; **Save as Apple System rates** stays active for a one-click fix.
- [x] If a booking's original Apple System figures weren't kept, the sheet shows stored figures instead of pretending.
- [x] Read-only check on live: **3,444** stored P&Ls have an Ex-Sheet correction; **auto-correct on sync is ON** (`vn_excel_price_replace_on_sync = 1`), so the hourly sync would re-apply Ex-Sheet rates after any restore.
- [ ] Deploy (invoice-processor.aahaas.com looks the same until then).

## 3. Accounts — Settings → PNL Rates Replacer (`66d889e`)

7 files · +1,721 / −1 · no new tables or columns

- [x] New sidebar link under Excel Product Prices (+ card on that page, + site search). Anyone who can open Excel Product Prices can view; **only a super admin** can change the setting or run a restore.
- [x] Header ring: share of live VN P&Ls on Apple System rates.
- [x] **Step 1 — upcoming files:** Apple System only (recommended; sync never reprices, Ex-Sheet buttons hidden) · Apple System by default (manual per-booking correction allowed) · Auto-replace with Ex-Sheet (current; type AUTO to turn back on).
- [x] **Step 2 — past files:** read-only list of P&Ls on Ex-Sheet rates, filter by date / agent tier / auto vs hand / IS number; Apple System vs Ex-Sheet cost and profit per row and in total; per-row Restore.
- [x] **Step 3 — restore console:** batches with progress, live log, time remaining, Pause / Resume / Stop. History of who changed what; past backups re-downloadable.
- [x] **Server-enforced order:** auto-replace off → backup CSV taken (`storage/app/pnl-rates-replacer`) → type RESTORE. Each P&L restored separately via the existing "Save as Apple System rates" code; Ex-Sheet records marked reverted (nothing deleted); hand-edited P&Ls skipped and listed; hand-added lines and travel-date fixes re-applied.
- [ ] Deploy `Master-Live`, open the page on the server.
- [ ] **Your step (live write):** set **Apple System only**, take the backup CSV, restore a small filtered batch first, check it, then the rest of the 3,444.

---

## Still to do today

- [ ] **Deploy both:** `LIVE-1.0.0v` (OneDrive rule + 18–20 Nov work) and `Master-Live` (P&L default + Replacer + 18–20 Nov work).
- [ ] Run the PNL Rates Replacer in stages after deploy.
- [ ] Decide on repairing OneDrive-overwritten bookings.
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 20 Nov:** turn off "Arriving tomorrow" on the 30 Sundays digest; check OPS report and Aahaas mails with real data (B2C 8, intake 42 / 18 / 6 / 2); D-6 / D-10 scope decision; `Call with Safraz and Sassindu .docx` in the OPS repo root.
2. **From 19 Nov:** `pnl_price_adjustments` index migration decision; cancellation-card number decision; render AHDS / Aahaas mails; try remove driver on one booking.
3. **From 18 Nov:** confirm Fetching tasks run again (VN43307_R2); Sync now on Payable 2.2VN; Online Work type-check + deploy, `PORTAL_URL`, email-reply mode decision.
4. **From 17 Nov:** decide on correcting stored B2C invoices / P&L rows (approval + backup); order-date rate decision; Excel MC Generate trial; check VN40172 and VN43304_R2.
5. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; merge `61f2ac06`; invoice PDF/logo check; Reconciliation download check; Agent Management short-name keywords; "Sri Lanka" in address decision.
6. **From 14 Nov:** type-check Bulk Issue desk / Ticket Issue workspace; Vendor Payable migration.
7. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default; AI-call re-point decision.
8. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; 2 old `AutoReportMailTest` failures.
9. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Meta template submissions; driver app build.
10. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
