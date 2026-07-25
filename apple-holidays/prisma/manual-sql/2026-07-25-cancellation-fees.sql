-- Cancellation fees captured on the cancellation request form.
-- Run with:  npx prisma db execute --file prisma/manual-sql/2026-07-25-cancellation-fees.sql --schema prisma/schema.prisma
-- Safe to re-run only after checking; MySQL/MariaDB has no IF NOT EXISTS for ADD COLUMN on older versions.

-- `cancellationFees` holds a JSON array of { note, amount } fee lines entered by
-- the requester. `cancellationFeeTotal` is the server-computed sum of those lines.
ALTER TABLE `Booking`
  ADD COLUMN `cancellationFees`     JSON NULL,
  ADD COLUMN `cancellationFeeTotal` DECIMAL(12, 2) NULL;
