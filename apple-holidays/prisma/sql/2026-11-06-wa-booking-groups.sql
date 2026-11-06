-- WhatsApp inbox booking groups.
--
--   wa_booking_groups         — a named group and its automation switches.
--   wa_booking_group_members  — which bookings are in it (by bookingRef).
--   wa_group_sends            — one row per send attempt. `dedupeKey` is set on
--                               automatic sends only and is UNIQUE, so two sweeps
--                               or a booking in two groups cannot double-message.
--
-- SAFETY
--   * Additive only. Three brand-new tables. No ALTER, DROP, TRUNCATE, DELETE
--     or UPDATE of any existing table or row anywhere in this file.
--   * No foreign keys (live schema carries drift).
--   * Every automation switch defaults to OFF.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-wa-booking-groups.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-wa-booking-groups.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `wa_booking_groups` (
  `id`            VARCHAR(191) NOT NULL,
  `name`          VARCHAR(191) NOT NULL,
  `color`         VARCHAR(16)  NOT NULL DEFAULT 'emerald',
  `autoDaily`     TINYINT(1)   NOT NULL DEFAULT 0,
  `dailyTime`     VARCHAR(5)   NOT NULL DEFAULT '18:00',
  `autoDay7`      TINYINT(1)   NOT NULL DEFAULT 0,
  `autoDay3`      TINYINT(1)   NOT NULL DEFAULT 0,
  `autoDriver`    TINYINT(1)   NOT NULL DEFAULT 0,
  `docTime`       VARCHAR(5)   NOT NULL DEFAULT '10:00',
  `archivedAt`    DATETIME(3)  NULL,
  `createdByName` VARCHAR(191) NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `wa_booking_groups_archived_idx` (`archivedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_booking_group_members` (
  `id`          VARCHAR(191) NOT NULL,
  `groupId`     VARCHAR(191) NOT NULL,
  `bookingRef`  VARCHAR(191) NOT NULL,
  `addedByName` VARCHAR(191) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `wa_booking_group_members_unique` (`groupId`, `bookingRef`),
  KEY `wa_booking_group_members_ref_idx` (`bookingRef`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_group_sends` (
  `id`         VARCHAR(191) NOT NULL,
  `groupId`    VARCHAR(191) NOT NULL,
  `bookingRef` VARCHAR(191) NOT NULL,
  -- daily | day7 | day3 | flights | hotels | itinerary | driver
  `kind`       VARCHAR(16)  NOT NULL,
  -- manual | auto
  `trigger`    VARCHAR(8)   NOT NULL,
  -- sending | sent | failed | skipped
  `status`     VARCHAR(16)  NOT NULL,
  `detail`     TEXT         NULL,
  `targetDate` VARCHAR(10)  NULL,
  `dedupeKey`  VARCHAR(191) NULL,
  `sentByName` VARCHAR(191) NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `wa_group_sends_dedupeKey_key` (`dedupeKey`),
  KEY `wa_group_sends_group_idx` (`groupId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
