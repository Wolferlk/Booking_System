# Daily Work Update — 25 September 2026 (Friday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 25 Sep 2026 (OPS: MC Report detail columns and Tickets Control, Daily Operations Report with D-3 Driver Allocation and Reconfirmation Status, passenger Special Notes, multiple files per ticket, searchable Service Type and full Meal Plan names, light Live Operations; Accounts: Bank Settlements, Minimum rates in Checklist VN 2.1V, period Excel export on Invoice Payments, B2B tickets board matched to the mail)

---

## Executive Summary

Most of today's OPS work went into **the MC Report and the booking agenda**. The MC Report gains a **Tickets Control** column for Vietnam and a set of **Sri Lanka / Singapore / Malaysia columns**: flight details, vehicle type, budget and actual KM, package cost, budget transfer, meal preference and special request. It also gets new summary tiles and a **Columns** button. On the agenda, **Service Type** and **Meal Plan** are now searchable and accept typed-in values, and Meal Plan shows full names ("Breakfast, Lunch") instead of codes.

The **Daily Operations Report email** has a new **D-3 Driver Allocation** section and a **Reconfirmation Status** section (Completed / Pending) that replaces the old D-10 section. **Cancelled files, including pending cancellations, and accommodation-only bookings are no longer counted.**

Also in OPS: a **Special Note per passenger** on the booking page, **any number of files per ticket**, and a **light-themed Live Operations** section with a daylight map.

In Accounts, the largest piece is a new **Bank Settlements** page that uploads bank statements for 9 accounts, checks their balances line by line, and matches each line against receipts, payables and ledgers. **Checklist VN 2.1V now shows minimum rates** from the Vietnam Products Cost sheet. **Invoice Payments** has a period Excel export, and the **/b2b/tickets** board now shows the same tickets as the daily email.

**Five database scripts in OPS and two Accounts migrations have not been run on live.** Until they run, the new typed-in fields show a "not set up on this database yet" message and the rest of each page works as before. The full list is in Section 13.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 8 commits | `LIVE-1.0.0v` | Clean · up to date with origin |
| Accounts System | 6 commits | `REV1` | Clean · up to date with origin |
| Aahaas Online Work | No work today | `main` | Clean · up to date with origin |
| Aahaas Task Manager | No work today | `main` | Clean · up to date with origin |
| AHS | No work today | `sewminiV3-UI-changes` | Clean · up to date with origin |

> **About the commit messages:** several of today's messages say *"not committed or deployed yet"*. That was true when each message was written. **Every change listed here is now committed and pushed**, because this workspace commits and pushes on its own. Before deploying, check what is on the remote.

---

## 1. OPS — MC Report: Sri Lanka / Singapore / Malaysia detail columns

`ac6949f` · 9 files · +1,278 / −8 · **needs a database script**

### 1.1 The new columns

| Column | Where | Where the data comes from |
|---|---|---|
| **Flight Details** | Sri Lanka | The booking's flights. A flight on that row's date shows as a coloured card: **green for arrival** (with landing time), **blue for departure**. Every other row shows the tour's arrival and departure as a small grey line. |
| **Vehicle Type** | Sri Lanka | The movement's own vehicle. If none is set, it falls back to the driver's registered vehicle, then the allocation board, shown in grey italics. |
| **Budget KM / Actual KM** | Sri Lanka | Typed on the report. Actual KM gets a red **"+15 km over"** or green **"under"** tag. |
| **Package Cost (LKR)** | Sri Lanka | Typed on the report. |
| **Budget Transfer** | Singapore / Malaysia | Typed on the report, in SGD or MYR by country. |
| **Meal Preference** | All | Passengers grouped, e.g. *"Vegetarian ×2"*. Hover to see names. |
| **Special Request** | All | The booking's Client Request, Occasion and passenger Special Notes as an amber note, plus a box to type a request for that movement only. |

### 1.2 Around the table

* **New summary tiles:** Sri Lanka arrivals and departures, KM actual vs budget (red when over), total package cost, budget transfer per currency, and how many bookings have special requests or meal preferences. **Each tile only appears when there is data for it.**
* **Columns button:** each person can hide columns they don't use. The choice is remembered in their browser.
* **Whole-tour hints:** when the Sri Lanka settlement sheet has tour figures saved, they show greyed out in empty cells (e.g. *"Tour 85,000"*). **They are never counted in the totals.**
* **Row details:** clicking a row shows the full flight list, all special requests, meal preferences with names, and who last changed the figures.
* **Search and exports:** the deep search covers flight numbers, meal preferences and requests. CSV and Excel exports include all the new columns, and the Excel summary sheet has the new totals.
* **Editing:** the same as Tickets Control. Anyone with agenda edit access clicks a cell, types and presses Enter. **Saving a movement chart keeps the figures on the same movements.**

### 1.3 Bug fixed in Tickets Control

Pressing **Esc** in a Tickets Control cell was **saving** what had been typed instead of undoing it. Fixed there and in the new cells.

### 1.4 Before it works on live

From `apple-holidays/`:

```
bash prisma/sql/apply-agenda-mc-details.sh --check   # shows which database it will run on, runs nothing
bash prisma/sql/apply-agenda-mc-details.sh
```

---

## 2. OPS — MC Report: Tickets Control column (Vietnam)

`7388ae1` · 8 files · +354 / −1 · **needs a database script**

* **When it shows:** at the end of the table, after Driver / Vendor, whenever a Vietnam booking is in view. Other countries' rows show "—" and can't be edited.
* **Editing:** click the cell, type, then Enter or click away to save. Up to 255 characters. Anyone with agenda edit access can edit; everyone else sees it read-only.
* **Exports:** included in CSV and Excel.
* **Survives chart saves:** saving an agenda deletes and re-creates all its movements, so a plain field would be wiped on every save. **The note is kept in its own table and moved to the re-created movement automatically.** If a movement is removed or the chart is regenerated with AI, its note stops showing but is not deleted.

**Script:** `bash prisma/sql/apply-agenda-tickets-control.sh --check`, then without `--check`. It only creates one table, `agenda_tickets_control`.

---

## 3. OPS — Daily Operations Report: D-3 Driver Allocation and Reconfirmation Status

`8d9bc32` · 5 files · +655 / −140 · **no database script needed**

### 3.1 What was wrong before

* **Pending cancellations were showing up.** Only files marked Cancelled were left out. A file waiting on Accounts to approve its cancellation can never reach "Client Confirmed", so it sat on the lists as pending forever.
* **Accommodation-only files** were in the 3-day list and counted as "ready", which made the numbers look better than they were.
* **"Reconfirmed on time" was inaccurate.** It included Hotel Only files and tours that weren't due yet.

### 3.2 D-3 Driver Allocation (new, placed before the readiness section)

* **Only tours we actually move are counted.** Left out: cancelled files (including pending cancellations), accommodation-only bookings however they were marked (Hotel Only flag, Sri Lanka's "hotel only" vehicle, or every movement marked hotel only), and tours with no transfers in the agenda, which are counted separately.
* A main card shows fully allocated tours, transfers covered, and a bar for **Allocated / Part-allocated / No driver**.
* **One card each for D-1, D-2 and D-3.** Tomorrow's card turns red if anything is still open.
* **Needs a driver** lists each tour with its day, B2B/B2C, a coverage bar (e.g. 2/5) and what's missing. Fully allocated tours show as small green tags.
* A footnote says what was left out (e.g. *"3 cancelled · 2 accommodation only"*), so a smaller number isn't mistaken for missing data.

### 3.3 Reconfirmation Status (replaces the old D-10 section)

* Covers tours arriving **today through the next 10 days**, without cancelled and Hotel Only files, so **Completed + Pending = exactly the guests who still need reconfirming**.
* **Completed** = client confirmed or pre-tour call logged (the same rule as the Ops Board), split into client + call, client only and call only.
* **Pending** is sorted overdue first, then due today, then by how soon the 10-day deadline falls. Overdue rows show the team's recorded reason, or *"No reason recorded"*.
* The late-reasons table and the red warning for late files with no reason are kept.

### 3.4 Other places updated to match

The dark summary strip now shows *D-3 drivers 3/7* and *Reconfirmed 3/6*. The CSV attachment has two new blocks, and the preview drawer and weekly/monthly workbook description use the new wording.

> **Two things you might want changed:**
> 1. A tour with **no agenda yet** stays on the driver list as pending, because no driver can be allocated until the movements exist.
> 2. The weekly/monthly **reconfirmation and readiness rates** now leave out Hotel Only and cancelled files too, so they **may drop slightly** compared with earlier weeks.

**What I checked:** type check and lint are clean. The layout was checked by rendering the email with made-up data in headless Chrome. **It has not been run against real bookings, so please check tomorrow's email.**

---

## 4. OPS — Special Note per passenger

`e5a7a0f` · 8 files · +480 / −1 · **needs a database script**

* **"Special" chip** with a pulsing dot next to the passenger's name, beside "Lead", and an amber ring on their avatar.
* **The note** shows under the passenger in a card labelled *SPECIAL NOTE*, **even when the meal section is closed**, with who wrote it and when.
* **Card header** shows *"✦ 1 special note"* next to *Passengers*.
* **Adding / editing:** open the passenger, click *+ Add special note*, type (up to 1,000 characters) and Save or Ctrl/⌘+Enter. The pencil edits or removes it. Same permission as editing passengers; everyone else can read it.
* **Survives passenger re-saves:** Edit Passengers, mail and OneDrive re-imports, and version restores all re-create passenger records, so **the note is stored against the booking plus the passenger's name**. Titles, capitals, spacing and punctuation don't matter. It is only lost if the name is actually spelled differently.
* These notes also feed the **Special Request** column on the MC Report (Section 1).

**Script:** `bash prisma/sql/apply-passenger-special-notes.sh --check`, then without `--check`.

---

## 5. OPS — Multiple files per ticket

`bed2bdf` · 9 files · +508 / −1 · **needs a database script**

* Every ticket card has a **Ticket files** section with **Add ticket files**: several PDFs or images at once, up to 30 per upload, 10 MB each. For example, 10 guests' tickets under one ticket.
* Files show as a numbered list; click to open, **pencil to rename** (e.g. to the guest's name), bin to remove.
* Same Ground Team roles that can already upload receipts. **The existing single receipt works exactly as before.**
* **Not included yet:** the extra files don't appear on the guest trip page or in the automatic WhatsApp ticket sends, because that changes what guests receive. **I can add it if you want.**

**Script:** `bash prisma/sql/apply-ticket-files.sh --check`, then without `--check`. It only creates `ticket_files`. **The dev site uses the test database, so run it there too.**

---

## 6. OPS — Agenda: searchable Service Type and full Meal Plan names

`6ec18a9` · 9 files · +214 / −12 · **needs a database script** · `2d4cb8a` · 4 files · +108 / −44 · no script

**Service Type**

* Click the box and the full list opens; type (e.g. *"tick"*) to narrow it. Arrow keys and Enter pick an option.
* **Type your own** (e.g. *"Boat Transfer"*, up to 64 characters). It is kept as typed with a *Custom type* note, appears straight away on other movements in the same chart, and once saved appears for everyone, most-used first.
* Typing a built-in name in any case (*"private transfer"*) still saves as the proper built-in type, so **SIC timings, driver allocation, reports and exports behave as before**.
* **Script:** `bash prisma/sql/apply-agenda-custom-service-types.sh --check`, then without `--check`.

**Meal Plan**

* The list now reads full names: Breakfast, Lunch, Dinner, "Breakfast, Lunch", Half Board, Full Board, All Inclusive, Room Only / No Meals, plus Local and Indian meals. **Saved codes on old charts display as full names too.**
* The short codes still work as a search shortcut (*"BL"* finds *"Breakfast, Lunch"*), and **typed-in meal plans** are saved and added to the dropdown.
* **No live data is changed.** HB, FB, AI and RO become full names the next time a chart is saved.

---

## 7. OPS — Live Operations: light theme and daylight map

`9c1f496` · 2 files (+ the 24 Sep daily update)

* **"Fleet on the road right now" removed** (the yellow vehicle cards and the *Fleet →* link). The *Vehicles On Road* tile still shows the count.
* **The map opens in daylight.** The toggle switches between Day and Night. Controls, legend, pop-ups and airport labels are white with dark text; flight lines, routes and pins are slightly darker so they stand out.
* **Live Operations section** is light and more colourful: a soft white-sky-amber gradient, pastel tiles with coloured icon badges, a pill-style Arrivals / Departures / On Ground switcher, and light versions of the status badges.

---

## 8. Accounts — Bank Settlements

`02be84c` · 42 files · +7,769 / −2 · **needs 2 migrations**

A new **Bank Settlements** page in the sidebar under **Company**.

* **Tabs:** a Master tab plus **one tab per bank account (9 accounts)**. The Master tab has a month strip per account that **shows missing monthly statements**.
* **Upload with preview:** before anything is saved it shows which account the file belongs to, the balance check, and which lines are new versus already on file. Parsers for **CIMB, ICICI, Indus and UOB**, plus a generic reader.
* **Balance check:** each line's running balance must follow from the line before, which catches missing lines, duplicate uploads and files uploaded on the wrong tab.
* **Matching:** each bank line is matched against **invoice receipts (B2B and B2C), Payable 1.0, the two B2B flight ledgers and the company ledger**. The reference numbers typed when recording payments are the strongest signal. Every suggestion shows its score and reasons.
* **Automatic handling:** certain matches are confirmed automatically and marked **AUTO** (can be undone). Bank charges are marked as explained, and transfers between our own accounts are paired.
* **"In books, not in bank":** payments recorded into an account that its statement doesn't show.
* **AI (OpenAI)** is used only to read transaction descriptions, work out the columns of an unknown format like Combank, and read PDFs. **A PDF is accepted only if its balances check out.**
* **Existing data:** the page only writes to its 4 new tables. **It never changes an invoice, payable or payment record.**

**Tested:** all 7 sample statements read correctly with **0 balance errors**, and the four UOB files' printed totals match to the cent. **16 automated tests pass** on a throwaway in-memory database. **Not run:** the real sample files through the full upload-and-match flow. A safety hook blocked it because the test creates and drops tables, and I didn't work around it.

---

## 9. Accounts — Minimum rates in Checklist VN 2.1V

`ae798a2` · 11 files · +1,459 / −18 · **no migration**

* **Popup has three views: Original / Minimum / Both.** Minimum shows each line's minimum unit price and total with the original crossed out, and the estimate, P&L and margin cards switch to minimum figures. Both shows them side by side with a saving column and two margin rings. The popup remembers the last view.
* A bar shows coverage, e.g. *"8/9 lines on the minimum sheet"*, plus the total saving. **Lines with no minimum keep their original value and get an amber "original" tag**, with a *No minimum* filter.
* **Matching is rule-based, not AI**, so it costs nothing per line and every match traces to a sheet row: exact text → spelling fixes → names the sheet cut off at ~50 characters → close wording. **Numbers must agree** ("1 way" never matches "3 ways"), and shared never matches private.
* **Pax:** on group-priced lines the per-person minimum is multiplied by the tour's pax (*"×4 pax"* tag). **A minimum that is implausibly low is refused** and listed for review, and a minimum never raises a line that is already cheaper.
* **New board tabs:** *Minimum rates* (sheet status, Fetch now / Force re-read, link setting, two strictness sliders) and *Missing minimums* (every item the sheet can't price, the closest sheet row, a suggested minimum, and an Excel export laid out to paste into the sheet).
* **Safety:** the sheet (*Veitnam Products Cost.xlsx*, 1,093 rows) is stored as a file on the server, and the previous copy is kept. The only database write is one settings row for the link, super-admin only. **Display only: the Excel checklist, OPS and P&Ls are never changed.** Re-checked every 6 hours, or by hand with `php artisan checklist-vn21:minimum-rates`.

**Tested:** against the real sheet with VN40750's lines: 8 got a minimum, 1 was already at its minimum, 1 was refused as implausible. All three popup views were rendered in Chrome, which caught and fixed one JavaScript error.

---

## 10. Accounts — Invoice Payments period Excel export

`57efd7a` · 4 files · +298 / −21 · `c637831` · +17

On `/invoice-payments`, **Export Excel** now downloads a workbook in the same format as the auto daily report, for whatever period is filtered:

1. **NEW & SAME DAY UPDATED:** bookings first confirmed in the range, with Type *New* or *Updated (same period)*.
2. **OLD AMENDMENTS:** bookings confirmed before the range and updated in it, with first-confirmed date, age in days, amount before, new amount, change and every revision date.
3. **CANCELLED:** bookings cancelled in the range. The tab notes how many from the range were cancelled after it ended.

`c637831` makes sure every invoice is included in its ledger chain. **Only tested offline with made-up rows.**

---

## 11. Accounts — /b2b/tickets board matches the daily email

`49e2907` · 4 files · +224 / −1 · then `aac08ac` · −164

* **Why the numbers differed:** the email is a snapshot taken just after midnight, while the board re-reads the portal every time. Tickets entered after the send, with an issue date of the 24th, still counted on the board. **That was the extra 5.**
* **The board now follows the email by default** when an email covers exactly the dates on screen: it lists only the tickets in that email's Excel attachment (*"71 documents · as mailed"*). **Status, amounts and payments are still read live.**
* **Show live (+5 since the send)** brings the later tickets back; **Match the mail** returns to the email's set. If the attachment is gone, it falls back to tickets recorded before the send. Export downloads whatever the board is showing.
* `aac08ac` **removed the "What the mail said" section** at your request. The board loads a little faster because it no longer re-reads the portal for that comparison. **Its styling, script and routes are still there but unused. Say if you want them removed.**

---

## 12. Verification summary

- **OPS:** type check and lint are clean on every file changed. The remaining type and lint errors are older and in code I didn't touch (13 lint errors on the booking page predate today). The Daily Operations email was rendered with sample data in headless Chrome, and the Meal Plan code-to-name conversion was tested on sample values. **No OPS page has been opened in a browser today, and the report hasn't run against real bookings.**
- **Accounts:** Bank Settlements has 16 passing automated tests and 7 sample statements checked. Minimum rates were tested against the real sheet and rendered in Chrome. The Invoice Payments export and the B2B tickets board were **not checked against real data**, because the live database doesn't connect from this machine.
- **Nothing was written to any live database today.**

---

## 13. Follow-Up Items

1. **Run the five OPS scripts** from `apple-holidays/`, each with `--check` first. Each only creates new tables. **Run them on the test database too.**
   * `apply-agenda-mc-details.sh` (MC Report detail columns)
   * `apply-agenda-tickets-control.sh` (Tickets Control)
   * `apply-passenger-special-notes.sh` (passenger Special Notes)
   * `apply-ticket-files.sh` (multiple files per ticket)
   * `apply-agenda-custom-service-types.sh` (typed-in Service Types)
2. **Run the two Bank Settlements migrations** in Accounts (`create_bank_settlement_tables`, `seed_bank_accounts`), then upload one real statement per bank.
3. **Check tomorrow's Daily Operations email:** the D-3 Driver Allocation and Reconfirmation Status numbers against the Ops Board.
4. **Browser-check today's OPS work:** MC Report (new columns, Columns button, Esc fix), booking page Special Notes, ticket files, Service Type / Meal Plan boxes, and the Live Operations section.
5. **Decide:** whether ticket files should go to the guest trip page and WhatsApp sends; whether tours with no agenda should stay on the D-3 driver list; and whether to remove the unused "What the mail said" code on `/b2b/tickets`.
6. **Click-test after deploying Accounts:** the Invoice Payments export on a real period, `/b2b/tickets` for 24/09 (expect 71 documents), and the Minimum / Both views on VN40750.
7. **Still open from 24 Sep:** the Checklist VN 2.1v script and first sync, Accounts Checklist VN 2.1V on the server (expect 458 September tours), the PNL popup click-test (VN42205, 496720), the Checklist VN 2.1V permission for non-super-admins, the cut-off message, and splitting annual and casual leave.
8. **Still open from earlier:** the Vietnam agenda includes and Vietnam Booking Checklist scripts, Azure write access to OneDrive, the three payment migrations, `Mail.Send` in Entra, **rotating the credentials tracked in `web/.env.local.example`**, `AUTH_SECRET`, the five live indexes, and `DB_READ_HOST` in Amplify.
