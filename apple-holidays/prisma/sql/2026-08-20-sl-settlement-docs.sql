-- Sri Lanka settlement documents — the printable pack behind the Drive Log's
-- "Documents" button (name board, transport / local visit / tour settlement).
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row: nothing is altered, dropped, back-filled or rewritten. The
-- table holds one JSON pack per booking — the desk's edited version of the four
-- sheets. Everything in it is *typed in*: hand-approved extras, agreed batta
-- rates, signatures, the guest name as it should read on the board. None of it
-- is derived, which is why it is stored rather than recomputed.
--
-- There is no FK to `bookings` on purpose, matching `booking_last_minute_acks`:
-- the row is keyed by booking ref so it survives the child-row rewrite an
-- amendment performs, and a settlement sheet that has been out with a driver
-- must not vanish under a cascade.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct":
--
--   npx prisma db execute --file prisma/sql/2026-08-20-sl-settlement-docs.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `sl_settlement_docs` (
    `bookingRef` VARCHAR(191) NOT NULL,
    `pack` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`bookingRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
