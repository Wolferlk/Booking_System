# Daily Work Update — 22 September 2026 (Tuesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 22 Sep 2026 (Accounts: payments on B2C, B2B Flights and B2B Tickets, Receive from agency, Page Master, old-amendment de-duplication, cancellation fix; Online Work: Leave requests, departments, web check-in, Mail & Teams panel, sign-in security code; Task Manager: paste-a-write-up import)

---

## Executive Summary

The day's big piece is **collections**. Invoice Payments was the only board in the Accounts System where money could be recorded. It now has three siblings: **B2C Invoices**, **B2B Flights (`/b2b/bookings`)** and **B2B Tickets (`/b2b/tickets`)**, each with the same Pay popup — record, refund, history, AI receipt reading, cancel-with-reason and a statement PDF. B2B also gained **Receive from agency**, where one bank transfer is split oldest-first across an agency's unpaid bookings and saved as one linked transfer.

**Three migrations are written and none have been run**, because they are against the production database. Until they run, the three new boards work exactly as before and show a note saying payments aren't set up.

Two reporting problems were fixed. **Old amendments were counted once per revision**, so VN41530 appeared three times (R13, R14, R15) and inflated the Old updates card and the mail. All four places now read one method, so a booking shows once at its latest revision. The **Credit / Non-credit agent amount cards** were mixing old-update money into a New + New updates figure; they no longer do, and both popups gained a credit-vs-non-credit split with a check line that shows a mismatch rather than hiding it.

A **live failure on booking 14219** was traced and fixed: a cancellation on a booking with no invoice saved `email_id = null` into a NOT NULL column, so MySQL rejected the insert and rolled the whole cancellation back.

In **Online Work**, the largest single feature of the day is **Leave requests** end to end — four leave types, backdated leave, medical certificates, a year calendar, and admin approval in the same queue as shift and WFH. **No email can go out yet**: the Microsoft 365 app holds only `Mail.Read`, not `Mail.Send`. Also landed: departments, profile photos, web check-in for people with no desktop agent, a Mail & Teams panel on every employee page, automatic monitoring enrolment, and a security code on the Admin sign-in button (the HR button was removed).

In the **Task Manager**, pasting a write-up now yields one task per `TASK n:` block instead of dozens of fragments.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 7 commits | `REV1` | Clean |
| Aahaas Online Work | 12 commits | `main` | Clean |
| Aahaas Task Manager | 2 commits | `main` | Clean |
| Booking System / OPS | No work today | `LIVE-1.0.0v` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

---

## 1. Accounts System — Invoice Payments: credit / non-credit, honestly scoped

`e4ab315` · 4 files · +363 / −38

### 1.1 The cards now mean what they say

The **Credit** and **Non-credit agent amount** cards count **New + New updates only**. The *Older edited* line under each card is gone, because it was putting old-update money on a card whose headline was not about old updates. The two cards now add up **exactly** to New + New updates. Each footer states its coverage (for example *"3 of 4 bookings from New + New updates"*) and carries an *Excludes old updates & cancellations* tag. Both ⓘ texts were rewritten to match.

### 1.2 A credit-vs-non-credit split inside both popups

* **Old updates** — a share bar per currency, computed on **standing value, not change**, because a change can be negative and a negative has no share. Each side shows amount changed (▲/▼), standing value, how many could be compared, and an expandable list (invoice number, agent, first-confirmed date and days ago, change, standing value).
* **Cancelled** — the same section, showing value voided, fees billed, refunds and *called off later*. Bookings called off after the period are faded, labelled *not in the card*, and their money is kept out so the list and the card agree. A cancellation's side comes from the **original invoice's** credit type.
* **A check line on both** confirms the two halves add back to the card to the cent, per currency. When they don't, it shows an **amber warning instead of hiding the mismatch**.

**Not verified against real data.** The production database timed out from this machine, so the split was run on made-up bookings (no invoice type → non-credit; post-period cancellations counted but not added; other-brand bookings excluded). The page cache key was renamed so a stale 30-minute result can't be served without the split.

---

## 2. Accounts System — Old amendments: one line per booking

`ec67ea2` · 5 files · +57 / −8

VN41530 was appearing three times — R13, R14 and R15 — in four different places. All four now read **one** method, `oldAmendments()` in `ActivityTabs.php`, which keeps only each booking's **latest document in the period**, the way *Today new & updated* already worked. That corrects at once:

* the **OLD AMENDMENTS** sheet in the Excel attachment,
* the **mail body's** Old amendments table and its *confirmations edited* count,
* the **Old updates card** on `/invoice-payments`, including its FILTER button, which now picks just the R15 document,
* the **same strip on `/pnl/db`**.

**The money does not change, only the count.** *Before* and *Change* on the kept row now span the whole period — for VN41530, the value before R13 through to R15 — so the ▲ figure is the same money the three rows used to add up to.

**One knock-on handled:** the P&L mail counted old rows per booking to find its starting point. With one row per booking it would have compared against R14 instead of R12, so the row now carries `edits_in_period` and `PnlReportSource.php` uses that number. Both cache keys were renamed (`payments.activity.v3`, `pnl.activity.v2`) so the corrected count shows immediately.

---

## 3. Accounts System — Booking 14219: cancellation rolled back

`719e273` · 1 file · +37 / −1

**What happened on live:** confirming a cancellation on booking 14219 failed with *"No invoice found for this booking ref"* and **nothing was saved**. The cancellation invoice copies `email_id` from the booking's original invoice. With no original invoice it saved `email_id = null`, `generated_invoices.email_id` is NOT NULL, MySQL rejected the insert, and the whole transaction rolled back.

**The fix:** when there is no original invoice, the service creates a **placeholder email record** for the cancellation, found again by the key `booking-cancellation:<ref>` so re-pricing reuses it. B2C, AS and document-confirmation invoices already work this way. The placeholder is marked `invoice_generated` / `read`, so the email processor will not pick it up as a new confirmation. **Bookings that do have an invoice behave exactly as before.**

> **Worth knowing, and left alone deliberately:** 14219 is an Aahaas B2C booking. B2C invoices are numbered `AHS-<order id>`, but the cancel screen searches only for an invoice numbered with the plain booking ref. If 14219 does have a B2C invoice (possibly `AHS-14219`), the cancel screen would not find it, so the original invoice would not be marked cancelled and its payments would not be counted. I did not change this because I cannot confirm 14219 is the B2C order id. Say the word and I'll add that lookup.

---

## 4. Accounts System — Page Master (`/settings/pages`)

`7c9092d` · 9 files · +1,067 / −61 · **needs a migration**

A switch for every sidebar link, grouped by sidebar section. **Each user decides which pages show in their own sidebar.** Linked from the Settings section of the sidebar and from the user menu.

* **Hiding is not a permission.** Users only see switches for pages they can already open, and a hidden page still opens from a bookmark or a link. Access remains in Roles & Permissions.
* **Page Master can't be hidden**, because it is the way back. The sidebar's foot shows *"3 pages hidden"*, linking to it, so pages never look lost.
* Changes **save as you flip them**; the real sidebar redraws in place and a returning link glows once.
* Section switches turn a whole group on or off and sit half-way when a group is partly hidden.
* Search (`/`), filters (All / Showing / Hidden / Unused), *Show all*, and Undo (Ctrl+Z).
* **Last opened** is recorded by `EnsurePageAccess`. *Hide unused* (not opened in 30 days) stays **locked until there are 30 days of history**, so it cannot hide everything on day one.
* Choices are per account, so they follow the user to any device, and a hide choice survives losing and regaining access to a page.

**One thing to maintain:** the sidebar list in `config/access.php` mirrors the sidebar. A new sidebar link needs its key added there or it gets no switch. This is noted in project memory.

**Verification:** Blade views compile and routes register. Save and tracking logic was tested against in-memory SQLite — it saved only real page keys, refused bogus keys and the locked Page Master key, and wrote one visit record when the same page was opened twice in a row. Layout was checked from a rendered screenshot. **Not clicked through signed in as a real non-admin user.**

---

## 5. Accounts System — B2C Invoices: its own Pay option

`53e73bf` · 9 files · +1,735 / −7

The B2C Invoices page can now take money, and it **saves into the same payment records as Invoice Payments** — every save, refund, cancel and restore goes through the existing Invoice Payments controller, so amended invoices, cancelled bookings, exchange rates and receipt uploads are all checked the same way. The new routes accept **`AHS-` invoices only**.

* **Pay button** on every invoiced row. It **glows orange** when the storefront has taken the customer's money and we haven't recorded it.
* The **Payment column is clickable**, showing status (Unpaid / Part paid / Paid / Paid on Aahaas / Refund due), a bar, and paid vs total. A matching **Payment filter** and a **collection strip** (% received, received, outstanding, *Paid on Aahaas*) sit under the KPI cards.
* **Aahaas storefront card** in the popup compares what the storefront says the customer paid against what we hold. *Fill receipt from Aahaas* fills the amount, a suggested mode, the order date and a reference. If the order was cancelled on Aahaas while we still hold money, it points to Refund. **The storefront figures are only suggestions — nothing is recorded until someone confirms**, and they are only compared when the invoice is in the currency the page is showing.
* **Settle from Aahaas (bulk):** every order in the current window that Aahaas says is paid and we haven't recorded, with editable amount, date and reference per line, one mode for all, and untick to skip. **Each line is re-checked against the current balance just before saving**, so a double-click or a second open tab cannot record the same money twice.
* The Excel report gains **Received, Balance and Paid on Aahaas**.

**Not tried on real orders — the live B2C database timed out from this machine.** Please open `/b2c/invoices` once and check a few orders.

---

## 6. Accounts System — B2B Flights: payments and *Receive from agency*

`74e9c56` · 16 files · +2,581 / −28 · **needs a migration**

### 6.1 Why a new table

**B2B bookings are never saved as our invoices** — they are read live from the B2B database, which we only read. So payments could not be attached to invoices the way B2C does. They go into a new table, **`b2b_booking_payments`**, in our own accounts database, with the same rules as invoice payments. This also keeps B2B out of the invoice reports, as it is today.

`2026_09_22_120000_create_b2b_booking_payments_table.php` — **not run.** Back up, preview with `php artisan migrate --pretend`, then `php artisan migrate`.

### 6.2 On the board

A **collection strip** (% received, received, outstanding, bookings with no receipt) per currency across the whole filtered window, not just the page. Each card keeps the portal's own payment status and adds **ours** (Unpaid / Part paid / Paid / Refund due) with a progress bar, plus a **Pay** button. New filters for payment status and agency, and the agency name now shows on each card.

### 6.3 Receive from agency

Opened from the header, the collection strip, or a booking's popup.

1. Pick the agency; its unpaid bookings load, grouped by currency, **oldest first**.
2. Enter amount, date, mode, reference and bank slip — **the AI can read the amount, date and reference off the slip**.
3. The amount spreads oldest-first and updates as you watch. Every line can be edited or unticked, with a meter for allocated vs left.
4. Saving writes **one entry per booking, all linked as one transfer**. Each line is re-checked against the latest balance before saving. From any booking's history you can cancel **just that entry or the whole transfer**.

There's an **agency statement PDF**: every confirmed booking for that agency with value, received and balance.

**Verification:** 8 new B2B tests cover oldest-first splitting, numbering, currency locks, rate conversion, the refund limit, cancel and restore, and cancelling a whole transfer. The 8 B2C tests still pass. **All tests ran on in-memory SQLite, not production.** Views compile and scripts pass syntax checks. The B2B database is not reachable from this machine.

---

## 7. Accounts System — B2B Tickets: the same Pay option

`b571ec0` · 16 files · +1,835 / −597 · **needs a migration**

`/b2b/tickets` gets the same treatment: collection strip (% received, received, outstanding, tickets with no receipt, per currency), our payment status under the portal's, a **Pay** button beside Trail, a *Received (ledger)* advanced filter, and **Receive from agency** in the header and on the strip. Agency lump sums split oldest-first across that agency's tickets, one entry per ticket, cancellable as a whole. The shared ledger logic was lifted out into `B2bLedgerService` (`B2bPaymentService` shrank by ~530 lines as a result).

`2026_09_22_160000_create_b2b_ticket_payments_table.php` — **not run.**

> **Two decisions that want your confirmation:**
> 1. **A ticket's value is its sell price** — `ticket_cost + markup − markup reversed` — because `ticket_cost` alone is supplier cost per `B2B_Fligth.md`. A **voided ticket is worth 0**, so anything received against one reads *Refund due*. Refunded and reissued tickets keep their sell price; **if a reissue's cost is the full new fare rather than the difference, the pair will look over-billed.**
> 2. **Tickets and bookings keep separate ledgers** (`b2b_ticket_payments` vs `b2b_booking_payments`), because many tickets have no order. To stop the same money being taken twice, **the ticket popup warns when the ticket's booking already holds receipts on the bookings ledger.**

---

## 8. Online Work — Leave requests, end to end

`8a0642f` · 29 files · +3,144 / −46

### 8.1 For employees (`/me/leave`, new menu item)

* **Four leave types:** full day, half day (morning or afternoon), short leave (**exactly 2 hours** from a chosen start time), and medical.
* **Backdated leave** up to 60 days.
* **Documents:** a medical certificate (PDF or phone photo) at request time or added later. **A later upload goes to HR as a reply in the same email thread.**
* Before sending, the form shows: how many working days it really is **based on that person's shift** (Friday–Monday counts as 2), a clash with leave already held, a warning past a short-leave limit (default 2 a month), and **exactly who will be emailed**.
* **Year view:** the whole year as a calendar, coloured by leave type, with totals.
* **Approved leave marks the day as leave (or half day) in Daily filing automatically.**

### 8.2 For admins (`/approvals`)

Leave joins shift and work-from-home in one queue, with a filter by kind and an **Away this week** band at the top. Each leave shows the days, the documents, who else is off then, and the person's leave so far this year. **Every email attempt is recorded, including why it failed**, with a *Send the email again* button.

### 8.3 The emails

| Step | What is sent |
|---|---|
| Request | From the employee's **own mailbox** to HR, Pradeep on BCC. Certificate attached up to 3 MB; larger files are linked. |
| Decision | A **reply in the same thread** to employee and HR, with the approver's note. |
| Withdrawal | Also a reply in that thread, so HR has **one thread per leave**. |

The one-tap `admin1@aahaas.com` account has no mailbox; when it approves, the decision comes from the HR mailbox instead. That case was tested.

> **Blocked, and it needs someone with Entra access:** the Microsoft 365 app **does not have `Mail.Send`**. I read the live access token and it holds only `Mail.Read`. In Entra, open the app's API permissions, add **`Mail.Send` as an Application permission**, and grant admin consent. *Settings → Leave* has direct links, the permissions the app holds right now, and a **send test email** button. Anything raised before then can be re-sent from Approvals with one click.

> **Recipients — please check:** I set **To** `hr@aahaas.com` and **BCC** `pradeep.kumar@aahaas.com` (Managing Director). The directory also has `pradeep.kumar@bcdtravel.lk`, which may be what "BCD" meant. HR can change this in Settings → Leave.

**Verification:** type-check and production build pass. The built app was run locally against the real routes — a backdated medical leave with a certificate, approval, and a later document upload all worked; wrong file types, overlapping leave, weekend-only leave, leave too far back, and one employee acting on another's leave were all refused; email attempts failed as expected and the reason was recorded; light, dark and phone layouts check out. Test data was deleted afterwards. **Not tested: a real sent email and its threading, which needs `Mail.Send` first.**

---

## 9. Online Work — the rest of the day

| Commit | What landed |
|---|---|
| `15ce3a6` | **✦ Import from text** beside *Add a task* on Daily filing: paste a write-up, review the tasks it finds, then add them to the day, or add and submit in one step. Both readers tested on the sample; **the popup has not been clicked through in a browser**. |
| `6c83459` | Sidebar and mobile navigation: new icons and animations (~440 lines). |
| `965bdc9` | Demo sandbox config updated for the removed demo accounts. |
| `2fa219e` | **Mail & Teams panel** on every employee page, under the Employee ID / Working shift row, opening on today's figures. **Not opened against the tenant** — that needs an admin session, so please click through it once before relying on it. |
| `f577110` | **Staff are enrolled in the monitoring roster automatically.** Sajid will be picked up next time his page is opened. **Not run against production — the first thing to check is whether the server can write `.data/monitoring.json`;** if it can't, the panel shows that error instead of data. |
| `50159dd` | **Hide sample data** switch moved into Settings, in the Demo data panel above Add/Remove. |
| `a857f9c` / `b6a5ab8` | **Departments and profile photos:** add departments, assign people, choose a head, open each department's details; avatar upload on the account page. Every new database statement was checked against the live schema **without running any writes**. Neither feature has been clicked through in a browser. |
| `2ee9212` | **Web check-in.** People with no desktop agent (Sasindu on a Mac) can mark attendance from a card on *My day*, under the greeting. **I did not click the button myself, because that writes a real attendance row.** |
| `1d96610` | **Sign-in page:** a Windows PC setup download card (opens the SharePoint link), **the HR button removed** from the page *and* from the server's list, and the **Admin button now asks for a security code** in a popup — wrong code shakes the field and clears it. The code lives server-side in `quick-signin.ts` and is checked in the route, so **it never appears in the page source** (confirmed). The existing rate limit still applies, so wrong attempts count. |
| `bdea57d` | Sign-in page backdrop: eight travel photos as a moving slideshow. Checked from screenshots of the built app in light and dark mode; it reached the third scene (Sigiriya) on its own. |

---

## 10. Task Manager — pasting a write-up gives tasks, not fragments

`1af93c0` `def08f4` · ~930 lines

Pasting the sample now gives **10 tasks, one per `TASK n:` block**, in both *Paste free-form text* and *Paste a tracker table*. Before, every line became its own item — including `Kind of Work: Testing`, `Priority: Normal`, `Reference: …` and the `---` separators — so 10 tasks came out as dozens of fragments. The block reader lives in the new `src/lib/taskBlocks.ts`; the daily-updates new/history screens were reworked alongside it.

---

## 11. Verification summary

- **Accounts System:** PHP syntax checks pass, Blade views compile, routes register. **16 payment tests (8 B2B new, 8 B2C existing) pass on in-memory SQLite.** The activity-split and old-amendment changes were run on made-up rows with no database. **No new board has been opened against real data from my machine** — the production and B2B databases both time out from here.
- **Online Work:** type-check and production build pass throughout. Leave was exercised against the real routes on a local build of the app, with test data deleted after. New database statements were checked against the live schema **without any writes**. Several screens (Mail & Teams, departments, avatars, web check-in, the task-import popup) have **not been clicked through in a browser**.
- **Task Manager:** both readers tested on the real sample text; type-check passes.

---

## 12. Follow-Up Items

1. **Run the three migrations, in this order, with a backup and a `--pretend` preview first:** `2026_09_22_100000_create_user_page_preferences_table`, `2026_09_22_120000_create_b2b_booking_payments_table`, `2026_09_22_160000_create_b2b_ticket_payments_table`. **None have been run.** Until each runs, its board works as before and says payments aren't set up.
2. **Open `/b2c/invoices`, `/b2b/bookings` and `/b2b/tickets` once on the server** and check a few rows against what you know is true. None have met real data.
3. **Open `/invoice-payments` for 22/09/2026** and confirm two things: the **Old updates count drops** (VN41530 once, at R15), and the **credit / non-credit cards add up to New + New updates**. The next daily mail carries the old-amendment fix.
4. **Retry Confirm Cancellation on booking 14219** once `719e273` is deployed. Nothing was saved when it failed, so the retry is safe. **Then tell me whether 14219's B2C invoice is `AHS-14219`** — if it is, the cancel screen still won't find it and I'll add that lookup.
5. **Confirm the two B2B Tickets decisions** in §7: sell price as a ticket's value (and what a reissue's cost represents), and separate ticket / booking ledgers.
6. **Add `Mail.Send` as an Application permission in Entra and grant admin consent**, then use the *send test email* button in Settings → Leave. Until then no leave email leaves the building.
7. **Confirm the leave recipients:** `hr@aahaas.com` To, `pradeep.kumar@aahaas.com` BCC — or is `pradeep.kumar@bcdtravel.lk` what "BCD" meant?
8. **Before deploying Leave:** `WORKDAY_PATH` must be a **persistent volume** (leave data and documents live there with the filings), and set `PORTAL_URL` if email links show the wrong address.
9. **Security, please action:** `web/.env.local.example` is **tracked in git and holds real credentials** — database password, OpenAI key, Graph client secret and AWS keys. **Rotate them and remove them from the repo.**
10. **Check the monitoring roster write** on production: if the server cannot write `.data/monitoring.json`, the Mail & Teams panel shows that error instead of data.
11. **Click through in a browser once:** Mail & Teams, departments, avatars, web check-in and the Daily-filing import popup. None have been opened in a browser against your data.
12. **When a sidebar link is added, add its key to the sidebar list in `config/access.php`**, or it gets no Page Master switch.
13. **Still open from 21 Sep:** the `/pnl/db` wide-window timing, whether the P&L strip needs a *sweep this window* button, the Online Work production `.env` clean-up, the passwordless-Admin decision (now partly answered by the security code), audit row id 19, and the Task Manager department scoping for Leader-created projects.
14. **Still open from 19 and 15 Sep:** the `admin@aahaas.com` password decision, `AUTH_SECRET` in the deployment environment, the five live indexes, `DB_READ_HOST` in Amplify, Checklist VN's tables on live, and the Task Manager team backfill.
