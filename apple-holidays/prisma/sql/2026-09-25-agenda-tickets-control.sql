-- Tickets Control — a short free-text note per Vietnam movement, kept on the
-- MC Report's "Tickets Control" column.
--
-- One row per agenda item. It lives in its own table rather than as a column on
-- `agenda_items` for two reasons:
--   * A chart save deletes and recreates every agenda item, so the app carries
--     each note across to the movement's new id (src/lib/tickets-control.ts).
--   * Adding a column to `agenda_items` in the Prisma schema would break every
--     agenda read on a database this file has not been run on yet. A separate
--     table is only read by the code that needs it, which tolerates it missing.
--
-- No foreign key, for the same reason as agenda_item_includes: the agenda
-- rows are recreated on save, and the live schema carries drift.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-agenda-tickets-control.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-agenda-tickets-control.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `agenda_tickets_control` (
  `agendaItemId`  VARCHAR(191)  NOT NULL,
  `bookingRef`    VARCHAR(191)  NOT NULL,
  `value`         VARCHAR(255)  NOT NULL,
  `updatedById`   VARCHAR(191)  NULL,
  `updatedByName` VARCHAR(191)  NULL,
  `updatedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`agendaItemId`),
  INDEX `agenda_tickets_control_bookingRef_idx` (`bookingRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
