# Daily Work Update — 14 September 2026 (Monday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 14 Sep 2026 (Booking System security, Accounts System P&L reporting)

---

## Executive Summary

Two halves to the day. The morning closed a safety gap in the **Booking System**: cancelling or deleting a booking no longer happens on a single click — an emailed code is now required, bound to one user, one action and one target. The afternoon went entirely into the **daily P&L mail**, which was reporting figures that could not be reconciled by anyone reading them.

The headline defect was a card reading **P&L count 599** beside **Total bookings 544** — more P&Ls than bookings, which reads as the board double-counting amendments. It was not double-counting. The two cards were counted from **two different systems on two different date meanings**: bookings *first billed* this month, on the invoice ledger, against P&L rows *extracted* this month, which also holds every older booking re-extracted inside it. Same heading, two books. The card is now counted over the census's own bookings, one per booking, and reads **531 of 544** with the shortfall explained on its face.

The second defect was arithmetic rather than population. An older booking edited in this period was being added to the day **whole** — one back-catalogue file at 649.14 selling and 775.52 cost turned a 141.00 day into **14.62**, a figure describing neither period. Older bookings now contribute only **what this period changed on them**, the day reads **728.98 / 614.36 / 114.62**, and the email prints the sum itself so nobody has to take it on trust. Every figure is now kept **per currency** — INR and USD are never added into a third number that is true of neither.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 18 commits | `REV1` | Clean |
| Booking System / OPS | 4 commits | `LIVE-1.0.0v` | Clean |
| AHS | No work today | `SewV3---sasi-update-v2` | Clean |
| Aahaas Task Manager | No work today | `main` | Clean |

---

## 1. Booking System — two-step verification on destructive actions

`apple-holidays/src/lib/action-verification.ts` (new, 472 lines) + `components/security/verification-modal.tsx` + `api/verification/request`

Cancelling and deleting cannot be taken back. A delete drops the passengers, flights, hotels, agenda and P&L with the booking; a cancellation puts a notice in front of the agent. Neither runs on one click any more: the user asks for a code, it is mailed to the address they signed in with, and the destructive route refuses to act without it.

Three properties are enforced in the library rather than in each route, so a new route cannot forget one:

- **Bound** — a code is issued for one user, one action and one target. The target of a bulk delete is a digest of the exact set of references, so changing the selection invalidates the code.
- **Single-use** — consumption is a conditional `UPDATE`, so two requests racing on the same code cannot both win and delete twice.
- **Fails closed** — no table, no code, an expired code or too many wrong guesses all refuse the action. Nothing destructive runs because verification could not be checked.

The code itself is never stored — the row keeps SHA-256 of the code salted with the row's own id, so reading the database does not let anyone approve a cancellation. Gated actions: booking cancel, full cancel, delete, bulk delete, filtered delete.

Also this morning: **WhatsApp delivery receipts and status reporting** on the Sri Lanka drive log, and a **sending-number health check** (`readSendingNumberHealth`) that reads Meta's quality rating and health status and warns in the send dialog — the invisible failure mode where messages are accepted and then throttled.

---

## 2. Accounts System — the daily P&L mail

### 2.1 The defect: 599 P&Ls against 544 bookings

Not double-counting. Two populations:

| Card | Source | What "this month" meant |
|---|---|---|
| Total bookings 544 | `generated_invoices` (invoice ledger) | booking **first billed** on/after 1 Sep |
| P&L count 599 | `pnl_records` (the board) | P&L row whose **extract date** fell in 1–13 Sep |

A booking first billed in August whose P&L was pulled into the queue in September is in the second and not the first. Printed side by side under one *month to date* heading, the difference is unreconcilable.

**Fixed by counting both cards over the same bookings.** `InvoiceLedgerCensus::bookingRefs()` now lists the bookings behind the five cards (sharing one derived table with the counts, so they can never describe different books), and `PnlDbReportService::refsOnBoard()` counts the board over exactly those — `COUNT(DISTINCT` booking reference`)`, so an amendment is the same P&L updated by construction, whatever its revision.

The card now reads **531**, and says why the other 13 are not there: **cancelled** (off the board on purpose — no trip left to margin) is counted apart from **no P&L raised yet** (business to chase). If the book cannot be listed it falls back to the old window count and is *marked* as a different population rather than passing it off as the same one.

### 2.2 One row per booking — two separate leaks

- The board's latest-revision rule keyed only on `as_quotation_no`. Two NULL quotation numbers are never equal in SQL, so every revision of such a booking survived the test. Now keyed on the booking — quotation number, then IS number, then invoice number.
- The window rule only reaches inside the window it reads, and the report then unions in bookings the period *billed* from outside it. `PnlReportSource::oneRowPerBooking()` closes that union: highest revision wins, keyed through `BookingKey`.

### 2.3 The money: an amendment is not a new sale

The two tables under the strip are added two different ways now, because they are not the same kind of business:

- **This period's own confirmations** — added whole. Sold here, all of it belongs here.
- **Older confirmations edited here** — added as the **change only**: the revision the booking now stands on, less the one it stood on when the period opened (`periodChange()`, baseline = current revision less the revisions this period raised).

On the 13/09 mail: 679.84 + **49.14** = 728.98 selling, 538.84 + **75.52** = 614.36 cost, 141.00 **− 26.38** = 114.62 profit — against 1,328.98 / 1,314.36 / **14.62** before.

**Where it cannot be measured it says so.** With no earlier revision on the board, both available guesses are wrong — the whole booking bills an earlier period here, zero claims the amendment moved nothing — so nothing is added, the row shows *"no earlier revision"*, and the foot says *"over 1 of 2"*.

### 2.4 Shown, not asserted

A **How it adds up** table now sits under the three cards: one line per figure per currency, with the two columns that produced it.

| How it adds up | Cur | This period's own | Change on older | Total |
|---|---|---:|---:|---:|
| Selling | USD | 679.84 | + 49.14 | 728.98 |
| Cost | USD | 538.84 | + 75.52 | 614.36 |
| Profit | USD | 141.00 | − 26.38 | 114.62 |

Every number on it is checkable against the two tables below it. *Old amendments* also gained a **P/L change** column, and its foot changed from a total to *"This period changed: Sell ▲ +49.14 · Cost ▲ +75.52 · P/L ▼ −26.38"*.

### 2.5 Per currency, everywhere

The three cards, the breakdown and both table feet print one line per currency (INR, USD, …). A day that sold USD 679.84 and moved INR 4,333.99 did not do 5,013.83 of anything. Single-currency books print exactly as before, with no code repeated three times.

### 2.6 Removed at the desk's request

- The **Apple System count** card (it was the Apple System's own confirmation count, not this report's).
- The **Filters** row (it described the query behind the file, not the file).
- The **Period covered / Bookings / Total / Attachment** table — every line of it is stated elsewhere in the mail, and the file is attached.

### 2.7 `USD NaN` on the preview

`/pnl/auto` printed **USD NaN** beside every P&L preview. The page did `Number(a)` on each currency total; invoice reports store one amount per currency, P&L reports store `{bookings, sell, cost, profit}`. Fixed in all three places that print totals (brand preview, schedule panel, sent-run detail).

### 2.8 New: `php artisan pnl:census-gap`

Read-only. Prints the same two figures the mail prints, then **names** every booking in the month's book with no live P&L and why. Built on exactly the reads the card is built from, so it cannot tell a different story than the email.

```
php artisan pnl:census-gap --as-of=2026-09-13
```

### 2.9 Earlier today, before the above

Census work on the **B2B invoice mail**: unattached cancellations reported rather than dropped, invoice count separated from raw document count, the census floor moved to month-to-date and applied to the booking rather than the document, and the covering sentences removed from both mails. Plus `FillInvoiceAgentIdJob` — filling missing Agent IDs during invoice generation.

---

## 3. Verification

- **88 unit tests run · 78 pass.** New coverage: the change-only arithmetic (728.98 / 614.36 / 114.62), the unmeasurable case adding nothing, currencies never added across each other, the P&L count taken over the census's own bookings, the fallback marking itself, and two revisions of one booking collapsing to one row.
- **10 tests fail, and they failed before today's work** — verified against a stash. They need a live database connection (`AsInvoiceNumberTest`, `AutoReportMailTest`, `RevisedInvoiceReportTest`).
- Both the one-currency and two-currency emails were rendered and read end to end, not just asserted on.
- **Every query added today is a SELECT.** Nothing writes, no migration, no schema change on the Accounts side.

---

## 4. Follow-Up Items

1. **The 13 bookings behind 531 of 544 have not been named yet.** The RDS host is not reachable from this machine (connection times out), so `pnl:census-gap` needs to be run where the database is. If the 12 "no P&L row" bookings turn out to have P&Ls filed under different references, that is a matching bug and not uncosted business — it needs fixing at the join, not at the wording.
2. **The census is cached for six hours.** A send inside that window still describes the book already cached; the corrected cards appear on the next send after it expires.
3. **Booking System:** the `action_verification` table is created by `prisma/manual-sql/2026-09-14-action-verification.sql` (`npx prisma db execute --file … --schema prisma/schema.prisma`) — it must be applied to live by hand, as the live database is not `prisma db push`-safe.
4. **The 10 DB-dependent unit tests** should be given fixtures so the suite can go green on a machine without the production database.
5. The P&L mail's per-currency strip has only been seen with INR and USD. A third currency will render, but has not been observed.
