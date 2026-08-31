-- Driver Brief — the record that a human actually walked a driver through a file.
--
-- Why a table: the movement chart already says *who* is driving and WhatsApp
-- already says *what was sent*. Neither answers the question the ops desk is
-- asked when something goes wrong on day two — "was this driver briefed, by
-- whom, and what did we tell him". A sent message is not a briefing; a briefing
-- is somebody reading the file to the driver page by page and writing down what
-- came out of it. That event has nowhere to live until now.
--
-- One row per booking, keyed by `bookingRef` rather than the booking id so the
-- brief survives the child-row rewrite an amendment performs — the same choice
-- `driver_logs` and `sl_settlement_docs` make. The driver is denormalised onto
-- the row on purpose: the brief must keep saying who was briefed even after the
-- allocation is changed to somebody else, because that change is precisely when
-- somebody needs to know the old driver had already been walked through it.
--
-- `slidesSeen` is the deck's own progress (which pages were actually read, not
-- merely opened) and `aiBrief` caches the generated talking points so reopening
-- the deck costs nothing. Both are JSON because their shape belongs to the deck,
-- not to the schema.
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row. Idempotent via IF NOT EXISTS — safe to run against live.
--
--   npx prisma db execute --file prisma/sql/2026-08-31-driver-briefs.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `driver_briefs` (
    `bookingRef`    VARCHAR(191) NOT NULL,

    -- Who was briefed. Denormalised deliberately (see header).
    `driverId`      VARCHAR(191) NULL,
    `driverName`    VARCHAR(191) NULL,
    `driverPhone`   VARCHAR(32)  NULL,

    -- 'pending' → nobody has opened the deck.
    -- 'in_progress' → opened, some slides read, not signed off.
    -- 'completed' → walked through and marked complete.
    `status`        VARCHAR(24)  NOT NULL DEFAULT 'pending',

    -- What the briefer wrote down: the driver's questions, what he already
    -- knew, what he was told to watch for. Free text on purpose.
    `notes`         TEXT         NULL,

    -- { "driver": true, "overview": true, ... } — one key per slide read.
    `slidesSeen`    LONGTEXT     NULL,

    -- Cached AI talking points so reopening the deck spends no model call.
    `aiBrief`       LONGTEXT     NULL,
    `aiBriefAt`     DATETIME(3)  NULL,

    `startedAt`     DATETIME(3)  NULL,
    `completedAt`   DATETIME(3)  NULL,
    `briefedById`   VARCHAR(191) NULL,
    `briefedByName` VARCHAR(191) NULL,

    `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`bookingRef`),
    INDEX `driver_briefs_status_idx`      (`status`),
    INDEX `driver_briefs_driverId_idx`    (`driverId`),
    INDEX `driver_briefs_completedAt_idx` (`completedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
