-- Checklist VN 2.1v — a read-only mirror of the Vietnam desk's live Excel
-- checklist ("Checklist 2026.xlsx" on SharePoint), refreshed every 2 hours.
--
-- The workbook stays the source of truth and is NEVER written to: the sync
-- downloads the file and parses it, it does not open a workbook session. These
-- tables are what OPS reads, so a booking page does not have to fetch a 6 MB
-- file to show one tour.
--
-- Four tables:
--
--   vn_sheet_checklist_tours    One row per TOUR CODE header row: agent, pax,
--                               dates, itinerary, revenue, total estimate, PNL.
--                               A tour that leaves the sheet is marked
--                               isActive = 0, never deleted.
--
--   vn_sheet_checklist_lines    One row per payment line under a tour (details
--                               for payment, vendor, code, unit price, quan1 x
--                               quan2, total estimate, paid). Rewritten per tour,
--                               and only when that tour's content changed.
--
--   vn_sheet_checklist_syncs    One row per sync run — when, why, what changed,
--                               and the error if it failed. The Settings card
--                               and the "last synced" chip read this.
--
--   vn_sheet_checklist_events   What changed on a tour between two syncs
--                               ("Paid: Check -> ACT paid", "+1 line"), for the
--                               booking page's timeline.
--
-- Keyed by `tourCode` (VN42202), not a booking id — the sheet has no id, and a
-- tour exists in the sheet whether or not OPS has the booking. Combined codes
-- ("VN15137/VN17876") are matched through `refKey` (",VN15137,VN17876,").
-- No foreign keys, as with the other VN tables, because the live schema drifts.
--
-- SAFETY
--   * Additive only. Four brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No DELIMITER / procedures (`prisma db execute` splits on `;`).
--
--   bash prisma/sql/apply-vn-checklist-sheet.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-vn-checklist-sheet.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `vn_sheet_checklist_tours` (
  `id`               VARCHAR(191)  NOT NULL,
  `tourCode`         VARCHAR(191)  NOT NULL,
  -- ",VN15137,VN17876," — every VN ref in the code, for LIKE matching.
  `refKey`           VARCHAR(500)  NOT NULL DEFAULT '',
  `primaryRef`       VARCHAR(64)   NULL,

  `agent`            VARCHAR(191)  NULL,
  -- The agent's own booking reference (column B of the first line row).
  `agentRef`         VARCHAR(191)  NULL,
  `pax`              INT           NULL,
  `monthLabel`       VARCHAR(64)   NULL,
  `arrivalDate`      DATE          NULL,
  `departureDate`    DATE          NULL,
  `days`             INT           NULL,
  `itinerary`        VARCHAR(500)  NULL,

  -- Header-row money. VND columns are whole dong (not thousands).
  `quotedUsd`        DECIMAL(16,2) NULL,
  `revenueUsd`       DECIMAL(16,2) NULL,
  `totalVnd`         DECIMAL(18,2) NULL,
  `totalEstimateVnd` DECIMAL(18,2) NULL,
  `pnlIncurredVnd`   DECIMAL(18,2) NULL,
  `profitMargin`     DECIMAL(12,6) NULL,
  `exchangeRate`     DECIMAL(14,4) NULL,

  -- Rolled up from the lines on every sync.
  `lineCount`        INT           NOT NULL DEFAULT 0,
  `linesTotalVnd`    DECIMAL(18,2) NOT NULL DEFAULT 0,
  `paidLineCount`    INT           NOT NULL DEFAULT 0,
  `checkLineCount`   INT           NOT NULL DEFAULT 0,
  `openLineCount`    INT           NOT NULL DEFAULT 0,

  `sheetTab`         VARCHAR(191)  NULL,
  `sheetRow`         INT           NULL,
  `contentHash`      VARCHAR(64)   NOT NULL,
  `isActive`         TINYINT(1)    NOT NULL DEFAULT 1,
  `firstSeenAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `changedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `removedAt`        DATETIME(3)   NULL,
  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `vn_sheet_checklist_tours_tourCode_key` (`tourCode`),
  INDEX `vn_sheet_checklist_tours_primaryRef_idx` (`primaryRef`),
  INDEX `vn_sheet_checklist_tours_arrival_idx` (`arrivalDate`),
  INDEX `vn_sheet_checklist_tours_active_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_sheet_checklist_lines` (
  `id`               VARCHAR(191)  NOT NULL,
  `tourCode`         VARCHAR(191)  NOT NULL,
  `position`         INT           NOT NULL DEFAULT 0,
  `sheetTab`         VARCHAR(191)  NULL,
  `sheetRow`         INT           NULL,

  -- DETAILS FOR PAYMENT / VENDORS / CODE / DATES / Status (Quality check)
  `details`          TEXT          NOT NULL,
  `vendor`           VARCHAR(191)  NULL,
  `code`             VARCHAR(64)   NULL,
  `dates`            VARCHAR(191)  NULL,
  `qcStatus`         VARCHAR(191)  NULL,

  `unitPrice`        DECIMAL(18,4) NULL,
  `quan1`            DECIMAL(12,2) NULL,
  `quan2`            DECIMAL(12,2) NULL,
  `totalEstimateVnd` DECIMAL(18,2) NULL,

  -- Column "Paid" as typed ("ACT paid", "Check", "Tina paid", ...) and the
  -- bucket it falls in: ACT_PAID | TINA_PAID | INDIA_PAID | OTHER_PAID | CHECK | OPEN
  `paidRaw`          VARCHAR(191)  NULL,
  `paidBucket`       VARCHAR(16)   NOT NULL DEFAULT 'OPEN',
  `incurred`         VARCHAR(191)  NULL,
  `note`             TEXT          NULL,

  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `vn_sheet_checklist_lines_tour_idx` (`tourCode`, `position`),
  INDEX `vn_sheet_checklist_lines_bucket_idx` (`paidBucket`),
  INDEX `vn_sheet_checklist_lines_vendor_idx` (`vendor`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_sheet_checklist_syncs` (
  `id`               VARCHAR(191)  NOT NULL,
  -- CRON | MANUAL | STALE | SETTINGS
  `trigger`          VARCHAR(16)   NOT NULL,
  -- RUNNING | SUCCESS | UNCHANGED | FAILED
  `status`           VARCHAR(16)   NOT NULL DEFAULT 'RUNNING',
  `startedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt`       DATETIME(3)   NULL,
  `durationMs`       INT           NULL,

  `fileName`         VARCHAR(191)  NULL,
  `fileETag`         VARCHAR(191)  NULL,
  `fileModifiedAt`   DATETIME(3)   NULL,
  `fileSize`         INT           NULL,
  `tabs`             VARCHAR(500)  NULL,

  `tours`            INT           NOT NULL DEFAULT 0,
  `lines`            INT           NOT NULL DEFAULT 0,
  `added`            INT           NOT NULL DEFAULT 0,
  `changed`          INT           NOT NULL DEFAULT 0,
  `removed`          INT           NOT NULL DEFAULT 0,
  `warnings`         TEXT          NULL,
  `error`            TEXT          NULL,
  `triggeredBy`      VARCHAR(191)  NULL,

  PRIMARY KEY (`id`),
  INDEX `vn_sheet_checklist_syncs_started_idx` (`startedAt`),
  INDEX `vn_sheet_checklist_syncs_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_sheet_checklist_events` (
  `id`               VARCHAR(191)  NOT NULL,
  `tourCode`         VARCHAR(191)  NOT NULL,
  `syncId`           VARCHAR(191)  NULL,
  -- ADDED | CHANGED | REMOVED | RESTORED
  `kind`             VARCHAR(16)   NOT NULL,
  `summary`          VARCHAR(500)  NOT NULL,
  -- JSON array of { field, from, to, line? }
  `changes`          TEXT          NULL,
  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `vn_sheet_checklist_events_tour_idx` (`tourCode`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
