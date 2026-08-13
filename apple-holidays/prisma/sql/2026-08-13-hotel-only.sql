-- Hotel Only bookings — accommodation and nothing else.
--
-- Purely additive: four new columns on `bookings` plus one index. Nothing is
-- dropped, renamed or rewritten, and every existing row defaults to 0 (not
-- hotel-only), so the flag is invisible until an operator sets it.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct".
--
--   npx prisma db execute --file prisma/sql/2026-08-13-hotel-only.sql --schema prisma/schema.prisma
--
-- Re-runnable: MariaDB/MySQL 8 will error on a duplicate column, which is the
-- intended signal that it has already been applied.

ALTER TABLE `bookings`
  ADD COLUMN `hotelOnly`     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `hotelOnlyAt`   DATETIME(3) NULL,
  ADD COLUMN `hotelOnlyBy`   VARCHAR(191) NULL,
  ADD COLUMN `hotelOnlyNote` TEXT NULL;

CREATE INDEX `bookings_hotelOnly_idx` ON `bookings` (`hotelOnly`);
