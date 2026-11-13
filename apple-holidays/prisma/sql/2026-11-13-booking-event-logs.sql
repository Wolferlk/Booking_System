-- Booking Logs — one readable timeline of who changed what on a booking, and
-- why an automatic message did not go out.
--
--   booking_event_logs   One row per change / send outcome:
--                          section   contact | passengers | flights | accommodation |
--                                    overview | agenda | messages
--                          action    created | updated | deleted | assigned | unassigned |
--                                    sent | failed | skipped
--                          summary   one human sentence ("Phone changed")
--                          changes   [{ field, from, to }] for edits
--                          reason    why a send failed / was skipped
--                          actor*    the staff member, or NULL + source for the scheduler
--
-- Older history (activity_logs, status_events, booking_versions, whatsapp_messages,
-- vn_driver_sync_events, file_handler_logs) is read as-is and merged in the app —
-- nothing is copied or backfilled.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No foreign keys.
--
--   bash prisma/sql/apply-booking-event-logs.sh --check   # show the target, run nothing

CREATE TABLE IF NOT EXISTS `booking_event_logs` (
  `id`         VARCHAR(191) NOT NULL,
  `bookingRef` VARCHAR(64)  NOT NULL,
  `section`    VARCHAR(24)  NOT NULL,
  `action`     VARCHAR(32)  NOT NULL,
  `summary`    VARCHAR(500) NOT NULL,
  `changes`    JSON         NULL,
  `status`     VARCHAR(16)  NULL,
  `reason`     TEXT         NULL,
  `actorId`    VARCHAR(191) NULL,
  `actorName`  VARCHAR(191) NULL,
  `source`     VARCHAR(32)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `booking_event_logs_ref_idx` (`bookingRef`, `createdAt`),
  INDEX `booking_event_logs_section_idx` (`section`, `createdAt`),
  INDEX `booking_event_logs_created_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
