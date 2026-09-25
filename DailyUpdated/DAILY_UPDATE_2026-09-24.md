# Daily Work Update — 24 September 2026 (Thursday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 24 Sep 2026 (Cross-system: Checklist VN 2.1v — the Excel checklist mirrored into OPS every 2 hours and read by Accounts; Accounts: Checklist VN 2.1V board, PNL-page checklist popup, B2C carry fix, OLD AMENDMENTS P&L columns, "Under Development" page flags; Online Work: admin attendance register and corrections, employee records with completeness %)

---

## Executive Summary

Today was built around **Checklist VN 2.1v**: the Vietnam team's Excel checklist, which they keep working in, is now **copied into OPS every 2 hours and shown in both systems**. OPS stores it in four new tables and shows it on every Vietnam booking and on a new board. Accounts reads OPS's copy **read-only** and adds a board of its own, with a **Sheet vs P&L** comparison and a per-vendor view, plus a popup on the PNL page.

**Nothing is ever written back to the Excel file.** Every sync downloads a copy of the workbook, and OPS never opens it for editing, so nothing the team types can be changed from OPS. The reading code was tested against today's real file: **3,756 tours and 29,910 payment lines in about 2 seconds**, and VN42199 matches the screenshot exactly.

**One database script is written and has not been run on live.** It only creates four tables. Until it runs, OPS has nothing to show and the Accounts board has nothing to read.

The Accounts board went through **four rounds of fixes this afternoon** after testing on the server: a database connection that had never been used in production, a MariaDB reserved word (`lines`), and a clash with Bootstrap's `row` class that broke the table layout. **Each fix has been pushed, but the last three have not been seen working after a deploy.**

Also in Accounts: the **B2C report** stops pulling in storefront orders from earlier days, the **OLD AMENDMENTS** sheet gains P&L Cost and Profit, and super admins can now **flag a page as "Under Development"**.

In **Online Work**, two larger pieces: an **admin attendance register** where each correction is logged with a reason, and **employee records with a completeness score** across 70 fields and 19 document types.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 1 commit | `LIVE-1.0.0v` | Clean · up to date with origin |
| Accounts System | 9 commits | `REV1` | Clean · up to date with origin |
| Aahaas Online Work | 2 commits | `main` | Clean · up to date with origin |
| Aahaas Task Manager | No work today | `main` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

> **About the commit messages:** several of today's messages say *"nothing committed or pushed yet"*. That was true when each message was written. **Every change listed here is now committed and pushed**, because this workspace commits and pushes on its own. Before deploying, check what is on the remote.

---

## 1. OPS — Checklist VN 2.1v: the Excel checklist mirrored into OPS

`d0d7847` · 25 files · +3,647 / −14 · **needs a database script**

### 1.1 Before it works on live

From `apple-holidays/`:

```
bash prisma/sql/apply-vn-checklist-sheet.sh --check   # shows which database it will run on, runs nothing
bash prisma/sql/apply-vn-checklist-sheet.sh           # creates the 4 new tables (asks first)
```

It **only adds four new tables** and changes or deletes nothing that exists. After that, press **Sync now** in Settings. The first sync loads about **30,000 lines**.

### 1.2 What is stored

Four tables: **each tour** (agent, pax, dates, itinerary, revenue, Total VND, total estimate, PNL, margin), **each payment line** (details, vendor, code, unit × qty, total, Paid), **a log of every sync**, and **a record of changes** between syncs.

### 1.3 How syncing works

* **Every 2 hours.** On live, a scheduled job in `vercel.json` runs the sync. If someone opens the checklist and the copy is more than 2 hours old, a sync also starts by itself.
* **If the file hasn't changed since the last sync, nothing is downloaded.**
* **Only tours that actually changed get rewritten.**
* **A tour removed from the sheet is marked "removed", never deleted.**

### 1.4 Where it shows

* **Booking page:** a new section at the end of every Vietnam booking. The header shows when it last synced (green / amber / red) and has **Sync now**, **Download this tour** and **Open in Excel**. Below it: cards for revenue, Total VND, total estimate and PNL with a margin ring; a payment progress bar (ACT paid / Tina paid / India / Check / not marked); a cost breakdown by code; a searchable list of payment lines you can filter by status; and **a history of what changed between syncs**, such as *"Paid: Check → ACT paid"* or *"1 line added"*.
* **Board:** a new sidebar page, **Checklist VN 2.1**, at `/dashboard/checklist-vn/sheet`, so VN Ground users can open it without changing the access rules. It lists every tour, with filters for month, agent, not marked, Check, fully paid and loss-making. Each tour expands to show its lines and links to the booking where OPS has one.
* **Settings → "Checklist VN 2.1v (Excel)":** change the Excel link (admins only), which tabs to read, how often it syncs, and whether automatic sync is on. There is also Sync now, a download of the original Excel or of OPS's stored copy, and the recent sync history.

### 1.5 Things to know

* **Tabs read:** only *Checklist 2026* and *Checklist 2027*. The *sheet* tab has its columns shifted, so it is left out. Any tab can be added in Settings.
* **Tours that don't match a booking:** 6 tour codes are not booking numbers (for example *"Business Trip 01 – Tina"* and AHS codes). They are stored but won't appear on any booking page. **Combined codes such as VN15137/VN17876 show on both bookings.**
* **Change history was tested** on a copy of real tour data, with one line marked paid, one added and one removed. It reported each change correctly.
* **Your earlier message was cut off** (*"I need to see this in that new component and…"*). I took it to mean the board page. **Tell me if you meant something else.**

**What I checked:** type check and lint pass on everything changed. The 3 type errors the project already had are in files I didn't touch. **I have not run the app or a full sync against a database**, because there isn't one I can reach from here. This commit also carries the 22 and 23 Sep daily updates.

---

## 2. Accounts — Checklist 2.1 popup on the PNL page

`49fbdc1` · 5 files · +568

Every **Vietnam row on `/pnl/db`** now has a **Checklist 2.1** button. It opens a **view-only** popup showing the same checklist as the OPS booking page. It shows the header with sync status, **Open in OPS** and **Open in Excel**; tour details; the figures and margin ring; the payment bar and cost-by-code breakdown; the lines with filters and search; and the changes feed. **If the lines don't add up to the sheet's Total estimate, it shows a warning.**

**How a PNL row finds its tour:**

1. **By IS number.** `VN 42205` and `VN42205` both work, and so do combined codes.
2. **If that fails, by quotation number.** The sheet's agent-ref column holds `<quotation>CNTL` (VN42199 → `496565CNTL`). Rows with no IS number, such as **496720** from your screenshot, can still find their tour, and **the popup says when it matched this way.**

**Safety:** Accounts reads OPS's copy of the checklist and **copies and writes nothing**. The button is covered by the PNL page's own permission, and it doesn't appear on non-Vietnam rows.

**New files:** `SheetMirrorReader.php`, `ChecklistSheetController.php`, `checklist-sheet-modal.blade.php`.

---

## 3. Accounts — Checklist VN 2.1V board

`277d0c1` · 9 files · +972 · then fixes in `aa672e3`, `d44c7ee`, `4a7d54b`, `e0f5003`

A new page under **Payable** in the sidebar, at `/checklist-vn21`. It reads the same OPS tables the OPS board uses, **read-only**.

### 3.1 What's on it

* **Summary banner** in the OPS style: tour count, when OPS last synced, when the sheet was last edited, **Open in Excel / Download Excel**, and totals for Revenue, Total VND, Estimate, PNL and % of lines paid.
* **Three tabs**, all sharing the same search, month and agent filters:
  * **Tours** — the OPS board plus a **Sheet vs P&L** column. Each tour is matched to Accounts' stored P&L (latest revision) and shows *Revenue matches*, a variance chip such as **+$12.40**, or *No P&L*, with a link to that P&L. **A Sheet ≠ P&L filter and a red tile in the banner list the tours that don't match.**
  * **Vendors** — the amount owed per vendor, split into paid (ACT / Tina), on Check, and not marked, with a bar for each. Click a vendor to see their lines across tours.
  * **Changes** — a day-by-day feed of what the desk changed on the sheet, covering anything from the last 24 hours to the last 30 days.
* Clicking any tour, vendor line or change opens **the same popup as the PNL page**.
* **Export view** downloads the current filtered view as Excel: the tours with the P&L comparison, and every line.
* **Access:** its own permission, **"Checklist VN 2.1V"**, separate from Checklist VN 1.0V and *Check List — Vietnam*. Super admins see it straight away. For anyone else, tick it in Roles/Users.

**Matching rule:** by IS number, trying both spellings, then by the quotation number from the `…CNTL` agent ref. **A revenue gap under $1 counts as a match.** Tours whose P&L isn't in USD show the currency instead of a comparison.

### 3.2 The fixes after it was tried on the server

| Commit | Problem | Fix |
|---|---|---|
| `aa672e3` | *"Could not load the checklist"* | The page read through **`ops_read`**, a connection no other Accounts code uses and which had never worked in production. **It now uses `ops`**, the connection that Checklist VN 1.0V, cancellations and suppliers already use successfully. If it still fails, **the page now says why** (e.g. *"the OPS database did not answer"*) and logs the full error to `laravel.log` under `[ChecklistVN 2.1]`. |
| `d44c7ee` | Slow P&L lookup could block the whole board | **The board now loads from the checklist tables alone.** The Sheet vs P&L column is filled by a second request (`recon`), so a slow or failing P&L lookup can't stop the checklist from showing. `pnl_records` has no index on `is_number` and holds email bodies, so Vietnam P&Ls are now **read once into a map (eleven short columns) and cached for 15 minutes**. All matching then happens in memory. |
| `4a7d54b` | **MariaDB error 1064** | `lines` is a reserved word in MariaDB, and a column alias was named `lines` without quotes. **Every hand-written alias is now back-ticked** (`` AS `lines` ``, `` AS `open` ``). Also fixed: vendor names with trailing spaces (*"Go Air"* / *"Go Air "*) and blank names no longer show as duplicate rows. |
| `e0f5003` | Every table cell dropped onto its own line | The rows had the class name `row`, which **Bootstrap treats as a layout container**. OPS uses a different styling library, which is why the same markup looked fine there. Rows now use their own class, the *Sheet vs P&L* tile no longer clashes with Bootstrap's `alert` class, and the summary cards shrink instead of running off the right edge. |

### 3.3 Added to the Tours tab in `e0f5003`

* **Arrivals calendar:** one bar per day of the month. Bar height is tours arriving that day, **green shows lines paid, amber shows lines on Check**, a **red dot** marks a day with a loss-making tour, and today is highlighted. Click a day to filter the board to it; click again or ✕ to go back to the whole month.
* **Expand a tour in place:** the chevron shows that tour's payment lines under its row, **warns if they don't add up to the sheet's own total**, and has a *Full checklist* button.
* **Agent badges:** each agent gets an initials badge, always in the same colour.
* **Arrival status:** *in 3 days*, *tomorrow*, *on tour* or *completed*.
* Column headings stay visible while you scroll, and the row you hover or open is highlighted.

**What I checked:** PHP syntax passes, all new routes register, the pages build, and the page and popup JavaScript pass a syntax check. I printed the SQL of every board query offline to check the quoting. **All the queries only read.** **I have not seen the fixed board rendered with real data.** The live database doesn't connect from this machine. **After deploying, expect September's 458 tours, the same as the OPS board.**

---

## 4. Accounts — B2C report no longer pulls in earlier storefront orders

`869e8e4` · `PnlInvoiceParity.php` · +28 / −2

**The bug:** an Aahaas storefront order placed late on the 21st and invoiced on the 22nd was **counted on the 22nd's report** (**AHS-14531**, ordered 21/09/2026). This happened because the "carry" that brings forward P&Ls billed today but dated earlier also applied to storefront orders.

**Why the carry exists:** the Apple System **keeps a booking's original created date when it bumps a revision**, so an amendment billed today has a P&L dated weeks ago. A storefront order has no such gap. Its date is the checkout date and is never changed, and the B2C Sync Ledger builds each day from that same date.

**The fix:** storefront-channel P&Ls are **removed from the carry before it is merged in**. The Apple System carry is untouched. Because it lands in one place, **it fixes all three places that use it**: the B2C mail, its attached workbook, and the Period Activity strip on `/pnl/db`. The Aahaas B2C report now means exactly *"orders placed on this day"*, which is also the definition its count check uses.

---

## 5. Accounts — P&L Cost and P&L Profit on the OLD AMENDMENTS sheet

`3642228` · `ActivityTabs.php` · +3 / −1

The **OLD AMENDMENTS** sheet now has **P&L Cost** and **P&L Profit** next to P&L Value, in the same order and money format as *TODAY NEW & UPDATED*. The row data already held both figures, so only the header list, the row array and the money-format column list changed. The totals block under the table already printed Value / Cost / Profit. **No report was sent to check the sheet.**

---

## 6. Accounts — "Under Development" page flags

`b7992b7` · 6 files · +819 · new `PageDevelopment.php` and `under-development-notice.blade.php`

In **Settings → Pages**, super admins can now **mark any page as under development and add a note**. Flagged pages show a notice to users, which they can dismiss. Saving goes through a new `saveDevelopment` endpoint on `PageMasterController`, which only super admins can use, and the page list now returns each page's flag and note.

---

## 7. Online Work — admin attendance register and corrections

`d20e823` · 14 files · +2,015 / −127

Attendance is now **one register per day**. Admins and HR can pick any date in the last two years. The date is in the URL, so a day can be shared as a link.

* **Correcting one person:** a correction sheet shows **the record as it is next to the record after this correction**. It has status chips that explain what each status means, arrival time, hours on the clock, and **a reason, which is required**. **Overtime is worked out from the hours and can't be typed.**
* **Bulk:** select people, one status and one reason. A Poya day for forty people is one action, but it **still logs forty separate entries, each with that person's own previous value**.
* **"Nothing filed" is counted separately from "Absent"**: one is missing data, the other is a finding about a person. Filling those gaps is the main purpose of the screen.
* **Active, idle and locked time cannot be edited.** They are measured from the keyboard, and a hand-typed value there would look like a measurement. The panel explains this instead of showing an input.
* **Every change writes to `attendance_adjustments`** (old → new, who, why) and sets `is_adjusted`. The existing web check-in SQL already respects that flag, so **a day marked by hand is never recalculated over the top of the person who signed it off**.

**Verified:** all 7 SQL statements were prepared (PREPARE only, nothing executed) against the live database, and both tables exist. **Nothing was written.**

---

## 8. Online Work — employee records with completeness %

`d5ac321` · 20 files · +3,550 / −14

**The design:** the employee record is defined once, as data, and the form, validation, completeness score, access rules and history labels are all built from that definition. That gives **70 fields in 6 sections and 19 document types**. **Adding a field is one line, and a field can't be partly added.**

* **Completeness ring** on the record page, a summary card on the employee page, and **a sortable column across the whole directory**, so *"who has an incomplete file"* becomes a work list. Required fields count 3× as much as recommended ones, and optional fields count for nothing, so the score reflects what actually needs filling in.
* **Documents are listed by what the file needs, not by what was uploaded.** Missing required types are as visible as filled ones, and **an expired document counts as missing**. The file type is read from the file's contents, not from its name.
* **Restricted sections are removed on the server.** A team lead's browser never receives a salary figure or account number, and their score is labelled *"partial view"* instead of looking like the whole file.
* **Salary and career history are built from the edit trail, not stored separately**, so they can't contradict the current figure.

**Verified:** type check clean and the production build passes. A logic test (run, then removed) confirmed: empty = 0%, complete = 100%, an expired document lowers the score, HR sees 124 points against a team lead's 88, and validation rejects a toddler's date of birth, a status not on the list, and a bad phone number.

> **Three scope decisions to review:**
> 1. **Work/attendance and leave are linked, not copied.** Shift, attendance, filings and approvals already hold that data. Leave entitlement fields (annual / casual / medical / no-pay / parental) were added, with **days taken counted in working days from approved leave**.
> 2. **Annual and casual are shown as one pool.** The leave form asks *what kind* of leave (whole day, half day, two hours, medical), not which allowance it comes from, so splitting them would be a guess. **One extra field on the leave form would make it exact. Say the word.**
> 3. **Records are stored as JSON under `.data/hr/`**, following the existing workday and departments stores. `db.ts` is read-only by design and the schema belongs to the ASP.NET API, so adding 120 columns from here would make the two diverge.

---

## 9. Verification summary

- **OPS:** type check and lint are clean on every file changed (the 3 project-wide type errors are older and in files I didn't touch). The sheet reader was tested against today's real workbook (**3,756 tours / 29,910 lines, about 2 s**), and the change history was tested on a copy of real tour data. **No full sync has been run against a database, and the app has not been run.**
- **Accounts:** PHP lint and route registration pass, Blade views build, JavaScript passes a syntax check, and every board query's SQL was printed and checked offline. **Nothing has been seen working with real data.** The live database doesn't connect from this machine.
- **Online Work:** type check and production build pass for the records work. The logic test passed. The attendance SQL was prepared against live without writing anything.
- **Nothing was written to the Excel workbook or to any live database today.**

---

## 10. Follow-Up Items

1. **Run the Checklist VN 2.1v script** from `apple-holidays/`: `--check` first, then the script. It creates four tables only. Then press **Sync now** in Settings (about 30,000 lines on the first run).
2. **Deploy Accounts and reload Checklist VN 2.1V.** Expect **September's 458 tours**. If it fails, send me the message on the page or the `[ChecklistVN 2.1]` line in `laravel.log`.
3. **Click-test the PNL popup:** **VN42205** (matched by IS number) and **496720** (no IS number, matched by quotation).
4. **Give the Checklist VN 2.1V permission** to non-super-admin users in Roles/Users.
5. **Confirm what the cut-off message meant** (*"I need to see this in that new component and…"*). I built the board page.
6. **Decide whether to split annual and casual leave.** It needs one field on the leave form.
7. **Check the remote before deploying.** This workspace commits and pushes on its own, so some commit messages say "not committed" when the change is in fact on the remote.
8. **Still open from 23 Sep:** the Vietnam agenda includes and Vietnam Booking Checklist scripts; Azure write access to OneDrive for Manual Products; the SIC Tour / Payable 1.1 / USD-estimate choices; whether invoice generation should use a held invoice value; SG 40053 before anyone refreshes it; where else ops write "test"; a browser check of the 23 Sep OPS work; and a type check for `eb6d988`.
9. **Still open from 22, 21, 19 and 15 Sep:** the three payment migrations, `/b2b/pnl` against real data, `Mail.Send` in Entra, the leave recipients, `WORKDAY_PATH` persistence, **rotating the credentials tracked in `web/.env.local.example`**, `/pnl/db` wide-window timing, the Online Work production `.env` clean-up, audit row id 19, Task Manager department scoping, the `admin@aahaas.com` password decision, `AUTH_SECRET`, the five live indexes, `DB_READ_HOST` in Amplify, and the Task Manager team backfill.
