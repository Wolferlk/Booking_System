# Daily Task List — 16 November 2026 (Monday)

**Owner:** Sasindu Diluranga
**Date:** 16 November 2026
**Written:** 16 November 2026, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `Wolferlk/Online-work-Aahaas`)

| Project | Branch | Work on 16 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v`, `feature/booking-details-redesign` | 5 commits · **PR #323 and #324 merged** into `LIVE-1.0.0v` · `61f2ac06` on `feature/booking-details-redesign` **not merged yet** · local `LIVE-1.0.0v` is behind `origin` (pull needed) |
| Accounts System | `Master-Live`, `feature/gemini-fallback` | 7 commits · **PR #63, #64, #65 merged** into `Master-Live` (`320cf71`) |
| Online Work | `main` | No work |
| HRMS | `v1.0.13` | No work · uncommitted change still open |

> All commits are pushed. **Nothing is confirmed as deployed.** No Node or PHP on the laptop: OPS changes after 13:30 and all Accounts changes were **not type-checked, linted or run**. Only `6b16f519` passed a type check.
>
> ⚠️ The Gemini API key was pasted into chat and briefly into the OPS `.env.example` (cleared, never committed). **Create a new key** in Google AI Studio.

## What was done

1. **OPS:** WhatsApp chat "other numbers" banner fixed (one line); copy to Sulaksha now goes as approved template.
2. **OPS:** booking details page — slim journey map, 4 collapsible panels, lead passenger card, **light/dark mode**.
3. **OPS + Accounts:** **Gemini fallback** when OpenAI fails.
4. **Accounts:** new **B2C invoice PDF design**, new office address, new Apple Holidays logo; agent reference fix (AI… numbers).
5. **Accounts:** **Reconciliation** tab in Vendor Payable (Vietnam) with VAT-inclusive split, agent type and system invoice columns.

---

## 1. OPS — WhatsApp fixes (`089ee27f`, `6b16f519`)

- [x] "Other numbers on this booking" banner showed all 150 numbers and pushed the chat off screen. Now one line ("🔗 150 other numbers", 3 latest, "+147 more ▾"); expanded list scrolls, newest first, search when > 8.
- [x] Copy to Sulaksha failed because the 24 h window is per sending number, but all Aahaas numbers share one inbox. Now sent as the **approved template**. Type check passes.
- [ ] Send one real document to confirm it reaches Sulaksha.

## 2. OPS — booking details redesign (`1cf0782e`, `58687e2e`, PR #323 `055717f0`, PR #324 `b75ab69a`)

10 files · +1,801 / −22

- [x] Journey map is a slim line with spinner / "Rebuild map" until a route is ready.
- [x] Guest Reconfirmation, AI Voice Calls, AI Call Transcripts and Pre-checking **start minimised** (coloured header bar, Expand / Minimise, remembered per user).
- [x] **Lead passenger card** under the IS number (name, initials avatar, crown, age, nationality, co-travellers).
- [x] **Light / dark mode** switch next to "Back", saved per browser per user (no DB change).
- [ ] `npm run build`, then open a booking in both modes and fix any spots that don't recolour.

## 3. Gemini fallback (OPS `58687e2e`, `61f2ac06` · Accounts `b9acf8f`)

- [x] **OPS:** `src/lib/ai-fallback.ts` hooked into the shared OpenAI client — all 43 chat calls + 3 web-search calls. gpt-4o → `gemini-3.5-flash`, mini/nano → `gemini-3.5-flash-lite`. Retries once without the "think less" setting if Gemini rejects it.
- [x] **Accounts:** `app/Services/Ai/GeminiFallback.php` as a global Laravel HTTP hook on OpenAI chat completions — all 9 callers covered.
- [x] Only on OpenAI-side failures (401/403, 408, 409, 429, 5xx, timeout, network). 400/404/422 untouched. If Gemini also fails, the original OpenAI error is returned. Off when `GEMINI_API_KEY` is empty or `AI_FALLBACK_DISABLED=true`. Logged as `[AI fallback]`.
- [x] `.env.example` lists the setting names with no values.
- [ ] Add the Gemini settings to the **ERP `.env`** and both **production servers**; `php artisan config:clear`, restart php-fpm and queue workers.
- [ ] Merge `61f2ac06` (`feature/booking-details-redesign`) into `LIVE-1.0.0v`.
- [ ] Check the Gemini prices added to the OPS usage cost table against Google billing.
- [ ] Not covered: voice transcription, image generation, realtime voice, some PDF uploads.

## 4. Accounts — B2C invoice PDF, logo, agent ref (`905b1fc`, `609b1e5`, `866bc39`)

- [x] New B2C invoice design: navy header with logo in white box, info strip (Order #, Issued, Revision, Booking ref, PAID / DUE), Bill to + Lead passenger cards, numbered services table, navy Total bar, compact currency strip, bank details grid, new footer. All old fields kept.
- [x] New address (World Trade Center, East Tower, L27/ET/02, 27th Floor, Colombo) in all 4 places.
- [x] New trimmed **Glossy Apple Holidays logo** (`public/images/apple-holidays-logo.png`, 994×230, ~129 KB) in all 3 invoice builders; old image kept as fallback.
- [x] **Agent reference fix:** `extractAgentReferenceNo` only knew `NL…`; now reads the voucher "Agent ID" row (e.g. `AI0000462321635`), letters + 10+ digits only.
- [ ] Open `/invoice/view/{id}` on a machine with PHP to check the PDF and logo.
- [ ] **Decide:** add "Sri Lanka" to the new address? Keep the "Aahaas · Travel" label?
- [ ] Check the next AI… voucher no longer prints NA.

## 5. Accounts — Vendor Payable Reconciliation (`32449ee`, `f1b20ec`, `6257b2a`, PRs #63–#65)

- [x] New **Reconciliation** tab (after Payments made), laid out like the VN Lotus file: As per vendor / As per Accounts (VND + USD), bank fee, rates, Total Difference.
- [x] Inputs: VAT %, vendor rate (25,500), Accounts rate (avg of tours), bank fee, vendor invoice total.
- [x] **VAT fixed:** checklist price is taken as **including** 8% VAT (1,944,000 → 1,800,000 + 144,000). Before the fix "As per Accounts" was ~8% too high.
- [x] New columns: **Credit / Non-Credit** (Agent Management) and **system invoice** with paid / balance; invoice shown on the tour's first line only. Receivables box in Excel; "Invoices for these tours" card on the page.
- [x] "Reconciliation" is the first tab in both Excel downloads, with live formulas. Read-only.
- [ ] Try one download on the server.
- [ ] Add short agent names (e.g. "MMT", "30SUNDAYS") as keywords in Agent Management so they don't show as Non-Credit.

---

## Still to do today

- [ ] ⚠️ **Rotate the Gemini key** and update both `.env` files.
- [ ] Pull `LIVE-1.0.0v` locally; merge `feature/booking-details-redesign` follow-up.
- [ ] Get Node and PHP on a machine to type-check / lint 12–16 Nov work before any deploy.
- [ ] **Accounts:** `php artisan migrate --pretend` → backup → migrate (Vendor Payable tables + earlier B2C amendment / same-order migrations), deploy `Master-Live`.
- [ ] **OPS:** run pending SQL with `--check` first (agent digest, WhatsApp groups, VN Driver Sync, `booking_event_logs`), redeploy, set cron pingers (`vn-driver-sync`, `as-cancel-sweep`).
- [ ] Write the missing daily updates (3–7 Nov).

## Carried over

1. **From 14 Nov:** type-check Bulk Issue desk and Ticket Issue workspace; Vendor Payable migration.
2. **From 13 Nov:** `booking_event_logs` SQL; Guest Autopilot default (`auto_guest_engage_on_assign_enabled`); AI-call re-point decision; check Guest WhatsApp card, Care tab, top card; digest vehicle line decision.
3. **From 12 Nov:** VN Driver Sync SQL + pinger + Suggest-mode first run; `as-cancel-sweep` scheduler; B2B console channel decision; ~681 old tour vendors decision; leaderboard deploy; 2 old `AutoReportMailTest` failures.
4. **From 11 Nov:** ⚠️ security (DB root password, port 3306, boss password from `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042` + Retry failed; Meta template submissions; Online Work ticket backup and deploy; driver app build; same-order mode stays off.
5. **Older:** HRMS `onlineWorkPerformance.service.js` uncommitted since 27 Oct.
