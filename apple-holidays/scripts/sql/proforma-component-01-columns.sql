-- Proforma Invoice component — step 1 of 1: widen `proforma_invoices`.
--
-- SAFETY
-- ------
-- Every statement is an ADD COLUMN / ADD INDEX guarded by an information_schema
-- lookup, so running this file twice is a no-op instead of an error. Nothing
-- here drops, renames, re-types, truncates or writes to an existing column, and
-- no existing row is rewritten: every new column is NULLable, or carries a
-- default that matches what the existing rows already mean.
--
--   * `origin` defaults to 'RESERVATION' — which is exactly what every row
--     already in this table is: filed through the reservation pipeline.
--   * `hotelAdded` defaults to 0 — no existing invoice was hand-added against
--     a booking, because that path did not exist.
--
-- InnoDB adds a NULLable column (and an appended DEFAULT) INSTANTLY on MySQL
-- 8.0 — metadata only, no table rebuild, no long lock. `proforma_invoices` is
-- in any case a small table.
--
-- APPLY WITH (never `prisma db push` — the live DB carries unrelated drift a
-- push would also try to apply):
--
--   mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" \
--     < scripts/sql/proforma-component-01-columns.sql
--
-- Then regenerate the client so the app sees the new fields:
--
--   npx prisma generate
--
-- ROLLBACK
-- --------
-- Deliberately not scripted. Dropping a column destroys whatever was written
-- into it; if this has to come out, stop writing the columns first and drop
-- them in a later, separate change once nothing reads them.

DELIMITER //

DROP PROCEDURE IF EXISTS `pf_add_column`//
CREATE PROCEDURE `pf_add_column`(IN col VARCHAR(64), IN spec TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'proforma_invoices'
      AND COLUMN_NAME  = col
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `proforma_invoices` ADD COLUMN `', col, '` ', spec);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END//

DROP PROCEDURE IF EXISTS `pf_add_index`//
CREATE PROCEDURE `pf_add_index`(IN idx VARCHAR(64), IN cols TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'proforma_invoices'
      AND INDEX_NAME   = idx
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `proforma_invoices` ADD INDEX `', idx, '` (', cols, ')');
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- ── Booking-centric identity ────────────────────────────────────────────────
CALL pf_add_column('bookingId',       'VARCHAR(191) NULL');
CALL pf_add_column('isNumber',        'VARCHAR(64) NULL');
CALL pf_add_column('accommodationId', 'VARCHAR(191) NULL');
CALL pf_add_column('city',            'VARCHAR(191) NULL');

-- ── Stay ────────────────────────────────────────────────────────────────────
CALL pf_add_column('checkIn',   'DATETIME(3) NULL');
CALL pf_add_column('checkOut',  'DATETIME(3) NULL');
CALL pf_add_column('nights',    'INT NULL');
CALL pf_add_column('roomType',  'VARCHAR(191) NULL');
CALL pf_add_column('mealPlan',  'VARCHAR(8) NULL');
CALL pf_add_column('roomCount', 'INT NULL');

-- ── Provenance ──────────────────────────────────────────────────────────────
CALL pf_add_column('origin',     "VARCHAR(16) NOT NULL DEFAULT 'RESERVATION'");
CALL pf_add_column('hotelAdded', 'TINYINT(1) NOT NULL DEFAULT 0');

-- ── Storage. The S3 key, so the Accounts app can stream the PDF from the
--    bucket itself rather than through this app's session-guarded route.
CALL pf_add_column('fileKey', 'TEXT NULL');

CALL pf_add_index('proforma_invoices_isNumber_idx', '`isNumber`');
CALL pf_add_index('proforma_invoices_origin_idx',   '`origin`');

DROP PROCEDURE IF EXISTS `pf_add_column`;
DROP PROCEDURE IF EXISTS `pf_add_index`;

-- Verify (read-only):
--   SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proforma_invoices'
--   ORDER BY ORDINAL_POSITION;
