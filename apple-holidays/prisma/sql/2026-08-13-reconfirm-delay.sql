-- Guest reconfirmation D-10 delay reasons.
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row. There is no FK to `bookings` on purpose: the row is keyed by
-- booking ref so it survives the child-row rewrite an amendment performs, and a
-- record of why a deadline was missed must not be removed by a cascade.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct":
--
--   npx prisma db execute --file prisma/sql/2026-08-13-reconfirm-delay.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `booking_reconfirm_delays` (
    `id` VARCHAR(191) NOT NULL,
    `bookingRef` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(32) NOT NULL,
    `note` TEXT NULL,
    `dueAt` DATETIME(3) NULL,
    `recordedBy` VARCHAR(191) NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `booking_reconfirm_delays_bookingRef_key`(`bookingRef`),
    INDEX `booking_reconfirm_delays_reason_idx`(`reason`),
    INDEX `booking_reconfirm_delays_recordedAt_idx`(`recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
