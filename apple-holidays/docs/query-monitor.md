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
   npx prisma db execute --file prisma/sql/query-monitor-thread-merge.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/query-monitor-reply-detail-ai-summary.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/query-monitor-group-mailbox-reply-source.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/2026-08-15-query-monitor-thread-ledger.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/sql/2026-08-17-query-monitor-thread-rounds.sql --schema prisma/schema.prisma
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
   > the `db execute` lines above and `prisma generate` by hand.

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
| C Subject | Mail subject, with the `Re:` / `Fw:` chain stripped — the query's title, not its forwarding history |
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
| O Replied By | The handler whose Sent Items the reply was found in |
| P Response (hrs) | `E − D` in hours, to 2 dp. A **number**, so the team can average and sort it. Blank while open |
| Q SLA | `Met` / `Missed` against the SLA hours, blank while open — Status says where a query stands *now*, this remembers whether it was answered in time |
| R Mails in Thread | **Every** mail of the conversation, ours included — see *The thread ledger* |
| S Last Mail | Timestamp of the newest mail in the thread (D stays the first one) |
| T AI Summary | One sentence on the mail that **opened** the thread, written only while *AI reads every new mail* is on |
| U From | The sender's display name — who at the agency actually wrote |
| V From Email | The address it came from |
| W Replied By Email | The mailbox the answer went out of (O is only the first name) |
| X Replied To | Where the answer went — what proves it reached the agent and not a colleague |
| Y Reply Type | `Direct reply` / `Forwarded on` / `Internal only`. Only the first stops the SLA clock |
| Z Forward Chain | `Sajid → Vishmika · Vishmika → Sudari`, oldest hop first |
| AA Reply Summary | What happened across the **whole** thread, rewritten every time it grows |

Dates are written as real Excel serials with the same number formats as the
manual rows, so sorting and the team's pivots keep working.

### The thread ledger

Columns R and U–AA are roll-ups of a record kept per thread: **one row per mail,
in both directions**, in `query_monitor_thread_events`. Before it existed a row
knew only how many *inbound* mails had folded into it and the first name of
whoever's Sent Items a reply turned up in — which left the team opening Outlook
to answer "who forwarded this, and did anyone ever actually reply?".

Each mail is recorded as one of five kinds:

| Kind | Direction | What it is |
|---|---|---|
| `QUERY` | in | The mail that opened the thread |
| `FOLLOW_UP` | in | A later mail from the agent — a chaser, or an answer to our question |
| `REPLY` | out | Ours, **addressed back to whoever asked** |
| `FORWARD` | out | Ours, to a colleague or a supplier instead |
| `INTERNAL` | out | Ours, on the thread but to neither |

The classification is made from the mail's actual recipients, never guessed:
the asker's address on TO or CC is what makes something a reply.

> **This tightened the SLA.** A forward used to be accepted as the reply when
> nothing better could be found, which stopped the clock early and credited the
> wrong person. It no longer does. Such a thread stays **Pending/Overdue**, reads
> `Forwarded on` in column Y, and names the hop in Z. Some rows that read
> *Replied* under the old rule will correctly go back to open the first time a
> sweep re-reads them.

Recording is idempotent, so the overlapping windows every sweep re-reads cannot
log the same mail twice. Rows written before 15 Aug 2026 start with an empty
ledger and gain one from the next mail that touches the thread — history is
never rewritten. While a ledger is empty, R falls back to the old
`chasers + 1` count rather than claiming the thread is a single mail.

### Reply Summary (AA) vs AI Summary (T)

They answer different questions and are deliberately kept apart:

- **T** reads the mail that opened the thread, is written once and never moves.
  It says *what was asked*.
- **AA** reads the whole ledger and is rewritten whenever the ledger grows. It
  says *what became of it* — who chased, who answered, what is outstanding.

AA is filled in **whether or not the AI switch is on**. With it on, gpt-4o-mini
narrates the timeline (capped at 30 threads a sweep). With it off — or over
budget, or if the call fails — the cell carries the ledger's own description,
which costs nothing and is always true: *"Ravi Kumar wrote 3 times (2 chasers);
forwarded Sajid → Vishmika; answered by Vishmika on 2026-08-15 14:40."*

A thread of exactly one mail is left blank: there, T already says everything.

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

- **QUERY** → appended to the query sheet, columns A–AA, as above.
- **EXCLUDED** → appended to a second tab, default **“Other Mails”**, columns
  A–N: Date · Received time · Subject · Sender · Sender Email · File Handler ·
  TO List · Reason · Destination · CNTL · AI Summary · Mails in Thread ·
  Last Mail · Reply Summary. The tab is created with its header on first use.
  It carries the thread columns because on-ground traffic is what threads
  hardest — the same incident comes back four times before it is settled.

The pattern list is the `query_monitor_exclude_patterns` setting, edited under
*Configuration → Mail that is not a query*. One pattern per line: `#` comments,
`/…/flags` regular expressions, anything else a case-insensitive phrase. The
seed list covers vouchers, on/on-ground, discrepancy, refund, complaint, avail
checks, bare `NL…` references and mailer auto-replies.

Excluded mail costs no *extraction* GPT call and is never chased for a reply. It
does get a summary when the AI-read switch is on — "what is this on-ground
incident about" is the question this tab is opened to answer. It appears in
the dashboard under *Queries → Other mail*, with the pattern that caught it. A
mail can be moved between the two tabs by hand **before** it is written; after
that the API refuses, because this app never deletes rows and the move would
strand one on the old tab. *Re-check unwritten mail* re-applies an edited pattern
list to the backlog that has not been written yet.

### The two AI switches

They are separate settings and they do different jobs.

| Switch | Default | What it costs |
|---|---|---|
| *AI fallback for destination & travel date* | on | A `gpt-4o-mini` call **only** for mails whose destination or travel date the regexes could not read, and only for mail bound for the query sheet |
| *AI reads every new mail* | **off** | A `gpt-4o-mini` call for **every** new mail, on both tabs, to write column T |

The second one is off by default precisely because it is per-mail rather than
per-gap. When it is on, each newly recorded mail gets one sentence saying what is
being asked for — pax, nights, dates when the mail states them — with the model
told not to open with "This email is a request regarding…". The sentence is
flattened to a single line before it reaches the cell.

Three properties worth knowing:

- **A sweep is capped at 60 summaries.** A catch-up run over a long lookback, or
  a mailbox just switched on that returns a week of mail, would otherwise make
  hundreds of calls in one pass and time the function out before it reached the
  workbook. What is left over stays blank on an otherwise complete row.
- **A failure is a blank cell, never a lost row.** Nothing in the summary path
  can fail the sweep.
- **History is not backfilled.** Turning the switch on starts summarising the
  mail that arrives *afterwards*; rows already on the sheet keep an empty T.

Both are logged to `AiUsageLog` (`query_monitor_extraction` and
`query_monitor_summary`), so the spend is separable per switch.

### Deduplication

The same mail reaching five handlers is **one** entry. The key is the RFC
`internetMessageId` (falling back to conversation + normalised subject). Each
recipient is stored as a `QueryMonitorMatch`; their names are joined into the TO
List cell. If a handler is added later — mailbox activated, colleague CC'd — the
entry's row is rewritten in place rather than appended again.

### One row per query, not per mail

That key recognises one mail in five inboxes. It does **not** recognise the
*next* mail of the same conversation — the chaser, the "any update?", the agent
replying into their own thread. Each of those is a different `internetMessageId`,
so before thread merging each took a row of its own and the sheet showed

```
Re: URGENT QUOTE | 3501051 | Naga Suresh Naidu    12:24
Re: URGENT QUOTE | 3501051 | Naga Suresh Naidu    12:24
Re: URGENT QUOTE | 3501051 | Naga Suresh Naidu    12:24
```

three times over for one question. With **One row per thread** on (default), a
follow-up folds into the row the query already owns: the TO list grows if it
reached one more handler, `followUpCount` goes up, and the row is **rewritten**
in place. A follow-up whose arrival changes no cell costs no Graph call at all.

Two mails are the same thread when Graph gives them the same `conversationId`,
or — for mail that has none — when the normalised subject *and* sender domain
match **and** that subject carries a reference number — 5+ digits, or 4 that do
not read as a year. That condition is the safety of the fallback: agencies send
"Urgent quote required" several times a day and "SRILANKA // 15 ADULTS // JAN
3RD WEEK 2027" is a template, not an identifier; collapsing those *across
senders* would hide real queries, which is worse than a duplicate.

There is a third key, for the case neither of those sees: the **same address,
same subject, same day**. A generic subject re-sent an hour later is a new
`conversationId` and has no reference to thread on, so it used to become a second
entry and a second line directly under the first. Same person, same day, same
words is one query asked twice. The sender *address* is what makes this safe
where the domain would not: two agents at one agency sending the same generic
subject still keep a row each.

### A thread is not one query for ever — rounds

Folding every later mail into the first row is right *while the query is open*.
A chaser is the same unanswered question, and folding it keeps the SLA measured
from when it was first asked rather than letting an impatient agent reset the
clock by writing again.

It is wrong once we have actually answered. The agent coming back after a reply
is a new question with a new clock, and folding it made the sheet show nothing at
all: on 17 Aug the team watched real mail arrive and disappear into rows dated
the 6th, the 8th and the 11th, and typed those lines back in by hand.

So a mail that arrives after the thread's `repliedAt` opens a **new round**,
which takes a row of its own. Everything else still folds.

- **`repliedAt` is the test**, and it is only ever set by a *direct* reply
  addressed back to the asker. A forward to a colleague leaves it null, so
  passing a query on can never split a thread — which is the same rule that
  stopped a forward counting as an answer for the SLA.
- **The merge target is the thread's *latest* unmerged entry**, not its earliest:
  the round still open is the last one started. Within a round nothing changes,
  because that round's chasers are all `MERGED` and the only unmerged entry it
  has is the mail that opened it.
- **The append guard is relaxed for a round-opening entry** (`newRound` on the
  model). A row is normally protected by two identities — the exact one (date +
  allocation time + subject) and a looser same-day-same-subject one. The loose
  one cannot tell two rounds of a thread apart, so for these entries only the
  exact key applies. It carries the allocation time, which two rounds never
  share, so a write landing twice is still caught.

The practical effect on a day's mail: of fourteen follow-ups on 17 Aug, five had
arrived after we replied and now take a line each. The other nine are chasers on
queries **nobody has answered** — one of them sitting unanswered since 8 Aug —
and folding those is the point. Four separate lines would read as four queries;
one overdue row is the truth.

What a merge deliberately does **not** touch:

- **Allocation time (D)** stays the first mail's — the SLA is measured from when
  the query was asked, so a chaser cannot reset the clock.
- **Replied time (E) and Status (B)** stay as they are. "Replied" records that
  the team answered; an agent writing again does not un-answer it.

What it **does** record, so that folding a chaser away never hides it: **Mails in
Thread (R)** goes up by one and **Last Mail (S)** moves to the new mail's
timestamp. Every follow-up therefore rewrites its row — that is the price of one
line per query, and it is paid in a single range PATCH.

The follow-up is still stored as an entry — its `dedupKey` is what stops the next
sweep looking at the same mail again — with `mergedIntoId` pointing at the row it
belongs to and a sync state of `MERGED`, which is terminal: it is never written
to either workbook, and the dashboard lists it under its query rather than beside
it. `threadWindowDays` (default 30) caps how far back a follow-up may reach, and
never past the workbook's start date — a row in the *previous* file cannot be
rewritten.

**Duplicates already in the sheet** are cleaned up by *Configuration → Duplicate
rows → Merge duplicates*. It keeps the earliest row of each thread, brings it up
to date, deletes the later ones from both workbooks and renumbers every stored
row pointer below them. Only the layout's own columns are deleted and shifted up, so the
lists the team keeps to the right stay where they are.

*Remove duplicates* (the sheet-level sweep, `sheet-dedupe.ts`) works the other
way round — from the rows rather than from the database — and folds two lines
when either the subject names a reference and the day matches, or **every cell
describing the query** matches: day, subject, TO list, file handler, sales
person, destination, agent, travel date, CNTL, amendment, region. The
timestamps, reply state, SLA, thread count and AI summary are left out of that
comparison on purpose: they move after a row is written, so two copies of one
query never agree on them, and a rule that included them would keep exactly the
pairs the team is complaining about. Run it with *Preview* first — it reports
what it would delete without touching the workbook.

### Rows the database never knew about

`appendRows` puts a block in the workbook; the database write that records which
row each entry landed on is a **separate** call. A sync that dies between the two
— a Lambda timing out — leaves the rows on the sheet with their entries still
`PENDING`, and the next sync appends them again. No amount of thread merging
helps: nothing in the database points at the first copy.

Every end of that is covered, and the guards are layered because each one sees
something the others cannot.

- **One writer at a time.** The write takes its own lock (`query_monitor_sync_lock`),
  separate from the sweep lock. Both the sweep (auto-write on) and the *Sync to
  sheet* button write the same `PENDING` block; pressed while a sweep was
  writing, both read the same pending set, and the append guard below could not
  help — it reads the tail *before* the other writer's rows have landed, so
  neither saw the other. The second caller is now turned away with "a write is
  already running" and its rows stay `PENDING` for the write already in flight.
- **Within the block**, two pending entries that are the same query never become
  two rows. The later one is folded into the earlier — `mergedIntoId` points at
  it, its sync state becomes `MERGED`, and it counts towards the surviving row's
  *Mails in Thread*. Nothing is deleted: the mail is still stored and still
  listed in the dashboard under the query it belongs to. Same query means same
  day and same normalised subject, with either a reference number in the subject
  or the same sender address — the same test the collector uses, applied once
  more at the last gate.
- **Before appending**, the tail of the tab (last 200 rows) is read and any
  pending row already standing there is *claimed* — the entry is pointed at the
  row it turns out to own and drops out of the append. A row answers to the exact
  identity (date serial, timestamp serial, subject — the three cells nothing else
  edits) *and* to the reference-subject identity, so a repeat is caught whether
  it is one write landing twice or one query written twice. The sender is not a
  column on the query tab, so that key is applied inside the block instead, where
  the entries are still to hand. A tail that cannot be read is not fatal; the
  block is written, because a missing query is worse than a duplicate row.
- **Afterwards**, *Remove duplicates* in the page header reads the sheet itself
  and deletes repeated lines whether or not any entry claims them — see the rule
  under *One row per query*. The earliest line stays; entries that owned a
  deleted row become `MERGED` (never `PENDING`, which is what would put the row
  straight back) and pointers below are renumbered. `GET` the same route for a
  count without touching the file.

`mergeDuplicateEntries` works from the database outwards, this works from the
sheet inwards; they are separate on purpose.

### Rows the team moved

A stored `sheetRow` is a row *number*, and a row number only means what it meant
when it was recorded for as long as nobody inserts or deletes rows above it. The
team does insert rows — that is what a shared workbook is for. On 17 Aug two
hand-typed lines went in at 664–665 and pushed every row below them down by two
while the database went on pointing at the old numbers. Nothing complained:
`updateRow` writes to the number it is given, so the next reply on that thread
would have silently overwritten one of the lines just typed in.

So **an in-place rewrite now checks that the row still holds the query** before
writing it. The span covering the dirty rows is read once per tab — padded on
both sides, because where the rows *were* is not where they may have gone — and
each entry is matched to the row that actually carries it, by the exact identity
the append guard already uses: date serial, allocation-time serial and subject,
the three cells nothing else edits. Three outcomes:

- **the stored row still matches** — the ordinary case, and the ordinary cost is
  one extra range read per sweep;
- **it moved** — the pointer is corrected to where the row now is, in the
  database as well as for this write, so the drift is repaired permanently and
  reported in the run log;
- **it is nowhere in the span** — the write is **skipped**, and the entry goes
  `FAILED` with an explanation. A row that cannot be found is a row that must not
  be guessed at: writing blind is precisely how a hand-typed line gets destroyed.
  Clear the stale row and press *Retry failed writes* to append it fresh.

A read that fails leaves every entry unverified and the old behaviour standing —
a sweep must not stop because a range read did.

Note that the append point was never affected by any of this: it is found by
scanning column C from the bottom, so appends land correctly under hand-typed
rows whatever the stored pointers say. Only the in-place rewrites were exposed.

### When a write fails

A failed write leaves the entry `FAILED` with the Graph error on it — a
mismatched header, a locked file, a timeout — and **nothing picks it up again**:
the sync looks for `PENDING` and `DIRTY` only. Fixing the cause is therefore not
enough on its own; the backlog has to be put back in the queue.

*Retry failed writes* (the banner on the Queries tab, `POST
/api/query-monitor/retry`) does that and writes in one press. Which state each
entry goes back to is the part that matters:

- **no row number** in that workbook → `PENDING`, so it is appended;
- **a row number already** → `DIRTY`, so its row is *rewritten in place*.

Sending the second kind back as `PENDING` is exactly how a retry becomes a
duplicate line — the row is already there, and appending puts a second one under
it. The two workbooks are decided separately: the live file can be written and
the backup behind, or the reverse.

Entries received before the workbook's start date are left `FAILED` rather than
requeued — the next write would only close them off as `SKIPPED` again — and are
reported in the message so the count adds up.

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

### Growing the layout over a sheet already in use

Columns O–T (and K on the other-mail tab) were added in August 2026 to a workbook
the team was already reading. Nothing was migrated and nothing was rewritten:

- Row 1 is **widened, not replaced**. `headerExtension` accepts a header that is
  a *prefix* of the current layout with every cell after it blank, and then
  writes only those blank cells. Not one existing column name changes, so not one
  existing value changes meaning.
- Before widening, the rows below are read across the new columns. If **anything**
  is already standing there — a lookup list, a pivot helper — the widening is
  refused and reported. Once those columns are ours, every append and rewrite
  writes over them, so that has to be a person's decision.
- Rows already on the sheet keep O–T blank until something makes them dirty: a
  reply landing, a chaser arriving, a hand edit. History is not backfilled; the
  detail starts from the day the columns went in.

### “Column mismatch”

The tab's header is neither the expected layout nor an older layout of ours that
can be widened into it — almost always a file copied from an earlier sheet.
Press **Prepare**.

A header that is genuinely *wrong* (rather than merely short) is only rewritten
while the tab holds **no data rows**. Above real rows it is left alone and
reported instead: relabelling columns without moving the values underneath would
silently change what every cell means. A tab in that state needs a human, and
the Configuration tab offers the two ways out described next.

The sync applies the same rule. It refuses to append into a mismatched tab rather
than writing the full layout under a shorter header, where every value past the
break would land in the wrong column.

### Keeping a header the team edited, or putting the layout back

Both buttons sit under the mismatch message in **Configuration → Target
workbook**, and both keep every row already on the sheet. They act on the live
workbook and on the backup together, so the two files never end up on different
layouts.

**Keep this header** (`adopt`) changes *nothing* on the workbook — not row 1, not
a cell. Each of our fields is matched to the column that now carries its name,
by exact name first and then by a short alias list (`Handler` → File Handler,
`Recipients` → TO List, `Thread count` → Mails in Thread…). That mapping is
stored per workbook and tab, and from then on rows are written into those
columns:

- Columns of the team's *between* ours are never written to — a block goes out as
  one range call per run of neighbouring mapped columns, not one call across the
  span.
- A field the header has no column for is simply not written, and is listed in
  the status panel so nobody waits for a column that will never fill.
- Reads project back into layout order, so the append guard, the duplicate sweep
  and the dashboard preview are unaware the tab is laid out differently.
- The header the mapping was taken from is stored with it. If row 1 changes
  again, the mapping is stale and the sweep stops exactly as it does now, rather
  than writing a column out — press the button again to re-read it.

**Restore standard layout** (`restore`) puts our layout back, in this order:

1. The tab is copied — values *and* number formats — to a new `… bak MMDD-hhmm`
   tab. Everything the team had, including columns ours has no field for, is on
   that tab afterwards.
2. Every data row is moved into the columns the standard layout expects, matched
   by the heading it was sitting under: a value under `Recipients` comes back
   under TO List in column G.
3. Row 1 is rewritten as our header and the mapping is dropped, so writing goes
   back to being by position.

Rows keep their row numbers and their order throughout, so the row pointer stored
per entry still points at the same query: nothing is re-appended and nothing is
re-synced. The one thing that does not survive on the *live* tab is a column of
the team's that stood inside A–AA — that column now carries one of our fields. It
is intact on the archive tab, and the columns affected are named back in the
confirmation message.

### The backup must be a different file

Two share links can resolve to the same workbook. If they do, the mirror would
append every row to that one file twice, and the two sets of row numbers would
collide so later rewrites would land on the wrong rows.

Identical URLs are rejected on save; identical *drive items* (a copied or
re-shared link to the same file) are caught at sync time by comparing the
resolved `driveId`/`itemId`, and the backup pass is skipped with a warning in the
run log.

## Safety properties

- **Columns A–AA only** on the query sheet; anything further right belongs to the
  team's lookup lists and pivots and is never written. (The other-mail tab uses
  A–N.) The layout can only grow into columns verified empty first — see
  *Growing the layout over a sheet already in use*.
- **The File Handler is always someone on the TO list**, or blank. Enforced by
  the API, not just the UI.
- **The two tabs must differ.** Saving the same name for both is rejected —
  nine-column rows appended to the query sheet would wreck it.
- **Append point is found by scanning column C from the bottom**, not from
  `usedRange` — the sheet carries formatted-but-empty rows past the last entry.
- **Every written row's number is stored** on the entry, so a row can be traced,
  re-read, or corrected in place. The duplicate clean-up is the only thing that
  deletes rows, and it renumbers those pointers in the same pass.
- **A row is never rewritten without checking it is still the right row.** Row
  numbers go stale the moment anyone inserts or deletes rows in Excel; a rewrite
  that cannot confirm its target is skipped rather than allowed to overwrite
  whatever is standing there — see *Rows the team moved*.
- **A follow-up never starts a row.** Merged entries are terminal (`MERGED`);
  neither a sync, a rebase nor a reclassify can put them back in the queue.
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
  thread.ts      thread identity — conversation, or subject+domain with a ref
  extract.ts     destination / travel date / CNTL parsing, GPT fallback
  summarize.ts   the one-sentence summary behind "AI reads every new mail"
  sheet.ts       workbook resolution, append, in-place update, tail read,
                 adopting / restoring a hand-edited header
  header-map.ts  matching a header the team edited to our fields, and the
                 stored mapping the writes then go out under
  sheet-dedupe.ts  duplicate *rows* on the tab, incl. ones no entry claims
  run.ts         the sweep: collect → dedup → enrich → write, with the run log
  scheduler.ts   per-minute tick that decides when a sweep is due
  auth.ts        admin guard for the API routes

src/app/api/query-monitor/{entries,mailboxes,rules,runs,settings,run,sync,sheet,reclassify,rebase,dedupe,sheet-dedupe,sheet-header,retry}
src/app/api/cron/query-monitor
src/app/dashboard/admin/query-monitor/    page + queries / config / logs tabs
prisma/sql/query-monitor.sql              table creation
prisma/sql/query-monitor-mail-kind.sql    mailKind / excludeReason / sheetTab columns
prisma/sql/query-monitor-to-list.sql      toList + backup row/state columns
prisma/sql/query-monitor-thread-merge.sql thread keys, mergedIntoId, followUpCount
prisma/sql/query-monitor-reply-detail-ai-summary.sql
                                          repliedBy, aiSummary, aiSummaryAt
prisma/sql/2026-08-15-query-monitor-thread-ledger.sql
                                          thread events table + roll-up columns
prisma/sql/2026-08-17-query-monitor-thread-rounds.sql
                                          newRound — a thread can hold more
                                          than one query, see "rounds" above
```

## Known gaps

- `availcheck@aahaas.com` is not a mailbox in the tenant (Graph:
  `ErrorInvalidUser`). It is seeded **inactive** with that reason on the record —
  correct the address (or licence the shared mailbox) in the UI and activate it.
- Deleting an entry that has already been written does not clear its sheet row;
  the API refuses and tells you to clear the row in Excel first.
