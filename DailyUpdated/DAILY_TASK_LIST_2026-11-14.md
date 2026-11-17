# Daily Task List — 14 November 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 14 November 2026
**Written:** 16 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 14 Nov |
|---|---|---|
| Booking System / OPS | `feature/bulk-ticket-issue`, `feature/ticket-issue-workspace` → `LIVE-1.0.0v` | 2 commits · **PR #321 and #322 merged** into `LIVE-1.0.0v` |
| Accounts System | `feature/vn-vendor-payable`, `feature/vn-vendor-payable-v2` → `Master-Live` | 2 commits · **PR #61 and #62 merged** into `Master-Live` |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No work · uncommitted change still open |

> All commits are pushed and merged. **Nothing is confirmed as deployed.** No Node or PHP on the laptop, so **none of today's code was type-checked, linted or run**; checked by reading only.
>
> ⚠️ Don't try the ticket desks locally with the live `.env`: holding and paying would hit the real GlobalTix and Cebu portals.

## What was done

1. **OPS:** **Bulk Issue desk** on the Tickets page (group, match, cart, hold, one WhatsApp code, pay).
2. **OPS:** **Issue button + full-screen Ticket Issue workspace** for each ticket.
3. **Accounts:** **Vendor Payable (Vietnam)** board with payments, remittance PDF and vendor statements (2 new tables).
4. **Accounts:** Vendor Payable v2: 7-sheet **Excel export**, more filters, table / line / ageing views.

---

## 1. OPS — Bulk Issue desk (`edc49a94`, PR #321 `0d2b4e7f`)

7 files · +1,698 / −26

- [x] **Bulk Issue** button next to "Create Tickets from API" (GT users and admins only).
- [x] Find tickets in a window (Today … Next 14 days / custom), grouped by product; GlobalTix and Cebu searched once per group, priced per visit date and pax; **Best value** marked; **Smart fill**.
- [x] Cart survives closing and is re-checked on reopen. Hold 3 at a time; missing info (time slot, guest name, Cebu phone) flagged.
- [x] **One WhatsApp code per cart**, tied to the exact holds and amounts; valid 15 min; pays 2 at a time with live progress; "Pay the rest with a new code".
- [x] Each portal still paid separately; each hold can go held → paying only once; Accounts gates still apply. `payHeld()` split out of `confirm()`; single-ticket flow unchanged. No DB change.
- [ ] `npm install --legacy-peer-deps` and `npx tsc --noEmit` (build hides type errors).
- [ ] Test with the desk off or against a local DB before using on live.

## 2. OPS — Ticket Issue workspace (`e1855267`, PR #322 `5031e6b3`)

5 files · +520 / −42

- [x] **Issue** button on each activated, unbought ticket (when Ticket Issue Desk is on); "Pay held" when already held. Status chip "Held · GlobalTix · ref" / "Check status".
- [x] Full-screen workspace: left list (To issue / Bought / All, grouped by visit date, ↑/↓ or j/k, Esc); right side is the same Ticket Issue Desk (GlobalTix, Cebu, Manual).
- [x] Last 4 tickets kept loaded. New read-only status endpoint (country-scoped).
- [ ] Type-check, then try one ticket after deploy.

## 3. Accounts — Vendor Payable (Vietnam) (`f30cee1`, PR #61 `1a9aa91`)

17 files · +2,099 / −8

- [x] New "Vendor Payable — settle each vendor" tab on Payable 1.0 / 1.1 / 1.3 + sidebar link; "Vendor Payable" and **Pay** buttons in Checklist VN 2.1V.
- [x] Date range (Arriving / Travelling), totals (pending, overdue, due in 7 days, paid here, paid on sheet), daily owed-vs-settled chart, vendor cards with filters.
- [x] Pay selected lines: date, method, bank ref, adjustment, note, bank slip → reference `VP-2611-00012`; **remittance advice PDF**; Excel statement per vendor; "Payments made" list.
- [x] Checklist / P&L only read. Payments in 2 new ERP tables: `vn_vendor_payments`, `vn_vendor_payment_lines`. Lines matched by tour + vendor + details + code; "re-priced after paying" and "paid, now off the sheet" flags. Server re-checks total; DB stops double payment. Payments only voided with a reason.
- [x] Fixed broken vendor row markup in Checklist VN 2.1V Vendors tab.
- [ ] `php artisan migrate --pretend`, back up, then `php artisan migrate` on the server.

## 4. Accounts — Vendor Payable v2 (`b63a9cc`, PR #62 `89c7205`)

5 files · +1,535 / −429 · no migration

- [x] **Export Excel** of what's on screen, 7 sheets: Summary, Vendors, Lines, Ageing, Services, Payments, Payment lines. VND and USD≈ in every heading; filters and frozen headings.
- [x] Filters: line status, how late, service code, agent, text, min pending, named vendors only. Clickable summary boxes and charts; removable chips; saved views; state in the URL.
- [x] Views: Cards ("Pay overdue" / "Pay all pending"), Table, Every line, Ageing heatmap, Payments made.
- [ ] Click through on the server before anyone relies on it.

---

## Still to do today

- [ ] Type-check and build OPS on a machine with Node (12–14 Nov changes).
- [ ] Run the Vendor Payable migration on the Accounts server (after `--pretend` and backup).

## Carried over

1. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default; AI-call re-point decision; check Guest WhatsApp card, Care tab and top card.
2. **From 12 Nov:** VN Driver Sync SQL + pinger; `as-cancel-sweep` scheduler; B2B console decision; old tour vendors decision; leaderboard deploy.
3. **From 11 Nov:** security items; agent-digest + WhatsApp-group SQL; OPS redeploy; Accounts migrate + deploy; Online Work deploy; Meta billing `131042`; driver app build.
4. **Older:** missing daily updates 3–7 Nov; HRMS uncommitted change since 27 Oct.
