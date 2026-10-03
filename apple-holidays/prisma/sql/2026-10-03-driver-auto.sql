-- Driver-Auto (Allocating) — drivers and vehicle vendors pick up open trips
-- from a personal, tokenised trip board instead of waiting to be phoned.
--
-- Two tables:
--
--   driver_trip_claims   One row per request a driver/vendor makes for an open
--                        trip. A Sri Lanka trip is the whole booking (round
--                        trip); every other country is one movement. The row
--                        carries a snapshot of what the driver saw, because a
--                        movement chart save recreates agenda item ids.
--
--                        `lockKey` is the race guard: it is set to the trip key
--                        ('B:<bookingId>' / 'M:<agendaItemId>') only on the
--                        claim that WON the trip, and the UNIQUE index means two
--                        drivers pressing "Take" in the same second cannot both
--                        win. MySQL/MariaDB allow any number of NULLs under a
--                        UNIQUE index, so pending / rejected rows never collide.
--
--   driver_board_sends   One row per daily "open trips" message (WhatsApp or
--                        email) to one driver/vendor. The (partyKey, sendDate,
--                        channel) UNIQUE index is the once-a-day guard, so the
--                        in-process scheduler and the cron route can both run.
--
-- SAFETY
--   * Additive only. Two brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * No foreign keys — keyed by ids/refs on purpose (live schema carries
--     drift, and booking/agenda rows are recreated on amendment).
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No DELIMITER / procedures (`prisma db execute` splits on `;`).
--
--   bash prisma/sql/apply-driver-auto.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-driver-auto.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `driver_trip_claims` (
  `id`             VARCHAR(191)  NOT NULL,

  -- 'BOOKING' (Sri Lanka round trip) | 'MOVEMENT' (one agenda item)
  `kind`           VARCHAR(16)   NOT NULL,
  -- 'B:<bookingId>' | 'M:<agendaItemId>'
  `tripKey`        VARCHAR(191)  NOT NULL,
  `bookingId`      VARCHAR(191)  NOT NULL,
  `bookingRef`     VARCHAR(191)  NOT NULL,
  `agendaItemId`   VARCHAR(191)  NULL,
  `country`        VARCHAR(32)   NOT NULL,
  `tripDate`       DATETIME(3)   NOT NULL,
  `tripEndDate`    DATETIME(3)   NULL,
  `snapshot`       JSON          NULL,

  -- 'DRIVER' | 'VENDOR'
  `partyType`      VARCHAR(16)   NOT NULL,
  `partyId`        VARCHAR(191)  NOT NULL,
  `partyName`      VARCHAR(191)  NULL,
  `partyPhone`     VARCHAR(64)   NULL,

  -- 'PENDING' | 'APPROVED' | 'AUTO_ASSIGNED' | 'REJECTED' | 'WITHDRAWN'
  -- | 'SUPERSEDED' | 'STALE' | 'RELEASED'
  `status`         VARCHAR(24)   NOT NULL DEFAULT 'PENDING',
  `lockKey`        VARCHAR(191)  NULL,
  `driverNote`     TEXT          NULL,
  `decisionNote`   TEXT          NULL,
  `decidedById`    VARCHAR(191)  NULL,
  `decidedByName`  VARCHAR(191)  NULL,
  `decidedAt`      DATETIME(3)   NULL,
  `assignedAt`     DATETIME(3)   NULL,
  `notifyResult`   TEXT          NULL,

  `createdAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `driver_trip_claims_lockKey_key` (`lockKey`),
  KEY `driver_trip_claims_tripKey_idx` (`tripKey`),
  KEY `driver_trip_claims_party_idx` (`partyType`, `partyId`),
  KEY `driver_trip_claims_status_idx` (`status`),
  KEY `driver_trip_claims_country_date_idx` (`country`, `tripDate`),
  KEY `driver_trip_claims_bookingRef_idx` (`bookingRef`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `driver_board_sends` (
  `id`             VARCHAR(191)  NOT NULL,
  -- 'd-<driverId>' | 'v-<vendorId>'
  `partyKey`       VARCHAR(191)  NOT NULL,
  `partyName`      VARCHAR(191)  NULL,
  `country`        VARCHAR(32)   NOT NULL,
  -- Local calendar day of the send in the country's timezone, 'YYYY-MM-DD'.
  `sendDate`       VARCHAR(10)   NOT NULL,
  -- 'whatsapp' | 'email'
  `channel`        VARCHAR(16)   NOT NULL,
  `recipient`      VARCHAR(191)  NULL,
  `tripCount`      INT           NOT NULL DEFAULT 0,
  -- 'sent' | 'failed' | 'skipped'
  `status`         VARCHAR(16)   NOT NULL,
  `waMessageId`    VARCHAR(191)  NULL,
  `error`          TEXT          NULL,
  -- 'schedule' | 'manual'
  `trigger`        VARCHAR(16)   NOT NULL DEFAULT 'schedule',
  `sentByName`     VARCHAR(191)  NULL,
  `createdAt`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `driver_board_sends_once_key` (`partyKey`, `sendDate`, `channel`),
  KEY `driver_board_sends_country_date_idx` (`country`, `sendDate`),
  KEY `driver_board_sends_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
