# Daily Task List — 8 November 2026 (Sunday)

**Owner:** Sasindu Diluranga  
**Date:** 8 November 2026  
**Written:** 11 November 2026, reconstructed from GitHub history

> **GitHub status:** no new commits were found on 8 November in Booking System / OPS, Accounts System, Online Work, HRMS or Task Manager. This list records the verification and deployment work still open after the 2–7 November changes; it does not claim that any item was completed on this date.

## Priority 1 — Security

- [ ] Change the exposed `dev-onlineWork` database root password.
- [ ] Close public access to port `3306` and confirm the database is reachable only from approved hosts.
- [ ] Confirm the boss account password referenced by commit `301ca4b` has been changed.
- [ ] Rotate the exposed OpenAI key and other secrets.
- [ ] Remove `ssh-keys/developer_key` and the door bridge token from Git history and invalidate the old credentials.

## Booking System / OPS

- [ ] Run the Agent Digest Ticket pack and WhatsApp-group SQL with `--check` first, then apply it on live.
- [ ] Redeploy OPS with the changes from 2–7 November: B2C amendments, monthly reports, ticket automation, WhatsApp retry/report, T-3 PDF, driver changes, digest attachments, View/Copy and the trip panel.
- [ ] Open the PR for the commits ahead of `Master-Dev`.
- [ ] Load a real booking and verify the amended booking card, WhatsApp View/Copy, trip panel and booking switcher.
- [ ] Send one internal test agenda by WhatsApp and Email.
- [ ] Test one Agent Digest Ticket pack using real S3 ticket files; send a test before enabling auto-send.
- [ ] Keep `ORDER_VERSION_MODE=same_order` disabled until the n8n and card-gateway checks are complete.

## Accounts System

- [ ] Run the B2C amendment and same-order migrations with a backup and preview where available.
- [ ] Deploy `Master-Live`.
- [ ] Browser-check B2C Invoices, P&L and Payables using `15726`, `15834` and replaced version `15833`.
- [ ] Confirm chain-id search and copy behavior.
- [ ] Verify the Payable 2.2VN **Sync now** action against the live checklist workbook.

## Online Work

- [ ] Back up the live ticket file and `inventory.json` before deployment.
- [ ] Re-run the 60 permission/workflow checks after the rate-limit fix.
- [ ] Confirm admin access, desk leads and desk members.
- [ ] Deploy the support desks, filing tray, roster, report, asset and speed fixes with the PM2/nginx/DB-pool changes.
- [ ] Test one real filing, one ticket notification, one Microsoft 365 report and the asset-delete rules.
- [ ] Confirm the `1.0.4` agent installers are available on S3.

## Driver app and integrations

- [ ] Build iOS and Android with Get trips, call-first and guest-picker changes.
- [ ] Check Sinhala and Tamil wording and test on one iPhone and one Android device.
- [ ] Decide the high-roof 9-seat rule, `Van` guest range and `/driver-board` bypass.
- [ ] Confirm the gateway uses `gpt-4o-mini` for WhatsApp group suggestions.
- [ ] Fix Meta billing error `131042`, then run WhatsApp **Retry failed**.
- [ ] Submit the Agent Digest and PDF templates to Meta and record approval status.

## Documentation

- [ ] Write the missing daily updates for 3–7 November.
- [ ] Commit or drop the HRMS 502 retry change left uncommitted since 27 October.
- [ ] Record deployment results, migrations, template approvals and real-data verification in the next daily update.
