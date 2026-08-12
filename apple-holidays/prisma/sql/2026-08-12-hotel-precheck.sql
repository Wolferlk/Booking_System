-- Pre-checking / D-10 Hotel Reconfirmation
--
-- Additive-only. Creates four brand-new tables and touches no existing table,
-- column or row. There is no FK to `bookings` or `accommodations` on purpose:
-- accommodations are deleted and re-created on every booking amendment, and a
-- cascading FK would take the reconfirmation trail down with them.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
-- Run with:  mysql -h <host> -u <user> -p apple_holidays < 2026-08-12-hotel-precheck.sql

CREATE TABLE IF NOT EXISTS `hotel_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `countryCode` VARCHAR(2) NOT NULL DEFAULT 'LK',
    `city` VARCHAR(191) NULL,
    `accountsHotelId` INTEGER NULL,
    `accountsHotelName` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `website` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `whatsapp` VARCHAR(191) NULL,
    `whatsappVerified` BOOLEAN NOT NULL DEFAULT false,
    `googleMapsUrl` TEXT NULL,
    `source` ENUM('ACCOUNTS', 'MANUAL', 'AI') NOT NULL DEFAULT 'MANUAL',
    `notes` TEXT NULL,
    `aiResearch` JSON NULL,
    `aiResearchedAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedBy` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hotel_profiles_normalizedName_key`(`normalizedName`),
    INDEX `hotel_profiles_name_idx`(`name`),
    INDEX `hotel_profiles_countryCode_idx`(`countryCode`),
    INDEX `hotel_profiles_accountsHotelId_idx`(`accountsHotelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_contact_channels` (
    `id` VARCHAR(191) NOT NULL,
    `hotelId` VARCHAR(191) NOT NULL,
    `kind` ENUM('PHONE', 'MOBILE', 'WHATSAPP', 'EMAIL', 'FAX') NOT NULL DEFAULT 'PHONE',
    `label` VARCHAR(191) NULL,
    `value` VARCHAR(191) NOT NULL,
    `e164` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedBy` VARCHAR(191) NULL,
    `guessed` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hotel_contact_channels_hotelId_idx`(`hotelId`),
    INDEX `hotel_contact_channels_e164_idx`(`e164`),
    PRIMARY KEY (`id`),
    CONSTRAINT `hotel_contact_channels_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotel_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_reconfirmations` (
    `id` VARCHAR(191) NOT NULL,
    `stayKey` VARCHAR(191) NOT NULL,
    `bookingRef` VARCHAR(191) NOT NULL,
    `accommodationId` VARCHAR(191) NULL,
    `hotelProfileId` VARCHAR(191) NULL,
    `hotelName` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `nights` INTEGER NOT NULL DEFAULT 0,
    `roomType` VARCHAR(191) NULL,
    `roomCategory` VARCHAR(191) NULL,
    `roomCount` INTEGER NULL,
    `mealType` VARCHAR(191) NULL,
    `adults` INTEGER NULL,
    `children` INTEGER NULL,
    `cwb` INTEGER NULL,
    `cnb` INTEGER NULL,
    `infants` INTEGER NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'CONFIRMED', 'DISCREPANCY', 'ISSUE', 'CANCELLED', 'NOT_REQUIRED') NOT NULL DEFAULT 'PENDING',
    `confirmationNumber` VARCHAR(191) NULL,
    `lastChannel` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastCheckedBy` VARCHAR(191) NULL,
    `dueAtOverride` DATETIME(3) NULL,
    `followUpAt` DATETIME(3) NULL,
    `discrepancyNote` TEXT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hotel_reconfirmations_stayKey_key`(`stayKey`),
    INDEX `hotel_reconfirmations_bookingRef_idx`(`bookingRef`),
    INDEX `hotel_reconfirmations_checkIn_idx`(`checkIn`),
    INDEX `hotel_reconfirmations_status_idx`(`status`),
    INDEX `hotel_reconfirmations_hotelProfileId_idx`(`hotelProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_reconfirmation_events` (
    `id` VARCHAR(191) NOT NULL,
    `reconfirmId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `actorName` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hotel_reconfirmation_events_reconfirmId_idx`(`reconfirmId`),
    INDEX `hotel_reconfirmation_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `hotel_reconfirmation_events_reconfirmId_fkey` FOREIGN KEY (`reconfirmId`) REFERENCES `hotel_reconfirmations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
