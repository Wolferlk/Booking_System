-- Adds AgendaItem.isLeisure — the "It's a leisure day" flag on the movement chart.
--
-- Additive and non-destructive: a new nullable column with no default. Existing
-- rows stay NULL, which the app reads as "never decided" and falls back to text
-- detection (src/lib/leisure-day.ts), so nothing changes for saved agendas until
-- someone toggles the button or regenerates.
--
-- Apply with (NOT `prisma db push` — the live DB carries unrelated drift that a
-- push would also apply):
--   npx prisma db execute --file scripts/sql/add-agenda-item-is-leisure.sql --schema prisma/schema.prisma
--   npx prisma generate
--
-- Safe to run once per database. Re-running errors with "Duplicate column name".

ALTER TABLE `agenda_items` ADD COLUMN `isLeisure` BOOLEAN NULL;
