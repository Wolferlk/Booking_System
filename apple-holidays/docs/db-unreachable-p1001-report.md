# "Can't reach database server" (P1001): why it happens and what to change

Written for: the team running the `apple-bo…` PM2 process on `/var/www/Apple-Booking-system`.
Date: 2026-10-14
Status: **report only. No code, config or database was changed to write this.**

---

## 1. What the log says

```
code: 'P1001'   modelName: 'Booking'
Invalid `prisma.systemSetting.findUnique()` invocation:
Can't reach database server at aahaas-prod-database-4...:3306
[QueryMonitor] Scheduled sweep SUCCESS — 1 new, 1 appended, 0 error(s)
[AsReconcile] auto 2026-10-13→2026-10-14: upstream=0 created=0 ... parity=false (61110ms)
```

What these lines tell us:

| Observation | Meaning |
|---|---|
| `P1001` | Prisma could not **open a new TCP/MySQL connection** within `connect_timeout` (10 s in this app, set in `src/lib/db-tuning.ts`). The error comes from opening a connection. A slow query would fail differently (P2024 / P1008). |
| Two different models fail (`Booking`, `systemSetting`) | The failures don't depend on the query or the table, so this isn't a bug in one feature. The whole process is losing its connection to the database. |
| `QueryMonitor ... SUCCESS` appears **between** the failures | The database is **not down**. Some connections get through and some don't, so it fails on and off. That pattern points to an **overloaded or full** database, not a stopped one. |
| `AsReconcile ... upstream=0 ... parity=false (61110ms)` | The reconcile run took 61 s and found nothing. That's what a run looks like when its DB calls are timing out and retrying inside its retry budget. `parity=false` is a **side effect of the outage**. It doesn't mean AppleSystem and OPS have really drifted apart. |
| `node_modules/next/dist/server/lib/start-server.js` | This is the self-hosted `next start` under PM2, not Amplify. So **all background schedulers run inside this one process** (see section 3). |

## 2. Root cause (most likely)

**`aahaas-prod-database-4` is running out of connection slots and CPU, so new connections time out.**

We measured this before, in `docs/database-load.md` (from `npm run db:health` on the live primary):

- **Peak connections: 503 / 500.** The server has already hit `max_connections`.
- **CPU ~99.8 %** on the hourly scheduler ticks (noted in `src/lib/db-tuning.ts`).
- 24 % of queries are full table scans; about 1,294 rows read per query.

When CPU is pinned, the MySQL handshake (TLS, auth, session setup) can take longer than 10 s, and Prisma reports **P1001**. When the connection limit is hit, new connections are refused. Both effects come and go with load, which matches the success-between-failures pattern above.

### Why so many connections hit this one server

The **same RDS instance** serves almost everything:

| Client | Where | Connections |
|---|---|---|
| This app, Prisma primary | `src/lib/prisma.ts` | pool up to **15** per process |
| This app, Prisma "replica" | `src/lib/prisma-read.ts` | up to **10** more. If `DB_READ_HOST` is not set on this server, `readDb()` falls back to the primary anyway |
| This app, raw `mysql2` | `b2b-db.ts`, `b2c-db.ts`, `quote-ai-db.ts`, `accounts-db.ts`, `accounts-driver-advance-db.ts`, `chat/db.ts` | **new connection per call** (`mysql.createConnection`), no pool, so many open/close handshakes |
| This app, WhatsApp shared inbox | `whatsapp-shared-inbox-sync.ts` | pool of 3 |
| Amplify deployment of ops | Lambda | 15 per Lambda instance × N instances |
| Payable / `invoice_processor` | separate app, same host | 11.8 GB schema, blob-heavy scans |
| Apple Accounts, B2C (`production_live1`), n8n | same host | unknown |

Each PM2 instance gets its own 15 + 10 pool. If the app runs in **cluster mode** (`pm2 ls` shows more than one `apple-bo…` row), every instance also runs **every scheduler**, so the load doubles or triples.

### Why the background schedulers make spikes worse

`src/instrumentation.ts` → `startCronJobs()` and friends start about 20 timers in this one process: cancellation watch (2 min), file-handler sweep (5 min), TQ auto (5 min), AS live watch and AS reconcile (15 min), query monitor, report scheduler, VN checklist (minute ticks), and node-cron daily jobs (06:00, 10:00, 18:00, midnight).

- Many share round-number boundaries, so they **start in the same second** and grab connections together.
- Almost every tick begins with `systemSetting.findUnique(...)` to check its on/off switch (**99 call sites** in `src/`). That's why `systemSetting.findUnique` is the query that shows up failing: it is the most frequent query.
- When the DB is unreachable, each job **still runs on schedule** and waits through the 10 s connect timeout (and `withAsRetryBudget` retries for AsReconcile). Every job keeps knocking on a server that is already struggling, and the log fills with these errors.

### Other causes to rule out (less likely, but check them)

1. **RDS event**: reboot, failover, maintenance window or storage autoscaling around the error time (RDS console → Events). This would show as a burst of failures with *no* successes in between.
2. **Network/security group** change between the PM2 server and RDS. This would make it fail *every* time, which doesn't match the log.
3. **DNS**: the server briefly failing to resolve the RDS hostname.

## 3. How to confirm (all read-only)

On AWS:
- CloudWatch for `aahaas-prod-database-4` at the error timestamps: **DatabaseConnections**, **CPUUtilization**, **FreeableMemory**, **ReadIOPS**. If connections are near 500 or CPU is near 100 %, that confirms the cause.
- RDS → Events for the same window.

On the database (read-only SQL):
```sql
SHOW GLOBAL STATUS WHERE Variable_name IN
 ('Max_used_connections','Threads_connected','Aborted_connects',
  'Connection_errors_max_connections','Connection_errors_internal');
SHOW VARIABLES LIKE 'max_connections';
SHOW VARIABLES LIKE 'wait_timeout';
-- who holds the connections:
SELECT user, SUBSTRING_INDEX(host, ':', 1) AS client, db, command, COUNT(*) AS n
FROM information_schema.PROCESSLIST
GROUP BY 1,2,3,4 ORDER BY n DESC;
```
If `Connection_errors_max_connections` keeps rising, the server is refusing connections because the limit is full.

On the PM2 server:
```bash
pm2 ls                                   # how many apple-bo instances? fork or cluster?
nc -zv aahaas-prod-database-4.crgimm6mohf1.ap-southeast-1.rds.amazonaws.com 3306
pm2 logs 2 --lines 2000 | grep -c P1001   # how often
pm2 logs 2 --lines 2000 | grep -E "P1001|Scheduler|sweep" | head -100   # do failures line up with ticks?
grep -E "^DB_(POOL|READ|CONNECT)|REPLICA" .env   # is a replica / pool cap configured here?
```

## 4. Suggested changes

These are ordered by the most relief for the least risk. **None of them have been made.**

### A. Config only (no code deploy)

1. **Run one PM2 instance, in fork mode**, for this app (or see C1). Every extra instance duplicates every scheduler and every pool.
2. **Set the pool explicitly on the PM2 server's `.env`**:
   `DB_POOL_LIMIT=8`, `DB_READ_POOL_LIMIT=5`, `DB_CONNECT_TIMEOUT=20`, `DB_POOL_TIMEOUT=30`.
   A longer connect timeout lets the handshake finish when the server is busy, instead of failing at 10 s.
3. **Point reads at a replica**: set `DB_READ_HOST=<replica endpoint>` so `readDb()` really leaves the primary. Today, without it, both clients hit the primary.
4. **Give each app its own DB user with `MAX_USER_CONNECTIONS`** (e.g. ops 60, Payable 60, n8n 30). Then one app's spike can't take the whole server down. This is a DBA change; it needs care because it touches live users.
5. **Lower `wait_timeout`** (e.g. 300 s) in the RDS parameter group so idle sleeping connections are released. Check `SHOW PROCESSLIST` first to see how many are `Sleep`.

### B. Code changes (small, low risk)

1. **Cache `systemSetting` reads.** Add a small in-memory cache (30–60 s TTL) around the on/off switch lookups that schedulers do every tick. `prisma-read.ts` already does this for `db_replica_reads_enabled`; reuse the same pattern. This removes most of the 99 call sites' repeated traffic.
2. **DB-down circuit breaker for schedulers.** After a P1001/P1017/P2024, set a shared "DB unhealthy until T+2 min" flag. Every scheduler `tick()` checks the flag first and skips that run with one log line, instead of each job retrying against a struggling server.
3. **Stagger scheduler start times.** Add a fixed offset per job (e.g. reconcile at :07, file-handler at :02) so they don't all fire on the same minute boundary.
4. **Make AsReconcile fail fast and say so.** When the DB is unreachable, record `run.error = 'db_unreachable'` and stop. Don't report `upstream=0 ... parity=false` after 61 s, which reads like a real parity gap and can trigger a false alert from `notifyOnProblem`.
5. **Pool the raw `mysql2` clients.** Replace the per-call `mysql.createConnection` in `b2b-db.ts`, `b2c-db.ts`, `quote-ai-db.ts`, `accounts-db.ts`, `accounts-driver-advance-db.ts` with one `mysql.createPool({ connectionLimit: 3–5 })` each, cached on `globalThis` the way `prisma.ts` does it. Opening a new connection for every query is the most expensive thing to do to a CPU-bound server.

### C. Structural (bigger, later)

1. **Separate the schedulers from the web server.** Run the background jobs in **one** dedicated PM2 process (e.g. `RUN_SCHEDULERS=true` only on that one) and have web instances skip `startCronJobs()`. Then web traffic and background load can't starve each other, and scaling the web side doesn't multiply the jobs.
2. **Put RDS Proxy in front of `aahaas-prod-database-4`.** It pools connections across PM2, Amplify Lambdas, Payable and n8n. This is the standard fix for Lambda plus a long-running server sharing one MySQL.
3. **Move `invoice_processor` (Payable, 11.8 GB of blobs) off the primary**, or at least stop `SELECT *` on its blob tables. `docs/database-load.md` identifies this as where most of the CPU goes.
4. **Finish the scan fixes** in `docs/database-load.md` (missing indexes, blob columns excluded from list queries).

## 5. Recommended order

1. Run the section 3 checks to confirm connection limits or CPU are the cause (about 15 minutes).
2. A1 + A2 + A3: config only, can be done today.
3. B1 + B2 + B4: one small deploy that stops the background jobs from making an outage worse.
4. B5, C1, C2 as planned work.
