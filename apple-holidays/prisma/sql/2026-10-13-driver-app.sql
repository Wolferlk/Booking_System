-- Aahaas Driver App (iOS + Android, React Native / Expo) — the tables the
-- mobile API (`/api/mobile/*`) writes to. Everything the app READS about a
-- driver, a booking, an agenda or a feedback form comes from the existing
-- tables, which this file does not touch.
--
--   mobile_driver_accounts   App login for a driver already in `drivers`
--                            (registered through /register/driver). One row
--                            per driver; password hash + token version.
--   mobile_otps              One-time codes (WhatsApp or e-mail) for first
--                            sign-in, password reset and code sign-in. Only
--                            the SHA-256 of the code is stored.
--   mobile_trip_sessions     One per (driver, booking): the round trip as the
--                            driver runs it — portal QR shown/skipped, start,
--                            feedback gate, completion, total km.
--   mobile_trip_days         One per (session, day): start/end swipe, GPS
--                            distance for that day, last known position.
--   mobile_location_points   GPS breadcrumbs for a day (BIGINT auto id).
--   mobile_vehicle_checks    The 2-monthly vehicle photo renewal, with the
--                            AI photo review and the ops decision.
--   mobile_push_tokens       Expo push tokens per device.
--   mobile_notifications     In-app notification feed; `dedupeKey` UNIQUE is
--                            the once-only guard for the reminder cron.
--   mobile_driver_requests   Driver → ops requests: hand-over (driver
--                            change), help / SOS, profile (bank) change,
--                            feedback waiver.
--
-- SAFETY
--   * Additive only. Nine brand-new tables. No ALTER, DROP, TRUNCATE, DELETE
--     or UPDATE of any existing table or row anywhere in this file.
--   * No foreign keys — keyed by ids/refs on purpose (live schema carries
--     drift, and booking/agenda rows are recreated on amendment).
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No DELIMITER / procedures (`prisma db execute` splits on `;`).
--
--   bash prisma/sql/apply-driver-app.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-driver-app.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `mobile_driver_accounts` (
  `id`              VARCHAR(191) NOT NULL,
  `driverId`        VARCHAR(191) NOT NULL,
  `passwordHash`    TEXT         NULL,
  `phoneVerifiedAt` DATETIME(3)  NULL,
  `emailVerifiedAt` DATETIME(3)  NULL,
  -- 'en' | 'si' | 'ta' | 'vi'
  `language`        VARCHAR(8)   NOT NULL DEFAULT 'en',
  -- Bumped on password reset / "sign out everywhere"; a token with an older
  -- version is refused.
  `tokenVersion`    INT          NOT NULL DEFAULT 0,
  `lastLoginAt`     DATETIME(3)  NULL,
  `lastSeenAt`      DATETIME(3)  NULL,
  `appVersion`      VARCHAR(32)  NULL,
  `platform`        VARCHAR(16)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile_driver_accounts_driverId_key` (`driverId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_otps` (
  `id`          VARCHAR(191) NOT NULL,
  -- 'ACTIVATE' | 'LOGIN' | 'RESET'
  `purpose`     VARCHAR(16)  NOT NULL,
  -- 'WHATSAPP' | 'EMAIL'
  `channel`     VARCHAR(16)  NOT NULL,
  `target`      VARCHAR(191) NOT NULL,
  `driverId`    VARCHAR(191) NOT NULL,
  `codeHash`    VARCHAR(128) NOT NULL,
  `attempts`    INT          NOT NULL DEFAULT 0,
  `expiresAt`   DATETIME(3)  NOT NULL,
  `consumedAt`  DATETIME(3)  NULL,
  `ip`          VARCHAR(64)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `mobile_otps_driver_created_idx` (`driverId`, `createdAt`),
  KEY `mobile_otps_target_created_idx` (`target`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_trip_sessions` (
  `id`                VARCHAR(191)  NOT NULL,
  `driverId`          VARCHAR(191)  NOT NULL,
  `bookingId`         VARCHAR(191)  NOT NULL,
  `bookingRef`        VARCHAR(191)  NOT NULL,
  `country`           VARCHAR(32)   NULL,
  -- 'ACTIVE' | 'COMPLETED' | 'HANDED_OVER'
  `status`            VARCHAR(16)   NOT NULL DEFAULT 'ACTIVE',
  `portalShownAt`     DATETIME(3)   NULL,
  `portalSkipped`     TINYINT(1)    NOT NULL DEFAULT 0,
  `startedAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `feedbackShownAt`   DATETIME(3)   NULL,
  -- NULL | 'SUBMITTED' | 'WAIVED' (ops let the driver close without one)
  `feedbackStatus`    VARCHAR(16)   NULL,
  `feedbackWaivedBy`  VARCHAR(191)  NULL,
  `completedAt`       DATETIME(3)   NULL,
  `totalKm`           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `createdAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile_trip_sessions_driver_booking_key` (`driverId`, `bookingId`),
  KEY `mobile_trip_sessions_status_idx` (`status`),
  KEY `mobile_trip_sessions_bookingRef_idx` (`bookingRef`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_trip_days` (
  `id`            VARCHAR(191)  NOT NULL,
  `sessionId`     VARCHAR(191)  NOT NULL,
  `driverId`      VARCHAR(191)  NOT NULL,
  `bookingRef`    VARCHAR(191)  NOT NULL,
  -- Local calendar day, 'YYYY-MM-DD'
  `dayDate`       VARCHAR(10)   NOT NULL,
  -- 'STARTED' | 'ENDED'
  `status`        VARCHAR(16)   NOT NULL DEFAULT 'STARTED',
  `startedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt`       DATETIME(3)   NULL,
  `startLat`      DOUBLE        NULL,
  `startLng`      DOUBLE        NULL,
  `endLat`        DOUBLE        NULL,
  `endLng`        DOUBLE        NULL,
  `startOdometer` INT           NULL,
  `endOdometer`   INT           NULL,
  `distanceKm`    DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  `pointCount`    INT           NOT NULL DEFAULT 0,
  `lastLat`       DOUBLE        NULL,
  `lastLng`       DOUBLE        NULL,
  `lastSpeed`     FLOAT         NULL,
  `lastPingAt`    DATETIME(3)   NULL,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile_trip_days_session_day_key` (`sessionId`, `dayDate`),
  KEY `mobile_trip_days_driver_day_idx` (`driverId`, `dayDate`),
  KEY `mobile_trip_days_status_ping_idx` (`status`, `lastPingAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_location_points` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `dayId`       VARCHAR(191) NOT NULL,
  `lat`         DOUBLE       NOT NULL,
  `lng`         DOUBLE       NOT NULL,
  `accuracy`    FLOAT        NULL,
  `speed`       FLOAT        NULL,
  `recordedAt`  DATETIME(3)  NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `mobile_location_points_day_time_idx` (`dayId`, `recordedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_vehicle_checks` (
  `id`              VARCHAR(191) NOT NULL,
  `driverId`        VARCHAR(191) NOT NULL,
  `vehicleId`       VARCHAR(191) NULL,
  -- { front, back, left, right, inside, odometer } → '/api/uploads/...'
  `photos`          JSON         NOT NULL,
  `odometer`        INT          NULL,
  `aiReview`        JSON         NULL,
  -- 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'SUBMITTED',
  `reviewNote`      TEXT         NULL,
  `reviewedByName`  VARCHAR(191) NULL,
  `reviewedAt`      DATETIME(3)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `mobile_vehicle_checks_driver_created_idx` (`driverId`, `createdAt`),
  KEY `mobile_vehicle_checks_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_push_tokens` (
  `id`         VARCHAR(191) NOT NULL,
  `token`      VARCHAR(255) NOT NULL,
  -- 'DRIVER' | 'STAFF'
  `actorType`  VARCHAR(16)  NOT NULL,
  `actorId`    VARCHAR(191) NOT NULL,
  `platform`   VARCHAR(16)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile_push_tokens_token_key` (`token`),
  KEY `mobile_push_tokens_actor_idx` (`actorType`, `actorId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_notifications` (
  `id`         VARCHAR(191) NOT NULL,
  `actorType`  VARCHAR(16)  NOT NULL,
  `actorId`    VARCHAR(191) NOT NULL,
  -- 'TRIP_TOMORROW' | 'TRIP_ASSIGNED' | 'VEHICLE_CHECK_DUE' | 'REQUEST_UPDATE' | 'OPS' ...
  `kind`       VARCHAR(32)  NOT NULL,
  `title`      VARCHAR(191) NOT NULL,
  `body`       TEXT         NOT NULL,
  `data`       JSON         NULL,
  `dedupeKey`  VARCHAR(191) NULL,
  `readAt`     DATETIME(3)  NULL,
  `pushedAt`   DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile_notifications_dedupeKey_key` (`dedupeKey`),
  KEY `mobile_notifications_actor_created_idx` (`actorType`, `actorId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mobile_driver_requests` (
  `id`             VARCHAR(191) NOT NULL,
  `driverId`       VARCHAR(191) NOT NULL,
  `driverName`     VARCHAR(191) NULL,
  -- 'HANDOVER' | 'HELP' | 'PROFILE_CHANGE' | 'FEEDBACK_WAIVER'
  `kind`           VARCHAR(24)  NOT NULL,
  `bookingRef`     VARCHAR(191) NULL,
  `payload`        JSON         NULL,
  `reason`         TEXT         NULL,
  -- 'PENDING' | 'APPROVED' | 'REJECTED'
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  `decidedByName`  VARCHAR(191) NULL,
  `decidedAt`      DATETIME(3)  NULL,
  `decisionNote`   TEXT         NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `mobile_driver_requests_status_idx` (`status`, `createdAt`),
  KEY `mobile_driver_requests_driver_idx` (`driverId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
