-- Query Monitor — one row per thread, not one row per mail.
--
-- Additive only: five nullable/defaulted columns and three indexes on
-- `query_monitor_entries`. Nothing existing is dropped or retyped.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/query-monitor-thread-merge.sql --schema prisma/schema.prisma
--
-- MySQL/MariaDB have no `ADD COLUMN IF NOT EXISTS` on every version, so each
-- statement is guarded by information_schema and prepared dynamically — the
-- whole file is safe to re-run.

-- threadKey: conversationId when Graph gives one, else subjectKey
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `threadKey` VARCHAR(190) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'threadKey'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subjectKey: `fromDomain|normalised subject`, only for subjects with a reference number
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `subjectKey` VARCHAR(190) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'subjectKey'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- mergedIntoId: the entry whose row already stands for this thread
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `mergedIntoId` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'mergedIntoId'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- followUpCount: how many later mails folded into this row
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `followUpCount` INT NOT NULL DEFAULT 0',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'followUpCount'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lastMessageAt: newest mail of the thread (receivedAt stays the first one)
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `lastMessageAt` DATETIME(3) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'lastMessageAt'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_threadKey_idx` ON `query_monitor_entries` (`threadKey`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_threadKey_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_subjectKey_idx` ON `query_monitor_entries` (`subjectKey`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_subjectKey_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_mergedIntoId_idx` ON `query_monitor_entries` (`mergedIntoId`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_mergedIntoId_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing rows keep every new column at its default: no thread key yet, not
-- merged into anything. "Merge duplicates" on the Configuration tab backfills
-- the keys and folds the duplicate rows that are already in the workbook.
