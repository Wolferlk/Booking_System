-- Widen agenda_items movement columns from VARCHAR(191) to TEXT.
--
-- Long activity names (multi-attraction packages, e.g. "4 Island Tour (...) +
-- Hon Thom Cable Car (One-way) + Aquatopia Water Park + ... | Shared Transfer")
-- exceed 191 characters and caused MySQL error 1406 "Data too long" on save.
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-07-20-agenda-item-text-columns.sql --schema prisma/schema.prisma
--
-- None of these columns are indexed, so converting to TEXT is safe.

ALTER TABLE `agenda_items`
  MODIFY `location`  TEXT NOT NULL,
  MODIFY `fromPoint` TEXT NULL,
  MODIFY `toPoint`   TEXT NULL;
