-- Query Monitor — one File Handler per row, everyone else in TO List, plus a
-- mirrored backup workbook.
--
-- Additive only: four columns and one index on `query_monitor_entries`, then a
-- one-time backfill. Nothing existing is dropped or retyped.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/query-monitor-to-list.sql --schema prisma/schema.prisma
--   npx prisma generate
--
-- Each statement is guarded by information_schema and prepared dynamically, so
-- the whole file is safe to re-run.

-- toList: every mailbox the mail reached, comma-joined (sheet column G).
-- VARCHAR with a default, not TEXT: MySQL forbids defaults on TEXT, and a
-- NOT NULL column with no default cannot be added to a table that already has
-- rows without a destructive rebuild.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `toList` VARCHAR(500) NOT NULL DEFAULT ''''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'toList'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- backupSheetRow: the row this entry owns in the standby workbook
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `backupSheetRow` INT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'backupSheetRow'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- backupSyncStatus: the standby workbook tracks its writes separately
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `backupSyncStatus` VARCHAR(191) NOT NULL DEFAULT ''PENDING''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'backupSyncStatus'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `backupSyncError` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'backupSyncError'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_backupSyncStatus_idx` ON `query_monitor_entries` (`backupSyncStatus`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_backupSyncStatus_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── One-time backfill ────────────────────────────────────────────────────────
-- `handlerNames` used to hold every recipient comma-joined. That list is now the
-- TO List, and `handlerNames` narrows to a single owner: keep it where the mail
-- only ever reached one mailbox, and blank it where it reached several — those
-- rows get their owner from the first reply, or from the dashboard dropdown.

UPDATE `query_monitor_entries`
   SET `toList` = LEFT(`handlerNames`, 500)
 WHERE `toList` = '';

UPDATE `query_monitor_entries`
   SET `handlerNames` = ''
 WHERE `handlerNames` LIKE '%,%';
