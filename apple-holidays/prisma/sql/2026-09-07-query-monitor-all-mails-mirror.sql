-- Query Monitor — the hand-editable mirror of the all-mail ledger.
--
-- A second worksheet beside "All Mails" carrying the same rows, that the team
-- may type into. The app's own All Mails tab is cleared and rewritten whole on
-- every sweep, which is right for a ledger nobody edits and fatal for one they
-- do. This mirror is appended to and never rewritten.
--
-- The row pointer below is the load-bearing part, and it is worth being precise
-- about why. What gets appended is decided from THIS COLUMN, never from reading
-- the tab: a message that already has a row number is one we have written, so it
-- is never a candidate again. That is what makes a line deleted by hand stay
-- deleted — reading the sheet to decide would put every one of them back on the
-- next sweep.
--
-- Additive only. No column is dropped, retyped or backfilled. Every row already
-- in the table reads PENDING with a null pointer, which is exactly what it is:
-- not yet on the mirror.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/2026-09-07-query-monitor-all-mails-mirror.sql --schema prisma/schema.prisma
--
-- Every statement is guarded by information_schema and prepared dynamically, so
-- the file is safe to re-run.

-- mirrorRow — the row this message occupies on the mirror. Set once, never cleared.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_mails` ADD COLUMN `mirrorRow` INT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mails'
    AND COLUMN_NAME  = 'mirrorRow'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- mirrorStatus — PENDING | SYNCED | FAILED | SKIPPED. There is no DIRTY.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_mails` ADD COLUMN `mirrorStatus` VARCHAR(191) NOT NULL DEFAULT ''PENDING''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mails'
    AND COLUMN_NAME  = 'mirrorStatus'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- mirrorError — why the last attempt to copy this message across did not land.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_mails` ADD COLUMN `mirrorError` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mails'
    AND COLUMN_NAME  = 'mirrorError'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The mirror pass selects on this every sweep.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_mails_mirrorStatus_idx` ON `query_monitor_mails` (`mirrorStatus`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mails'
    AND INDEX_NAME   = 'query_monitor_mails_mirrorStatus_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
