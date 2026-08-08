-- Query Monitor — reply attribution and the AI one-line summary.
--
-- Additive only: three nullable columns on `query_monitor_entries`. Nothing
-- existing is dropped, retyped or backfilled, so every row already in the table
-- keeps exactly the values it has and the new columns read NULL — which is what
-- the sheet writes as a blank cell.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/query-monitor-reply-detail-ai-summary.sql --schema prisma/schema.prisma
--
-- Each statement is guarded by information_schema and prepared dynamically, so
-- the whole file is safe to re-run.

-- repliedBy: the handler whose Sent Items the reply was found in (sheet column O)
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `repliedBy` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'repliedBy'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- aiSummary: one sentence describing the mail (sheet column T / other-mail K)
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `aiSummary` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'aiSummary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- aiSummaryAt: when it was written, so a re-run can tell "never read" from "read and empty"
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `aiSummaryAt` DATETIME(3) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'aiSummaryAt'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The workbook itself needs no migration. The six new query columns land in
-- O–T and the summary in K of the other-mail tab — all previously empty cells,
-- to the right of everything already written. The header names are filled in by
-- the app on the next sync (see `headerExtension` in src/lib/query-monitor/
-- sheet.ts), which writes ONLY the blank header cells and never touches A–N.
--
-- Rows already on the sheet keep their blank O–T until something makes them
-- dirty — a reply landing, a chaser arriving, a hand edit. That is deliberate:
-- history is not rewritten, the detail starts from today's mail.
