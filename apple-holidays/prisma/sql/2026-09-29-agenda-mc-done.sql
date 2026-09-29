-- MC Report "done" marks — the Sri Lanka desk ticks off a movement once it has
-- run, and the report paints that row green. One row per done movement (agenda
-- item); un-marking deletes the row.
--
-- Own table, not a column on `agenda_items` or `agenda_mc_details`, for the same
-- reasons as agenda_mc_details:
--   * A chart save deletes and recreates every agenda item, so the app carries
--     each row across to the movement's new id (src/lib/mc-done.ts).
--   * A separate table is only read by the code that needs it, which tolerates
--     it missing on a database this file has not been run on yet.
--
-- No foreign key: agenda rows are recreated on save, and the live schema drifts.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-agenda-mc-done.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-agenda-mc-done.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `agenda_mc_done` (
  `agendaItemId` VARCHAR(191) NOT NULL,
  `bookingRef`   VARCHAR(191) NOT NULL,
  `doneById`     VARCHAR(191) NULL,
  `doneByName`   VARCHAR(191) NULL,
  `doneAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`agendaItemId`),
  INDEX `agenda_mc_done_bookingRef_idx` (`bookingRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
