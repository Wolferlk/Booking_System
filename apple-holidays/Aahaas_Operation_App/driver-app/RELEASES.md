# Aahaas Core App — Release Guide

As of 2026-10-24

## Current version

The mobile app is **Aahaas Core App, Test 1.0.3v**. It is a **beta**: it runs against the live server (ops.aahaas.com, real bookings), but it is still being tested by a small group before the full release.

| App | Stage | Version | Server |
| --- | --- | --- | --- |
| Aahaas Core App | Test (Beta) | 1.0.3v | ops.aahaas.com (LIVE) |

## Where the version shows in the app

Every screen below reads the same label, **Test 1.0.3v · Beta**.

| Screen | Who sees it | What it shows |
| --- | --- | --- |
| Welcome (before sign-in) | Everyone | An amber **BETA · Test 1.0.3v** badge under the Aahaas logo |
| Me (profile) | Drivers | Aahaas Core App · Test 1.0.3v · Beta |
| Account | Vehicle vendors | Aahaas Core App · Test 1.0.3v · Beta |
| More | Company staff | Aahaas Core App · Test 1.0.3v · Beta · every change is logged |

At sign-in the app sends the plain version number (1.0.3) to the server, so the Driver App page on ops.aahaas.com shows which version each phone is running.

## How the version is set

Two values in `app.json` control it:

| Setting | Value now | Meaning |
| --- | --- | --- |
| `expo.version` | `1.0.3` | The version number. The stores show this too. |
| `expo.extra.appStage` | `Test` | The release stage. If it has a value, the app shows that stage and the word **Beta**. |

The label is built in `src/lib/config.ts`.

**Full release:** set `appStage` to `""` (empty). The beta badge on the Welcome screen disappears and the label becomes just **1.0.3v**.

## Version numbers

A version reads as **MAJOR.MINOR.PATCH** + v. This follows the same rules as OPS.

| Part | Goes up when | Example |
| --- | --- | --- |
| MAJOR | A big change to how the app works | 1.0.3v → 2.0.0v |
| MINOR | A new feature or screen | 1.0.3v → 1.1.0v |
| PATCH | A bug fix or a small change | 1.0.3v → 1.0.4v |

The store build number (Android versionCode, iOS buildNumber) is separate. EAS increases it automatically on every production build, so nobody has to change it by hand.

## How to release

The app has no over-the-air updates. **A new version reaches phones only through a new build.**

1. **Set the version.** Change `expo.version` in `app.json`, and set `extra.appStage` (`Test` for a beta, `""` for a full release).
2. **Check the code.** Run `npx tsc --noEmit` and `npx expo lint` in `driver-app/`.
3. **Update the server first.** If the release needs new tables, run its `apply-*.sh` script on the live database before anyone installs the build.
4. **Build.** Run `npx eas-cli@latest build --profile preview` for a test APK, or `--profile production` for the stores.
5. **Test with the sandbox driver.** Sign in as sandun@mail.com, which only sees TEST-SBX trips. Never make real bookings to test the app.
6. **Hand it out.** Share the APK with the beta testers, or submit the production build to the stores.
7. **Record it.** Add a row to the release log below.

## Release log

Add a new row at the top for every release, newest first.

| Version | Stage | Date | What changed |
| --- | --- | --- | --- |
| 1.0.3v | Test (Beta) | 2026-10-24 | Renamed in the app to Aahaas Core App. Added the stage label and the beta badge on the Welcome screen. Includes driver and vendor self-registration, trip tickets, trip pauses, vendor login and WhatsApp delivery ticks. |
| 1.0.1 | — | 2026-10-21 | Previous build |
| 1.0.0 | — | 2026-10-13 | First build: driver and company login |

1.0.2 was skipped. It was never set in the code.
