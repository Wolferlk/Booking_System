# Booking Team Query Monitor

Hourly sweep of the booking team's file-handler mailboxes into the SharePoint
query workbook (tab **Query Entry Sheet**), mirrored into a standby backup
workbook on every sweep.

Since **5 Aug 2026** both are new, empty files created for this system — the app
writes their headers itself. Mail received before that date belongs to the
previous sheet and is never appended here (`query_monitor_start_date`).

It is a self-contained observer: it reads mailboxes and writes one spreadsheet.
It does **not** touch bookings, P&L, the mail-inbox pipeline, or OneDrive
monitoring, and shares no state with them beyond the `SystemSetting` table.

Screen: `/dashboard/admin/query-monitor` (SUPER_ADMIN / ULTRA_SUPER_ADMIN).

---

## First-time setup

1. **Create the tables.** Additive — new tables and columns, nothing existing is
   altered:

   ```bash
   npx prisma db execute --file prisma/sql/query-monitor.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/query-monitor-mail-kind.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/query-monitor-to-list.sql --schema prisma/schema.prisma
   npx prisma generate
   ```

   > **Never `prisma db push` against live.** The live database carries schema
   > drift that push tries to "correct", and on a populated table it offers a
   > full reset — *“To apply this change we need to reset the database, all data
   > will be lost”*. **Answer no.** Every column here is instead added by the SQL
   > above, which is guarded by `information_schema` and safe to re-run.
   >
   > This is also why `toList` is `VARCHAR(500) DEFAULT ''` rather than `TEXT`:
   > MySQL forbids defaults on `TEXT`, and a required column with no default
   > cannot be added to a table that already has rows — which is exactly the
   > reset prompt above. With the default it applies in place.
   >
   > If a deploy script runs the schema sync for you, decline the reset, then run
   > the three `db execute` lines and `prisma generate` by hand.

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
| F File Handler | **One** name — who owns the query. See below. |
| G TO List | **Every** handler the mail reached, comma-joined — one row, never duplicated |
| H Sales Person | Sender rule (domain or exact address) → falls back to `Others` |
| I Destination | Regex over subject/body, then GPT fallback, then the rule's default |
| J Agent | Sender rule → falls back to the sender's display name |
| K Travel Date | Regex over subject/body (day-first), then GPT fallback |
| L CNTL | `CNTL 12345`, `12345 CNTL`, or a labelled CRM/reference id |
| M Amendment | Blank unless hand-edited |
| N Region | Only when the mail states it outright, or the rule sets a default |

Dates are written as real Excel serials with the same number formats as the
manual rows, so sorting and the team's pivots keep working.

### One file handler, chosen from the TO list

Column F used to comma-join every recipient, which made "whose query is this?"
unanswerable. It now holds exactly one name, taken from the TO list in G:

1. **One recipient** → assigned immediately, there is nothing to decide.
2. **Several recipients** → left **blank**, and filled in with whoever replies
   first. A blank cell is the team's cue that nobody has picked the query up.
3. **By hand** at any time, from the dropdown in the dashboard's File handler
   column. The dropdown only offers names on the TO list, and the API rejects
   anything else — a file handler who was never on the mail is a data error.

A name chosen by hand is a manual override: no later reply or sweep takes it
back. The Queries tab has an *Unassigned* filter and a banner counting queries
still waiting for an owner.

### Mail that is not a query

Much of what reaches the file handlers is not new business: hotel vouchers,
on-ground incidents, refund chases, availability checks, bare booking
references. Those must not sit in the query sheet, whose pivots measure response
time on enquiries — but they are not noise either, so nothing is discarded.

Every mail is classified on the subject line alone (bodies carry quoted threads,
which would exclude a genuine query written under an old voucher mail):

- **QUERY** → appended to the query sheet, columns A–N, as above.
- **EXCLUDED** → appended to a second tab, default **“Other Mails”**, columns
  A–J: Date · Received time · Subject · Sender · Sender Email · File Handler ·
  TO List · Reason · Destination · CNTL. The tab is created with its header on
  first use.

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
recipient is stored as a `QueryMonitorMatch`; their names are joined into the TO
List cell. If a handler is added later — mailbox activated, colleague CC'd — the
entry's row is rewritten in place rather than appended again.

### Replies land the next day

A query raised at 16:00 and answered at 09:00 the next morning is outside every
lookback window by the time the reply exists. So replies are chased for
`replyChaseDays` (default 7) regardless of when the mail arrived, and each sweep
writes back into rows appended days ago:

- **Replied time** (E) — the first reply in the thread from any recipient's Sent
  Items.
- **Status** (B) — `Pending` → `Overdue` once the SLA passes with no reply, and
  → `Replied` when one lands.
- **File Handler** (F) — filled in with whoever replied, if still blank.

Every such change marks the entry `DIRTY`, which rewrites its row in **both**
workbooks in place. Nothing is ever appended twice.

## The backup workbook

A second workbook mirrors the first: same rows, same rewrites, written in the
same sweep, so it is at most one sweep behind. It is a separate pass with its own
row numbers (`backupSheetRow`) and its own state (`backupSyncStatus`) because:

- a locked or unreachable backup must never stop the team's live sheet updating;
- the two files number their rows independently, so one cannot use the other's
  pointers;
- a retry of a failed backup write must not re-append to the live file.

Toggle it with *Mirror to the backup workbook*; its URL sits under *Target
workbook*. The Configuration panel shows whether the mirror has kept up.

## Moving to a new workbook

Changing the URL is only half the move — every entry still remembers the row it
owns in the **old** file, so sweeps would keep rewriting rows nobody reads.
In order, on the Configuration tab:

1. **Save** the new *Share link*, the *Backup workbook*, and *Start from*.
   Saving a changed URL drops the cached drive/item id, so the next call
   resolves the new file.
2. **Prepare** (`POST /api/query-monitor/prepare`) — creates both tabs and writes
   the expected header. This is the fix for *“Column mismatch”*.
3. **Move rows here** (`POST /api/query-monitor/rebase`) — entries from the start
   date onwards forget their row numbers and go back to `PENDING`; older ones are
   retired as `SKIPPED`.
4. **Sync to sheet**.

Nothing is deleted from the old workbook.

### “Column mismatch”

The tab's header is not the expected 14 columns — almost always a file copied
from the old 13-column sheet, which has no **TO List**. Press **Prepare**.

The header is only rewritten while the tab holds **no data rows**. Above real
rows it is left alone and reported instead: relabelling columns without moving
the values underneath would silently change what every cell means. A tab in that
state needs a human — clear it, or point at a clean one.

The sync applies the same rule. It refuses to append into a mismatched tab rather
than writing 14 columns under a 13-column header, where everything from column G
on would land one column left of where it belongs.

### The backup must be a different file

Two share links can resolve to the same workbook. If they do, the mirror would
append every row to that one file twice, and the two sets of row numbers would
collide so later rewrites would land on the wrong rows.

Identical URLs are rejected on save; identical *drive items* (a copied or
re-shared link to the same file) are caught at sync time by comparing the
resolved `driveId`/`itemId`, and the backup pass is skipped with a warning in the
run log.

## Safety properties

- **Columns A–N only** on the query sheet; anything further right belongs to the
  team's lookup lists and pivots and is never written. (The other-mail tab uses
  A–J.)
- **The File Handler is always someone on the TO list**, or blank. Enforced by
  the API, not just the UI.
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
  constants.ts   setting keys, both sheet layouts, seed mailboxes + rules,
                 the default exclusion patterns
  config.ts      settings / mailboxes / rules accessors and seeding
  classify.ts    "is this a query?" — exclusion pattern parsing and matching
  dates.ts       Excel serial conversion in the sheet timezone
  collect.ts     Graph inbox + sent-items reads, sender filtering
  extract.ts     destination / travel date / CNTL parsing, GPT fallback
  sheet.ts       workbook resolution, append, in-place update, tail read
  run.ts         the sweep: collect → dedup → enrich → write, with the run log
  scheduler.ts   per-minute tick that decides when a sweep is due
  auth.ts        admin guard for the API routes

src/app/api/query-monitor/{entries,mailboxes,rules,runs,settings,run,sync,sheet,reclassify,rebase}
src/app/api/cron/query-monitor
src/app/dashboard/admin/query-monitor/    page + queries / config / logs tabs
prisma/sql/query-monitor.sql              table creation
prisma/sql/query-monitor-mail-kind.sql    mailKind / excludeReason / sheetTab columns
prisma/sql/query-monitor-to-list.sql      toList + backup row/state columns
```

## Known gaps

- `availcheck@aahaas.com` is not a mailbox in the tenant (Graph:
  `ErrorInvalidUser`). It is seeded **inactive** with that reason on the record —
  correct the address (or licence the shared mailbox) in the UI and activate it.
- Deleting an entry that has already been written does not clear its sheet row;
  the API refuses and tells you to clear the row in Excel first.
