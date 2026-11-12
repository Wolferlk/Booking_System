# Daily Task List — 11 November 2026 (Wednesday)

**Owner:** Sasindu Diluranga  
**Date:** 11 November 2026  
**Written:** 11 November 2026, based on the unfinished work in the 7 November task list

> **Working rule:** complete the security items before production deployment. Use backups, `--check`/preview modes and internal test recipients before any live send.

## Priority 0 — Security

- [ ] Change the exposed `dev-onlineWork` database root password.
- [ ] Close public access to port `3306`; confirm the database is reachable only from approved hosts.
- [ ] Confirm the boss account password from commit `301ca4b` has been changed.
- [ ] Rotate the exposed OpenAI key and other exposed secrets.
- [ ] Remove `ssh-keys/developer_key` and the door bridge token from Git history, then invalidate the old credentials.

## Priority 1 — Production deployments and checks

### Booking System / OPS

- [ ] Run the agent-digest and WhatsApp-group SQL in `--check` mode, then apply it on live.
- [ ] Redeploy OPS with the Ticket pack, attachments, View/Copy, WhatsApp trip panel, groups and the other pending changes.
- [ ] Open the PR for the commits ahead of `Master-Dev`.
- [ ] Keep `ORDER_VERSION_MODE=same_order` disabled on live until the full rollout is approved.
- [ ] After deploy, check a real booking: the WhatsApp View/Copy screen, trip panel, booking switcher and one internal agenda send.
- [ ] Test the Agent Digest Ticket pack with one real booking and real S3 ticket files. Send a test before enabling automation.
- [ ] Decide which saved digests should receive PDF, Excel and Word attachments before redeploying/sending.

### Accounts System

- [ ] Run `php artisan migrate` for the B2C amendment and same-order migrations.
- [ ] Deploy `Master-Live`.
- [ ] Browser-check B2C Invoices, P&L and Payables with orders `15726`, `15834` and replaced order `15833`.
- [ ] Confirm the amended chain id copies and searches correctly.

### Online Work

- [ ] Back up the live ticket file before deployment.
- [ ] Re-run the 60 permission/workflow checks after the rate-limit fix.
- [ ] Confirm admins, desk leads and members are on the new access list.
- [ ] Deploy the two support desks with the PM2, nginx and DB-pool changes.
- [ ] Send one real ticket notification email to an internal recipient.

## Priority 2 — WhatsApp, driver app and integrations

- [ ] Fix Meta billing error `131042`, then use WhatsApp **Retry failed**.
- [ ] Submit `aahaas_agent_ticket_pack` and the two PDF digest templates to Meta; record approval status.
- [ ] Confirm the gateway serves `gpt-4o-mini` for WhatsApp group suggestions.
- [ ] Link the existing WhatsApp test group to one booking and tell staff who can see group messages.
- [ ] Build the driver app for iOS and Android with Get trips, call-first and guest-picker changes.
- [ ] Check Sinhala and Tamil wording, then test the build on one iPhone and one Android device.
- [ ] Decide the high-roof 9-seat rule, `Van` guest range and `/driver-board` bypass before enabling the new driver selection behavior.

## Priority 3 — Follow-up verification

- [ ] Check the `15912` card and B2C versions `15726` / `15833` after OPS and Accounts deployment.
- [ ] Check digest popups, archived digests and one real PDF/Excel/Word attachment on desktop and phone.
- [ ] Check one real Online Work filing, the ticket tray, asset delete with a backed-up `inventory.json`, and the Windows dropdown fix.
- [ ] Confirm the Online Work `1.0.4` installers are present on S3.
- [ ] Investigate why the portal restarted using `journalctl`.
- [ ] Test one real Microsoft 365 report and the support-team assignment list.

## Documentation and cleanup

- [ ] Write the missing daily updates for 3–7 November.
- [ ] Commit or drop the HRMS `onlineWorkPerformance.service.js` change left uncommitted since 27 October.
- [ ] Record deployment times, migrations, template approvals, real-booking checks and any rollback notes in the next daily update.

## Do not enable yet

- [ ] Same-order production mode.
- [ ] Automatic Agent Digest Ticket pack sending before a successful test.
- [ ] Real WhatsApp group rollout before Meta Official Business Account approval and staff visibility instructions.
