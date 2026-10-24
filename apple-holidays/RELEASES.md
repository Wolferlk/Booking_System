# OPS Release Guide — Live & Dev

As of 2026-10-24

## Current versions

OPS LIVE runs **1.6.6V**. OPS DEV runs **1.6.5V**.

| Environment | Version | Status |
| --- | --- | --- |
| OPS LIVE | 1.6.6V | Live, used by all teams |
| OPS DEV | 1.6.5V | Testing before release |

## Live vs Dev

Dev is where changes are tested on test data. Live is what the teams use every day, on real bookings.

| | OPS DEV | OPS LIVE |
| --- | --- | --- |
| Purpose | Test new features and fixes | Daily work by all teams |
| Website | holidays-booking-dev.aahaas.com | ops.aahaas.com |
| Database | apple_holidays_testing (test data) | apple_booking_system on AWS (real data) |
| Hosting | Dev server | AWS Amplify |
| Git branch | To confirm | LIVE-1.0.0v |
| Who uses it | Developers and testers | OPS, Accounts, VN desk and the other teams |

Never test with real bookings on Live. Use Dev, or the sandbox driver in the driver app.

## Version numbers

A version reads as **MAJOR.MINOR.PATCH** + V. For example, 1.6.6V means major 1, minor 6, patch 6.

| Part | Goes up when | Example |
| --- | --- | --- |
| MAJOR | A big change to how the system works | 1.6.6V → 2.0.0V |
| MINOR | A new feature or module is added | 1.6.6V → 1.7.0V |
| PATCH | A bug fix or a small change | 1.6.6V → 1.6.7V |

When a number goes up, the numbers after it go back to 0. Every release to Live gets a new version number.

## How to release

Every change goes to Dev first and reaches Live only after it passes testing there.

1. **Build on Dev.** Make the change and deploy it to OPS DEV.
2. **Test on Dev.** Check the change and the screens around it with test data.
3. **Pick the new version.** Use the version number rules above, for example 1.6.6V → 1.6.7V.
4. **Update the database first.** If the change needs new tables, run its `apply-*.sh` script on the Live database. Never run `prisma db push` on Live.
5. **Release to Live.** Merge into the Live branch. AWS Amplify builds and deploys it.
6. **Check Live.** Open ops.aahaas.com and confirm the change works.
7. **Record it.** Add a row to the release log below.

If Live breaks after a release, roll back to the last good build in the AWS Amplify console.

## Release log

Add a new row at the top for every release, newest first.

| Version | Environment | What changed |
| --- | --- | --- |
| 1.6.6V | LIVE | Current Live release. Latest change: guest WhatsApp message template (apple_holidays_guest_message) |
| 1.6.5V | DEV | Current Dev build |
