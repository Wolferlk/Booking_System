-- MC Report — date indexes for the movement chart.
--
-- The MC Report reads movements by date range (`agenda_items.date`) and Hotel
-- Only stays by check-in (`accommodations.checkIn`). Neither column had an
-- index, so every chart load — even "Today" — scanned both tables in full,
-- and the page grew slower as more bookings were added.
--
-- SAFETY
--   * Additive only: two new secondary indexes. No column, row or existing
--     index is changed, and nothing is dropped, deleted or updated.
--   * Online: ALGORITHM=INPLACE, LOCK=NONE — reads and writes carry on while
--     the index builds (MySQL 8 and MariaDB 10.x both support this).
--   * Idempotent: each index is created only if it is not already there, so
--     the file is safe to run twice.
--
--   bash prisma/sql/apply-mc-report-date-indexes.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-mc-report-date-indexes.sh           # apply (asks first)

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agenda_items' AND INDEX_NAME = 'agenda_items_date_idx'
);
SET @ddl := IF(@has_idx = 0,
  'CREATE INDEX `agenda_items_date_idx` ON `agenda_items` (`date`) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accommodations' AND INDEX_NAME = 'accommodations_checkIn_idx'
);
SET @ddl := IF(@has_idx = 0,
  'CREATE INDEX `accommodations_checkIn_idx` ON `accommodations` (`checkIn`) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
