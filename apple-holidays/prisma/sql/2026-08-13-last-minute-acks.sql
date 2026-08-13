-- Last-minute booking acknowledgements (the D-4 alert).
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row: nothing is altered, dropped, back-filled or rewritten. The
-- "last minute" flag itself is *derived* (arrivalDate − createdAt ≤ 4 days, see
-- `src/lib/last-minute-shared.ts`) and needs no column anywhere — this table
-- stores only the acknowledgement, which is the one fact that cannot be derived.
--
-- There is no FK to `bookings` on purpose, matching `booking_reconfirm_delays`:
-- the row is keyed by booking ref so it survives the child-row rewrite an
-- amendment performs, and a record of who took responsibility for a late file
-- must not be removed by a cascade.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct":
--
--   npx prisma db execute --file prisma/sql/2026-08-13-last-minute-acks.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `booking_last_minute_acks` (
    `id` VARCHAR(191) NOT NULL,
    `bookingRef` VARCHAR(191) NOT NULL,
    `arrivalDate` DATETIME(3) NOT NULL,
    `leadDays` INT NOT NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `acknowledgedByEmail` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `booking_last_minute_acks_bookingRef_key`(`bookingRef`),
    INDEX `booking_last_minute_acks_acknowledgedAt_idx`(`acknowledgedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
