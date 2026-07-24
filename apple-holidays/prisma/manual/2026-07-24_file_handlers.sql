-- File Handler feature — additive migration (two brand-new tables only).
-- Safe to run on the live DB: it creates new tables and does NOT touch any
-- existing table or row. Matches the FileHandler / FileHandlerLog models in
-- prisma/schema.prisma. Run once, e.g.:
--   npx prisma db execute --file prisma/manual/2026-07-24_file_handlers.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `file_handlers` (
  `id`            VARCHAR(191) NOT NULL,
  `name`          VARCHAR(191) NOT NULL,
  `email`         VARCHAR(191) NOT NULL,
  `phone`         VARCHAR(191) NULL,
  `whatsappPhone` VARCHAR(191) NULL,
  `password`      TEXT NOT NULL,
  `country`       ENUM('ALL','VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA') NOT NULL DEFAULT 'ALL',
  `isRegistered`  TINYINT(1) NOT NULL DEFAULT 1,
  `isActive`      TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `approvedAt`    DATETIME(3) NULL,
  `approvedBy`    VARCHAR(191) NULL,
  `lastLoginAt`   DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `file_handlers_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `file_handler_logs` (
  `id`               VARCHAR(191) NOT NULL,
  `fileHandlerId`    VARCHAR(191) NULL,
  `fileHandlerName`  VARCHAR(191) NOT NULL,
  `action`           VARCHAR(191) NOT NULL,
  `bookingId`        VARCHAR(191) NULL,
  `bookingRef`       VARCHAR(191) NULL,
  `isNumber`         VARCHAR(191) NULL,
  `cntlNumber`       VARCHAR(191) NULL,
  `operationCountry` ENUM('ALL','VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA') NULL,
  `details`          TEXT NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `file_handler_logs_fileHandlerId_idx` (`fileHandlerId`),
  INDEX `file_handler_logs_action_idx` (`action`),
  INDEX `file_handler_logs_bookingRef_idx` (`bookingRef`),
  INDEX `file_handler_logs_createdAt_idx` (`createdAt`),
  CONSTRAINT `file_handler_logs_fileHandlerId_fkey`
    FOREIGN KEY (`fileHandlerId`) REFERENCES `file_handlers` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
