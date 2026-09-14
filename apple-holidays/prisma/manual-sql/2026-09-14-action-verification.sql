-- Step-up (two-step) email verification for cancelling and deleting bookings.
--
-- Run with:
--   npx prisma db execute --file prisma/manual-sql/2026-09-14-action-verification.sql --schema prisma/schema.prisma
--
-- STRICTLY ADDITIVE AND SAFE ON LIVE. One brand-new table. No existing table is
-- altered, no existing row is read or written, and there is no foreign key, so
-- nothing cascades and no booking can be touched by this migration. CREATE
-- TABLE IF NOT EXISTS makes a second run a no-op rather than an error.
--
-- NOTE: until this runs, cancel and delete fail closed — the routes refuse the
-- action rather than perform it unverified. Run it before deploying the code.

CREATE TABLE IF NOT EXISTS `action_verifications` (
  `id`         VARCHAR(191) NOT NULL,
  `userId`     VARCHAR(191) NOT NULL,
  `email`      VARCHAR(320) NOT NULL,
  `action`     VARCHAR(60)  NOT NULL,
  `target`     VARCHAR(191) NOT NULL,
  `label`      VARCHAR(255) NULL,
  `codeHash`   VARCHAR(64)  NOT NULL,
  `attempts`   INT          NOT NULL DEFAULT 0,
  `expiresAt`  DATETIME(3)  NOT NULL,
  `consumedAt` DATETIME(3)  NULL,
  `ipAddress`  VARCHAR(64)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `action_verifications_userId_action_target_idx` (`userId`, `action`, `target`),
  INDEX `action_verifications_expiresAt_idx` (`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4;
