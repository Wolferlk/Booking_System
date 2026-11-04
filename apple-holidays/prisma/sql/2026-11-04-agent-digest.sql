-- Agent Daily Digest — a daily WhatsApp / email to an agent (e.g. 30 Sundays)
-- listing their on-ground trips with the allocated driver, vehicle, driver
-- vendor, guide and tour vendor of every agenda line.
--
--   agent_digest_rules  — one digest design (who, which agent, which countries,
--                         which dates, which fields, when to send).
--   agent_digest_runs   — a frozen snapshot of what one digest contained. The
--                         WhatsApp link (/digest/<id>?t=<token>) shows this
--                         snapshot, never live data.
--   agent_digest_sends  — one row per recipient per channel. `dedupeKey` is
--                         UNIQUE, so the scheduler, the cron route and a staff
--                         "Send now" can never message the same person twice
--                         for the same rule and day.
--
-- SAFETY
--   * Additive only. Three brand-new tables. No ALTER, DROP, TRUNCATE, DELETE
--     or UPDATE of any existing table or row anywhere in this file.
--   * No foreign keys (live schema carries drift).
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-agent-digest.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-agent-digest.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `agent_digest_rules` (
  `id`            VARCHAR(191)  NOT NULL,
  `name`          VARCHAR(191)  NOT NULL,
  `isActive`      TINYINT(1)    NOT NULL DEFAULT 1,
  -- Sends automatically every day at `sendTime` in `timezone`. Default OFF.
  `autoSend`      TINYINT(1)    NOT NULL DEFAULT 0,
  `sendTime`      VARCHAR(5)    NOT NULL DEFAULT '07:00',
  `timezone`      VARCHAR(64)   NOT NULL DEFAULT 'Asia/Colombo',
  -- JSON: the full design (agents, countries, blocks, fields, recipients, text).
  `config`        JSON          NOT NULL,
  `archivedAt`    DATETIME(3)   NULL,
  `createdByName` VARCHAR(191)  NULL,
  `updatedByName` VARCHAR(191)  NULL,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `agent_digest_rules_active_idx` (`isActive`, `autoSend`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_digest_runs` (
  `id`            VARCHAR(191)  NOT NULL,
  `token`         VARCHAR(64)   NOT NULL,
  `ruleId`        VARCHAR(191)  NULL,
  `ruleName`      VARCHAR(191)  NOT NULL,
  -- The local calendar day the digest is FOR, 'YYYY-MM-DD'.
  `runDate`       VARCHAR(10)   NOT NULL,
  -- 'schedule' | 'manual' | 'test'
  `trigger`       VARCHAR(16)   NOT NULL,
  `bookingCount`  INT           NOT NULL DEFAULT 0,
  `itemCount`     INT           NOT NULL DEFAULT 0,
  `payload`       JSON          NOT NULL,
  `createdByName` VARCHAR(191)  NULL,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `agent_digest_runs_rule_date_idx` (`ruleId`, `runDate`),
  KEY `agent_digest_runs_date_idx` (`runDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_digest_sends` (
  `id`            VARCHAR(191)  NOT NULL,
  `dedupeKey`     VARCHAR(191)  NOT NULL,
  `runId`         VARCHAR(191)  NULL,
  `ruleId`        VARCHAR(191)  NULL,
  `ruleName`      VARCHAR(191)  NOT NULL,
  `runDate`       VARCHAR(10)   NOT NULL,
  -- 'whatsapp' | 'email'
  `channel`       VARCHAR(16)   NOT NULL,
  `recipient`     VARCHAR(191)  NOT NULL,
  `recipientName` VARCHAR(191)  NULL,
  -- 'sent' | 'failed' | 'skipped'
  `status`        VARCHAR(16)   NOT NULL,
  -- WhatsApp: 'text' (inside 24h window) | 'template' (link) ; email: 'html'
  `mode`          VARCHAR(16)   NULL,
  `subject`       VARCHAR(255)  NULL,
  `body`          MEDIUMTEXT    NULL,
  `waMessageId`   VARCHAR(191)  NULL,
  `error`         TEXT          NULL,
  `trigger`       VARCHAR(16)   NOT NULL,
  `sentByName`    VARCHAR(191)  NULL,
  `bookingCount`  INT           NOT NULL DEFAULT 0,
  `itemCount`     INT           NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `agent_digest_sends_dedupeKey_key` (`dedupeKey`),
  KEY `agent_digest_sends_date_idx` (`runDate`),
  KEY `agent_digest_sends_rule_idx` (`ruleId`, `runDate`),
  KEY `agent_digest_sends_created_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
