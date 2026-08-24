# Today Daily Task List — 22 August 2026

**System:** Booking System / Apple Holidays Operations
**Owner:** Sasindu Diluranga
**Date:** 22 August 2026
**Working rule:** Keep live data safe. Use read-only checks wherever possible; do not run live writes, migrations, role scripts, or external API writes without approval.

## Main outcome for today

Finish and verify the Booking System work delivered today around proforma invoices, hotel reservations, passenger selection, agenda date validation, and reservation-team access. The final result must be usable by Operations and Accounts without duplicate records, incorrect passenger details, invalid dates, or unapproved reservation changes.

## 1. Proforma invoice workflow — high priority

- [ ] Open `/dashboard/proforma` and confirm the page loads without client or server errors.
- [ ] Verify proforma search works by booking reference, invoice identifier, and the available scoped lookup fields.
- [ ] Confirm the booking selector displays the lead passenger using the new `name` field and does not depend on the removed `fullName` property.
- [ ] Confirm the invoice form preserves the selected booking, passenger, currency, amount, and description while navigating between form sections.
- [ ] Test the booking-specific endpoint `/api/proforma/booking/[ref]` with a safe read-only request.
- [ ] Test the general list/search endpoints with empty, partial, and valid search criteria; confirm invalid input returns a clear validation response.
- [ ] Confirm the proforma detail endpoint returns the correct record and does not expose unrelated booking or payment data.
- [ ] Confirm receipt URL handling displays a usable link when a receipt exists and a clear empty state when it does not.
- [ ] Verify recent invoices are separated from new invoice creation and that already-settled items display their settlement status correctly.
- [ ] Verify duplicate or already-matched invoices cannot be silently settled twice.
- [ ] Cross-check one read-only sample against the Accounts System so booking reference, lead passenger, invoice amount, and status agree.

## 2. Hotel reservation operations

- [ ] Open the reservations dashboard and verify the request inbox, reservation list, deadline board, hotel directory, invoices, and credit-notes pages load.
- [ ] Confirm request-inbox filters work for country and urgency without changing the underlying records.
- [ ] Confirm CSV export follows the active filters and uses stable column headings.
- [ ] Verify hotel directory lookup returns the correct hotel and that hotel details/availability routes use the expected identifier.
- [ ] Check reservation drawer rendering for contact data, options, special requests, contracts, invoices, and credit notes.
- [ ] Verify reservation state labels and transition controls match the permitted workflow; invalid transitions must be rejected with a useful message.
- [ ] Confirm gate/checklist rules prevent incomplete reservations from moving forward.
- [ ] Verify supplier/partner details are scoped to the selected reservation and cannot leak into another reservation.
- [ ] Confirm all reservation write actions remain behind the reservation guard and correct role permissions.
- [ ] Check loading, empty, error, and permission-denied states for each new reservation screen.

## 3. Passenger and agenda data quality

- [ ] Search bookings with one passenger, multiple passengers, and missing optional passenger data.
- [ ] Confirm the lead passenger’s name is selected consistently in proforma, booking details, and related forms.
- [ ] Confirm no UI still reads `fullName` where the new passenger contract expects `name`.
- [ ] Test agenda item date validation with valid dates, same-day dates, reversed dates, malformed dates, and dates outside the booking period.
- [ ] Verify invalid agenda dates are rejected before persistence and that the user receives an actionable validation message.
- [ ] Confirm existing valid agenda items still render correctly after validation changes.

## 4. Roles and access control

- [ ] Verify `RS_USER` is available for the intended countries only and does not grant unrelated admin access.
- [ ] Check sidebar visibility for Admin, Operations, Reservation Team, and restricted users.
- [ ] Verify API routes enforce permissions server-side even when a restricted user manually enters a URL.
- [ ] Confirm reservation, proforma, and booking actions show a clear denied response rather than a generic server error.
- [ ] Review the role and reservation guard code for accidental broad access before any deployment.

## 5. Technical verification

- [ ] Run the Booking System lint/build checks from `apple-holidays/` after confirming they do not connect to or modify live data.
- [ ] Run targeted read-only checks for proforma and reservations.
- [ ] Run existing safe regression checks: `drivelog:guard`, `drivelog:render`, `sldocs:render`, and relevant reservation preflight checks where their environment is local/safe.
- [ ] Review server logs for route errors, Prisma errors, failed imports, and hydration warnings.
- [ ] Confirm environment/configuration changes are documented in `.env.example` and do not contain secrets.
- [ ] Review the final diff for accidental changes outside today’s Booking System scope.

## 6. Handoff checklist

- [ ] Record tested routes, test data/reference numbers, and results.
- [ ] List any remaining issue with severity, reproduction steps, and affected role.
- [ ] Confirm whether database migration or role application is required; do not execute either against live data without approval.
- [ ] Prepare a short deployment note covering proforma, reservations, passenger naming, agenda validation, and access-control changes.
- [ ] Obtain business confirmation for the proforma settlement and reservation workflow before production rollout.

## Definition of done

The Booking System proforma and reservation pages are verified end-to-end in a safe environment; passenger names and agenda dates are correct; role restrictions are enforced; exports and receipt links work; no duplicate settlement or reservation transition is possible; and all remaining risks are documented for handoff.

