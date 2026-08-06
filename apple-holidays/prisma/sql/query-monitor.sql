-- Booking Team Query Monitor — table creation.
--
-- Additive only: five brand-new tables, no ALTER / DROP on anything existing.
-- Apply with (never `prisma db push` against live — it would try to "fix" the
-- pre-existing schema drift):
--
--   npx prisma db execute --file prisma/sql/query-monitor.sql --schema prisma/schema.prisma
--
-- Every statement is IF NOT EXISTS, so re-running it is a no-op.

CREATE TABLE IF NOT EXISTS `query_monitor_mailboxes` (
  `id`            VARCHAR(191) NOT NULL,
  `email`         VARCHAR(191) NOT NULL,
  `displayName`   VARCHAR(191) NOT NULL,
  `isActive`      TINYINT(1)   NOT NULL DEFAULT 1,
  `sortOrder`     INT          NOT NULL DEFAULT 0,
  `lastCheckedAt` DATETIME(3)  NULL,
  `lastMessageAt` DATETIME(3)  NULL,
  `lastError`     TEXT         NULL,
  `totalSeen`     INT          NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `query_monitor_mailboxes_email_key` (`email`)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `query_monitor_sender_rules` (
  `id`            VARCHAR(191) NOT NULL,
  `matchType`     VARCHAR(191) NOT NULL DEFAULT 'DOMAIN',
  `pattern`       VARCHAR(191) NOT NULL,
  `salesPerson`   VARCHAR(191) NOT NULL,
  `agent`         VARCHAR(191) NOT NULL,
  `region`        VARCHAR(191) NULL,
  `destination`   VARCHAR(191) NULL,
  `isActive`      TINYINT(1)   NOT NULL DEFAULT 1,
  `priority`      INT          NOT NULL DEFAULT 0,
  `matchCount`    INT          NOT NULL DEFAULT 0,
  `lastMatchedAt` DATETIME(3)  NULL,
  `notes`         TEXT         NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `query_monitor_sender_rules_pattern_key` (`pattern`),
  INDEX `query_monitor_sender_rules_matchType_isActive_idx` (`matchType`, `isActive`)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `query_monitor_entries` (
  `id`               VARCHAR(191) NOT NULL,
  `dedupKey`         VARCHAR(191) NOT NULL,
  `conversationId`   VARCHAR(191) NULL,
  `subject`          TEXT         NOT NULL,
  `fromAddress`      VARCHAR(191) NOT NULL,
  `fromName`         VARCHAR(191) NOT NULL,
  `fromDomain`       VARCHAR(191) NOT NULL,
  `receivedAt`       DATETIME(3)  NOT NULL,
  `repliedAt`        DATETIME(3)  NULL,
  `replyStatus`      VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `handlerNames`     TEXT         NOT NULL,
  `salesPerson`      VARCHAR(191) NULL,
  `agent`            VARCHAR(191) NULL,
  `destination`      VARCHAR(191) NULL,
  `travelDate`       DATETIME(3)  NULL,
  `travelDateText`   VARCHAR(191) NULL,
  `cntl`             VARCHAR(191) NULL,
  `amendment`        VARCHAR(191) NULL,
  `region`           VARCHAR(191) NULL,
  `isUrgent`         TINYINT(1)   NOT NULL DEFAULT 0,
  `bodySnippet`      TEXT         NOT NULL,
  `extractionSource` VARCHAR(191) NOT NULL DEFAULT 'RULE',
  `aiConfidence`     DOUBLE       NULL,
  `manualOverrides`  JSON         NULL,
  `sheetRow`         INT          NULL,
  `syncStatus`       VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `syncError`        TEXT         NULL,
  `syncedAt`         DATETIME(3)  NULL,
  `firstRunId`       VARCHAR(191) NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `query_monitor_entries_dedupKey_key` (`dedupKey`),
  INDEX `query_monitor_entries_receivedAt_idx` (`receivedAt`),
  INDEX `query_monitor_entries_syncStatus_idx` (`syncStatus`),
  INDEX `query_monitor_entries_replyStatus_idx` (`replyStatus`),
  INDEX `query_monitor_entries_conversationId_idx` (`conversationId`),
  INDEX `query_monitor_entries_fromDomain_idx` (`fromDomain`)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `query_monitor_matches` (
  `id`          VARCHAR(191) NOT NULL,
  `entryId`     VARCHAR(191) NOT NULL,
  `mailboxId`   VARCHAR(191) NOT NULL,
  `graphId`     VARCHAR(191) NOT NULL,
  `handlerName` VARCHAR(191) NOT NULL,
  `receivedAt`  DATETIME(3)  NOT NULL,
  `repliedAt`   DATETIME(3)  NULL,
  `folder`      VARCHAR(191) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `query_monitor_matches_entryId_mailboxId_key` (`entryId`, `mailboxId`),
  INDEX `query_monitor_matches_graphId_idx` (`graphId`),
  INDEX `query_monitor_matches_mailboxId_idx` (`mailboxId`),
  CONSTRAINT `query_monitor_matches_entryId_fkey`
    FOREIGN KEY (`entryId`) REFERENCES `query_monitor_entries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `query_monitor_matches_mailboxId_fkey`
    FOREIGN KEY (`mailboxId`) REFERENCES `query_monitor_mailboxes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `query_monitor_runs` (
  `id`               VARCHAR(191) NOT NULL,
  `trigger`          VARCHAR(191) NOT NULL DEFAULT 'CRON',
  `status`           VARCHAR(191) NOT NULL DEFAULT 'RUNNING',
  `startedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt`       DATETIME(3)  NULL,
  `durationMs`       INT          NULL,
  `windowFrom`       DATETIME(3)  NULL,
  `windowTo`         DATETIME(3)  NULL,
  `mailboxesScanned` INT          NOT NULL DEFAULT 0,
  `messagesSeen`     INT          NOT NULL DEFAULT 0,
  `entriesCreated`   INT          NOT NULL DEFAULT 0,
  `entriesUpdated`   INT          NOT NULL DEFAULT 0,
  `repliesDetected`  INT          NOT NULL DEFAULT 0,
  `rowsAppended`     INT          NOT NULL DEFAULT 0,
  `rowsUpdated`      INT          NOT NULL DEFAULT 0,
  `aiCalls`          INT          NOT NULL DEFAULT 0,
  `errors`           INT          NOT NULL DEFAULT 0,
  `errorMessage`     TEXT         NULL,
  `triggeredBy`      VARCHAR(191) NULL,
  `steps`            LONGTEXT     NULL,
  PRIMARY KEY (`id`),
  INDEX `query_monitor_runs_startedAt_idx` (`startedAt`),
  INDEX `query_monitor_runs_status_idx` (`status`)
) ENGINE = InnoDB;
