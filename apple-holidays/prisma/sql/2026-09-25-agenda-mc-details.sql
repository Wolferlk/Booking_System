-- MC Report desk figures — the values the desk types straight into the MC
-- Report, one row per movement (agenda item):
--
--   packageCost     Sri Lanka          — transport package cost for the movement
--   budgetKm        Sri Lanka          — kilometres budgeted
--   actualKm        Sri Lanka          — kilometres actually run
--   budgetTransfer  Singapore/Malaysia — budgeted transfer cost
--   specialRequest  every destination  — a request that applies to this movement only
--
-- `currency` is stamped from the booking's country when a money figure is saved
-- (LKR / SGD / MYR), so a report never has to guess what a number was in.
--
-- Own table, not new columns on `agenda_items`, for the same two reasons as
-- agenda_tickets_control:
--   * A chart save deletes and recreates every agenda item, so the app carries
--     each row across to the movement's new id (src/lib/mc-details.ts).
--   * Adding columns to `agenda_items` in the Prisma schema would break every
--     agenda read on a database this file has not been run on yet. A separate
--     table is only read by the code that needs it, which tolerates it missing.
--
-- No foreign key: agenda rows are recreated on save, and the live schema drifts.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-agenda-mc-details.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-agenda-mc-details.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `agenda_mc_details` (
  `agendaItemId`   VARCHAR(191)   NOT NULL,
  `bookingRef`     VARCHAR(191)   NOT NULL,
  `packageCost`    DECIMAL(12,2)  NULL,
  `budgetKm`       DECIMAL(10,1)  NULL,
  `actualKm`       DECIMAL(10,1)  NULL,
  `budgetTransfer` DECIMAL(12,2)  NULL,
  `currency`       VARCHAR(8)     NULL,
  `specialRequest` VARCHAR(500)   NULL,
  `updatedById`    VARCHAR(191)   NULL,
  `updatedByName`  VARCHAR(191)   NULL,
  `updatedAt`      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`agendaItemId`),
  INDEX `agenda_mc_details_bookingRef_idx` (`bookingRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
