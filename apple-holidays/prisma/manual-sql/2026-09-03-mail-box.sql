-- Mail Box — templated, tracked, threaded outbound mail for a booking.
--
-- Run with:
--   npx prisma db execute --file prisma/manual-sql/2026-09-03-mail-box.sql --schema prisma/schema.prisma
--
-- STRICTLY ADDITIVE. Five brand-new tables; not one existing table is altered,
-- and no existing row is read or written. `CREATE TABLE IF NOT EXISTS` means a
-- second run is a no-op rather than an error, so this is safe to re-apply.
--
-- Foreign keys point only at the new tables (threads → agents/templates,
-- messages → threads). There is deliberately NO FK to `bookings`: threads are
-- keyed by `bookingRef` string, the same convention as `sl_settlement_docs` and
-- `driver_briefs`, so correspondence survives the child-row rewrite an
-- amendment performs.

CREATE TABLE IF NOT EXISTS `mail_templates` (
  `id`          VARCHAR(191) NOT NULL,
  `code`        VARCHAR(120) NOT NULL,
  `name`        VARCHAR(190) NOT NULL,
  `description` TEXT         NULL,
  `category`    VARCHAR(60)  NOT NULL DEFAULT 'General',
  `audience`    VARCHAR(30)  NOT NULL DEFAULT 'AGENT',
  `subject`     TEXT         NOT NULL,
  `bodyHtml`    LONGTEXT     NOT NULL,
  `ccEmails`    JSON         NULL,
  `attachPdf`   TINYINT(1)   NOT NULL DEFAULT 0,
  `isActive`    TINYINT(1)   NOT NULL DEFAULT 1,
  `sortOrder`   INT          NOT NULL DEFAULT 0,
  `createdBy`   VARCHAR(190) NULL,
  `updatedBy`   VARCHAR(190) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `mail_templates_code_key` (`code`),
  INDEX `mail_templates_isActive_sortOrder_idx` (`isActive`, `sortOrder`),
  INDEX `mail_templates_category_idx` (`category`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `mail_agents` (
  `id`           VARCHAR(191) NOT NULL,
  `name`         VARCHAR(190) NOT NULL,
  `company`      VARCHAR(190) NULL,
  `primaryEmail` VARCHAR(320) NOT NULL,
  `ccEmails`     JSON         NULL,
  `matchKeys`    JSON         NULL,
  `country`      VARCHAR(60)  NULL,
  `phone`        VARCHAR(60)  NULL,
  `notes`        TEXT         NULL,
  `isActive`     TINYINT(1)   NOT NULL DEFAULT 1,
  `createdBy`    VARCHAR(190) NULL,
  `updatedBy`    VARCHAR(190) NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `mail_agents_isActive_idx` (`isActive`),
  INDEX `mail_agents_primaryEmail_idx` (`primaryEmail`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `mail_internal_recipients` (
  `id`        VARCHAR(191) NOT NULL,
  `name`      VARCHAR(190) NOT NULL,
  `email`     VARCHAR(320) NOT NULL,
  `team`      VARCHAR(90)  NULL,
  `alwaysCc`  TINYINT(1)   NOT NULL DEFAULT 1,
  `isActive`  TINYINT(1)   NOT NULL DEFAULT 1,
  `notes`     TEXT         NULL,
  `createdBy` VARCHAR(190) NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `mail_internal_recipients_email_key` (`email`),
  INDEX `mail_internal_recipients_isActive_alwaysCc_idx` (`isActive`, `alwaysCc`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `mail_threads` (
  `id`                VARCHAR(191) NOT NULL,
  `bookingRef`        VARCHAR(60)  NULL,
  `agentId`           VARCHAR(191) NULL,
  `templateId`        VARCHAR(191) NULL,
  `subject`           TEXT         NOT NULL,
  `toAddresses`       TEXT         NOT NULL,
  `ccAddresses`       TEXT         NOT NULL,
  `conversationId`    VARCHAR(190) NULL,
  `internetMessageId` VARCHAR(190) NULL,
  `graphMessageId`    VARCHAR(255) NULL,
  `mailboxUser`       VARCHAR(320) NOT NULL DEFAULT '',
  `status`            VARCHAR(20)  NOT NULL DEFAULT 'SENT',
  `error`             TEXT         NULL,
  `replyCount`        INT          NOT NULL DEFAULT 0,
  `unreadReplies`     INT          NOT NULL DEFAULT 0,
  `lastMessageAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSyncedAt`      DATETIME(3)  NULL,
  `sentByName`        VARCHAR(190) NULL,
  `sentByEmail`       VARCHAR(320) NULL,
  `operationCountry`  ENUM('VIETNAM','SRILANKA','SINGAPORE_MALAYSIA','SINGAPORE','MALAYSIA') NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `mail_threads_bookingRef_idx` (`bookingRef`),
  INDEX `mail_threads_conversationId_idx` (`conversationId`),
  INDEX `mail_threads_lastMessageAt_idx` (`lastMessageAt`),
  INDEX `mail_threads_status_idx` (`status`),
  INDEX `mail_threads_agentId_idx` (`agentId`),
  INDEX `mail_threads_templateId_idx` (`templateId`),
  CONSTRAINT `mail_threads_agentId_fkey`
    FOREIGN KEY (`agentId`) REFERENCES `mail_agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `mail_threads_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `mail_templates` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `mail_thread_messages` (
  `id`                VARCHAR(191) NOT NULL,
  `threadId`          VARCHAR(191) NOT NULL,
  `direction`         VARCHAR(4)   NOT NULL,
  `graphId`           VARCHAR(255) NULL,
  `internetMessageId` VARCHAR(190) NULL,
  `fromAddress`       VARCHAR(320) NOT NULL DEFAULT '',
  `fromName`          VARCHAR(190) NOT NULL DEFAULT '',
  `toAddresses`       TEXT         NOT NULL,
  `ccAddresses`       TEXT         NOT NULL,
  `subject`           TEXT         NOT NULL,
  `bodyHtml`          LONGTEXT     NOT NULL,
  `bodyText`          LONGTEXT     NOT NULL,
  `hasAttachments`    TINYINT(1)   NOT NULL DEFAULT 0,
  `isRead`            TINYINT(1)   NOT NULL DEFAULT 0,
  `sentAt`            DATETIME(3)  NOT NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `mail_thread_messages_graphId_key` (`graphId`),
  INDEX `mail_thread_messages_threadId_sentAt_idx` (`threadId`, `sentAt`),
  INDEX `mail_thread_messages_direction_idx` (`direction`),
  CONSTRAINT `mail_thread_messages_threadId_fkey`
    FOREIGN KEY (`threadId`) REFERENCES `mail_threads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4;
