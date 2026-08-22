-- Reservation Team — step 1 of 2: create the eight new tables.
--
-- SAFETY
-- ------
-- Every statement in this file is CREATE TABLE IF NOT EXISTS. Nothing here
-- alters, drops, truncates or writes to an existing table, and no new table
-- carries a foreign key into an existing one — `bookingRef`, `hotelProfileId`,
-- `accommodationId` and `budgetLineId` are deliberately soft pointers, resolved
-- in application code. Running this file cannot lose or change a single row of
-- live data, and it is safe to run more than once.
--
-- The foreign keys among the *new* tables are declared inline rather than as
-- follow-up ALTER statements, so a second run is a no-op instead of a
-- "duplicate key name" error.
--
-- BEFORE APPLYING
-- ---------------
-- Run the pre-flight check first — it is read-only and tells you which of these
-- tables already exist and whether utf8mb4_unicode_ci matches the collation the
-- rest of this database uses:
--
--   npx tsx scripts/rs-preflight.mts
--
-- APPLY WITH (never `prisma db push` — the live DB carries unrelated drift a
-- push would also try to apply):
--
--   DATABASE_URL="mysql://USER:PASS@HOST:3306/apple_booking_system" \
--     npx prisma db execute --file scripts/sql/reservation-team-01-tables.sql \
--                           --schema prisma/schema.prisma
--   npx prisma generate
--
-- Then verify:
--   npx tsx scripts/rs-verify.mts
--
-- Rollback: scripts/sql/reservation-team-99-rollback.sql (drops only these
-- eight tables; safe only while they are still empty).

CREATE TABLE IF NOT EXISTS `hotel_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `reservationKey` VARCHAR(190) NOT NULL,
    `bookingRef` VARCHAR(64) NOT NULL,
    `accommodationId` VARCHAR(191) NULL,
    `hotelProfileId` VARCHAR(191) NULL,
    `hotelName` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NULL,
    `operationCountry` ENUM('ALL', 'VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA') NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `nights` INTEGER NOT NULL DEFAULT 0,
    `roomType` VARCHAR(191) NULL,
    `roomCategory` VARCHAR(191) NULL,
    `roomCount` INTEGER NOT NULL DEFAULT 1,
    `mealPlan` ENUM('RO', 'BB', 'HB', 'FB', 'AI') NOT NULL DEFAULT 'BB',
    `adults` INTEGER NOT NULL DEFAULT 0,
    `children` INTEGER NOT NULL DEFAULT 0,
    `cwb` INTEGER NOT NULL DEFAULT 0,
    `cnb` INTEGER NOT NULL DEFAULT 0,
    `infants` INTEGER NOT NULL DEFAULT 0,
    `leadGuestName` VARCHAR(191) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `fxRate` DECIMAL(18, 8) NULL,
    `fxRateAt` DATETIME(3) NULL,
    `nettRate` DECIMAL(12, 2) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `baseTotalCost` DECIMAL(12, 2) NULL,
    `taxesIncluded` BOOLEAN NOT NULL DEFAULT true,
    `budgetLineId` VARCHAR(191) NULL,
    `budgetAmount` DECIMAL(12, 2) NULL,
    `status` ENUM('REQUESTED', 'QUOTING', 'OPTION_HELD', 'PENDING_HOTEL', 'CONFIRMED', 'AMEND_REQUESTED', 'AMENDED', 'CANCEL_REQUESTED', 'CANCELLED', 'NO_SHOW', 'WAITLISTED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `confirmationNumber` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmedBy` VARCHAR(191) NULL,
    `gateSnapshot` JSON NULL,
    `optionHeldUntil` DATETIME(3) NULL,
    `optionReleasedAt` DATETIME(3) NULL,
    `freeCancelUntil` DATETIME(3) NULL,
    `penaltyTiers` JSON NULL,
    `policyText` TEXT NULL,
    `contractId` VARCHAR(191) NULL,
    `paymentDueAt` DATETIME(3) NULL,
    `proformaDueAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `lastChannel` VARCHAR(16) NULL,
    `lastContactedAt` DATETIME(3) NULL,
    `firstResponseAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `assignedToEmail` VARCHAR(191) NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `penaltyAmount` DECIMAL(12, 2) NULL,
    `cancelReason` TEXT NULL,
    `supersedesId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hotel_reservations_reservationKey_key`(`reservationKey`),
    INDEX `hotel_reservations_bookingRef_idx`(`bookingRef`),
    INDEX `hotel_reservations_status_idx`(`status`),
    INDEX `hotel_reservations_checkIn_idx`(`checkIn`),
    INDEX `hotel_reservations_hotelProfileId_idx`(`hotelProfileId`),
    INDEX `hotel_reservations_optionHeldUntil_idx`(`optionHeldUntil`),
    INDEX `hotel_reservations_paymentDueAt_idx`(`paymentDueAt`),
    INDEX `hotel_reservations_assignedToEmail_idx`(`assignedToEmail`),
    INDEX `hotel_reservations_operationCountry_idx`(`operationCountry`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_options` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,
    `hotelProfileId` VARCHAR(191) NULL,
    `hotelName` VARCHAR(191) NOT NULL,
    `starRating` INTEGER NULL,
    `roomType` VARCHAR(191) NULL,
    `mealPlan` ENUM('RO', 'BB', 'HB', 'FB', 'AI') NOT NULL DEFAULT 'BB',
    `roomCount` INTEGER NOT NULL DEFAULT 1,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `fxRate` DECIMAL(18, 8) NULL,
    `nettRate` DECIMAL(12, 2) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `baseTotalCost` DECIMAL(12, 2) NULL,
    `availability` ENUM('AVAILABLE', 'ON_REQUEST', 'FULL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `cancelPolicy` TEXT NULL,
    `freeCancelUntil` DATETIME(3) NULL,
    `distanceNote` VARCHAR(191) NULL,
    `pros` TEXT NULL,
    `cons` TEXT NULL,
    `quotedAt` DATETIME(3) NULL,
    `quoteValidUntil` DATETIME(3) NULL,
    `quoteDocUrl` TEXT NULL,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `selectedReason` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reservation_options_reservationId_idx`(`reservationId`),
    INDEX `reservation_options_hotelProfileId_idx`(`hotelProfileId`),
    CONSTRAINT `reservation_options_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `hotel_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_special_requests` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EARLY_CHECK_IN', 'LATE_CHECK_OUT', 'EXTRA_BED', 'HONEYMOON', 'ANNIVERSARY', 'BIRTHDAY', 'CONNECTING_ROOMS', 'ADJOINING_ROOMS', 'HIGH_FLOOR', 'SEA_VIEW', 'QUIET_ROOM', 'ACCESSIBLE_ROOM', 'DIETARY', 'AIRPORT_TRANSFER', 'BABY_COT', 'FLOWERS_CAKE', 'OTHER') NOT NULL,
    `detail` TEXT NULL,
    `chargeable` BOOLEAN NOT NULL DEFAULT false,
    `cost` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(3) NULL,
    `status` ENUM('REQUESTED', 'ACKNOWLEDGED', 'CONFIRMED', 'DECLINED', 'NOT_APPLICABLE') NOT NULL DEFAULT 'REQUESTED',
    `hotelResponse` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reservation_special_requests_reservationId_idx`(`reservationId`),
    INDEX `reservation_special_requests_status_idx`(`status`),
    CONSTRAINT `reservation_special_requests_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `hotel_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_events` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(48) NOT NULL,
    `fromStatus` VARCHAR(32) NULL,
    `toStatus` VARCHAR(32) NULL,
    `channel` VARCHAR(16) NULL,
    `note` TEXT NULL,
    `payload` JSON NULL,
    `actorName` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reservation_events_reservationId_idx`(`reservationId`),
    INDEX `reservation_events_createdAt_idx`(`createdAt`),
    INDEX `reservation_events_action_idx`(`action`),
    CONSTRAINT `reservation_events_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `hotel_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_contracts` (
    `id` VARCHAR(191) NOT NULL,
    `hotelProfileId` VARCHAR(191) NOT NULL,
    `contractCode` VARCHAR(191) NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validTo` DATETIME(3) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `policyText` TEXT NULL,
    `penaltyTiers` JSON NULL,
    `freeCancelDays` INTEGER NULL,
    `childPolicy` TEXT NULL,
    `paymentTerms` TEXT NULL,
    `paymentDueDays` INTEGER NULL,
    `commissionPct` DECIMAL(5, 2) NULL,
    `contractDocUrl` TEXT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'EXPIRED', 'SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hotel_contracts_hotelProfileId_idx`(`hotelProfileId`),
    INDEX `hotel_contracts_validFrom_validTo_idx`(`validFrom`, `validTo`),
    INDEX `hotel_contracts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hotel_contract_rates` (
    `id` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NOT NULL,
    `seasonName` VARCHAR(191) NULL,
    `seasonFrom` DATETIME(3) NULL,
    `seasonTo` DATETIME(3) NULL,
    `roomType` VARCHAR(191) NOT NULL,
    `mealPlan` ENUM('RO', 'BB', 'HB', 'FB', 'AI') NOT NULL DEFAULT 'BB',
    `singleRate` DECIMAL(12, 2) NULL,
    `doubleRate` DECIMAL(12, 2) NULL,
    `tripleRate` DECIMAL(12, 2) NULL,
    `extraBedRate` DECIMAL(12, 2) NULL,
    `cwbRate` DECIMAL(12, 2) NULL,
    `cnbRate` DECIMAL(12, 2) NULL,
    `minNights` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hotel_contract_rates_contractId_idx`(`contractId`),
    CONSTRAINT `hotel_contract_rates_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `hotel_contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proforma_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NULL,
    `bookingRef` VARCHAR(64) NULL,
    `hotelProfileId` VARCHAR(191) NULL,
    `hotelName` VARCHAR(191) NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `invoiceDate` DATETIME(3) NULL,
    `dueDate` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `fxRate` DECIMAL(18, 8) NULL,
    `amount` DECIMAL(12, 2) NULL,
    `taxAmount` DECIMAL(12, 2) NULL,
    `totalAmount` DECIMAL(12, 2) NULL,
    `baseTotalAmount` DECIMAL(12, 2) NULL,
    `fileUrl` TEXT NULL,
    `fileName` VARCHAR(191) NULL,
    `aiExtract` JSON NULL,
    `aiExtractedAt` DATETIME(3) NULL,
    `status` ENUM('RECEIVED', 'UNDER_REVIEW', 'DISCREPANCY', 'VERIFIED', 'FORWARDED', 'PAID', 'REJECTED', 'VOID') NOT NULL DEFAULT 'RECEIVED',
    `matchResult` JSON NULL,
    `variance` DECIMAL(12, 2) NULL,
    `variancePct` DECIMAL(8, 4) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedBy` VARCHAR(191) NULL,
    `forwardedAt` DATETIME(3) NULL,
    `forwardedTo` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `rejectReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `proforma_invoices_reservationId_idx`(`reservationId`),
    INDEX `proforma_invoices_bookingRef_idx`(`bookingRef`),
    INDEX `proforma_invoices_status_idx`(`status`),
    INDEX `proforma_invoices_dueDate_idx`(`dueDate`),
    INDEX `proforma_invoices_hotelProfileId_idx`(`hotelProfileId`),
    CONSTRAINT `proforma_invoices_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `hotel_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `credit_notes` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NULL,
    `bookingRef` VARCHAR(64) NULL,
    `hotelProfileId` VARCHAR(191) NULL,
    `hotelName` VARCHAR(191) NOT NULL,
    `reason` ENUM('CANCELLATION', 'AMENDMENT', 'OVERCHARGE', 'NO_SHOW_WAIVER', 'SERVICE_FAILURE', 'DUPLICATE_PAYMENT', 'OTHER') NOT NULL DEFAULT 'CANCELLATION',
    `reasonNote` TEXT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `fxRate` DECIMAL(18, 8) NULL,
    `expectedAmount` DECIMAL(12, 2) NULL,
    `receivedAmount` DECIMAL(12, 2) NULL,
    `baseExpectedAmount` DECIMAL(12, 2) NULL,
    `creditNoteNo` VARCHAR(191) NULL,
    `raisedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedBy` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `appliedToInvoiceId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'REQUESTED', 'PROMISED', 'RECEIVED', 'APPLIED', 'WRITTEN_OFF', 'DISPUTED') NOT NULL DEFAULT 'PENDING',
    `lastChasedAt` DATETIME(3) NULL,
    `chaseCount` INTEGER NOT NULL DEFAULT 0,
    `fileUrl` TEXT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `credit_notes_reservationId_idx`(`reservationId`),
    INDEX `credit_notes_bookingRef_idx`(`bookingRef`),
    INDEX `credit_notes_status_idx`(`status`),
    INDEX `credit_notes_expectedBy_idx`(`expectedBy`),
    INDEX `credit_notes_hotelProfileId_idx`(`hotelProfileId`),
    CONSTRAINT `credit_notes_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `hotel_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
