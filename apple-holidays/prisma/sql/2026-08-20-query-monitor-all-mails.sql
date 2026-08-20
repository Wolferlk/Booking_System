-- Query Monitor — the raw mail log behind the "All Mails" tab.
--
-- `query_monitor_entries` is a record of *queries*, and it hides mail on
-- purpose: internal and automated senders are dropped at the mailbox and never
-- reach it, the exclusion patterns divert everything that is not new business to
-- the other-mail tab, and a chaser is folded into the row its thread already
-- owns. Each of those is right for the SLA pivots the team reads, and each of
-- them is why the workbook cannot answer the other question they ask — what
-- actually landed in these mailboxes?
--
-- This table answers it. One row per message, nothing filtered, nothing folded.
-- It costs no extra Graph call: the sweep already reads the whole inbox window
-- and then discards what it has no use for, and this is that same list written
-- down before the discarding happens.
--
-- `dedupKey` is computed exactly as `query_monitor_entries.dedupKey` is, so the
-- two tables join on it — which is what lets a logged mail pick up its query's
-- status, SLA and thread columns while staying a row of its own. There is
-- deliberately **no foreign key**: the whole point of the log is that it holds
-- mail no entry will ever exist for.
--
-- Additive only. Nothing existing is dropped, retyped or backfilled by this
-- file; the app seeds the log from the entries table once, on the first export.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/2026-08-20-query-monitor-all-mails.sql --schema prisma/schema.prisma
--
-- Safe to re-run: the table is created only if absent.

CREATE TABLE IF NOT EXISTS `query_monitor_mails` (
  `id`                VARCHAR(191) NOT NULL,
  -- internetMessageId when Graph gives one, else conversationId|subject — the
  -- same key `query_monitor_entries` uses, so the join is exact.
  `dedupKey`          VARCHAR(190) NOT NULL,
  `internetMessageId` VARCHAR(190) NULL,
  `conversationId`    VARCHAR(190) NULL,
  `subject`           TEXT         NOT NULL,
  `fromAddress`       VARCHAR(320) NOT NULL,
  `fromName`          VARCHAR(190) NOT NULL DEFAULT '',
  `fromDomain`        VARCHAR(190) NOT NULL DEFAULT '',
  `receivedAt`        DATETIME(3)  NOT NULL,
  -- The monitored mailboxes it reached, as the names the sheet prints. Grows
  -- when the same mail turns up in a second inbox. VarChar, not TEXT: MySQL
  -- forbids a default on TEXT, and a handful of first names never approaches 500.
  `toNames`           VARCHAR(500) NOT NULL DEFAULT '',
  -- Every address on its TO/CC line. TEXT because a real distribution list can
  -- run long, and truncating it here would lose the one record of who was on it
  -- — which is also why it carries no default, MySQL forbidding one on TEXT.
  -- Every writer passes at least an empty string.
  `toAddresses`       TEXT         NOT NULL,
  `hasAttachments`    TINYINT(1)   NOT NULL DEFAULT 0,
  `bodySnippet`       TEXT         NOT NULL,
  -- NULL  — the query pipeline took this mail on, so an entry exists for it.
  -- INTERNAL  — from our own tenant.
  -- AUTOMATED — noreply addresses, mailer daemons, tenant notifications.
  -- Mail with a reason set exists here and in no other table.
  `skipReason`        VARCHAR(32)  NULL,
  `firstRunId`        VARCHAR(191) NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `query_monitor_mails_dedupKey_key` (`dedupKey`),
  KEY `query_monitor_mails_receivedAt_idx` (`receivedAt`),
  KEY `query_monitor_mails_skipReason_idx` (`skipReason`),
  KEY `query_monitor_mails_conversationId_idx` (`conversationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
