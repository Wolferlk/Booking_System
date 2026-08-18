-- Experience Report Centre — the end-of-trip agent report, its history and its
-- bad-experience hold queue.
--
-- Additive only. This creates ONE new table and touches nothing that exists:
-- no ALTER, no DROP, no foreign key onto `bookings` (the booking is referenced
-- by its `bookingRef` string, exactly as the tbl_te_* tables already do).
-- Safe to run more than once.
--
-- Run with:
--   npx prisma db execute --file prisma/sql/2026-08-18-te-experience-reports.sql --schema prisma/schema.prisma
--
-- No COLLATE is specified anywhere on purpose: the table inherits the schema
-- default, so it matches its neighbours on both the MySQL and MariaDB copies.

CREATE TABLE IF NOT EXISTS `te_experience_reports` (
  `id`             VARCHAR(36)  NOT NULL,
  `bookingRef`     VARCHAR(64)  NOT NULL,

  -- draft → (held | queued) → sent | failed | cancelled
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'draft',
  `triggerSource`  VARCHAR(16)  NOT NULL DEFAULT 'manual',

  -- Bad-experience gate. `riskSignals` is the JSON array of what tripped it.
  `riskLevel`      VARCHAR(16)  NOT NULL DEFAULT 'none',
  `riskScore`      INT          NOT NULL DEFAULT 0,
  `riskSignals`    JSON         NULL,
  `holdReason`     TEXT         NULL,

  -- Denormalised trip facts, so the history list renders without re-reading
  -- the booking (and still reads right after the booking is amended).
  `clientName`     VARCHAR(255) NULL,
  `agentName`      VARCHAR(255) NULL,
  `arrivalDate`    DATE         NULL,
  `departureDate`  DATE         NULL,

  -- `dossier` is the full evidence snapshot (itinerary, per-call feedback,
  -- transcripts, guest form). Transcripts live here and ONLY here — they are
  -- deliberately kept out of `bodyHtml`, and are read back by the UI viewer.
  `sources`        JSON         NULL,
  `dossier`        JSON         NULL,
  `narrative`      JSON         NULL,

  -- Exactly what was (or would be) mailed to the agent.
  `subject`        VARCHAR(512) NULL,
  `bodyHtml`       MEDIUMTEXT   NULL,
  `toEmail`        VARCHAR(255) NULL,
  `ccEmails`       TEXT         NULL,
  `sentAt`         DATETIME(3)  NULL,
  `sentBy`         VARCHAR(255) NULL,

  -- The hold escalation that goes to Pradeep instead of the agent.
  `escalationTo`   VARCHAR(255) NULL,
  `escalationHtml` MEDIUMTEXT   NULL,
  `escalatedAt`    DATETIME(3)  NULL,

  `releasedAt`     DATETIME(3)  NULL,
  `releasedBy`     VARCHAR(255) NULL,
  `resolutionNote` TEXT         NULL,
  `lastError`      TEXT         NULL,

  -- Append-only audit trail: [{ at, actor, action, detail }]
  `events`         JSON         NULL,

  `createdBy`      VARCHAR(255) NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `te_exp_reports_booking_idx` (`bookingRef`),
  KEY `te_exp_reports_status_idx` (`status`, `createdAt`),
  KEY `te_exp_reports_sent_idx` (`sentAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
