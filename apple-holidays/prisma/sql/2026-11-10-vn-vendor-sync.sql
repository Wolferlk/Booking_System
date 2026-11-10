-- VN Vendor Sync — fills each Vietnam movement's TOUR VENDOR from the desk's
-- Excel checklist (Checklist VN 2.1v mirror), every 15 minutes.
--
-- The workbook is never written. The sync reads the vn_sheet_checklist_* mirror
-- and writes ONLY assignments.tourVendorId / tourVendorName / tourVendorPhone,
-- and only where the movement has no tour vendor yet (or still holds the one
-- this sync put there). Driver, vehicle vendor, rate and guide fields are never
-- touched. These three tables are its memory and its log.
--
--   vn_vendor_sync_runs    One row per run (every 15 min, "Fetch now", stale
--                          read): what the sheet refresh did and what changed.
--
--   vn_vendor_sync_links   One row per movement the sync has an opinion on:
--                          which sheet line it matched, the vendor, how sure
--                          it is, and what it wrote — plus what was there
--                          BEFORE its first write, so every write can be undone.
--                          Keyed by booking + a movement key (date + route),
--                          because the chart re-creates movement ids on save.
--
--   vn_vendor_sync_events  The log: applied / updated / suggested / kept
--                          manual / undone / ignored, with from → to.
--
-- SAFETY
--   * Additive only. Three brand-new tables. No ALTER, DROP, TRUNCATE, DELETE
--     or UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No foreign keys (the live schema drifts), no DELIMITER / procedures.
--
--   bash prisma/sql/apply-vn-vendor-sync.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-vn-vendor-sync.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `vn_vendor_sync_runs` (
  `id`            VARCHAR(191)  NOT NULL,
  -- CRON | MANUAL | STALE
  `trigger`       VARCHAR(16)   NOT NULL,
  -- ALL, or the booking ref a "Fetch now" was pressed on
  `scope`         VARCHAR(64)   NOT NULL DEFAULT 'ALL',
  -- AUTO | SUGGEST — what the run was allowed to do
  `mode`          VARCHAR(16)   NOT NULL DEFAULT 'AUTO',
  -- RUNNING | SUCCESS | FAILED | SKIPPED
  `status`        VARCHAR(16)   NOT NULL DEFAULT 'RUNNING',
  `startedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt`    DATETIME(3)   NULL,
  `durationMs`    INT           NULL,

  -- The Excel refresh that ran first: SUCCESS | UNCHANGED | FAILED | SKIPPED | BUSY
  `sheetStatus`   VARCHAR(16)   NULL,
  `sheetNote`     VARCHAR(500)  NULL,

  `bookings`      INT           NOT NULL DEFAULT 0,
  `movements`     INT           NOT NULL DEFAULT 0,
  `matched`       INT           NOT NULL DEFAULT 0,
  `applied`       INT           NOT NULL DEFAULT 0,
  `updated`       INT           NOT NULL DEFAULT 0,
  `suggested`     INT           NOT NULL DEFAULT 0,
  `keptManual`    INT           NOT NULL DEFAULT 0,
  `inSync`        INT           NOT NULL DEFAULT 0,
  `noMatch`       INT           NOT NULL DEFAULT 0,

  `error`         TEXT          NULL,
  `triggeredBy`   VARCHAR(191)  NULL,
  `undoneAt`      DATETIME(3)   NULL,
  `undoneBy`      VARCHAR(191)  NULL,

  PRIMARY KEY (`id`),
  INDEX `vn_vendor_sync_runs_started_idx` (`startedAt`),
  INDEX `vn_vendor_sync_runs_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_vendor_sync_links` (
  `id`              VARCHAR(191)  NOT NULL,
  `bookingRef`      VARCHAR(64)   NOT NULL,
  -- yyyy-mm-dd|from>to (normalised) — survives the chart re-creating item ids
  `movementKey`     VARCHAR(255)  NOT NULL,
  `agendaItemId`    VARCHAR(191)  NULL,
  `movementDate`    DATE          NULL,
  `movementLabel`   VARCHAR(500)  NULL,
  -- AIRPORT_ARRIVAL | AIRPORT_DEPARTURE | HOTEL_MOVE | ACTIVITY
  `movementKind`    VARCHAR(24)   NULL,

  -- The sheet line that won
  `tourCode`        VARCHAR(191)  NULL,
  `sheetRow`        INT           NULL,
  `lineDetails`     TEXT          NULL,
  `lineCode`        VARCHAR(64)   NULL,
  `sheetVendor`     VARCHAR(191)  NULL,
  `score`           DECIMAL(5,2)  NULL,
  -- HIGH | MEDIUM
  `confidence`      VARCHAR(8)    NULL,
  `reason`          VARCHAR(500)  NULL,
  -- JSON: other vendors that also fit (ticket seller beside the transport…)
  `alsoJson`        TEXT          NULL,

  -- Who the vendor resolves to: TOUR_VENDOR | VEHICLE_VENDOR | NONE
  `directorySource` VARCHAR(16)   NULL,
  `vendorId`        VARCHAR(191)  NULL,
  `vendorName`      VARCHAR(191)  NULL,
  `vendorPhone`     VARCHAR(64)   NULL,

  -- APPLIED | SUGGESTED | IN_SYNC | KEPT_MANUAL | IGNORED | STALE | UNDONE
  `status`          VARCHAR(16)   NOT NULL,
  `note`            VARCHAR(500)  NULL,

  -- What this sync last wrote, and what was there before its FIRST write.
  `appliedName`     VARCHAR(191)  NULL,
  `appliedId`       VARCHAR(191)  NULL,
  `appliedPhone`    VARCHAR(64)   NULL,
  `prevName`        VARCHAR(191)  NULL,
  `prevId`          VARCHAR(191)  NULL,
  `prevPhone`       VARCHAR(64)   NULL,
  `appliedAt`       DATETIME(3)   NULL,
  `appliedBy`       VARCHAR(191)  NULL,
  `appliedRunId`    VARCHAR(191)  NULL,

  `lastRunId`       VARCHAR(191)  NULL,
  `lastSeenAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `vn_vendor_sync_links_ref_key` (`bookingRef`, `movementKey`),
  INDEX `vn_vendor_sync_links_item_idx` (`agendaItemId`),
  INDEX `vn_vendor_sync_links_status_idx` (`status`),
  INDEX `vn_vendor_sync_links_run_idx` (`appliedRunId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_vendor_sync_events` (
  `id`            VARCHAR(191)  NOT NULL,
  `runId`         VARCHAR(191)  NULL,
  `bookingRef`    VARCHAR(64)   NOT NULL,
  `movementKey`   VARCHAR(255)  NULL,
  `movementLabel` VARCHAR(500)  NULL,
  -- APPLIED | UPDATED | SUGGESTED | KEPT_MANUAL | SHEET_DROPPED | UNDONE | IGNORED | RESTORED | ERROR
  `action`        VARCHAR(16)   NOT NULL,
  `fromValue`     VARCHAR(191)  NULL,
  `toValue`       VARCHAR(191)  NULL,
  `score`         DECIMAL(5,2)  NULL,
  `detail`        VARCHAR(500)  NULL,
  `actor`         VARCHAR(191)  NULL,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `vn_vendor_sync_events_ref_idx` (`bookingRef`, `createdAt`),
  INDEX `vn_vendor_sync_events_run_idx` (`runId`),
  INDEX `vn_vendor_sync_events_created_idx` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
