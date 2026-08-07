-- Query Monitor — split "not a query" mail onto a second worksheet.
--
-- Additive only: three nullable/defaulted columns and one index on
-- `query_monitor_entries`. Nothing existing is dropped or retyped.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/query-monitor-mail-kind.sql --schema prisma/schema.prisma
--
-- MySQL/MariaDB have no `ADD COLUMN IF NOT EXISTS` on every version, so each
-- statement is guarded by information_schema and prepared dynamically — the
-- whole file is safe to re-run.

-- mailKind: QUERY (master sheet) | EXCLUDED (other-mail tab)
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `mailKind` VARCHAR(191) NOT NULL DEFAULT ''QUERY''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'mailKind'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- excludeReason: the pattern that diverted the mail
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `excludeReason` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'excludeReason'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sheetTab: which worksheet `sheetRow` counts rows on
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `sheetTab` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'sheetTab'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_mailKind_idx` ON `query_monitor_entries` (`mailKind`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_mailKind_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing rows keep `sheetTab` NULL, which the app reads as "the query sheet" —
-- correct, because that is the only tab anything has been written to so far.
