# Daily Work Update — 28 September 2026 (Monday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 28 Sep 2026 (OPS: weekly report fixes (wrong week, "took too long", week picker), Client Confirmed / Operations Ready emails no longer fail on a blank agent email, Remove from details on agenda flight cards; Accounts: invoice versions with a red OLD INVOICE mark, Dashboard action buttons behind a super-admin switch; Online Work: help desk and Support desk, nightly Daily report email, rebuilt Teams tab, mail sending through the Booking system's app)

---

## Executive Summary

Most of today's OPS work fixed the **weekly OPS report**. The 27 Sept email covered **14–20 Sept instead of 20–26 Sept**. The weekly report now covers the **7 days ending the day before it's sent**. The preview and send no longer fail with **"took too long"** when the Apple System is slow. A **week picker** lets you send any past week.

Also in OPS: the **Client Confirmed** and **Operations Ready** emails had been **silently not sending** for bookings whose agent email was saved as a blank value. They now fall back to the Mail Box agent directory, then to `confirm.booking@aahaas.com`. Flight cards on the agenda have a **Remove from details** button.

In Accounts, **/invoice-payments** now always downloads the **latest invoice**. Older versions can still be downloaded on purpose, and they come out with a **red "OLD INVOICE" mark on every page**. The Dashboard's **Email Records action buttons are hidden**, and a super-admin switch in Page Master brings them back.

Online Work got a **help desk** on the sign-in page with an admin **Support desk**, a **nightly Daily report email** with an Excel file, and a **rebuilt Teams tab** on the employee page. Mail sending moves to **the same Azure app the Booking system uses**. **It won't send until that app's secret is added on the server.**

**No database scripts or migrations were added today.** The five OPS scripts and two Accounts migrations from 25 Sep are still waiting (Section 9).

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 7 commits | `LIVE-1.0.0v` | Clean · up to date with origin |
| Accounts System | 2 commits | `REV1` | Clean · up to date with origin |
| Aahaas Online Work | 7 commits | `main` | Clean · up to date with origin |
| Aahaas Task Manager | No work today | `main` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** some of today's messages say *"nothing is committed or deployed"*. That was true when each message was written. **Every change listed here is now committed and pushed.** Nothing has been checked as deployed.

---

## 1. OPS — Weekly report covered the wrong week

`353ba3a` · 1 file · +40 / −13 (plus the 25 Sep daily update) · **no database script**

* **Before:** the weekly report used the previous Monday–Sunday week, so the **Sunday 27 Sept send showed 14–20 Sept**.
* **Now:** it covers the **7 days ending the day before the send**. A Sunday 27 Sept send covers **20–26 Sept**, compared against 13–19 Sept.
* Daily (yesterday) and monthly (last month) reports are unchanged. The reconciliation report's weekly option uses the same new week.
* In Preview, picking a past date shows the 7-day block that contains it, and the arrows still move a full week at a time.

> **The 27 Sept email already went out with the wrong week.** The next scheduled send (Sun 04 Oct) covers 27 Sept – 3 Oct. To send a corrected 20–26 Sept report, use the week picker (Section 3) once this is live.

---

## 2. OPS — Weekly report "took too long"

`6032167` · 4 files · +122 / −16

**Cause:** the Apple System is only used for the report's parity check, but its call could retry for up to 90 s for each batch of pages. A weekly range is about 11 pages. The preview also built the whole report twice at the same time, including the AI paragraph. Together this ran past the server's time limit.

**Changes:**

* **Time limits on the Apple System:** 20 s for preview, 25 s for Test / Send now and 90 s for the scheduled Sunday send. **The limit covers the whole report, not each request.** When it runs out, the report uses the **last reconciler run's figures (every 15 minutes)**.
* **AI paragraph:** 20 s with no retries. If it's slow, the email goes without it. Before, it could wait up to 10 minutes.
* **Preview builds once**, and revisiting the same week within 3 minutes is instant.
* **The email says so:** a yellow note in the Integrity section when the Apple System couldn't be reached, and the tile reads *"last reconciliation"*.

---

## 3. OPS — Week picker for sends

`a922191` · 7 files · +67 / −9 · `c5129cd` · 2 files · +230 / −4 · `5162834` · 1 file · +11 / −3

* **Send test to me**, **Send now to everyone** and **Test** now open a small window to pick the week:
  * **Latest:** what the schedule would send now (the default).
  * **A month with ‹ › arrows** showing Week 1 to Week 4 or 5. For September 2026: Week 1 06–12 Sept, Week 2 13–19, **Week 3 20–26**, Week 4 27 Sept – 03 Oct (greyed out until it's over).
* Weeks run from the schedule's send day to the day before (Sunday–Saturday for the weekly report), and a week belongs to the month it starts in.
* **Send to everyone** shows how many people will get it, and its button is amber so it isn't mistaken for a test.
* `a922191` lets the weekly send day be set per schedule, and the report window follows it.

**Bug fixed (`5162834`):** pressing *Send now to everyone* **crashed the whole page**. The window's month was set when the page loaded, before any schedule existed, so it was empty. It now falls back to the current month, and an empty month can no longer crash the page.

**Checked:** the dates on each September week button match what the server builds (Week 3 = *"Week of 20 Sept 2026 to 26 Sept 2026"*). "Latest" gives 20–26 Sept. Type check and lint are clean. **The page hasn't been opened in a browser and no report was sent.**

---

## 4. OPS — Client Confirmed / Operations Ready emails not sending

`426a879` · 3 files · +60 / −12

* **Cause:** some bookings have their agent email saved as a **blank value** rather than empty. The fallback only ran for empty, so the blank went to the mailer, which refused it. Both emails are sent in the background, so **the failure only showed in the pm2 log and no email went out.**
* **Recipient order now:**
  1. The booking's agent email, if it's a real address.
  2. The **Mail Box agent directory**, only on an **exact** name, alias or known-email match (never a partial name match), with the agent's CC addresses copied in.
  3. **`confirm.booking@aahaas.com`** if nothing else is found. The log names the booking and says where the mail went.

---

## 5. OPS — Agenda: Remove from details on flight cards

`69fef69` · 2 files · +30 / −5

* The greyed-out **"Already in details"** label is replaced by a red **Remove from details** button.
* It takes the flight wording out of Details / Timings: the *"Meet on arrival of VJ1322…"*, *"Our representative waits…"* and *"Please allow time for…"* sentences, and any other sentence naming the flight number. **Anything else typed stays.** On VN41769, only the traffic / weather note is left.
* **Add to details** then shows again, so it can be switched back in one click. The flight card stays on the item, and **nothing is saved until Save is pressed**.
* **If you meant hiding the whole flight card**, not just its text, I can add a dismiss option.

Type check passes. **Not clicked through in the app yet.**

---

## 6. Accounts — Invoice versions and the red OLD INVOICE mark

`102e277` · 7 files · +596 / −30 · **no migration**

**On /invoice-payments**

* **Download** always gives the booking's **latest version**, even from an older revision's row.
* A **version count button** (e.g. *3 ▾*) next to Download opens a **Versions panel**. Older revisions shown on the board have their invoice number crossed out with a red **⚠ OLD** badge. The V1, V2… chips in the payment popup open the same panel.
* **Versions panel:** every version newest first. The latest is green (*"Latest · default"*) and the rest red (*"Old · superseded"*). Each shows its date, value and change from the version before, plus any currency change. It also has a small value chart, View / Download per version and **Download all versions (.zip)**.

**The red mark**

* Every page of an old version gets a red border, a top band reading ***OLD INVOICE - NOT THE LATEST VERSION - V3 of V12***, a bottom band naming the invoice that replaced it, and a faint diagonal *SUPERSEDED*. The file name says it too (e.g. `VN41571_R2_R2__OLD-V2-superseded-by-V12.pdf`).
* **This applies anywhere in the app an old version is opened.** The stored file is never changed, and the mark is added each time it's served.
* "Latest" is worked out from the booking's actual revisions, **not the `is_latest` flag**, which has gone out of date on production before.

**Checked:** the mark on a sample PDF, and version order and file names on sample data. This caught and fixed a crash on invoices with no creation date. **Not tried on a real invoice** (the production database isn't reachable from here).

> **Check after deploying:** (1) the red top band may overlap the header of templates that print to the page edge, so open one old version of each invoice type; (2) if an old version's source email is gone and it was never edited in Invoice Studio, it downloads **without** the mark, though the file name still says OLD.

---

## 7. Accounts — Dashboard action buttons behind a switch

`487da2e` · 5 files · +165 / −2 · **no migration**

* The **Actions column** in the Dashboard's Email Records table (View / Download / Regenerate and the *Processing* badge) is **removed**.
* **Settings → Page Master** has a new **Dashboard action buttons** switch that brings it back. **Only super admins can change it.** Others see it greyed out, and the server rejects the change too. It applies to every user.
* Stored in the existing `app_settings` table, so **no database change on deploy**. New route: `POST /settings/pages/dashboard-actions`.

---

## 8. Online Work

| Commit | What |
|---|---|
| `5badb7f` | **Sign-in page links swapped:** the Windows desktop agent download and the *How to install and set up* PDF now point to the new files. |
| `fca5042` · +2,472 | **Help desk:** a *"Need a hand?"* card on the sign-in page for **Setup help** (install AnyDesk, give the AnyDesk address), **IT support** and **HR / Admin tickets**, with ticket numbers like *AH-1001* and **Track a ticket**. Admins get a **Support desk** (`/tickets`) with counts, filters, AnyDesk Copy / Connect, status / priority, assign, replies and internal notes. Employees get **`/me/support`**. Only `@aahaas.com` emails can raise tickets when signed out, up to 5 a minute. Tickets are stored in `.data/tickets/tickets.json`. |
| `a2f009c`, `bc3a939` | Sign-in panel: rotating words, journey steps, responsive layout and animation tweaks. |
| `7dd91db` · +3,658 | **Daily report:** a new page under Records that emails **yesterday's attendance, daily filings, mail, Teams and calls every night at 00:05 (Colombo)** with a **6-tab Excel file**. It has a *Needs attention* box (late, absent, left early, no filing, 5+ unanswered emails, 5+ missed calls). **It starts switched off:** add recipients, turn it on and save. It retries 3 times, 15 minutes apart, and never sends the same day twice. |
| `5960f01` · +2,114 | **Teams tab rebuilt** on the employee page: presence and rings, a day timeline, meetings with join / leave times, calls (answered / missed), chats, and Microsoft's 7-day report in its own section. Every card on Overview, Mail and Teams now has a hover note (ⓘ). |
| `71273ea` | **Mail now sends through the Booking system's Azure app**, which has `Mail.Send`. The portal's own app gets *ErrorAccessDenied*. Two new settings: `GRAPH_MAIL_CLIENT_ID` (filled in) and `GRAPH_MAIL_CLIENT_SECRET` (**blank, to be added on the server**). Used by the daily report and leave emails. The earlier SMTP code was removed. |

**Checked:** the production build and type check pass. The daily report email and Excel were built from made-up data for 10 employees, and the 00:05 timing was simulated. The ticket routes were tested against the running app with scratch data. **Nothing has run against real data or Microsoft 365, and no real email has been sent.** The admin Support desk and the ticket forms haven't been clicked through in a browser.

> **Help desk emails:** ticket and reply emails don't go out yet. They depend on the new mail app secret above.

---

## 9. Follow-Up Items

1. **Send a corrected weekly OPS report for 20–26 Sept** using the week picker (Week 3) once the OPS changes are live, after checking it in Preview.
2. **Browser-check today's OPS work:** the week picker window (especially *Send now to everyone*), a weekly Preview, and **Remove from details** on VN41769.
3. **Watch the pm2 log** for the next Client Confirmed / Operations Ready emails and confirm where they went.
4. **Accounts, after deploying:** open one old version of each invoice type to check the red band against the header, and check the Page Master switch as a super admin and a normal user.
5. **Online Work:** add `GRAPH_MAIL_CLIENT_SECRET` on the server, then use **Send to me** on the Daily report page before turning it on. Also click through the help desk forms and the Support desk, open a few employee Teams tabs against known activity, and check the new setup PDF opens in the View pop-up without signing in.
6. **Decide:** whether *Remove from details* should also be able to hide the whole flight card.
7. **Still open from 25 Sep:** the five OPS scripts (`apply-agenda-mc-details.sh`, `apply-agenda-tickets-control.sh`, `apply-passenger-special-notes.sh`, `apply-ticket-files.sh`, `apply-agenda-custom-service-types.sh`, each with `--check` first, and on the test database too), the two Bank Settlements migrations, checking the D-3 Driver Allocation / Reconfirmation Status numbers in the Daily Operations email, and the decisions on ticket files for guests, tours with no agenda, and the unused *"What the mail said"* code.
8. **Still open from earlier:** the Checklist VN 2.1v script and first sync, the Vietnam agenda includes and Vietnam Booking Checklist scripts, Azure write access to OneDrive, the three payment migrations, `Mail.Send` in Entra, **rotating the credentials tracked in `web/.env.local.example`**, `AUTH_SECRET`, the five live indexes, and `DB_READ_HOST` in Amplify.
