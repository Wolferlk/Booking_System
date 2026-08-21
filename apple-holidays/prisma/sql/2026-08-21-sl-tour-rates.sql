-- Sri Lanka tour entrance rate card — the adult / child gate price behind the
-- Tour Settlement sheet's "Rate card" panel.
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row: nothing is altered, dropped, back-filled or rewritten. One row
-- per attraction, shared by every booking, so a settlement sheet opens with
-- this year's prices already on it instead of a handler remembering them.
--
-- Keyed by the attraction name as it is printed. No FK anywhere: the catalogue
-- in `src/lib/sl-tour-tickets.ts` is the default list and this table is only
-- the prices written against it, so a name that is no longer sold simply stops
-- being read.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct":
--
--   npx prisma db execute --file prisma/sql/2026-08-21-sl-tour-rates.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `sl_tour_rates` (
    `name` VARCHAR(191) NOT NULL,
    `adultRate` DECIMAL(12, 2) NULL,
    `childRate` DECIMAL(12, 2) NULL,
    `note` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
