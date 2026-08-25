-- Proforma Invoice component — step 2: the beneficiary account on the invoice.
--
-- WHY
-- ---
-- A property's proforma prints the account it wants paying into at the foot of
-- the page. Until now nobody captured it: the reservation clerk typed the
-- figures, filed the PDF, and Accounts opened the document a second time to
-- read the bank details off it by eye before setting them on the Payable 1.0
-- line. That second reading is where wrong-account transfers come from.
--
-- These columns hold what the AI extraction pass read off the uploaded
-- document, so the account travels with the invoice. They are a *quotation of
-- the paper*, never an instruction: the Accounts app shows them beside the
-- payable line and a person presses a button to copy them across. Nothing
-- downstream pays from these columns directly.
--
-- SAFETY
-- ------
-- Identical shape to step 1, and the same guarantees. Every statement is an
-- ADD COLUMN guarded by an information_schema lookup, so running the file twice
-- is a no-op. Nothing drops, renames, re-types or writes to an existing column;
-- no existing row is rewritten. Every new column is NULLable, which is the
-- truthful value for every invoice already filed — nobody read a bank account
-- off those.
--
-- `aiExtract` / `aiExtractedAt` are declared in the Prisma model but were never
-- created on this table (the model predates the component). They are added here
-- for the same reason, and for the same cost: two nullable columns.
--
-- APPLY WITH (never `prisma db push`):
--
--   mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" \
--     < scripts/sql/proforma-component-02-bank-details.sql
--
--   npx prisma generate
--
-- ROLLBACK
-- --------
-- Not scripted, deliberately — see step 1.

DELIMITER //

DROP PROCEDURE IF EXISTS `pf2_add_column`//
CREATE PROCEDURE `pf2_add_column`(IN col VARCHAR(64), IN spec TEXT)
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

DELIMITER ;

-- ── The beneficiary account, as printed on the invoice ──────────────────────
-- Generous widths: a bank name and an account title are free text on a
-- letterhead, and truncating either is worse than storing a long string.
CALL pf2_add_column('bankAccountName',   'VARCHAR(255) NULL');
CALL pf2_add_column('bankName',          'VARCHAR(255) NULL');
CALL pf2_add_column('bankBranch',        'VARCHAR(255) NULL');
-- Kept as text, never a number: account numbers carry leading zeros, spaces and
-- dashes, and every one of those is part of the identifier.
CALL pf2_add_column('bankAccountNumber', 'VARCHAR(128) NULL');
CALL pf2_add_column('bankSwift',         'VARCHAR(32) NULL');
CALL pf2_add_column('bankIban',          'VARCHAR(64) NULL');
-- The currency the *account* is held in, which is not always the currency the
-- invoice is written in — a Sri Lankan property routinely bills in USD against
-- a rupee account, and the difference decides whether a conversion happens.
CALL pf2_add_column('bankCurrency',      'VARCHAR(8) NULL');
CALL pf2_add_column('bankAddress',       'TEXT NULL');

-- ── The extraction pass itself ──────────────────────────────────────────────
-- The whole model response, kept for audit and re-review: when a figure is
-- disputed, "what did the machine actually read?" has to be answerable without
-- re-running anything. Same pattern as HotelProfile.aiResearch.
CALL pf2_add_column('aiExtract',     'JSON NULL');
CALL pf2_add_column('aiExtractedAt', 'DATETIME(3) NULL');

DROP PROCEDURE IF EXISTS `pf2_add_column`;

-- Verify (read-only):
--   SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proforma_invoices'
--     AND COLUMN_NAME LIKE 'bank%' OR COLUMN_NAME LIKE 'ai%';
