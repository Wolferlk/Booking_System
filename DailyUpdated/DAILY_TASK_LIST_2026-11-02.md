# Daily Task List — 2 November 2026 (Monday)

**Owner:** Sasindu Diluranga  
**Date:** 2 November 2026  
**Written:** 11 November 2026, reconstructed from GitHub history and the following daily task lists

> **History note:** this list is reconstructed from commits across Booking System / OPS, Accounts System, Online Work and HRMS. Commit messages frequently say that work was not deployed or was only tested with sample/fake data; those warnings are preserved below.

## Booking System / OPS

- [x] Add **Retry failed** and **Report** actions to the WhatsApp inbox. The changes were type-checked and linted, but require an OPS redeploy and real-data testing.
- [x] Add **Guest voice** for AI calls and feedback.
- [x] Add automatic ticket creation when Apple API imports create a new booking.
- [x] Add B2C amendment notices and order-versioning support.
- [x] Rebuild the B2C store-orders section of the monthly report so B2B Packages, B2B Flights and B2C are counted separately.
- [x] Add the matching store-order card to OPS.
- [x] Rename “Today new & updated” to **“This month new & updated”** in the monthly report.
- [x] Remove unused B2C fields from the period report.
- [ ] Redeploy OPS before treating the amendment notices, ticket automation, monthly report and WhatsApp actions as live.
- [ ] Test the new report counts against real data after deployment; the live database was not reachable during development.

## Accounts System

- [x] Add a **Sync now** button to Payable 2.2VN so staff can refresh the checklist workbook without waiting for the two-hour timer.
- [x] Register the route and confirm PHP, TypeScript and templates compile.
- [ ] Test the sync end to end against the live system.
- [ ] Continue the B2C payable arrival-date and same-order work on their branches; neither is live until merged, migrated and deployed.

## Online Work

- [x] Add mandatory approvers to leave requests.
- [x] Add a personal copy-recipient list for leave emails.
- [x] Fix broken files caused by department names containing `&`, including “Ticketing, Flights & Visa”.
- [x] Improve deployment configuration and error handling.
- [x] Add roster Download Excel, Email and Plan with AI actions.
- [x] Add server-side fixes for the 502 issue.
- [x] Modify the Sri Lanka payroll UI and processing sections.
- [x] Set the sidebar version label to `V1.0.6`.
- [x] Complete the India payroll bulk leave calculation and comp-off work.
- [ ] Test the roster, email, AI planning and 502 fixes against the real server; development testing did not touch live data.

## HRMS

- [x] Modify the employee screens and Sri Lanka payroll sections.
- [x] Continue the India payroll and mobile-related modifications.
- [x] Complete the India bulk leave calculation and comp-off work.
- [ ] Review the payroll changes together in a browser and confirm there are no regressions in leave balances.

## Security and deployment gates

- [ ] Keep all changes un-deployed until real-data checks and rollback plans are ready.
- [ ] Rotate exposed credentials and secrets found in the repositories or commit history.
- [ ] Confirm the live database is not directly exposed to the internet.
- [ ] Record which OPS, Accounts, Online Work and HRMS changes were actually deployed.

## Carry-over for the next task list

- [ ] Build and test the Agent Digest and Daily Digest features.
- [ ] Finish the T-3 PDF and voucher changes and test them on OPS.
- [ ] Review B2C amendments `15726` / `15833` and the Payables arrival-date change.
- [ ] Deploy and verify Online Work changes, including the 502 fixes and roster tools.
- [ ] Continue same-order amendment work, keeping `ORDER_VERSION_MODE=same_order` disabled on live.
