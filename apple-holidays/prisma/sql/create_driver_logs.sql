-- Additive-only: create the driver_logs table (Sri Lanka Driver Advance Sheet).
-- Safe to run against the live DB — it creates one new table and one FK, and
-- touches no existing table or data. Idempotent via IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `driver_logs` (
    `bookingRef` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `tourPct` DOUBLE NOT NULL DEFAULT 0,
    `fuelPct` DOUBLE NOT NULL DEFAULT 0,
    `driverPhone` VARCHAR(191) NULL,
    `lines` JSON NOT NULL,
    `notes` TEXT NOT NULL,
    `autoSend` BOOLEAN NOT NULL DEFAULT false,
    `waSentAt` DATETIME(3) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`bookingRef`),
    CONSTRAINT `driver_logs_bookingRef_fkey` FOREIGN KEY (`bookingRef`) REFERENCES `bookings`(`bookingRef`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
