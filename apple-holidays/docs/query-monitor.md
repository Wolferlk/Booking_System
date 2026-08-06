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

### Deduplication

The same mail reaching five handlers is **one** entry. The key is the RFC
`internetMessageId` (falling back to conversation + normalised subject). Each
recipient is stored as a `QueryMonitorMatch`; their names are joined into the
File Handler cell. If a handler is added later — mailbox activated, colleague
CC'd — the entry's row is rewritten in place rather than appended again.

## Safety properties

- **Columns A–M only.** Column N onward holds the team's lookup lists and pivot
  helpers and is never written.
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
