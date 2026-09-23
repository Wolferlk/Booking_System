-- Vietnam booking checklist — the per-booking costing sheet the VN desk keeps
-- by hand in Excel (one row per thing a vendor is paid for), moved into OPS.
--
-- Two tables:
--
--   vn_booking_checklists       One row per booking: the exchange rate and the
--                               revenue the sheet is costed against, plus the
--                               sheet's own status. NULL revenue / rate means
--                               "use the live value" (the booking's P&L revenue
--                               or quoted total, and the house rate) — so a
--                               booking re-priced upstream flows straight through
--                               and only a figure a person typed overrides it.
--
--   vn_booking_checklist_items  One row per payable: details for payment, vendor,
--                               code, unit price, quan1 x quan2, paid state.
--                               Total estimate is COMPUTED (unit x q1 x q2) and
--                               only stored in `totalOverrideVnd` when a person
--                               types a total that is not that product.
--
-- Keyed by `bookingRef` (VN42194), not the booking id, because an AppleSystem
-- revision mints a new booking row under the same ref. No foreign keys, for the
-- same reason and because the live schema carries drift.
--
-- The four summary figures follow the Accounts "Checklist VN" definitions, so
-- the two systems read the same sheet the same way:
--   Total estimate  = sum of the items (VND)            — what the trip COSTS
--   Total VND       = revenue USD x rate                — what it SOLD for
--   PNL incurred    = Total VND - Total estimate        — the PROFIT in dong
--   Profit margin   = PNL incurred / Total VND
--
-- SAFETY
--   * Additive only. Two brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No DELIMITER / procedures (`prisma db execute` splits on `;`).
--
--   bash prisma/sql/apply-vn-booking-checklist.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-vn-booking-checklist.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `vn_booking_checklists` (
  `id`               VARCHAR(191)  NOT NULL,
  `bookingRef`       VARCHAR(191)  NOT NULL,

  -- Overrides. NULL = use the live value.
  `revenueUsd`       DECIMAL(14,2) NULL,
  `exchangeRate`     DECIMAL(14,4) NULL,

  -- 'DRAFT' | 'CHECKED' | 'FINAL'
  `status`           VARCHAR(16)   NOT NULL DEFAULT 'DRAFT',
  `note`             TEXT          NULL,

  `checkedById`      VARCHAR(191)  NULL,
  `checkedByName`    VARCHAR(191)  NULL,
  `checkedAt`        DATETIME(3)   NULL,

  `createdById`      VARCHAR(191)  NULL,
  `createdByName`    VARCHAR(191)  NULL,
  `updatedByName`    VARCHAR(191)  NULL,
  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `vn_booking_checklists_bookingRef_key` (`bookingRef`),
  INDEX `vn_booking_checklists_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vn_booking_checklist_items` (
  `id`               VARCHAR(191)  NOT NULL,
  `bookingRef`       VARCHAR(191)  NOT NULL,
  `position`         INT           NOT NULL DEFAULT 0,

  `serviceDate`      DATE          NULL,
  -- DETAILS FOR PAYMENT
  `description`      TEXT          NOT NULL,
  `vendor`           VARCHAR(191)  NULL,
  -- Trans / Ticket / SIC / Day Cruise / Guide fee / F&B / Hotel / Cruise / ...
  `code`             VARCHAR(64)   NULL,

  -- The unit price in the currency the vendor quoted. 'VND' | 'USD'.
  `unitPrice`        DECIMAL(18,4) NOT NULL DEFAULT 0,
  `unitCurrency`     VARCHAR(8)    NOT NULL DEFAULT 'VND',
  -- quan1 = pax or units; quan2 = repeat count (days, nights, ways).
  `quan1`            DECIMAL(10,2) NOT NULL DEFAULT 1,
  `quan2`            DECIMAL(10,2) NOT NULL DEFAULT 1,
  -- Only set when the typed total is NOT unit x q1 x q2. In VND.
  `totalOverrideVnd` DECIMAL(18,2) NULL,

  -- 'UNPAID' | 'PARTIAL' | 'PAID'
  `paidStatus`       VARCHAR(16)   NOT NULL DEFAULT 'UNPAID',
  `paidVnd`          DECIMAL(18,2) NULL,
  `paidAt`           DATETIME(3)   NULL,
  `paidByName`       VARCHAR(191)  NULL,

  -- Where the row came from: 'MANUAL' | 'CATALOG' | 'INCLUDE'
  `source`           VARCHAR(16)   NOT NULL DEFAULT 'MANUAL',
  `productKey`       VARCHAR(191)  NULL,
  `note`             VARCHAR(500)  NULL,

  `createdByName`    VARCHAR(191)  NULL,
  `updatedByName`    VARCHAR(191)  NULL,
  `createdAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `vn_booking_checklist_items_bookingRef_idx` (`bookingRef`, `position`),
  INDEX `vn_booking_checklist_items_paid_idx` (`paidStatus`),
  INDEX `vn_booking_checklist_items_vendor_idx` (`vendor`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
