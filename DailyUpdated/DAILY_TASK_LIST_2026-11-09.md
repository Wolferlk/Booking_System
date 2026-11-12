# Daily Task List — 9 November 2026 (Monday)

**Owner:** Sasindu Diluranga  
**Date:** 9 November 2026  
**Written:** 11 November 2026, from GitHub history and working-tree notes

> **Important:** the code below was committed/pushed in Git history, but the commit notes say it was not confirmed live. The Ticket Issue Desk involves holds, payments, cancellations and WhatsApp OTPs, so it must remain off until the database, gateway and approval checks are complete.

## 1. OPS — Driver app privacy and App Store review (`bf786fa`)

- [x] Add **Delete my account** for drivers and vendors.
- [x] Add **Delete my registration** for people waiting for approval.
- [x] Close company staff logins through the admin workflow rather than deleting operational records.
- [x] Sign the user out on every phone after deletion.
- [x] Add the OPS account-deletion request flow with **Erase details** and **Keep account** actions.
- [x] Protect the demo account from being permanently deleted by an App Store reviewer.
- [x] Add the public mobile privacy page at `/privacy/app`.
- [x] Link the privacy page from the Me, Account, More and pending-registration screens.
- [x] Add App Store review notes covering demo login, background location, account deletion and App Privacy answers.
- [ ] Redeploy the server changes.
- [ ] Create a new iOS build; the app changes are not delivered over the air.
- [ ] Test account deletion on a test account and confirm the admin request is visible.
- [ ] Check the privacy page and all links on a phone.

## 2. OPS — Create tickets from AppleSystem API (`95fd253`)

- [x] Remove the P&L buttons from the Tickets page.
- [x] Add **Create Tickets from API**.
- [x] Make the action read the booking quote from AppleSystem and create missing attraction/service tickets as DRAFTs.
- [x] Make the action safe to press twice for tickets created through the API.
- [x] Keep hotels and transport excluded, as before.
- [x] Hide the action for B2C and cancelled bookings and keep the existing role permissions.
- [ ] Redeploy OPS before using the button.
- [ ] Press it once against real AppleSystem data and inspect the created tickets.
- [ ] Check the duplicate risk for tickets entered manually, such as a manually entered Pinnawala ticket.
- [ ] Decide whether a future **Update from API** action is needed when an existing draft quote changes.
- [ ] Decide whether the P&L-panel ticket buttons should also be removed.

## 3. OPS — Ticket Issue Desk and WhatsApp OTP (`7c4ca32`)

- [x] Add ticket comparison across GlobalTix, Cebu and Manual sources.
- [x] Highlight the lowest price and calculate savings against the quote.
- [x] Add combo-ticket detection.
- [x] Add hold, issue, release and cancellation flows with approval checks.
- [x] Add six-digit WhatsApp OTPs for approvers: HMAC-protected, one-time use and five-minute expiry.
- [x] Invalidate the OTP if the amount changes.
- [x] Save issued references, ticket codes, e-tickets and purchase-record PDFs.
- [x] Add shared authorization and error handling for the Ticket Issue Desk routes.
- [x] Add the three-table database script and Settings switch; the feature starts off.
- [x] Pass 43 of 43 fake-database/fake-portal money-flow scenarios.
- [ ] Run the database script with `--check`, then apply it on live only after approval.
- [ ] Fix or confirm the GlobalTix 502 before enabling GlobalTix products.
- [ ] Fix Meta billing error `131042`, then use **Send test code first**.
- [ ] Test one hold, approval OTP, issue, release and cancellation with a safe internal/test booking.
- [ ] Confirm double-click protection and the locked state when a portal does not answer.
- [ ] Decide the Cebu paid-order cancellation procedure until Main Backend supports it.
- [ ] Keep the Ticket Issue Desk OFF in Settings until all live checks pass.

## 4. Accounts System — Dispatcher health (`60a61b1`)

- [x] Add the `DispatcherHealth` service.
- [x] Integrate dispatcher health checks into scheduled-report handling.
- [x] Show health information in B2B auto, P&L auto and general report views.
- [x] Add the shared dispatcher-health partial and console route support.
- [ ] Deploy the change with `Master-Live`.
- [ ] Confirm report pages show a useful health state when the dispatcher is healthy, delayed or unavailable.

## Verification and security

- [ ] Confirm the existing 11 OPS type-check errors remain unchanged and are not caused by the 9 November work.
- [ ] Do not run real ticket payments or cancellations until database backups and rollback steps are prepared.
- [ ] Verify WhatsApp billing before relying on OTP delivery.
- [ ] Confirm the exposed database password, OpenAI key and other credentials have been rotated.
- [ ] Record deployment, migration, App Store build and Ticket Issue Desk test results in the next daily update.
