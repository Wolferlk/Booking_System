-- Ticket approvals — the ground team's side of "ask before you buy".
--
-- Malaysia, Singapore and Vietnam buy attraction tickets through resellers.
-- Until now they bought first and recorded the portal afterwards, leaving
-- Accounts to pay a purchase already made. The order is now:
--
--   1. the ticket is created off the Detailed P&L,
--   2. the ground team picks the portal it intends to buy through and submits
--      the ticket to Accounts for approval,
--   3. Accounts approves it on Payable 1.0 and pays the portal,
--   4. only then does this app offer the Purchase button.
--
-- The request itself lives in the ACCOUNTS database, in `ticket_approvals` —
-- one row, both systems, no sync job to drift (see src/lib/ticket-approvals.ts
-- and Accounts' 2026_08_14_090000_create_ticket_approvals_table.php). What is
-- added here is a *mirror*: the same state, denormalised onto the ticket, so
-- the tickets list can filter, sort and colour by it without a cross-database
-- query per row. The shared table stays the truth; anything here is refreshed
-- from it, never the other way round.
--
-- Run with:
--   npx prisma db execute --file prisma/manual-sql/2026-08-14-ticket-approvals.sql --schema prisma/schema.prisma
--
-- Additive and nullable throughout. Every existing ticket reads as "never
-- submitted", which is exactly what it is — including the ones already
-- purchased under the old rules, which are left alone.

ALTER TABLE `tickets`
  -- pending | approved | paid | rejected | withdrawn | cancelled.
  -- NULL means the ticket has never been sent over.
  ADD COLUMN `approvalStatus`   VARCHAR(20)  NULL,
  -- The shared row's id, so a refresh is a lookup rather than a search.
  ADD COLUMN `approvalId`       INT          NULL,
  ADD COLUMN `approvalUrgency`  VARCHAR(12)  NULL,
  ADD COLUMN `approvalReason`   VARCHAR(255) NULL,
  -- When the ground team needs the money out by, if they said.
  ADD COLUMN `approvalNeededBy` DATETIME(3)  NULL,
  ADD COLUMN `submittedBy`      VARCHAR(191) NULL,
  ADD COLUMN `submittedAt`      DATETIME(3)  NULL,
  -- Accounts' answer, mirrored so the ticket card can show it offline.
  ADD COLUMN `approvalDecidedBy`   VARCHAR(191) NULL,
  ADD COLUMN `approvalDecidedAt`   DATETIME(3)  NULL,
  ADD COLUMN `approvalNote`        TEXT         NULL,
  ADD COLUMN `approvalPaidAt`      DATETIME(3)  NULL,
  ADD COLUMN `approvalPaidRef`     VARCHAR(191) NULL,
  ADD COLUMN `approvalSyncedAt`    DATETIME(3)  NULL;

-- The tickets list filters on "what is waiting on Accounts", per booking.
CREATE INDEX `tickets_approvalStatus_idx` ON `tickets` (`approvalStatus`);
