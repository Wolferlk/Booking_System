-- Driver App — pausing a running day ("Take a break").
--
-- A driver stops for a meal, fuel, prayer or while the guest is at a sight.
-- The day stays STARTED (so nothing else about a running day changes); a row
-- here with `endedAt` NULL means "paused right now".
--
-- GPS keeps running while paused. Points that fall inside a pause are stored
-- as usual (the route still draws) but their distance goes into `movedKm`
-- here, not into the day's km — unless the driver says on resume that the
-- guest was in the car (`countMoved` = 1), then it is added to the day.
--
-- `startT` / `endT` are the PHONE's clock (epoch ms), because the GPS points
-- carry the phone's clock too — points are matched to pauses by those.
--
-- SAFETY
--   * Additive only. One brand-new table. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * No foreign keys (live schema carries drift).
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-trip-pauses.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-trip-pauses.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `mobile_trip_pauses` (
  -- Made on the phone, so a pause sent twice from the offline queue is one row.
  `id`          VARCHAR(191)  NOT NULL,
  `dayId`       VARCHAR(191)  NOT NULL,
  `sessionId`   VARCHAR(191)  NOT NULL,
  `driverId`    VARCHAR(191)  NOT NULL,
  `bookingRef`  VARCHAR(191)  NOT NULL,
  -- 'MEAL' | 'FUEL' | 'GUEST_STOP' | 'REST' | 'PRAYER' | 'VEHICLE' | 'PERSONAL' | 'OTHER'
  `reason`      VARCHAR(24)   NOT NULL,
  `note`        VARCHAR(500)  NULL,
  -- What the driver expected, in minutes; NULL = "not sure".
  `plannedMin`  INT           NULL,
  `startT`      BIGINT        NOT NULL,
  `endT`        BIGINT        NULL,
  `startedAt`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt`     DATETIME(3)   NULL,
  `lat`         DOUBLE        NULL,
  `lng`         DOUBLE        NULL,
  `endLat`      DOUBLE        NULL,
  `endLng`      DOUBLE        NULL,
  `movedKm`     DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  `countMoved`  TINYINT(1)    NOT NULL DEFAULT 0,
  -- 'DRIVER' | 'MOVING' (resumed from the "you're moving" prompt) | 'DAY_END' | 'OPS'
  `endedBy`     VARCHAR(16)   NULL,
  `createdAt`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `mobile_trip_pauses_day_idx` (`dayId`, `startT`),
  INDEX `mobile_trip_pauses_open_idx` (`driverId`, `endedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
