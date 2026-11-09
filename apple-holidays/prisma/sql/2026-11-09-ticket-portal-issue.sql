-- Ticket Issue Desk — buying a ticket on GlobalTix or Cebu from the Tickets page.
--
--   ticket_portal_bookings  one row per hold on a portal, with the portal's own
--                           answers and the ticket's state before it was issued
--   ticket_portal_otps      WhatsApp approval codes (hashed; the code is never stored)
--   ticket_portal_cache     portal catalogues, so a page open does not re-walk them
--
-- No foreign keys: the live schema carries drift, and the tickets table's
-- collation is not guaranteed to match a new table's.
--
-- `liveKey` is the ticket id while a booking is live and NULL once it has ended.
-- UNIQUE allows many NULLs, so the database itself refuses a second live booking
-- on one ticket even if two people press Hold at the same moment.
--
-- SAFETY
--   * Additive only. Three brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-ticket-portal-issue.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-ticket-portal-issue.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `ticket_portal_bookings` (
  `id`              VARCHAR(191)  NOT NULL,
  `ticketId`        VARCHAR(191)  NOT NULL,
  `bookingId`       VARCHAR(191)  NOT NULL,
  `bookingRef`      VARCHAR(191)  NOT NULL,
  -- 'globaltix' | 'cebu'
  `provider`        VARCHAR(16)   NOT NULL,
  `productId`       VARCHAR(64)   NOT NULL,
  `productName`     VARCHAR(255)  NULL,
  `optionId`        VARCHAR(64)   NULL,
  `optionName`      VARCHAR(255)  NULL,
  `kind`            VARCHAR(32)   NULL,
  `tickets`         TEXT          NOT NULL,
  `alsoCovers`      TEXT          NULL,
  `visitDate`       VARCHAR(10)   NULL,
  `eventTime`       VARCHAR(32)   NULL,
  `customerName`    VARCHAR(191)  NULL,
  `customerMobile`  VARCHAR(32)   NULL,
  `reference`       VARCHAR(64)   NULL,
  -- reserving → reserved → confirming → confirmed → cancelling → cancelled
  -- reserved → released · any → failed · confirming → unknown (no answer)
  `status`          VARCHAR(16)   NOT NULL,
  `amount`          DECIMAL(12,2) NULL,
  `currency`        VARCHAR(8)    NULL,
  `lastError`       VARCHAR(500)  NULL,
  `liveKey`         VARCHAR(191)  NULL,
  `ticketSnapshot`  MEDIUMTEXT    NULL,
  `fileIds`         TEXT          NULL,
  `reserveJson`     MEDIUMTEXT    NULL,
  `confirmJson`     MEDIUMTEXT    NULL,
  `releaseJson`     MEDIUMTEXT    NULL,
  `detailsJson`     MEDIUMTEXT    NULL,
  `createdById`     VARCHAR(191)  NULL,
  `createdByName`   VARCHAR(191)  NULL,
  `confirmedByName` VARCHAR(191)  NULL,
  `releasedByName`  VARCHAR(191)  NULL,
  `cancelledByName` VARCHAR(191)  NULL,
  `confirmedAt`     DATETIME(3)   NULL,
  `cancelledAt`     DATETIME(3)   NULL,
  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ticket_portal_bookings_liveKey_key` (`liveKey`),
  INDEX `ticket_portal_bookings_ticketId_idx` (`ticketId`),
  INDEX `ticket_portal_bookings_bookingId_idx` (`bookingId`),
  INDEX `ticket_portal_bookings_reference_idx` (`reference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ticket_portal_otps` (
  `id`              VARCHAR(191)  NOT NULL,
  `portalBookingId` VARCHAR(191)  NOT NULL,
  -- 'CONFIRM' | 'CANCEL'
  `purpose`         VARCHAR(16)   NOT NULL,
  `codeHash`        VARCHAR(128)  NOT NULL,
  -- Ties the code to this reference, amount and currency.
  `bindHash`        VARCHAR(128)  NOT NULL,
  `recipients`      TEXT          NULL,
  `requestedById`   VARCHAR(191)  NULL,
  `requestedByName` VARCHAR(191)  NULL,
  `expiresAt`       DATETIME(3)   NOT NULL,
  `attempts`        INT           NOT NULL DEFAULT 0,
  `consumedAt`      DATETIME(3)   NULL,
  `voidedAt`        DATETIME(3)   NULL,
  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `ticket_portal_otps_booking_idx` (`portalBookingId`, `purpose`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ticket_portal_cache` (
  `cacheKey`  VARCHAR(191) NOT NULL,
  `value`     MEDIUMTEXT   NOT NULL,
  `fetchedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`cacheKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
