-- Accounts-team approval for booking cancellations.
-- Run with:  npx prisma db execute --file prisma/manual-sql/2026-07-22-pending-cancellation.sql --schema prisma/schema.prisma
-- Safe to re-run only after checking; MySQL/MariaDB has no IF NOT EXISTS for ADD COLUMN on older versions.

-- 1. New booking status, inserted just before CANCELLED to match schema.prisma order.
ALTER TABLE `Booking` MODIFY `status` ENUM(
  'DRAFT','BT_CONFIRMED','GT_REVIEW','CHANGE_REQUESTED','GT_VERIFIED',
  'AWAITING_PAYMENT_CONFIRM','OPERATIONS_READY','CLIENT_LIVE','IN_PROGRESS',
  'TE_REVIEWED','DRIVER_ALLOCATED','QC1_PASS','TICKETS_ISSUED','QC2_PASS',
  'MSG_SENT_CUSTOMER','FEEDBACK_DONE','COMPLETED','PENDING_CANCELLATION',
  'CANCELLED','AMENDED'
) NOT NULL DEFAULT 'DRAFT';

-- 2. Approval trail columns.
ALTER TABLE `Booking`
  ADD COLUMN `cancelRequestedAt`    DATETIME(3) NULL,
  ADD COLUMN `cancelPrevStatus`     ENUM(
    'DRAFT','BT_CONFIRMED','GT_REVIEW','CHANGE_REQUESTED','GT_VERIFIED',
    'AWAITING_PAYMENT_CONFIRM','OPERATIONS_READY','CLIENT_LIVE','IN_PROGRESS',
    'TE_REVIEWED','DRIVER_ALLOCATED','QC1_PASS','TICKETS_ISSUED','QC2_PASS',
    'MSG_SENT_CUSTOMER','FEEDBACK_DONE','COMPLETED','PENDING_CANCELLATION',
    'CANCELLED','AMENDED'
  ) NULL,
  ADD COLUMN `cancelDecidedAt`      DATETIME(3) NULL,
  ADD COLUMN `cancelDecidedByName`  VARCHAR(191) NULL,
  ADD COLUMN `cancelDecidedByEmail` VARCHAR(191) NULL,
  ADD COLUMN `cancelDecisionNote`   TEXT NULL;
