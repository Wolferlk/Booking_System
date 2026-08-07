# Booking Team Query Monitor

Hourly sweep of the booking team's file-handler mailboxes into the SharePoint
master workbook (**“AutoUpdating SL Query and Confirmation Entry Sheet 2026 …”**,
tab **Query Entry Sheet**).

It is a self-contained observer: it reads mailboxes and writes one spreadsheet.
It does **not** touch bookings, P&L, the mail-inbox pipeline, or OneDrive
monitoring, and shares no state with them beyond the `SystemSetting` table.

Screen: `/dashboard/admin/query-monitor` (SUPER_ADMIN / ULTRA_SUPER_ADMIN).

---

## First-time setup

1. **Create the tables** (additive — five new tables, nothing existing is
   altered; never `prisma db push` against live, it would fight the schema drift):

   ```bash
   npx prisma db execute --file prisma/sql/query-monitor.sql --schema prisma/schema.prisma
   npx prisma generate
   ```

2. **Check the Azure app permissions.** The monitor reuses the existing
   `Azure_CLIENT_ID` registration. It needs, as *application* permissions:
   `Mail.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`. All three were
   present when this was built.

3. **Open the screen.** Mailboxes and sender rules seed themselves on first
   load. Press **Test** on each mailbox — anything Graph cannot resolve shows a
   red banner with the reason.

4. **Press “Run now”**, review the rows on the Queries tab, then press
   **Sync to sheet**. When the output looks right, turn on
   *Write to the workbook automatically* and *Run automatically*.

## How a row is produced

| Sheet column | Source |
|---|---|
| A Date | Mail received date, in `QUERY_MONITOR_TZ` |
| B Status | `Replied` / `Pending` / `Overdue` (SLA configurable, default 2 h). Can be left blank. |
| C Subject | Mail subject |
| D Allocation time | Mail received timestamp |
| E Replied time | First reply in the same conversation from the handler's Sent Items |
| F File Handler | **All** handlers who received the mail, comma-joined — one row, never duplicated |
| G Sales Person | Sender rule (domain or exact address) → falls back to `Others` |
| H Destination | Regex over subject/body, then GPT fallback, then the rule's default |
| I Agent | Sender rule → falls back to the sender's display name |
| J Travel Date | Regex over subject/body (day-first), then GPT fallback |
| K CNTL | `CNTL 12345`, `12345 CNTL`, or a labelled CRM/reference id |
| L Amendment | Blank unless hand-edited |
| M Region | Only when the mail states it outright, or the rule sets a default |

Dates are written as real Excel serials with the same number formats as the
manual rows, so sorting and the team's pivots keep working.

### Mail that is not a query

Much of what reaches the file handlers is not new business: hotel vouchers,
on-ground incidents, refund chases, availability checks, bare booking
references. Those must not sit in the query sheet, whose pivots measure response
time on enquiries — but they are not noise either, so nothing is discarded.

Every mail is classified on the subject line alone (bodies carry quoted threads,
which would exclude a genuine query written under an old voucher mail):

- **QUERY** → appended to the query sheet, columns A–M, as above.
- **EXCLUDED** → appended to a second tab, default **“Other Mails”**, columns
  A–I: Date · Received time · Subject · Sender · Sender Email · File Handler ·
  Reason · Destination · CNTL. The tab is created with its header on first use.

The pattern list is the `query_monitor_exclude_patterns` setting, edited under
*Configuration → Mail that is not a query*. One pattern per line: `#` comments,
`/…/flags` regular expressions, anything else a case-insensitive phrase. The
seed list covers vouchers, on/on-ground, discrepancy, refund, complaint, avail
checks, bare `NL…` references and mailer auto-replies.

Excluded mail costs no GPT call and is never chased for a reply. It appears in
the dashboard under *Queries → Other mail*, with the pattern that caught it. A
mail can be moved between the two tabs by hand **before** it is written; after
that the API refuses, because this app never deletes rows and the move would
strand one on the old tab. *Re-check unwritten mail* re-applies an edited pattern
list to the backlog that has not been written yet.

### Deduplication

The same mail reaching five handlers is **one** entry. The key is the RFC
`internetMessageId` (falling back to conversation + normalised subject). Each
recipient is stored as a `QueryMonitorMatch`; their names are joined into the
File Handler cell. If a handler is added later — mailbox activated, colleague
CC'd — the entry's row is rewritten in place rather than appended again.

## Safety properties

- **Columns A–M only** on the query sheet. Column N onward holds the team's
  lookup lists and pivot helpers and is never written. (The other-mail tab is
  created by the app and uses A–I.)
- **The two tabs must differ.** Saving the same name for both is rejected —
  nine-column rows appended to the query sheet would wreck it.
- **Append point is found by scanning column C from the bottom**, not from
  `usedRange` — the sheet carries formatted-but-empty rows past the last entry.
- **Every written row's number is stored** on the entry, so a row can be traced,
  re-read, or corrected in place.
- **Hand edits win.** Any field corrected in the dashboard is recorded in
  `manualOverrides` and is never overwritten by a later sweep.
- **A run lock** (`query_monitor_run_lock`, 15-min TTL) stops the in-process
  scheduler and the Vercel cron from sweeping at once.
- **A sweep never throws.** A dead mailbox or a locked workbook downgrades the
  run to `PARTIAL`; the next hour retries.

## Scheduling

- Self-hosted: `startQueryMonitorScheduler()` from `instrumentation.ts` ticks
  every minute and fires when `now - lastRunAt >= intervalMinutes`.
- Vercel: `/api/cron/query-monitor` at `0 * * * *` (`vercel.json`).

Both are gated by the `query_monitor_enabled` switch and share the run lock, so
having both active is harmless.

## Files

```
src/lib/query-monitor/
  constants.ts   setting keys, sheet layout, seed mailboxes + rules
  config.ts      settings / mailboxes / rules accessors and seeding
  dates.ts       Excel serial conversion in the sheet timezone
  collect.ts     Graph inbox + sent-items reads, sender filtering
  extract.ts     destination / travel date / CNTL parsing, GPT fallback
  sheet.ts       workbook resolution, append, in-place update, tail read
  run.ts         the sweep: collect → dedup → enrich → write, with the run log
  scheduler.ts   per-minute tick that decides when a sweep is due
  auth.ts        admin guard for the API routes

src/app/api/query-monitor/{entries,mailboxes,rules,runs,settings,run,sync,sheet}
src/app/api/cron/query-monitor
src/app/dashboard/admin/query-monitor/    page + queries / config / logs tabs
prisma/sql/query-monitor.sql              table creation
```

## Known gaps

- `availcheck@aahaas.com` is not a mailbox in the tenant (Graph:
  `ErrorInvalidUser`). It is seeded **inactive** with that reason on the record —
  correct the address (or licence the shared mailbox) in the UI and activate it.
- Deleting an entry that has already been written does not clear its sheet row;
  the API refuses and tells you to clear the row in Excel first.
