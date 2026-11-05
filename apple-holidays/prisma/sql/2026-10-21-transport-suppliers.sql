-- Transport suppliers — which Accounts supplier a movement is paid to, picked
-- on the MC Report and carried onto the Trans-Reconsultation sheet, where the
-- Accounts system reads it beside the line it approves.
--
-- The supplier itself lives in the Accounts database (invoice_processor:
-- supplier_bank_details, or driver_bank_details for a driver paid direct) — the
-- "Suppliers Manage" registry. These tables only point at it, with a snapshot
-- of the name so a line still reads sensibly if the supplier is later renamed.
--
-- Own tables, not columns on agenda_items or trans_recon_lines:
--   * Adding a column to trans_recon_lines would make every Prisma read of that
--     table select it, so the live Trans-Reconsultation page would fail between
--     the code deploy and this file being run. A separate table is only read by
--     the code that needs it, which treats it as empty while it is missing.
--   * A chart save deletes and recreates every agenda item, so the app carries
--     each agenda_mc_suppliers row across to the movement's new id
--     (src/lib/mc-supplier.ts), exactly like agenda_mc_done.
--
-- No foreign keys: agenda rows are recreated on save, and the live schema drifts.
--
-- SAFETY
--   * Additive only. Two brand-new tables. No ALTER, DROP, TRUNCATE, DELETE or
--     UPDATE of any existing table or row anywhere in this file.
--   * Idempotent via IF NOT EXISTS — safe to run twice.
--
--   bash prisma/sql/apply-transport-suppliers.sh --check   # show the target, run nothing
--   bash prisma/sql/apply-transport-suppliers.sh           # apply (asks first)

CREATE TABLE IF NOT EXISTS `agenda_mc_suppliers` (
  `agendaItemId`    VARCHAR(191) NOT NULL,
  `bookingRef`      VARCHAR(191) NOT NULL,
  -- supplier_bank | driver — same vocabulary as the Accounts system's
  -- payable_supplier_links.supplier_source.
  `supplierSource`  VARCHAR(20)  NOT NULL,
  `supplierId`      BIGINT       NOT NULL,
  `supplierName`    VARCHAR(191) NOT NULL,
  `supplierCountry` VARCHAR(2)   NULL,
  -- The movement's driver / vendor when the supplier was picked, normalised —
  -- lets the picker suggest "SURESH was paid through X last time".
  `partyKey`        VARCHAR(191) NULL,
  `setById`         VARCHAR(191) NULL,
  `setByName`       VARCHAR(191) NULL,
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`agendaItemId`),
  INDEX `agenda_mc_suppliers_bookingRef_idx` (`bookingRef`),
  INDEX `agenda_mc_suppliers_partyKey_idx` (`partyKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `trans_recon_line_parties` (
  `lineId`          VARCHAR(191) NOT NULL,
  `sheetId`         VARCHAR(191) NOT NULL,
  `driverName`      VARCHAR(191) NULL,
  `supplierSource`  VARCHAR(20)  NULL,
  `supplierId`      BIGINT       NULL,
  `supplierName`    VARCHAR(191) NULL,
  `supplierCountry` VARCHAR(2)   NULL,
  -- Typed / picked on the sheet itself — a refresh from the MC Report then
  -- leaves that value alone, the same rule as trans_recon_lines.editedFields.
  `driverEdited`    TINYINT(1)   NOT NULL DEFAULT 0,
  `supplierEdited`  TINYINT(1)   NOT NULL DEFAULT 0,
  `updatedByName`   VARCHAR(191) NULL,
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`lineId`),
  INDEX `trans_recon_line_parties_sheet_idx` (`sheetId`),
  INDEX `trans_recon_line_parties_supplier_idx` (`supplierSource`, `supplierId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
