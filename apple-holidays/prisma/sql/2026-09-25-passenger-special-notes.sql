-- Passenger Special Note — a free-text note per passenger ("wheelchair at
-- arrival", "celebrating 50th anniversary", "severe nut allergy"), shown as a
-- highlighted callout on the booking page's Passengers card.
--
-- It lives in its own table rather than as a column on `passengers` because:
--   * Passenger rows are deleted and recreated by Edit Passengers, mail/OneDrive
--     re-imports and version restores, so a note keyed by passenger id would be
--     wiped. Notes are keyed by booking ref + normalised passenger name instead
--     (src/lib/passenger-notes.ts), which survives every recreate.
--   * Adding a column to `passengers` in the Prisma schema would break every
--     booking read on a database this file has not been run on yet. A separate
--     table is only read by the code that needs it, which tolerates it missing.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-passenger-special-notes.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-passenger-special-notes.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `passenger_special_notes` (
  `bookingRef`    VARCHAR(191)  NOT NULL,
  `nameKey`       VARCHAR(191)  NOT NULL,
  `passengerName` VARCHAR(191)  NOT NULL,
  `note`          VARCHAR(1000) NOT NULL,
  `updatedById`   VARCHAR(191)  NULL,
  `updatedByName` VARCHAR(191)  NULL,
  `updatedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`bookingRef`, `nameKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
