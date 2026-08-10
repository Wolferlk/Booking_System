-- Adds AgendaItem.isHotelOnly — the "Hotel Only" flag on the movement chart.
--
-- A hotel-only movement needs no driver, the same way a leisure day does, so the
-- Sri Lanka Driver Allocation board counts the file as allocated rather than
-- pending. It mirrors the booking-level `hotel_only` vehicle type already on
-- sl_driver_allocations.vehicleType.
--
-- Additive and non-destructive: a new nullable column with no default. Existing
-- rows stay NULL, which the app reads as "not hotel only" — nothing changes for
-- saved agendas until someone presses the button or the allocation board sets
-- the booking's vehicle type to Hotel Only.
--
-- Apply with (NOT `prisma db push` — the live DB carries unrelated drift that a
-- push would also apply):
--   npx prisma db execute --file scripts/sql/add-agenda-item-is-hotel-only.sql --schema prisma/schema.prisma
--   npx prisma generate
--
-- Safe to run once per database. Re-running errors with "Duplicate column name".

ALTER TABLE `agenda_items` ADD COLUMN `isHotelOnly` BOOLEAN NULL;
