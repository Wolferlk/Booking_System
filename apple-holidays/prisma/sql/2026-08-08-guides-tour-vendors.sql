-- Guides & Tour Vendors directories + their link into the movement chart.
--
-- Apply with (never `prisma db push` — the live schema carries drift):
--   npx prisma db execute --file prisma/sql/2026-08-08-guides-tour-vendors.sql --schema prisma/schema.prisma
--
-- SAFETY
--   * Purely additive: two new tables, six new nullable columns on `assignments`.
--   * No DROP, TRUNCATE, DELETE or UPDATE of existing rows anywhere in this file.
--   * Idempotent: every statement checks first, so re-running is a no-op.
--   * No stored procedures / DELIMITER, because `prisma db execute` splits on `;`.

CREATE TABLE IF NOT EXISTS `guides` (
  `id`             VARCHAR(191) NOT NULL,
  `name`           VARCHAR(191) NOT NULL,
  `country`        ENUM('ALL','VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA') NULL,
  `phone`          VARCHAR(191) NOT NULL,
  `whatsappPhone`  VARCHAR(191) NULL,
  `email`          VARCHAR(191) NULL,
  `photoUrl`       TEXT NULL,
  `nicNo`          VARCHAR(191) NULL,
  `languages`      TEXT NULL,
  `additionalInfo` TEXT NULL,
  `specialNote`    TEXT NULL,
  `bankName`       VARCHAR(191) NULL,
  `bankAccountNo`  VARCHAR(191) NULL,
  `bankHolder`     VARCHAR(191) NULL,
  `bankBranch`     VARCHAR(191) NULL,
  `bankCode`       VARCHAR(191) NULL,
  `isActive`       BOOLEAN NOT NULL DEFAULT true,
  `source`         ENUM('STAFF','SELF_REGISTERED','MANUAL_ENTRY') NOT NULL DEFAULT 'STAFF',
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `guides_country_idx` (`country`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `tour_vendors` (
  `id`             VARCHAR(191) NOT NULL,
  `name`           VARCHAR(191) NOT NULL,
  `country`        ENUM('ALL','VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA') NULL,
  `phone`          VARCHAR(191) NOT NULL,
  `whatsappPhone`  VARCHAR(191) NULL,
  `email`          VARCHAR(191) NULL,
  `photoUrl`       TEXT NULL,
  `nicNo`          VARCHAR(191) NULL,
  `services`       TEXT NULL,
  `additionalInfo` TEXT NULL,
  `specialNote`    TEXT NULL,
  `bankName`       VARCHAR(191) NULL,
  `bankAccountNo`  VARCHAR(191) NULL,
  `bankHolder`     VARCHAR(191) NULL,
  `bankBranch`     VARCHAR(191) NULL,
  `bankCode`       VARCHAR(191) NULL,
  `isActive`       BOOLEAN NOT NULL DEFAULT true,
  `source`         ENUM('STAFF','SELF_REGISTERED','MANUAL_ENTRY') NOT NULL DEFAULT 'STAFF',
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `tour_vendors_country_idx` (`country`)
) DEFAULT CHARACTER SET utf8mb4;

-- ── assignments: six new nullable columns ───────────────────────────────────
-- MySQL 8 and MariaDB 10.11 disagree on `ADD COLUMN IF NOT EXISTS`, so each is
-- added through a prepared statement that becomes `SELECT 1` when the column is
-- already present. All existing rows keep NULL — no data is rewritten.

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `guideId` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'guideId');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `guideName` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'guideName');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `guidePhone` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'guidePhone');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `tourVendorId` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'tourVendorId');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `tourVendorName` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'tourVendorName');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1', 'ALTER TABLE `assignments` ADD COLUMN `tourVendorPhone` VARCHAR(191) NULL')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'tourVendorPhone');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Foreign keys ────────────────────────────────────────────────────────────
-- Named to match what Prisma generates for these relations, so a later `db push`
-- against a dev database sees no drift. Adding the constraint also creates the
-- lookup index of the same name. Validation is instant: every value is NULL.
--
-- ON DELETE RESTRICT matches the existing driver / vehicle-vendor relations on
-- this table. A guide still linked to a movement therefore cannot be deleted at
-- the DB level — the app clears `guideId` on those rows first and keeps the
-- typed name and phone, so past movements still read correctly.

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1',
  'ALTER TABLE `assignments` ADD CONSTRAINT `assignments_guideId_fkey` FOREIGN KEY (`guideId`) REFERENCES `guides`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND CONSTRAINT_NAME = 'assignments_guideId_fkey');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(COUNT(*) > 0, 'SELECT 1',
  'ALTER TABLE `assignments` ADD CONSTRAINT `assignments_tourVendorId_fkey` FOREIGN KEY (`tourVendorId`) REFERENCES `tour_vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND CONSTRAINT_NAME = 'assignments_tourVendorId_fkey');
PREPARE stmt FROM @s;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Settings seed ───────────────────────────────────────────────────────────
-- Countries that require a guide / tour vendor. Empty list = feature off
-- everywhere, which is the safe default: nothing changes in the movement chart
-- until an admin switches a country on under Settings → Guides & Tour Vendors.
-- `ON DUPLICATE KEY UPDATE key = key` deliberately does nothing, so re-running
-- this file can never overwrite a choice already made.
INSERT INTO `system_settings` (`key`, `value`, `updatedAt`)
VALUES ('guide_countries', '[]', NOW(3)), ('tour_vendor_countries', '[]', NOW(3))
ON DUPLICATE KEY UPDATE `key` = `key`;
