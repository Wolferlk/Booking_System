-- VN Driver Sync — fills each Vietnam movement's DRIVER from the VN team's
-- workbook "(VN TEAM) Movement Chart 2026 (Final)" on OneDrive (read with Microsoft Graph), every 15 minutes.
--
-- The sheet is never written. Each sheet row (Date, Code, Tour Details, Meal
-- Plan, Meeting Time, Service Type, Vendors) is matched to the system movement
-- it describes — by rules first, OpenAI only for the rows the rules cannot
-- settle — and the Vendors text is saved on that movement:
--
--   assignments.driverName  = the full sheet text  ("Go Air - Driver's manager in Hanoi: +848… / +843… - Dương / Thảo Goair")
--   assignments.driverPhone = the numbers only     ("+84899802839 / +84368933597")
--
-- Only where the movement has no driver yet (or still holds the text this sync
-- put there). A driver picked from the directory, a vehicle vendor, or a name a
-- person typed is never replaced. A sheet text without a phone number is never
-- written. Guests only ever see the numbers (src/lib/guest-driver.ts).
--
--   vn_driver_sync_runs    One row per run: sheet read, counts, unmatched rows.
--   vn_driver_sync_links   One row per movement the sync has an opinion on:
--                          the sheet row, how sure, what it wrote and what was
--                          there BEFORE, so every write can be undone. Keyed by
--                          booking + movement key (chart saves re-create ids).
--   vn_driver_sync_events  The log, with from → to.
--
-- SAFETY
--   * Additive only. Three brand-new tables. No ALTER, DROP, TRUNCATE, DELETE
--     or UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No foreign keys (the live schema drifts), no DELIMITER / procedures.
--
--   bash prisma/sql/apply-vn-driver-sync.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-vn-driver-sync.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `vn_driver_sync_runs` (
  `id`            VARCHAR(191) NOT NULL,
  `trigger`       VARCHAR(16)  NOT NULL,
  `scope`         VARCHAR(64)  NOT NULL DEFAULT 'ALL',
  `mode`          VARCHAR(16)  NOT NULL DEFAULT 'AUTO',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'RUNNING',
  `startedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt`    DATETIME(3)  NULL,
  `durationMs`    INT          NULL,
  `sheetNote`     VARCHAR(500) NULL,
  `sheetRows`     INT          NOT NULL DEFAULT 0,
  `bookings`      INT          NOT NULL DEFAULT 0,
  `movements`     INT          NOT NULL DEFAULT 0,
  `matched`       INT          NOT NULL DEFAULT 0,
  `applied`       INT          NOT NULL DEFAULT 0,
  `updated`       INT          NOT NULL DEFAULT 0,
  `suggested`     INT          NOT NULL DEFAULT 0,
  `keptManual`    INT          NOT NULL DEFAULT 0,
  `inSync`        INT          NOT NULL DEFAULT 0,
  `noNumber`      INT          NOT NULL DEFAULT 0,
  `noMatch`       INT          NOT NULL DEFAULT 0,
  `aiCalls`       INT          NOT NULL DEFAULT 0,
  `unmatchedJson` MEDIUMTEXT   NULL,
  `error`         TEXT         NULL,
  `triggeredBy`   VARCHAR(191) NULL,
  `undoneAt`      DATETIME(3)  NULL,
  `undoneBy`      VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  INDEX `vn_driver_sync_runs_started_idx` (`startedAt`),
  INDEX `vn_driver_sync_runs_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_driver_sync_links` (
  `id`            VARCHAR(191) NOT NULL,
  `bookingRef`    VARCHAR(64)  NOT NULL,
  `movementKey`   VARCHAR(255) NOT NULL,
  `agendaItemId`  VARCHAR(191) NULL,
  `movementDate`  DATE         NULL,
  `movementLabel` VARCHAR(500) NULL,
  `movementText`  TEXT         NULL,
  `sheetTab`      VARCHAR(191) NULL,
  `sheetRow`      INT          NULL,
  `sheetDate`     DATE         NULL,
  `sheetDetails`  TEXT         NULL,
  `sheetTime`     VARCHAR(32)  NULL,
  `sheetService`  VARCHAR(191) NULL,
  `sheetText`     TEXT         NULL,
  `phones`        VARCHAR(191) NULL,
  `score`         DECIMAL(5,2) NULL,
  `confidence`    VARCHAR(8)   NULL,
  `method`        VARCHAR(8)   NULL,
  `reason`        VARCHAR(500) NULL,
  `aiHash`        VARCHAR(64)  NULL,
  `aiJson`        TEXT         NULL,
  `status`        VARCHAR(16)  NOT NULL,
  `note`          VARCHAR(500) NULL,
  `appliedName`   VARCHAR(191) NULL,
  `appliedPhone`  VARCHAR(191) NULL,
  `prevName`      VARCHAR(191) NULL,
  `prevPhone`     VARCHAR(191) NULL,
  `appliedAt`     DATETIME(3)  NULL,
  `appliedBy`     VARCHAR(191) NULL,
  `appliedRunId`  VARCHAR(191) NULL,
  `lastRunId`     VARCHAR(191) NULL,
  `lastSeenAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `vn_driver_sync_links_ref_key` (`bookingRef`, `movementKey`),
  INDEX `vn_driver_sync_links_item_idx` (`agendaItemId`),
  INDEX `vn_driver_sync_links_status_idx` (`status`),
  INDEX `vn_driver_sync_links_run_idx` (`appliedRunId`),
  INDEX `vn_driver_sync_links_date_idx` (`movementDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_driver_sync_events` (
  `id`            VARCHAR(191) NOT NULL,
  `runId`         VARCHAR(191) NULL,
  `bookingRef`    VARCHAR(64)  NOT NULL,
  `movementKey`   VARCHAR(255) NULL,
  `movementLabel` VARCHAR(500) NULL,
  `action`        VARCHAR(16)  NOT NULL,
  `fromValue`     VARCHAR(191) NULL,
  `toValue`       VARCHAR(191) NULL,
  `score`         DECIMAL(5,2) NULL,
  `detail`        VARCHAR(500) NULL,
  `actor`         VARCHAR(191) NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `vn_driver_sync_events_ref_idx` (`bookingRef`, `createdAt`),
  INDEX `vn_driver_sync_events_run_idx` (`runId`),
  INDEX `vn_driver_sync_events_created_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
