-- Query Monitor — a thread can hold more than one round.
--
-- Until now a thread was one query for ever: every later mail on the same
-- conversation folded into the row the first one owned, however long the thread
-- ran and whatever happened in between. That is right while the query is still
-- open — a chaser is the same unanswered question, and folding it keeps the SLA
-- measured from when the query was first asked.
--
-- It is wrong once we have actually answered. The agent writing back after a
-- reply is a new question with a new clock, and folding it made the sheet show
-- nothing at all: the team watched real mail arrive on 17 Aug and land silently
-- inside rows dated the 6th, the 8th, the 11th. They were typing those lines
-- back in by hand.
--
-- So a mail that arrives after `repliedAt` now opens a NEW round, which takes a
-- row of its own. This column records that decision at collection time.
--
-- Additive only. No column is dropped, retyped or backfilled: every row already
-- in the table reads `false`, which is exactly what it was — the first and only
-- round of its thread.
--
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/2026-08-17-query-monitor-thread-rounds.sql --schema prisma/schema.prisma
--
-- The statement is guarded by information_schema and prepared dynamically, so
-- the file is safe to re-run.

-- newRound: this entry re-opened a thread that had already been answered.
--
-- The append guard reads it. A row is normally protected from being written
-- twice by two identities: the exact one (date + allocation time + subject) and
-- a looser "same query" one (same day + same subject). The loose key cannot tell
-- two rounds of one thread apart — same subject, often the same day — so for an
-- entry that opens a round it is skipped, and only the exact key applies. That
-- key carries the allocation time, which two rounds never share, so a genuine
-- double-write is still caught while two real rounds both keep their line.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `query_monitor_entries` ADD COLUMN `newRound` BOOLEAN NOT NULL DEFAULT false',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'query_monitor_entries'
    AND COLUMN_NAME  = 'newRound'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
