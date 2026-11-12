# Daily Task List — 10 November 2026 (Tuesday)

**Owner:** Sasindu Diluranga  
**Date:** 10 November 2026  
**Written:** 11 November 2026, from GitHub history and working-tree notes

> **Important:** the 10 November work is in GitHub history, but most commit notes say it was not deployed or tested against live data. Complete the deployment, database and real-data checks before enabling any automatic sync, report or ticket-purchase flow.

## 1. OPS — Ticket portal and B2C ticket data (`0203e12`)

- [x] Add a red Tickets-page warning when the Ticket Issue Desk is enabled but its database tables are missing.
- [x] Add missing-table information and **Create desk tables** to Settings → Ticket Issue Desk.
- [x] Change the rejected WhatsApp template to `aahaas_ticket_approval_details` and automatically move the saved setting to the new name.
- [x] Keep six-digit approval codes working even while the replacement template waits for Meta approval.
- [x] Read B2C store-order items into the correct areas: draft tickets, Accommodation, Flights and Passengers.
- [x] Add visit dates, passenger counts, countries, hotel details and flight legs from the store order.
- [x] Allow B2C tickets to use GlobalTix or Cebu, while refusing a duplicate purchase when the store already bought the ticket.
- [ ] Run the ticket-portal SQL script with `--check`, then apply it on live with the Critical Services Password.
- [ ] Redeploy OPS.
- [ ] Register the replacement WhatsApp template with Meta and wait for approval.
- [ ] Check booking `15912` after deployment: Tickets, Flights, Accommodation and Passengers should be populated correctly.
- [ ] Keep the Ticket Issue Desk off until GlobalTix, Meta billing and safe approval testing are complete.

## 2. OPS — Weekly and monthly report activity (`cf0c73f`)

- [x] Split weekly and monthly email reports into **Created**, **Created & updated** and **Old booking updated** groups.
- [x] Show the booking creation method and invoice amount changes for each group.
- [x] Add Booking Activity summaries to email and Excel output.
- [x] Add Created, Created & Updated and Old Updated Excel tabs.
- [x] Add the same activity section and new columns to the daily report.
- [ ] Redeploy OPS before treating the report changes as live.
- [ ] Render one real weekly and monthly report and verify counts, invoice changes and Excel tabs.

## 3. OPS — Customer branding settings (`a036856`)

- [x] Add Customer Branding settings with switches for WhatsApp, Mails, PDF documents and Word documents.
- [x] Remove “Apple Holidays” from guest-facing channel text when selected.
- [x] Remove the Apple logo from generated documents when selected.
- [ ] Redeploy OPS.
- [ ] Check each switch with a test booking and confirm it affects only the selected channels/documents.

## 4. OPS — VN tour-vendor Excel sync (`38ff065`, `19b2d77`)

- [x] Build the automatic VN tour-vendor sync from the Excel checklist.
- [x] Add a 15-minute sync cycle, countdown, Fetch now, logs and Sync all now actions.
- [x] Match airports, tours, city transfers and combined service lines against upcoming Vietnam movements.
- [x] Apply only high-confidence matches automatically; send uncertain matches to review.
- [x] Preserve manually entered vendors and show them as **Kept yours**.
- [x] Add Apply, Undo, Ignore and Resume controls with per-movement and whole-run undo.
- [x] Add the Excel ⇄ System board with filters for Needs a look, To review, Different by hand, Same as Excel, Ignored and All.
- [x] Test against 1,486 copied Vietnam movements: 829 high-confidence matches, 46 for review and no hand-checked false matches reported.
- [ ] Add the new sync tables on live.
- [ ] Deploy OPS and schedule the 15-minute ping.
- [ ] Start in Suggest/Off mode and review high-confidence matches before enabling Auto.
- [ ] Verify that only Tour Vendor is changed; drivers, rates, vehicle vendors and guides must remain untouched.

## 5. OPS — Current allocations in WhatsApp links (`b896cf5`)

- [x] Make the WhatsApp link read current drivers, vehicles, driver vendors and tour vendors when opened.
- [x] Recalculate pending totals and “Driver pending” warnings from current allocations.
- [x] Keep the original sent booking list and fallback to the sent version if current data cannot be read.
- [x] Keep email and PDF/Excel/Word attachments unchanged after sending.
- [ ] Redeploy OPS.
- [ ] Verify a link where vendor assignments changed after the original send; confirm the pending count matches the current preview.

## 6. Accounts System — Reports and monthly P&L

- [x] Split the Daily Invoice and P&L “New + booked & amended same day” card into separate New and Booked & amended cards (`9a03939`).
- [x] Reorder the Today New & Updated table columns to show Raised, Handler and Agent (`fbd4f86`).
- [x] Add weekly report layout, three booking groups and day-by-day sections (`fb3abd9`).
- [x] Fix cancellation counting when invoice and `-CXL` occur in the same period or cancellation happens before the `-CXL` (`449bdf8`).
- [x] Add last completed Sunday–Saturday week selection and week numbering (`a957f29`).
- [x] Fix the B2C Payables Excel/cache encoding failure (`a851474`).
- [x] Add monthly Invoice and P&L report layouts with month picker and re-send support (`8ac5812`).
- [x] Make monthly View skip the long write-capable preflight check and return a useful error on failure (`65ffc5a`).
- [x] Increase background report-send memory and mark failed sends instead of leaving them pending (`1643bc4`).
- [x] Add Download Excel and Run now buttons to report previews (`53f5141`).
- [x] Remove the repeated Month to date deck from the monthly P&L mail (`d12634e`).
- [x] Fix the missing-space template errors in invoice and P&L auto reports (`f45e240`).
- [x] Add unsaved-changes warning for report date-range settings (`36403ba`).
- [x] Fix the GLK50194 invoice booking-number field rename issue (`9a3f3c6`).
- [ ] Deploy the Accounts changes with `Master-Live`.
- [ ] Save the intended weekly schedule date range; “Last full month” was previously changed in the browser but not saved.
- [ ] Create a monthly schedule before sending October’s report.
- [ ] Dry-run October first, then send to an internal recipient.
- [ ] Verify monthly View, Download Excel, Run now, cancellation totals and weekly date labels in a browser.
- [ ] Confirm whether the Month to date deck should also be removed from the monthly invoice mail.

## Verification and security

- [ ] Confirm the existing 11 OPS type-check errors remain unchanged and are not caused by the 10 November work.
- [ ] Back up live databases and sync tables before applying migrations.
- [ ] Do not enable automatic VN sync until the Excel ⇄ System board has been reviewed by staff.
- [ ] Do not enable ticket purchasing until GlobalTix, Cebu, WhatsApp OTP and duplicate-purchase checks pass.
- [ ] Confirm exposed database credentials, OpenAI keys and other secrets have been rotated.
- [ ] Record deployment times, migrations, template approvals, report dry runs and real-data checks in the next daily update.
