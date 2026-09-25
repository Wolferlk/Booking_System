-- Agenda custom service types — the MC agenda's Service Type box becomes a
-- type-to-search combo box, and a type the desk types in themselves (one that
-- is not in the built-in list) is saved as typed and offered to everyone in the
-- dropdown from then on.
--
-- That needs `agenda_items.serviceType` to hold free text, so the ENUM becomes
-- VARCHAR(64). MySQL/MariaDB carry every stored enum value over as the same
-- string, so no existing row changes, and the default stays `OWN_ARRANGEMENT`.
-- 64 matches `agenda_item_includes.itemServiceType`, which snapshots this value.
--
-- Until this runs, the built-in types save exactly as before; only a typed-in
-- custom type is refused (the app says so and nothing is changed).
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct":
--
--   bash prisma/sql/apply-agenda-custom-service-types.sh
--
-- Re-runnable: re-applying simply restates the same column definition.

ALTER TABLE `agenda_items`
  MODIFY COLUMN `serviceType` VARCHAR(64) NOT NULL DEFAULT 'OWN_ARRANGEMENT';
