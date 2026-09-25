-- Ticket files — several files under one ticket.
--
-- A ticket row holds one file (`tickets.fileUrl`, the receipt). A group ticket
-- — "Testing" bought for 10 guests — comes back from the portal as one file per
-- person, and the ground team needs all ten under that one ticket rather than
-- ten copies of the ticket. Each of those files is a row here.
--
-- `tickets.fileUrl` is untouched and keeps meaning what it always has; this
-- table only adds files beside it.
--
-- No foreign key: the live schema carries drift, and the tickets table's
-- collation is not guaranteed to match a new table's. The app deletes a
-- ticket's files when it deletes the ticket (src/app/api/tickets/[id]).
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-ticket-files.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-ticket-files.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `ticket_files` (
  `id`             VARCHAR(191)  NOT NULL,
  `ticketId`       VARCHAR(191)  NOT NULL,
  `fileUrl`        TEXT          NOT NULL,
  `fileName`       VARCHAR(255)  NULL,
  -- 'image' | 'pdf'
  `fileType`       VARCHAR(16)   NULL,
  -- Who the file is for, e.g. the guest's name. Defaults to the file name.
  `label`          VARCHAR(191)  NULL,
  `position`       INT           NOT NULL DEFAULT 0,
  `uploadedById`   VARCHAR(191)  NULL,
  `uploadedByName` VARCHAR(191)  NULL,
  `createdAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `ticket_files_ticketId_idx` (`ticketId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
