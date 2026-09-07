-- Query Monitor — the hand-editable mirror tab.
--
-- A second worksheet beside "Query Entry Sheet", carrying the same rows, that
-- the team may type into. The sweep appends to it and never writes over it
-- again: a row that lands there is theirs from that moment on. Its colour is
-- brought up to date — green once the query is answered — but only while the
-- row is still wearing the colour we painted; the first time it is found in a
-- colour of the team's own, that row's fill is locked and never touched again.
--
-- The mirror therefore cannot share the live sheet's pointers. It is appended to
-- on its own schedule, its rows drift independently once somebody inserts a
-- line into it by hand, and a failure writing to it must never make the live
-- sheet look unwritten. So it carries its own row pointer and its own state,
-- exactly as the standby workbook does.
--
-- Additive only. No column is dropped, retyped or backfilled. Every row already
-- in the table reads PENDING, which is what it is: not yet on the mirror.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/2026-09-07-query-monitor-manual-mirror.sql --schema prisma/schema.prisma
--
-- Every statement is guarded by information_schema and prepared dynamically, so
-- the file is safe to re-run.

-- manualSheetRow — where this entry sits on the mirror tab. Null until it has
-- been copied across; repaired in place when a hand-inserted line moves it.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `manualSheetRow` INT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'manualSheetRow'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- manualSyncStatus — PENDING | SYNCED | FAILED | SKIPPED. Deliberately no DIRTY:
-- there is no state in which a mirror row is rewritten.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `manualSyncStatus` VARCHAR(191) NOT NULL DEFAULT ''PENDING''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'manualSyncStatus'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- manualSyncError — why the last mirror write for this row did not land.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `manualSyncError` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'manualSyncError'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- manualHighlight — the fill we last painted on the mirror row. The reference
-- the manual-colour guard compares the live cell against.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `manualHighlight` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'manualHighlight'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- manualColorLocked — somebody coloured this line themselves. Terminal: a lock
-- that expires is a lock that loses their work on the next sweep.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `manualColorLocked` BOOLEAN NOT NULL DEFAULT false',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'manualColorLocked'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The mirror pass selects on this exactly as the two workbook passes select on
-- theirs.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_entries_manualSyncStatus_idx` ON `query_monitor_entries` (`manualSyncStatus`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND INDEX_NAME   = 'query_monitor_entries_manualSyncStatus_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
