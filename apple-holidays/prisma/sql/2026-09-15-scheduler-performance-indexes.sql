-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduler performance indexes — aahaas-prod-database-4
--
-- Problem: the hourly sweeps drive the primary to ~99.8% CPU. Every one of the
-- three worst offenders filters on a column with no index, so MariaDB reads the
-- whole table each tick:
--
--   FileHandlerResolve (every 5 min)  WHERE fileHandler LIKE '%sundays%'
--                                       AND createdAt BETWEEN ? AND ?
--   PortalLink welcome (daily)        WHERE status NOT IN (...)
--                                       AND createdAt BETWEEN ? AND ?
--                                       AND departureDate >= NOW()
--   PortalLink reminder (daily)       WHERE status NOT IN (...)
--                                       AND arrivalDate BETWEEN ? AND ?
--   /api/overview  (every page load)  WHERE flights.date BETWEEN ? AND ?
--
-- `bookings.createdAt` and `flights.date` have no index at all. `bookings.status`
-- has one but it is low-cardinality on its own; paired with a date it becomes
-- selective.
--
-- ── Differences from the brief ───────────────────────────────────────────────
-- The requested statements were:
--     ALTER TABLE `Booking` ADD INDEX `idx_status_vn` (`status`, `vnNumber`);
--     ALTER TABLE `Flight`  ADD INDEX `idx_arrival_date` (`arrivalDate`);
-- Neither runs against this schema:
--   * the tables are `bookings` and `flights` (Prisma @@map), not `Booking`/`Flight`;
--   * there is no `vnNumber` column anywhere — the Apple System reference is
--     `bookings.isNumber`, indexed separately below;
--   * `flights` has no `arrivalDate`; the flight date column is `flights.date`,
--     and `arrivalDate` lives on `bookings` (already indexed).
-- The statements below are the equivalents that match the queries actually run.
--
-- ── Safety ───────────────────────────────────────────────────────────────────
-- Adding a secondary index is non-destructive: no row is read, changed or
-- dropped. ALGORITHM=INPLACE, LOCK=NONE keeps the tables readable and writable
-- for the duration, so the live app keeps serving while this runs.
--
-- Run it through `npm run db:indexes -- --apply`, which checks each index and
-- column against information_schema first and skips anything already present.
-- Do NOT run `prisma db push` on this database — live has schema drift from the
-- Prisma schema and a push would try to "correct" it.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The file-handler sweep's date window, every 5 minutes. Highest impact:
--    this is the only bound the LIKE '%sundays%' scan can seek on, and without
--    it every tick reads all of `bookings`.
ALTER TABLE `bookings`
  ADD INDEX `idx_bookings_createdAt` (`createdAt`),
  ALGORITHM=INPLACE, LOCK=NONE;

-- 2. PortalLink welcome — status filter narrowed by the creation-date window.
ALTER TABLE `bookings`
  ADD INDEX `idx_bookings_status_createdAt` (`status`, `createdAt`),
  ALGORITHM=INPLACE, LOCK=NONE;

-- 3. PortalLink reminder, the D-3 queues, and most dashboard counts, which all
--    pair a status filter with an arrival-date range.
ALTER TABLE `bookings`
  ADD INDEX `idx_bookings_status_arrivalDate` (`status`, `arrivalDate`),
  ALGORITHM=INPLACE, LOCK=NONE;

-- 4. The Apple System reference. Looked up by the AS import, the reconcile
--    sweep and the drive-log screens; unindexed today.
ALTER TABLE `bookings`
  ADD INDEX `idx_bookings_isNumber` (`isNumber`),
  ALGORITHM=INPLACE, LOCK=NONE;

-- 5. Today's flights — /api/overview and /api/dashboard/stats both range-scan
--    this on every load. This is the real counterpart of the requested
--    `Flight(arrivalDate)` index.
ALTER TABLE `flights`
  ADD INDEX `idx_flights_date` (`date`),
  ALGORITHM=INPLACE, LOCK=NONE;
