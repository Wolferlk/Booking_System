-- Trans-Reconsultation — half-month transport sheets per country, built from
-- MC Report lines, approved line by line from the Accounts system.
--
-- Additive only: two new tables, nothing else is altered. Safe to run twice.
-- Apply with: bash prisma/sql/apply-trans-recon.sh
--
-- No foreign keys to bookings / agenda_items / pnl_line_items on purpose: agenda
-- items and P&L lines are recreated on every save, and a reconciled line must
-- survive that. The line keeps its own snapshot of what it was built from.

CREATE TABLE IF NOT EXISTS `trans_recon_sheets` (
  `id`              VARCHAR(191) NOT NULL,
  `country`         VARCHAR(24)  NOT NULL,
  `periodYear`      INT          NOT NULL,
  `periodMonth`     INT          NOT NULL,
  `half`            INT          NOT NULL,
  `periodStart`     DATE         NOT NULL,
  `periodEnd`       DATE         NOT NULL,
  `title`           VARCHAR(191) NOT NULL,
  `currency`        VARCHAR(8)   NOT NULL DEFAULT 'USD',
  `fxRates`         JSON         NULL,
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
  `note`            TEXT         NULL,
  `accountsNote`    TEXT         NULL,
  `createdById`     VARCHAR(191) NULL,
  `createdByName`   VARCHAR(191) NULL,
  `submittedAt`     DATETIME(3)  NULL,
  `submittedByName` VARCHAR(191) NULL,
  `lockedAt`        DATETIME(3)  NULL,
  `lockedByName`    VARCHAR(191) NULL,
  `lastSyncedAt`    DATETIME(3)  NULL,
  `updatedByName`   VARCHAR(191) NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `trans_recon_sheets_period_key` (`country`, `periodYear`, `periodMonth`, `half`),
  KEY `trans_recon_sheets_month_idx` (`periodYear`, `periodMonth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `trans_recon_lines` (
  `id`               VARCHAR(191)  NOT NULL,
  `sheetId`          VARCHAR(191)  NOT NULL,
  `position`         INT           NOT NULL DEFAULT 0,
  `source`           VARCHAR(8)    NOT NULL DEFAULT 'MC',
  `agendaItemId`     VARCHAR(191)  NULL,
  `bookingRef`       VARCHAR(191)  NULL,
  `serviceDate`      DATE          NOT NULL,
  `tourNo`           VARCHAR(191)  NULL,
  `guestName`        VARCHAR(191)  NULL,
  `pax`              VARCHAR(32)   NULL,
  `pickUp`           TEXT          NULL,
  `dropOff`          TEXT          NULL,
  `time`             VARCHAR(32)   NULL,
  `details`          TEXT          NULL,
  `mcDescription`    TEXT          NULL,
  `serviceType`      VARCHAR(64)   NULL,
  `vendorName`       VARCHAR(191)  NULL,
  `mcDriverRate`     DECIMAL(14,2) NULL,
  `mcRateCurrency`   VARCHAR(8)    NULL,
  `pnlLineItemId`    VARCHAR(191)  NULL,
  `pnlDescription`   TEXT          NULL,
  `pnlCategory`      VARCHAR(32)   NULL,
  `pnlValue`         DECIMAL(14,2) NULL,
  `pnlCurrency`      VARCHAR(8)    NULL,
  `pnlMatch`         VARCHAR(8)    NOT NULL DEFAULT 'NONE',
  `pnlScore`         DECIMAL(5,3)  NULL,
  `rateText`         VARCHAR(191)  NULL,
  `rate`             DECIMAL(14,2) NULL,
  `remarks`          TEXT          NULL,
  `editedFields`     JSON          NULL,
  `bookingCancelled` TINYINT(1)    NOT NULL DEFAULT 0,
  `mcMissing`        TINYINT(1)    NOT NULL DEFAULT 0,
  `isRemoved`        TINYINT(1)    NOT NULL DEFAULT 0,
  `approvalStatus`   VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
  `approvalNote`     TEXT          NULL,
  `approvedRate`     DECIMAL(14,2) NULL,
  `approvedByName`   VARCHAR(191)  NULL,
  `approvedAt`       DATETIME(3)   NULL,
  `updatedByName`    VARCHAR(191)  NULL,
  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `trans_recon_lines_sheet_idx` (`sheetId`),
  KEY `trans_recon_lines_agenda_idx` (`agendaItemId`),
  KEY `trans_recon_lines_booking_idx` (`bookingRef`),
  CONSTRAINT `trans_recon_lines_sheetId_fkey` FOREIGN KEY (`sheetId`)
    REFERENCES `trans_recon_sheets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
