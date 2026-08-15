-- Query Monitor — the thread ledger: every mail of a conversation, both ways.
--
-- Until now a row knew only how many *inbound* mails folded into it
-- (`followUpCount`) and the name of whoever's Sent Items a reply turned up in
-- (`repliedBy`). What it could never say is what the team actually asks of it:
-- who wrote in, who answered them and when, who forwarded the thread on to
-- whom, and — over a thread that ran to a dozen mails — what happened in it.
--
-- This file adds the record that can answer that: one table holding one row per
-- message in a thread (`query_monitor_thread_events`), plus the handful of
-- derived columns on `query_monitor_entries` that the workbook reads so a sheet
-- write never has to aggregate the ledger itself.
--
-- Additive only. No column is dropped, retyped or backfilled, so every row
-- already in the table keeps exactly the values it has; the new columns read
-- NULL or their default, which the sheet writes as a blank cell. Existing rows
-- gain their ledger the first time a new mail or a reply touches the thread —
-- history is not rewritten, the detail starts from today's mail.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/2026-08-15-query-monitor-thread-ledger.sql --schema prisma/schema.prisma
--
-- Each statement is guarded by information_schema and prepared dynamically, so
-- the whole file is safe to re-run.

-- ── The ledger table ────────────────────────────────────────────────────────
--
-- Deliberately FK-free on nothing: `entryId` does carry a real foreign key with
-- ON DELETE CASCADE, because an entry's ledger is meaningless without the entry
-- and the dashboard's delete button must not leave orphans behind.
CREATE TABLE IF NOT EXISTS `query_monitor_thread_events` (
  `id`           VARCHAR(191) NOT NULL,
  -- The root entry whose sheet row stands for this thread.
  `entryId`      VARCHAR(191) NOT NULL,
  -- `entryId|internetMessageId` (or `|graphId` when Graph gives no message id).
  -- The unique key is what makes recording an event idempotent: every sweep
  -- re-reads an overlapping window of Sent Items and must not log the same
  -- reply twice.
  `eventKey`     VARCHAR(190) NOT NULL,
  -- IN  — a mail from the agent to us.
  -- OUT — a mail from one of the monitored mailboxes.
  `direction`    VARCHAR(8)   NOT NULL,
  -- QUERY     — the mail that opened the thread (always the first IN).
  -- FOLLOW_UP — a later mail from the agent: a chaser, an answer to our question.
  -- REPLY     — ours, addressed back to whoever asked. This is the one that
  --             stops the SLA clock; the other two OUT kinds never do.
  -- FORWARD   — ours, passed to a colleague rather than answered to the agent.
  -- INTERNAL  — ours, on the thread but to neither: staff talking among themselves.
  `kind`         VARCHAR(16)  NOT NULL,
  -- Who wrote it: the handler's first name for OUT, the agent's display name for IN.
  `actorName`    VARCHAR(191) NOT NULL DEFAULT '',
  `actorAddress` VARCHAR(191) NOT NULL DEFAULT '',
  -- Everyone it went to, comma-joined and already resolved to handler names
  -- where the address is one of ours. VarChar, not TEXT: MySQL forbids a default
  -- on TEXT and a long CC list is truncated rather than allowed to break a write.
  `toNames`      VARCHAR(500) NOT NULL DEFAULT '',
  `toAddresses`  VARCHAR(500) NOT NULL DEFAULT '',
  `occurredAt`   DATETIME(3)  NOT NULL,
  `subject`      VARCHAR(500) NOT NULL DEFAULT '',
  `snippet`      TEXT         NULL,
  `messageId`    VARCHAR(255) NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `query_monitor_thread_events_eventKey_key` (`eventKey`),
  KEY `query_monitor_thread_events_entryId_occurredAt_idx` (`entryId`, `occurredAt`),
  KEY `query_monitor_thread_events_direction_idx` (`direction`),
  CONSTRAINT `query_monitor_thread_events_entryId_fkey`
    FOREIGN KEY (`entryId`) REFERENCES `query_monitor_entries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Derived columns on the entry ────────────────────────────────────────────
--
-- Every one of these is a roll-up of the ledger above. They exist because a
-- sheet write walks hundreds of entries and must not run a GROUP BY per row.

-- inboundCount: mails from the agent on this thread, the opening one included.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `inboundCount` INT NOT NULL DEFAULT 1',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'inboundCount'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- outboundCount: mails we sent on this thread — replies, forwards and internal.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `outboundCount` INT NOT NULL DEFAULT 0',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'outboundCount'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- replyType: DIRECT (answered the agent) | FORWARD (passed on, agent not yet
-- answered) | INTERNAL (discussed, agent not yet answered). Null while open.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replyType` VARCHAR(16) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replyType'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- repliedToAddress: where the reply actually went. "Replied by Sajid" is only
-- half an answer — the team wants to see it went back to the agent who asked.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `repliedToAddress` VARCHAR(500) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'repliedToAddress'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- forwardChain: "Sajid → Vishmika · Vishmika → Sudari", oldest hop first.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `forwardChain` VARCHAR(500) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'forwardChain'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lastActor / lastDirection: who wrote the newest mail of the thread and which
-- way it went, so "waiting on us" and "waiting on them" can be told apart.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `lastActor` VARCHAR(191) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'lastActor'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `lastDirection` VARCHAR(8) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'lastDirection'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- replySummary: what happened across the whole thread, in one or two sentences.
-- Distinct from `aiSummary`, which reads the opening mail only and never moves
-- again — this one is rewritten every time the thread grows.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replySummary` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replySummary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replySummaryAt` DATETIME(3) NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replySummaryAt'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- replySummaryEvents: how many ledger rows the stored summary was written from.
-- The regeneration test is `< inboundCount + outboundCount`, which is what stops
-- a sweep paying for a summary of a thread that has not moved since the last one.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `replySummaryEvents` INT NOT NULL DEFAULT 0',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'replySummaryEvents'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- duplicateReason: why this row is the one that survived a fold, and what it
-- absorbed. Written whenever the automatic de-duplication folds another row into
-- this one — the sheet showing its working for a line that now stands for mail
-- nobody can see written out any more.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `duplicateReason` TEXT NULL',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'duplicateReason'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── The workbook ────────────────────────────────────────────────────────────
--
-- The new columns to the RIGHT of the layout need no migration: they are
-- previously empty cells, and the app fills their header names in on the next
-- sync (see `headerExtension` in src/lib/query-monitor/sheet.ts), which writes
-- ONLY blank header cells and never touches a column already in use.
--
-- **From / From Email are different.** They were briefly written at U / V and
-- have been moved to G / H, next to File Handler — which means moving real
-- columns in a file the team is using. That is done by `realignWorksheet` in
-- sheet.ts, not here: it is an Excel operation (delete U:V, insert two columns
-- at G, name them), so Excel itself moves the data and fixes up every formula
-- and named range that pointed at the shifted cells. It runs from the same
-- "Prepare" action that lays out a workbook, it recognises exactly the one
-- previous shape it knows how to transform, and it refuses anything else rather
-- than guess. Until it has run, writes to that tab are refused as a header
-- mismatch — no row is ever written into the wrong column.
