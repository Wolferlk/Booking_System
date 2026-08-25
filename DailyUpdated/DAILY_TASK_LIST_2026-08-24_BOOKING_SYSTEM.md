# Today Daily Task List — 24 August 2026

**System:** Booking System / Apple Holidays Operations
**Owner:** Sasindu Diluranga
**Date:** 24 August 2026
**Working rule:** Keep live data safe. Use read-only checks wherever possible; do not run live writes, Prisma migrations, role scripts, or external API writes (WhatsApp/Meta) without approval.

## Main outcome for today

Verify and hand off today's deliveries: WhatsApp document delivery through approved Meta templates (booking details, agenda, driver documents) with closed-window queuing and delivery-status tracking; the new Confirm Booking Hotels page for the reservation team; the partner analytics module; and the proforma / all-mails ordering fixes. No customer message may be sent from testing without approval.

## 1. WhatsApp booking document delivery via approved template — high priority

- [ ] Confirm `aahaas_booking_docs` (and any related booking template) is APPROVED in the Meta account before any live test.
- [ ] Verify `POST /api/whatsapp/templates/bootstrap-booking` registers the template correctly and returns a clear status when Meta has not yet approved it.
- [ ] Confirm `WHATSAPP_APP_ID` and related credentials are present in the deployment environment and not committed to source control.
- [ ] Test booking-details send from `/dashboard/bookings/[ref]` with the 24-hour window OPEN: message and document must both arrive.
- [ ] Test with the window CLOSED: the opener template must be sent and the document queued, then delivered once the window opens.
- [ ] Confirm the queued document is delivered exactly once — no duplicate send after the window opens.
- [ ] Test the agenda send path (`/api/bookings/[ref]/agenda/send`) for both PDF and Word attachments; the Word case was the reported failure.
- [ ] Confirm failures return 422 with a readable explanation in the UI rather than a generic 500.
- [ ] Verify template variable mapping in `booking-details-template.ts` renders the correct booking reference, guest name and dates.

## 2. Driver document delivery and receipts

- [ ] Confirm the existing driver document sending flow is unchanged and still works — it must not regress from the booking-template work.
- [ ] Test the Drive Log Documents WhatsApp dialog and confirm delivery receipts are recorded per driver and per document.
- [ ] Verify `/api/dashboard/srilanka/drive-log/documents/deliveries` returns the correct receipt history and `copy-contact` behaves as expected.
- [ ] Check the Driver Chat Dock renders the thread and status without blocking the page.
- [ ] Review `prisma/schema.prisma` and `prisma/sql/2026-08-24-sl-driver-doc-sends.sql`; apply only through the intended script and only with approval — never against live data unreviewed.
- [ ] Confirm the removed Driver Log List page is no longer linked from the sidebar and no route 404s remain.

## 3. WhatsApp delivery status

- [ ] Verify the webhook split: `/api/webhooks/whatsapp` and the new `/api/webhooks/whatsapp-status-signal` both respond correctly.
- [ ] Confirm sent / delivered / read / failed statuses map correctly in `whatsapp-delivery-status.ts` and surface in Drive Log.
- [ ] Confirm an unknown or out-of-order status callback is ignored safely and never downgrades a later status.
- [ ] Verify the endpoint validates the caller and cannot be used to spoof a delivery status.
- [ ] Confirm serverless constraints are respected (no long-lived connections in the webhook path).

## 4. Confirm Booking Hotels page — reservation team

- [ ] Open `/dashboard/confirm-hotels` and confirm it loads for reservation-team roles only.
- [ ] Test filters: Check-In, Check-Out, Continue Stay, ALL; country filter; date filter for today / tomorrow / custom date.
- [ ] Verify IS-number search returns the right booking and nothing from another country the user cannot see.
- [ ] Confirm the movement logic in `hotel-movements.ts` / `hotel-movements-shared.ts` classifies check-in, check-out and continuing stays correctly across multi-night stays.
- [ ] Verify the middleware and `rbac.ts` changes restrict the route server-side, not only in the sidebar.
- [ ] Confirm hotel details remain read-only from this page — no upstream hotel record is modified.
- [ ] Check the empty state and the behaviour when a booking has no hotel movement for the selected day.

## 5. Partner analytics module

- [ ] Open `/dashboard/ground/analytics` and confirm the leaderboard and partner detail load without errors.
- [ ] Verify `/api/ground/analytics/leaderboard` and `/api/ground/analytics/partner` aggregate the correct period and exclude cancelled bookings.
- [ ] Cross-check a few partner scores and feedback counts against the underlying records.
- [ ] Confirm the drivers and vendors pages still work after the shared-component changes.
- [ ] Confirm the analytics routes are access-controlled and no partner sees another partner's data.
- [ ] Verify `/api/reservations/hotels/availability` and the hotels page addition read only from the B2C source.

## 6. Proforma page and all-mails ordering

- [ ] Confirm `/dashboard/proforma` opens on the approved / payment-done tab by default and the Pending tab shows only pending invoices.
- [ ] Verify filtering and sorting behave with the new default tab and that switching tabs does not lose filters unexpectedly.
- [ ] Confirm the Query Monitoring "All Mails" sheet exports oldest first, newest at the bottom, in both the sheet and the page listing.
- [ ] Re-export the workbook and confirm the order and dates are correct.

## 7. Safe test and release preparation

- [ ] Use test numbers for every WhatsApp check; do not message a real customer or driver without approval.
- [ ] Confirm no Prisma migration or SQL script is run against live data without explicit sign-off.
- [ ] Run the build and inspect for type and lint errors across the new pages and libraries.
- [ ] Review the diff for secrets, tokens, production URLs or customer data.
- [ ] Check logs for Meta API errors, 422 responses, webhook failures and DB connection issues on the serverless runtime.

## 8. Handoff checklist

- [ ] Record tested routes, template names, test numbers and results.
- [ ] Note the Meta template approval state and any pending approval that blocks release.
- [ ] List remaining issues with severity, reproduction steps and affected role.
- [ ] Prepare a deployment note covering WhatsApp templates and env keys, driver doc receipts schema, Confirm Booking Hotels access, partner analytics and the proforma default tab.
- [ ] Get Operations confirmation before enabling customer-facing WhatsApp sends in production.

## Definition of done

Booking documents and agendas send reliably through approved templates in both open and closed 24-hour windows without duplicates, driver document delivery is unchanged and now receipted, delivery statuses are tracked accurately, Confirm Booking Hotels is correct and role-restricted, partner analytics figures reconcile with source data, proforma and all-mails ordering match the requested behaviour, and every remaining risk is documented for handoff.
