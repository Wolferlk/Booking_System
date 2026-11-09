# App Store submission: what to paste into App Store Connect

Fill in the two `<…>` values before you submit.

---

## 1. App Information → Privacy Policy URL

```
https://ops.aahaas.com/privacy/app
```

This page only works after the OPS web app is deployed. Open it in a private browser window first to check it loads without a login.

---

## 2. App Review Information → Sign-In Information

Tick **Sign-in required**.

| Field     | Value                                  |
|-----------|----------------------------------------|
| User name | `sandun@mail.com`                      |
| Password  | `<the sandbox driver's app password>`  |

Before you submit, sign in on a real phone with exactly these details. If the password isn't known, reset it with "Forgot password?" on the driver sign-in screen first. Don't change the account after you submit.

---

## 3. App Review Information → Notes (paste as-is)

```
Aahaas CORE is the internal operations app for Aahaas (Apple Holidays), a tour operator in Sri Lanka, Vietnam, Singapore and Malaysia. It is used by the independent drivers and vehicle vendors who transport our guests, and by our operations staff.

DEMO LOGIN
On the first screen, under "Sign in as", tap "Driver" and sign in with the details above. This is a test driver: every trip it sees is generated test data (refs start with TEST-SBX), so you can safely try Start day, Pause, the vehicle check and Finish trip. Nothing reaches our real operations team.

BACKGROUND LOCATION
A driver taps "Start day" when they pick up guests and "End day" when the day's driving is done. Only between those two taps, the app records the vehicle's location to:
 1. count the kilometres driven, which is how the driver is paid, and
 2. show our operations team where the guests' vehicle is, for guest safety and help on the road.
Drivers usually navigate with Google Maps or Waze, so the screen is locked or another app is in front most of the day. That is why "Always" access is needed. Outside a running trip day the app collects no location, and tracking stops at End day, on sign-out, and on account deletion. While it runs, iOS shows the blue location indicator.

ACCOUNT DELETION
Drivers: Me tab → "Delete my account" (bottom of the screen).
Vendors: Account tab → "Delete my account".
Someone waiting for approval after signing up: "Delete my registration" on the waiting screen.
The login is removed straight away. Remaining personal details are erased by our team within 30 days. Trip and payment records are kept, without the person's name, for accounting. On the demo account, deletion signs you out but does not remove the account, so the demo keeps working for later reviews.

SIGN-UP
Drivers and vendors can register in the app. A real person in our operations team approves each registration before the account can sign in, so a new registration will stay on "Waiting for approval". Please use the demo login above to review the app.

COMPANY LOGIN
The "Company" login is for our own staff, using their existing work accounts. It is not needed for the review.

Contact: <your name>, +94 70 722 4229, ops@aahaas.com
```

---

## 4. App Privacy (the "nutrition label" questionnaire)

Data collected, all **linked to the user's identity**, none used for tracking or advertising:

| Apple category | What it is in this app | Purpose |
|---|---|---|
| Contact Info → Name | driver/vendor name | App Functionality |
| Contact Info → Email Address | optional e-mail | App Functionality |
| Contact Info → Phone Number | WhatsApp number (sign-in) | App Functionality |
| Contact Info → Physical Address | vendor company address | App Functionality |
| Location → Precise Location | only between Start day and End day | App Functionality |
| User Content → Photos or Videos | vehicle-check and profile photos | App Functionality |
| User Content → Other User Content | trip tickets/files, requests to ops | App Functionality |
| Financial Info → Other Financial Info | bank account for payouts | App Functionality |
| Identifiers → User ID | account id | App Functionality |
| Identifiers → Device ID | push-notification token | App Functionality |
| Other Data | driving licence number, vehicle details | App Functionality |

"Data used to track you": **No**.

---

## 5. Things to check yourself before submitting

- [ ] OPS deployed, so that `/privacy/app`, `/api/mobile/me/delete` and `/api/mobile/auth/register/cancel` are live.
- [ ] Demo login signs in on a real iPhone.
- [ ] `ops@aahaas.com` is a real, read mailbox. If not, change `CONTACT_EMAIL` in `src/app/privacy/app/page.tsx` in the OPS repo.
- [ ] The new build (with Delete account) is the one selected in App Store Connect.
