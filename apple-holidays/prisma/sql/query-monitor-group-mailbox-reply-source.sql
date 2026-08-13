-- Query Monitor — group (alias) mailboxes, reply attribution detail and the
-- replied-row highlight.
--
-- Additive only: new nullable / defaulted columns on three tables. Nothing
-- existing is dropped, retyped or backfilled, so every row already in the
-- tables keeps exactly the values it has.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift and offer a full reset):
--
--   npx prisma db execute --file prisma/sql/query-monitor-group-mailbox-reply-source.sql --schema prisma/schema.prisma
--   npx prisma generate
--
-- Every statement is guarded by information_schema and prepared dynamically, so
-- the whole file is safe to re-run.
--
-- Why VARCHAR with a default rather than TEXT for the address list: MySQL
-- forbids defaults on TEXT, and a NOT NULL column with no default cannot be
-- added to a table that already has rows — which is the reset prompt above.

-- ── query_monitor_mailboxes ─────────────────────────────────────────────────

-- mailboxKind: USER  → read directly from Graph (a real or shared mailbox)
--              ALIAS → a distribution group with no readable mailbox of its
--                      own. Its traffic is attributed from the TO/CC headers of
--                      mail collected out of the member inboxes.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_mailboxes` ADD COLUMN `mailboxKind` VARCHAR(16) NOT NULL DEFAULT ''USER''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mailboxes'
    AND COLUMN_NAME  = 'mailboxKind'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- aliasAddresses: further addresses that mean the same group, comma-separated
-- (availcheck@aahaas.com is also written as availcheck@appleholidaysds.com).
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_mailboxes` ADD COLUMN `aliasAddresses` VARCHAR(500) NOT NULL DEFAULT ''''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_mailboxes'
    AND COLUMN_NAME  = 'aliasAddresses'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── query_monitor_matches ───────────────────────────────────────────────────

-- viaAlias: this recipient was read off the mail's TO/CC line rather than out of
-- its own inbox. Kept so the daily counts can say how much of a group's traffic
-- is only visible because a member was also addressed.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_matches` ADD COLUMN `viaAlias` TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_matches'
    AND COLUMN_NAME  = 'viaAlias'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── query_monitor_entries ───────────────────────────────────────────────────

-- repliedByEmail: the mailbox the reply was actually sent from. `repliedBy`
-- holds the display name that goes in the sheet; this is the identity behind it,
-- so two handlers who share a first name can still be told apart.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `repliedByEmail` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'repliedByEmail'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- replyMessageId: the internetMessageId of the sent mail that was counted as the
-- reply, so an attribution can be traced back to a real message in Sent Items.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replyMessageId` VARCHAR(255) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replyMessageId'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- replyMatch: how it was matched — RECIPIENT (same thread AND addressed back to
-- the person who asked), CONVERSATION (same thread only) or SUBJECT (no
-- conversation id; same normalised subject, addressed back to the asker).
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replyMatch` VARCHAR(24) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replyMatch'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sheetHighlight / backupHighlight: the fill last applied to this entry's row in
-- each workbook. Purely a cache — it is what stops every sweep re-sending the
-- same "paint this row green" call for rows that are already green.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `sheetHighlight` VARCHAR(16) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'sheetHighlight'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `backupHighlight` VARCHAR(16) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'backupHighlight'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- An index for the daily counts: they read matches by day, per mailbox.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'CREATE INDEX `query_monitor_matches_receivedAt_idx` ON `query_monitor_matches` (`receivedAt`)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_matches'
    AND INDEX_NAME   = 'query_monitor_matches_receivedAt_idx'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The workbook needs no migration either. The daily counts land on a tab of
-- their own ("Daily Mail Stats"), created by the app on first export exactly as
-- the AI Usage tab is, and the replied-row highlight only sets a cell fill —
-- neither touches a value on the query or other-mail tabs.
