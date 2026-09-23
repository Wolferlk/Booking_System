-- Vietnam agenda includes — what a SIC Transfer / Private Tour movement is
-- actually made of, picked from the Vietnam product sheet.
--
-- Why: a Vietnam P&L line is a bundle ("SIC - 4 Island tour + cable car + Local
-- lunch") but the money leaves in parts — the boat, the cable car ticket, the
-- lunch, the transfer — each to a different supplier on a different day. The
-- operator who builds the movement chart is the one person who knows which
-- parts this booking really has, so they name them here, from the product
-- sheet, and the Accounts payables board reads them back to pay each part
-- separately.
--
-- Two tables:
--
--   vn_include_products   The product sheet, cached. Rows from the sheet are
--                         refreshed by "Sync now" and never deleted — a product
--                         that drops off the sheet is only marked inactive, so
--                         an include that already points at it still reads.
--                         Products typed in by an operator live here too
--                         (source = MANUAL) and are pushed to the "Manual
--                         Products" tab of the same workbook.
--
--   agenda_item_includes  The includes chosen on a movement. Keyed by
--                         `bookingRef` and carrying a snapshot of the movement
--                         (date, activity, service type), because the chart is
--                         deleted and recreated on every save and rebuilt
--                         wholesale on an amendment — the include must outlive
--                         the agenda row id it was first attached to. The
--                         product's code, name and price are snapshotted too, so
--                         a later sheet edit never re-prices a booking already
--                         made.
--
-- No foreign keys on purpose: `agenda_items` is rewritten on every save (see
-- above) and the live schema carries drift, so the join is soft — by
-- `agendaItemId` while it still exists, by the movement snapshot once it does not.
--
-- SAFETY
--   * Additive only. Two brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--   * No DELIMITER / procedures (`prisma db execute` splits on `;`).
--
--   bash prisma/sql/apply-vn-agenda-includes.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-vn-agenda-includes.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `vn_include_products` (
  `id`              VARCHAR(191)  NOT NULL,

  -- Stable identity: code + cleaned name, lower-cased. The sheet has no id
  -- column, so this is what a re-sync matches a row back to.
  `productKey`      VARCHAR(191)  NOT NULL,

  -- Column A of the sheet: Trans, Ticket, SIC, Day Cruise, Guide fee, F&B,
  -- Hotel, Cruise — or whatever the desk adds next.
  `code`            VARCHAR(64)   NOT NULL,
  -- Column B, with the bullets / leading colons the sheet carries stripped.
  `name`            TEXT          NOT NULL,
  -- Column B exactly as the sheet holds it, for tracing a row back.
  `rawName`         TEXT          NULL,
  -- Lower-cased, accent-free, punctuation-free name — what search runs on.
  `searchText`      TEXT          NOT NULL,
  -- Column C: how many times the product was paid. Used to rank search results.
  `usageCount`      INT           NOT NULL DEFAULT 0,
  -- Column D: the lowest price paid, in VND. NULL when the sheet has none.
  `minPriceVnd`     DECIMAL(16,2) NULL,

  -- 'SHEET' (read from the product sheet) or 'MANUAL' (typed in by an operator).
  `source`          VARCHAR(16)   NOT NULL DEFAULT 'SHEET',
  -- Worksheet and row the product was last read from.
  `sheetTab`        VARCHAR(191)  NULL,
  `sheetRow`        INT           NULL,
  `isActive`        BOOLEAN       NOT NULL DEFAULT true,

  -- MANUAL rows only: has the row reached the workbook's Manual Products tab?
  -- 'PENDING' | 'SYNCED' | 'FAILED'. NULL on SHEET rows.
  `syncStatus`      VARCHAR(16)   NULL,
  `syncError`       TEXT          NULL,
  `syncedAt`        DATETIME(3)   NULL,

  -- Where a MANUAL product was first needed, and by whom.
  `bookingRef`      VARCHAR(191)  NULL,
  `createdById`     VARCHAR(191)  NULL,
  `createdByName`   VARCHAR(191)  NULL,

  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `vn_include_products_productKey_key` (`productKey`),
  INDEX `vn_include_products_code_idx`   (`code`),
  INDEX `vn_include_products_source_idx` (`source`, `syncStatus`),
  INDEX `vn_include_products_active_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agenda_item_includes` (
  `id`              VARCHAR(191)  NOT NULL,

  -- The booking, by reference — survives an amendment's child-row rewrite.
  `bookingRef`      VARCHAR(191)  NOT NULL,
  -- The movement as it was when last saved. Soft: may point at a row that a
  -- later rebuild has replaced; the snapshot below then re-attaches it.
  `agendaItemId`    VARCHAR(191)  NULL,

  -- Snapshot of the movement — what Accounts matches a payable line against.
  `itemDate`        DATE          NOT NULL,
  `itemServiceType` VARCHAR(64)   NULL,
  `itemLocation`    VARCHAR(191)  NULL,
  `itemActivity`    TEXT          NULL,
  `itemSortOrder`   INT           NOT NULL DEFAULT 0,

  -- Snapshot of the product at the moment it was chosen.
  `productId`       VARCHAR(191)  NULL,
  `productKey`      VARCHAR(191)  NOT NULL,
  `code`            VARCHAR(64)   NOT NULL,
  `name`            TEXT          NOT NULL,
  `unitPriceVnd`    DECIMAL(16,2) NULL,
  `quantity`        INT           NOT NULL DEFAULT 1,
  `note`            VARCHAR(500)  NULL,
  `source`          VARCHAR(16)   NOT NULL DEFAULT 'SHEET',
  `position`        INT           NOT NULL DEFAULT 0,

  `createdById`     VARCHAR(191)  NULL,
  `createdByName`   VARCHAR(191)  NULL,
  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `agenda_item_includes_bookingRef_idx` (`bookingRef`, `itemDate`),
  INDEX `agenda_item_includes_agendaItemId_idx` (`agendaItemId`),
  INDEX `agenda_item_includes_productKey_idx` (`productKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
