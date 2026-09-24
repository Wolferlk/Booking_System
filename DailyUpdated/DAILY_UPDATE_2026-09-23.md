# Daily Work Update — 23 September 2026 (Wednesday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 23 Sep 2026 (Accounts: Payment History across five ledgers, invoice-value hold on the Detailed P&L, transport route names; OPS: D-7/D-10 and B2B/B2C filters, Cancelled & Test-file switches, Own-Arrangement hotel-name fix, Vietnam Booking Checklist; cross-system: Vietnam agenda includes → separated payables; Online Work: Windows setup guide viewer)

---

## Executive Summary

Today's centre of gravity moved to **OPS (`apple-holidays`)**, which had been quiet for two weeks, and to the **Vietnam workflow that runs across both systems**.

The single largest piece is the **Vietnam agenda includes chain**: a product picker on the OPS agenda, fed by your product sheet (**1,455 distinct products from 1,602 rows**), whose picks then appear on **Accounts Payable 1.0** as separately-payable parts of a line — *"3 parts · 1 paid"*, each with its own Pay button on the existing ledger. On top of that sits the new **Vietnam Booking Checklist**, a costing sheet per booking with a Draft / Checked / Final lock, whose four totals use **the same definitions as the Accounts Checklist VN so the two systems cannot give different numbers**.

**Two database scripts are written and neither has been run on live.** Both only create tables — nothing existing is altered or deleted — and each feature shows a *"not set up"* notice until its script runs.

In the **Accounts System**, **Payment History** merges five separate ledgers into one read-only board with recording where it is safe (receipts, expenses, income) and hard links back to the owning board where it is not. The **Detailed P&L** gained an **invoice-value hold**, built as a third hold on the existing audited mechanism rather than as a new one — and it is documented plainly that **a held value does not rewrite an invoice document**. The *"Transport — Leg 1…4"* naming bug was traced to a real cause and fixed: the Apple API's route list cannot hold the same destination twice.

In **Online Work**, one commit: the Windows setup guide card and its in-page document viewer.

> **One incident worth naming:** a checkout that arrived with commit `ad15e93` (made outside my session at 16:02) **wiped an earlier `ActivityTabs.php` change**. I re-applied and re-verified it, and the P&L *Value With Currency* column is back on disk.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Booking System / OPS | 6 commits | `LIVE-1.0.0v` | Clean |
| Accounts System | 4 commits | `REV1` | Clean |
| Aahaas Online Work | 1 commit | `main` | Clean |
| Aahaas Task Manager | No work today | `main` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

---

## 1. Accounts System — Payment History: five ledgers, one board

`dbc3235` · 6 files · +2,744 · new `PaymentHistoryService.php` (814 lines) and `PaymentHistoryController.php` (447)

### 1.1 What it pulls together

Five ledgers, merged **read-only**:

| Ledger | What it holds |
|---|---|
| `invoice_payments` | Client receipts and refunds, joined to the invoice |
| `payable_payments` | Supplier / hotel / driver payouts with their bank-slip receipts |
| `b2b_booking_payments` | Agency receipts on flight bookings |
| `b2b_ticket_payments` | Per-ticket receipts |
| `company_ledger_entries` | Company expenses — salaries, tax, rent, utilities, daily costs — and income |

### 1.2 Filtering

A date window with 8 presets · money in / out · confirmed vs voided · **ledger toggles with live counts** · currency · payment mode · company category · payable vendor type · payable country · has / missing a receipt · amount range · recorded-by · **full-text search across invoice number, IS number, supplier, guest, reference and remarks** · sort · page size. Active filters show as removable pills and the filter button carries a count.

### 1.3 Recording, not just viewing

* **Attach or replace a receipt on any row** — payable slips, invoice receipts, company bills. It writes only the three attachment columns on that row's own table, and **the old file is deleted only after the new one saves**.
* **Record Expense / Record Income** goes through `CompanyFinanceService`, so it lands on the Company Cost board with its normal audit trail.
* **No amount, date or status is editable here.** The drawer links back to the owning board instead.

### 1.4 Two judgement calls worth your eye

1. **Totals are per currency, not one number.** Only payable and company rows carry an `amount_lkr`; a USD invoice receipt has a rate to the *invoice* currency, not to LKR. Rather than invent rates, the KPI strip shows per-currency in / out plus a separate LKR line that **says out loud how many rows it couldn't cover**.
2. **Company ledger "imported income" rows are excluded by default.** Those `auto_invoice` / `auto_flight` entries are monthly summaries of receipts this board already lists individually, so **counting both would double the income**. There is a filter switch to include them, labelled as such.

---

## 2. Accounts System — Invoice value editing on the Detailed P&L

`d4c0def` · 5 files · +306 / −47 (includes the restored `ActivityTabs.php`)

The sheet already had a **hold** mechanism: the desk states a result figure by hand, it is applied last, audited and undoable. Cost and profit could be held; the invoice value was deliberately excluded. **I added it as a third hold rather than as a new mechanism, so it inherits all the existing safety.**

A new result-block row, **Invoice Value**, becomes an input in edit mode like Total Tour Cost and Profit. It shows a **Held chip** (who, when, why, and what the sheet derived) and a **Release** button that puts the Apple System's own price back.

In `PnlManualLineService.php`:

* **Writes `pnl_records.amount`** — the only thing in either P&L editor that does.
* **Profit follows it.** The invoice value is resolved before cost, so `profit = held value − cost` automatically, unless profit is itself held.
* **Survives an AS re-sync.** The nightly sync overwrites `amount` from the payload and then calls `recalculate()`, which **re-applies the hold immediately after**. Without this, the desk's figure would silently vanish overnight.
* **Release restores exactly** — it reads `pnl.cost.total` back out of the payload, the same cell the sync would have written, falling back to the pre-hold amount the server recorded.
* Refuses negatives, refuses anything over the **10M brake**, **super-admin only**, one audit row per hold, and raises the usual *"amend the booking or keep the edit?"* question.

> **One thing to know before using it: it does not rewrite an invoice document.** I checked the generation path — `AsConfirmationInvoiceService` reads the sell price **live from the Apple System** (`cost.total`), not from `pnl_records.amount`. So a held invoice value re-prices the booking on the PNL board, the P&L reports, the Invoice↔P&L match and the profit — but **a newly generated invoice still comes out at the Apple System's price**, and an already-issued one is edited in Invoice Studio. The UI copy says exactly that rather than overclaiming. If you want invoice generation to honour the held value too, say so and I'll wire it — **it is a deliberate second step, not something I'd fold in silently.**

**Verified:** all four PHP files lint clean and the 5,000-line P&L script parses under `node --check`. Hold arithmetic was exercised directly — no holds / quoted / cost / quoted+cost / quoted+profit all produce the right quoted-cost-profit triples. The anchor whitelist rejects `result:amount`, `cost.total` and empty, and accepts the four real ones. Validation: negative invoice value refused, negative cost still allowed, wrong section refused, out-of-range refused, `original_amount` forced to the server's figure. **No database was touched and nothing was run against live data.**

---

## 3. Accounts System — "Transport — Leg 1…4" on the SG 40053 sheet

`5d615a4` · 4 files · +127 / −9

**Why it printed bare leg numbers:** the sheet names each transport charge by matching it to the Apple API's route list. **That list cannot hold the same destination twice**, so on a longer tour two separate trips into Little India merge into one entry. Four charges then face three routes, the counts don't match, and the sheet gave up and numbered them.

**What changed:**

* **Three sources are tried in order** — the API's route groups first, then the itinerary's day routes (*"Day 3 · Little India → Sentosa"*), then the individual route hops. It uses **the first one whose count matches the charges**. This is in `AsPnlController.php`, with the itinerary passed in from `DbPnlController.php`.
* **It cannot go back to a bare "Leg N."** If nothing matches, the first charge line lists the tour's routes instead. The sheet still **won't attach a route to a charge it can't match**.
* **It covers every sheet.** P&L, Payables and Daily Updates share one detail endpoint, so all three get the fix, as does the AS P&L page, which has its own copy of the code.

**Tested** on **150 live bookings from the Apple API** (27 have itemised transport): all 27 now get route names, where the old code named 26. A rebuilt copy of the six-day SG 40053 layout now shows Changi → Little India (Day 1), Little India → Sentosa (Day 3), Sentosa → Little India (Day 4), Little India → Changi (Day 6). PHP syntax check passes. **The page has not been run in a browser** — the stored copy of that sheet lives on AWS and that database is not reachable from here. **No database was changed**; I read only from the GCP server on a read-only connection and from the Apple API.

> **Before anyone refreshes SG 40053:** the Apple System now holds a **newer 3-day revision** of this booking with 2 transfers — Changi → Little India at 45 and Little India → Changi at 40. Your sheet shows the older 6-day version with 4 × 40. **Clicking *Fetch from AS API* would replace the stored figures with the new ones**, so check that the hand-added Surcharge of 10 still makes sense afterwards. **I did not press it.**

---

## 4. OPS + Accounts — Vietnam agenda includes, and separated payables

`6e92d6d` (OPS, 19 files, +2,320) · `ad15e93` (Accounts, 3 files, +724) · **needs a database script**

One feature that crosses both systems: what the ops desk picks on the agenda becomes what the accounts desk pays, part by part.

### 4.1 Before it works on live

From `apple-holidays/`:

```
bash prisma/sql/apply-vn-agenda-includes.sh --check   # shows the target database, runs nothing
bash prisma/sql/apply-vn-agenda-includes.sh           # asks before running
```

It **only creates two tables** (`vn_include_products`, `agenda_item_includes`) and **alters or deletes nothing that exists**. Until it is run, the agenda page shows *"Includes not set up"* and saves exactly as it does today. **Nothing in the live database was changed.**

### 4.2 OPS — Settings → Vietnam Product Sheet

The new sheet link is the default and can be changed there. **Sync now reads the product list: 1,455 distinct products from 1,602 rows**, duplicate rows merged, and the cleanup strips the `·` and `:` junk from the start of names. **A product that disappears from the sheet is hidden from search but not deleted**, so bookings already using it keep working.

### 4.3 OPS — the agenda (Vietnam SIC Transfer and Private Tour only)

An **Includes panel** sits in the empty space to the right of Details.

* **Search** by the start of each word (*"hal cru"* finds the Halong cruises), filter by code (Trans, Ticket, SIC, Day Cruise…), keyboard-driven. Results show the sheet price and how often each product was used.
* **Suggestions before you type anything**, matched against the movement's activity text — for the Halong SIC movement, the Alova cruise comes first.
* Each include carries a **quantity and a price that can be changed for that booking**.
* **Not listed?** Add a product by hand. It saves straight away and is also written to a new **Manual Products** tab in the same workbook; if that write fails it is marked *waiting* and a retry button appears in Settings.
* **Includes survive chart saves, AI regenerate and amendments.** Any the system cannot put back on a movement are **listed at the top of the page instead of being dropped**.

### 4.4 Accounts — Payable 1.0, Vietnam tab

A line whose movement has includes gets a **"3 parts · 1 paid"** chip and a **Paid separately** panel listing each part: quantity × sheet price in VND, an approximate USD figure at the Checklist VN house rate, whether it is paid, and **its own Pay button**. Each part is paid through **the line's existing payment popup and ledger**, tagged with the part it covers. **Line balances still add up and there is no schema change in Accounts.** If a day has several movements with includes and none clearly matches the line, **the line says so instead of guessing**.

**What I checked:** search and suggestions were run against the real sheet (read only); the Accounts line-to-movement matching was tested with sample lines; the OPS type check and lint are clean on the files changed; PHP lint passes and the Blade view compiles. **I have not run either app, tested save-and-pay end to end, or written to the workbook.** Adding to the Manual Products tab only works if the Azure app has write access to your personal OneDrive, and **I could not confirm that without writing to it**.

> **Choices you may want to change:**
> * **Service types:** it covers **SIC Transfer and Private Tour only**, as asked. SIC Tour can be added with one line in `src/lib/vn-includes/shared.ts`.
> * **USD figures are starting estimates only**, because the sheet prices are the *lowest price paid* in VND. The clerk still enters what was actually paid.
> * **Payable 1.1 still uses its AI split.** I can make it use these OPS includes first if you want.

---

## 5. OPS — Vietnam Booking Checklist

`7414cbe` · 14 files · +2,116 · **needs a database script**

A costing sheet per Vietnam booking, opened from the booking page or from a new **Check List VN** page. The script creates **only two tables** (`vn_booking_checklists`, `vn_booking_checklist_items`) and changes nothing existing; until it runs, the popup shows a *"not set up"* notice and cannot save.

### 5.1 The popup

* A Vietnam-coloured header band with booking, CNTL, agent, pax and dates, and a **Draft / Checked / Final** switch. **Final locks the sheet, and only Accounts and admins can reopen it.**
* **Summary cards:** Revenue USD (from the booking's quoted total, typeable over), Exchange rate (starting at the Accounts house rate of **25,500**, changeable per booking), Total VND, Total estimate, and PNL incurred. A **ring chart for margin** turns red on a loss, amber below 10%, green above.
* A **payments bar** (paid vs still owed) and a **P&L check chip** comparing the sheet's cost against the booking's own P&L cost, showing the difference or *matched*.
* **The table:** one row per item — Date, Code, Details for payment, Vendor, Unit price (VND or USD), Quan1, Quan2, Total estimate, Paid. Total estimate is unit price × Quan1 × Quan2; **type your own total and it is highlighted amber, with one click to put the calculated one back**. *Paid* cycles Unpaid → Paid → Partial and **records who marked it and when**. Vendor names autocomplete from the sheet, rows can be duplicated or deleted, and Enter on the last row adds a new one.
* **Faster ways to add rows:** search the Vietnam product sheet (*"hal cru"*) to add a product with code and price filled in, or **From agenda** to pull in the products already picked on this booking's agenda — which needs §4's script to have been run.
* Also: per-vendor cards with a paid bar, a notes box, CSV export, and `Ctrl/⌘+S` to save.

> **The four totals use the same definitions as the Accounts Checklist VN, so both systems give the same numbers.** Note that **PNL incurred is the profit** (Total VND − Total estimate), **not the cost**, and margin is PNL incurred ÷ Total VND.

### 5.2 The Check List VN page

A summary banner of totals for the period with quick month buttons, a date range and search. Filters: **Not started, Draft, Checked, Final, Under water** (making a loss) and **To pay**. Each row shows its margin and paid progress, and clicking it opens the same popup.

**Who can use it:** Booking, Accounts, GT Vietnam and admins can edit; TE can view only. **The server also refuses users whose country scope excludes Vietnam.**

**What I checked:** type check and lint are clean on all new files, and I ran a worked example through the calculations and checked the result by hand. **I have not run the app to look at it.**

---

## 6. OPS — the accounts report board

### 6.1 D-7 / D-10 and a B2B / B2C filter

`1f14b02` · 1 file · +115 / −11

* **"Next 7 days" is now "D-7"** and covers **tomorrow to 7 days out**, so today is left out. **New "D-10"** covers tomorrow to 10 days out.
* **The buttons carry their actual dates** — `D-7 23–29 Sep` — so staff don't have to work them out, and hovering any button shows the full range.
* **The range view now opens on D-7.** Today, This month and Next 30 days are unchanged.
* **B2B / B2C filter** (before *Outstanding only*): a three-way `All · B2B · B2C` toggle, briefcase in blue and shopping-bag in violet, with the white highlight sliding to the pick. **Each option shows how many files it has on the current tab**, so the split is visible before clicking. *Clear filters* resets it and the CSV export gains a **Channel** column.
* **How B2C is identified:** a file counts as B2C when its agent is *Aahaas B2C*, which is how website orders are already labelled. **No database change.**

### 6.2 Cancelled and Test-file switches

`acd9e55` · 3 files · +206 / −4

Two switches in a small **"In the numbers"** row directly above the On Ground / Arrivals / Departures counts, since they affect every number below.

* Each is a slide switch with an icon — 🚫 **Cancelled** in red, 🧪 **Test files** in indigo. **When one is off, its label is crossed out and a dark badge shows how many files it is hiding** (`👁 4`), so **a hidden file is never silently missing**. *Show everything* appears whenever either is off.
* **Remembered per browser**, and **both default to Include**, so the board looks exactly as it does today until someone changes it.
* **The filtering happens on the server before the totals are worked out**, so switching off removes those files from the headline counts, pax, the five gauges, the ready %, the D-10 chase and the drill-downs — not just from the list.
* **Cancelled covers both approved cancellations and files still waiting on accounts approval**, as asked.
* **How a test file is found:** `test` or `testing` **as a whole word** (*latest*, *contest* don't count) in the cancellation reason or cancel decision note, Other Note, Important Notes, Client Request, Policy Notes, Tips or Amendment Note, or the lead guest's name ("Test Test"). The system has no separate comments feature, so I treated those note fields as the comment section — **if ops write "test" somewhere else, tell me where and I'll add it.**
* When test files are included, each shows an indigo **🧪 TEST** badge, and **hovering shows where "test" was found** (*Other Note: "…test booking pls ignore…"*), so a wrong match is easy to spot. The CSV export gains a **Test File** column.

**Type check and lint pass on everything changed;** the three project-wide type errors are in files I did not touch. **I have not run the app to look at it.**

---

## 7. OPS — Own Arrangement stays were losing their hotel names

`52b9aaa` · 4 files · +42 / −16

**The diagnosis first:** when Apple System is set to **Own Arrangement**, the guest's hotel **isn't stored anywhere upstream**. So *"sometimes the name is missing"* really means *"sometimes the stay is Own Arrangement"*. In the quotes I sampled, **every real `type: "hotel"` or `"cruise"` row came with a name and imported correctly**. I stopped the wider scan early, so **it did not cover every date I planned**.

**The bug that was real:** if someone typed the guest's hotel into an own-arrangement row, **the next Apple System sync treated the empty upstream name as a change** — it deleted and recreated the rows blank, **losing the address and contact too**. That sync runs automatically through the pre-arrival sync and reconcile jobs, so **names could disappear without anyone touching the booking**.

**The fix:** `carryForwardHotelNames()` in `as-booking-map.ts` **keeps the stored name for the same city and check-in date whenever Apple System sends none**; a name from Apple System still takes priority. It now runs in the auto and manual sync (`as-booking-sync.ts`) and the public API update (`as-quotation-actions.ts`). The *refetch accommodations* route already did this, and was switched to the shared helper.

**Type check is clean for these files. I have not run the app or a live sync**, and **I could not check how many existing bookings have blank names** because my read of the production database was blocked.

**How to get the names in:** *now* — use Edit or AI Auto-fill on the Accommodation card, pasting the agent's email or voucher; **with this fix the name now survives future syncs**. *Best* — ask the Apple System team to add a free-text hotel name to Own Arrangement stays and include it in the quote-template accommodation.

---

## 8. OPS — flight amendment reason made optional

`eb6d988` · 1 file (plus three daily-update files committed alongside)

In the **Update Flight Details** modal, **Save Changes now goes through with the reason box empty** and the *"Please provide a reason for the change"* error is gone; the label reads *Reason for change (optional)*. **Existing notes are kept** — the reason is only sent when something is typed, because sending it empty would **overwrite the booking's current amendment note with a blank one**.

**Not run:** neither the app nor a type check.

---

## 9. Online Work — Windows setup guide

`dacf515` · 3 files · +383

A guide card sits directly under yesterday's PC setup download. The icon is a small stack of paper whose three ruled lines keep re-drawing themselves, with the two back sheets fanning out on hover and a light sweeping diagonally across the card — **matching the language of the Windows download above it without competing with it**. Two actions: **View** (opens the popup) and a save icon that pulls the PDF straight down.

The popup uses **the native `<dialog>` the app already uses, so Escape, focus trapping and click-outside come for free**. It is 1040px wide with a spring entrance and a blurred backdrop, and embeds **SharePoint's own reader** so the document reads inside the sign-in page. While it loads, **a mock page settles into view with shimmering lines rather than a spinner**, and **after 7 seconds it changes its message to *"Still fetching the document from SharePoint…"*** and offers a new-tab button. The header carries Download and Open in SharePoint, and a footer line covers the case where the viewer needs a SharePoint sign-in.

---

## 10. Verification summary

- **Accounts System:** all PHP files lint clean, Blade views compile, and the 5,000-line P&L script parses under `node --check`. The hold arithmetic, anchor whitelist and validation rules were exercised directly. The transport-route fix was tested against **150 live bookings read from the Apple API**. **No database was written to today**; the AWS-hosted database is unreachable from this machine and the GCP read was read-only.
- **OPS:** type check and lint are clean on every file changed (the three project-wide type errors pre-date today's work). The Vietnam product search and suggestions were run against the real sheet, read-only. The checklist calculations were checked by hand on a worked example. **The app has not been run in a browser for any of today's OPS work**, and `eb6d988` had no type check at all.
- **Online Work:** the setup-guide card and viewer were built against the existing dialog pattern; **not clicked through in a browser**.
- **Not done end to end anywhere today:** save-and-pay on the Vietnam includes, the workbook write to the Manual Products tab, and any live sync.

---

## 11. Follow-Up Items

1. **Run the Vietnam agenda includes script** from `apple-holidays/`: `--check` first, then the script. It creates `vn_include_products` and `agenda_item_includes` only.
2. **Run the Vietnam Booking Checklist script.** It creates `vn_booking_checklists` and `vn_booking_checklist_items` only. **Do this after #1** if you want *From agenda* to work in the checklist popup.
3. **Confirm the Azure app has write access to your personal OneDrive.** Without it, hand-added products can't reach the Manual Products tab; they'll be marked *waiting* with a retry in Settings. **I could not test this without writing to your workbook.**
4. **Three Vietnam choices are yours:** whether SIC Tour joins SIC Transfer and Private Tour; whether Payable 1.1 should use the OPS includes instead of its AI split; and whether the USD estimates (lowest-price-paid, VND-based) are close enough to be useful to the clerk.
5. **Decide whether invoice generation should honour a held invoice value.** Today it does not — `AsConfirmationInvoiceService` reads the sell price live from the Apple System. **It's a deliberate second step; say the word and I'll wire it.**
6. **Before anyone refreshes SG 40053:** the Apple System holds a newer 3-day, 2-transfer revision. *Fetch from AS API* would replace the stored figures — check the hand-added Surcharge of 10 afterwards.
7. **Tell me where else ops write "test"**, if the note fields and guest name don't cover it.
8. **Open Payment History once** and check the per-currency KPI strip, particularly the LKR line that reports how many rows it could not cover.
9. **Click through today's OPS work in a browser** — D-7/D-10, the two switches, the includes panel and the checklist popup. **None of it has been seen running.**
10. **`eb6d988` needs a type check**, which was not run.
11. **Commit hygiene:** `ad15e93` arrived with a checkout that wiped an `ActivityTabs.php` change. It's restored, but **work made outside the session is overwriting work made inside it** — worth agreeing how we sequence that.
12. **Still open from 22 Sep:** the three payment migrations (Page Master, B2B bookings, B2B tickets), opening the three new payment boards on the server, `/b2b/pnl` against real data, the *What the mail said* 54-vs-47 panel, the commission-switch default, the sidebar-search look-and-feel, `Mail.Send` in Entra, the leave recipients, `WORKDAY_PATH` persistence, and **the credentials tracked in `web/.env.local.example`, which still need rotating**.
13. **Still open from 21, 19 and 15 Sep:** `/pnl/db` wide-window timing, the Online Work production `.env` clean-up, audit row id 19, Task Manager department scoping, the `admin@aahaas.com` password decision, `AUTH_SECRET`, the five live indexes, `DB_READ_HOST` in Amplify, and the Task Manager team backfill.
