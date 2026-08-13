-- Ticket portals: where the ground team actually bought each ticket.
--
-- Malaysia, Singapore and Vietnam buy through resellers (Cebu, Global Tix,
-- Travel Vago, Be My Guest) or from an agent by name, and Accounts pays whoever
-- that was — Payable 1.0 reads these columns straight off this table.
--
-- `portalId` points at `payment_portals` in the ACCOUNTS database (a different
-- server), so there is no foreign key and there cannot be one. `portalName` is
-- kept alongside on purpose: a purchase must keep saying where it was made even
-- if the portal is renamed or taken off the list later.
--
-- Run with:
--   npx prisma db execute --file prisma/manual-sql/2026-08-13-ticket-portals.sql --schema prisma/schema.prisma
--
-- Additive and nullable throughout — every existing ticket reads as "no portal
-- recorded", which is exactly what it is. Nothing is dropped, rewritten or
-- back-filled.

ALTER TABLE `tickets`
  ADD COLUMN `portalId`   INT          NULL,
  ADD COLUMN `portalName` VARCHAR(191) NULL,
  ADD COLUMN `portalRef`  VARCHAR(191) NULL,
  ADD COLUMN `portalBy`   VARCHAR(191) NULL,
  ADD COLUMN `portalAt`   DATETIME(3)  NULL;

-- The Accounts board groups a day's payables by portal, and the portals
-- settings page counts tickets per portal; both read this column by name.
CREATE INDEX `tickets_portalName_idx` ON `tickets` (`portalName`);
