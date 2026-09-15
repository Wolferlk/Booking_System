# Database load — what was changed, and what to do next

Written for: whoever is on call for `aahaas-prod-database-4`.

## The short version

Three fixes are in: **connection pool caps**, **read-replica routing**, and
**indexes**. All three are safe and all three were worth doing. But the
measurements below say the indexes are *not* what was driving the CPU, and the
real offender has not been found yet. Read "What still needs finding" before
closing this out.

Two commands, both read-only:

```bash
npm run db:health      # server counters — why is CPU high?
npm run db:indexes     # which performance indexes are missing?
```

`npm run db:indexes -- --apply` is the only command here that writes, and it only
ever runs `ALTER TABLE ... ADD INDEX`.

---

## What the server actually says

From `npm run db:health` against the live primary (MariaDB 10.11, 1,193 h uptime):

| Measure | Value | Reading |
|---|---|---|
| Buffer pool hit ratio | **99.92 %** | Not I/O bound. The working set fits in RAM. |
| Rows scanned per query | **1,294** | ~54,000 rows/sec read sequentially. **This is the CPU.** |
| Full scans | **24 % of all queries** | A quarter of queries read a whole table. |
| Joins without an index | 947,000 | |
| On-disk temp tables | 1,317,000 | |
| Peak connections | **503 / 500** | The limit has been hit. This is the P1001 / P2024 source. |

The two ratios matter together. A high hit ratio with a high scan rate means the
server is spending CPU walking rows that are *already in memory* — so the fix is
to stop the scans, not to add RAM or faster storage.

## What the data looks like

| Schema | Size |
|---|---|
| `apple_booking_system` (this app) | 1.1 GB / 84 tables |
| `invoice_processor` (Payable) | **11.8 GB / 97 tables** |

The weight is overwhelmingly on the Payable side, and it is blob weight rather
than row weight:

| Table | Size | Rows | Per row |
|---|---|---|---|
| `pnl_price_adjustments` | 8.0 GB | 116,000 | 72 KB |
| `onedrive_process_log` | 1.7 GB | 21,000 | 81 KB |
| `incoming_emails` | 0.6 GB | 6,800 | 94 KB |
| `mail_messages` (ops) | 0.5 GB | 4,900 | 102 KB |

A `SELECT *` over a few thousand rows of any of these moves hundreds of
megabytes. That is the shape of query that produces 1,294 rows/query and 24 %
full scans.

---

## Fix 1 — Indexes

**Status: applied to the schema, five confirmed missing on live, not yet created.**

### The statements in the original brief do not run against this schema

```sql
ALTER TABLE `Booking` ADD INDEX `idx_status_vn` (`status`, `vnNumber`);
ALTER TABLE `Flight`  ADD INDEX `idx_arrival_date` (`arrivalDate`);
```

* The tables are `bookings` and `flights` (Prisma `@@map`), not `Booking` / `Flight`.
* There is no `vnNumber` column anywhere in this database. The Apple System
  reference is `bookings.isNumber`.
* `flights` has no `arrivalDate`. The flight date column is `flights.date`;
  `arrivalDate` lives on `bookings`, and already has an index.

### What was added instead

Chosen to match the `WHERE` clauses the schedulers actually issue:

| Index | Serves |
|---|---|
| `bookings (createdAt)` | File-handler resolve sweep — the only bound its `LIKE '%sundays%'` can seek on |
| `bookings (status, createdAt)` | PortalLink welcome sweep |
| `bookings (status, arrivalDate)` | PortalLink reminder, D-3 queues, dashboard counts |
| `bookings (isNumber)` | Apple System lookups — the real counterpart of `vnNumber` |
| `flights (date)` | Today's flights on `/api/overview` and `/api/dashboard/stats` |

### Be honest about the expected gain

`bookings` is **2,682 rows / 16 MB**. `flights` is **7,362 rows / 1 MB**. Tables
this small cannot produce 99.8 % CPU no matter how often they are scanned. These
indexes are correct and worth having — they stop the sweeps from getting slower
as the tables grow — but **do not expect them to move the CPU graph.**

### Applying them

```bash
npm run db:indexes              # check — writes nothing
npm run db:indexes -- --apply   # create the missing ones
```

Safe on live: adding a secondary index reads no rows and changes none, and each
`ALTER` runs `ALGORITHM=INPLACE, LOCK=NONE` so the tables stay readable and
writable throughout. The script verifies the table and every column against
`information_schema` first and skips anything already present, so re-running it
is a no-op.

**Do not use `prisma db push`.** Live has drifted from `schema.prisma`; a push
would try to reconcile the whole schema, not just these indexes. The indexes are
declared in `schema.prisma` only so the model and the database agree.

## Fix 2 — Read-replica routing

**Status: code in place, inactive until `DB_READ_HOST` is set.**

Set it in **the Amplify environment**, not only local `.env` — production reads
its own configuration, and this codebase has had prod/local env drift before:

```
DB_READ_HOST=aahaas-prod-database-5.crgimm6mohf1.ap-southeast-1.rds.amazonaws.com
```

Only the host differs; port, schema, user and password are reused from the
primary, so the read side cannot land on a different database.

What moves to the replica: the file-handler resolve sweep, both PortalLink
sweeps, and the read-only dashboard aggregates (`/api/overview`,
`/api/dashboard/stats`). Every write stays on the primary.

What does **not** move, deliberately: existence checks that decide whether to
create a booking (AS watch / AS reconcile). A replica is behind by a small,
unbounded amount, and a stale "no such booking" would import a duplicate. The
rule is written at the top of [`src/lib/prisma-read.ts`](../src/lib/prisma-read.ts).

Kill switch: **Settings → Database Health** has a toggle that sends every read
back to the primary. It takes effect on the next query, no redeploy.

### Payable (Laravel) side

`config/database.php` gained two always-read-only connections, `mysql_read` and
`ops_read`, which point at `DB_READ_HOST` and fall back to the primary when it is
unset. Use them from reports and sweeps:

```php
DB::connection('mysql_read')->table('pnl_records')->...
```

A full read/write split on the main `mysql` connection is also wired, but is
**opt-in** (`DB_SPLIT_READS=true`) rather than automatic. `emails:fetch` and
`pnl:fetch` decide whether to process a mail by first SELECTing whether they
already have it; served stale, that check processes the same mail twice.
`sticky => true` covers reads *after* a write in the same run, but not the first
read of a run. Confirm the dedupe path before switching it on.

## Fix 3 — Connection pool caps

**Status: live, with defaults.**

`Max_used_connections` is **503 against a limit of 500** — the server has
refused connections. That, not indexing, is where Prisma `P1001` and `P2024` come
from.

The caps are applied in [`src/lib/db-tuning.ts`](../src/lib/db-tuning.ts) at the
point where the connection string is resolved, rather than by editing
`DATABASE_URL`. This app resolves its connection from four different sources
(`DB_*` parts, `DIRECT_DATABASE_URL`, `MYSQL_URL`, `DATABASE_URL`) and only one of
them is the line an operator would think to edit — capping at the resolver means
every path is capped. A `?connection_limit=` already present in the environment
still wins.

```
DB_POOL_LIMIT=15        # per process; 15 x instance count must stay under 500
DB_POOL_TIMEOUT=30
DB_CONNECT_TIMEOUT=10
DB_READ_POOL_LIMIT=10
```

Note that Payable, the B2C platform and anything else on this instance share the
same 500. Capping this app alone does not guarantee headroom for all of them.

---

## What still needs finding

The 1,294-rows-per-query figure is instance-wide and is not explained by anything
fixed above. To find the queries responsible:

1. **Lower the slow-query threshold.** `long_query_time` is currently **10 s**, so
   the slow log only records catastrophes — 5,078 of them. Set it to `1` in the
   RDS parameter group (dynamic, no restart) and let it collect for an hour.
2. **Read the log** with `pt-query-digest`, or via Performance Insights →
   Top SQL. Rank by *rows examined*, not by duration.
3. **Suspect the blob tables first.** Any `SELECT *` against
   `pnl_price_adjustments`, `onedrive_process_log`, `incoming_emails`,
   `pnl_records` or `mail_messages` moves 70–100 KB per row. `pnl_records`
   carries full email bodies — it should never be selected with `*`.
4. **Then consider archiving.** 8 GB of `original_payload` / `lines` longtext in
   `pnl_price_adjustments` is history, not working data. Moving rows older than a
   year to an archive table would shrink the scan surface directly.

One more thing worth fixing while you are in there: `.env` defines `DB_DATABASE`
twice — `apple_booking_system` near the top and `invoice_processor` further down —
and the loader keeps the last one. Scripts here name the database explicitly for
that reason, but it is a trap for the next person.
