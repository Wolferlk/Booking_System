-- Trans-Reconsultation — Excel import provenance columns.
--
-- ONLY for a database where 2026-10-19-trans-recon.sql was applied BEFORE these
-- columns were added to it (that file now creates them itself). Additive, and
-- safe to run twice on MariaDB (live is MariaDB 10.11; ADD COLUMN IF NOT EXISTS
-- is MariaDB syntax — on MySQL 8 add the columns by hand instead).
-- Apply with: bash prisma/sql/apply-trans-recon.sh --upgrade

ALTER TABLE `trans_recon_sheets`
  ADD COLUMN IF NOT EXISTS `lastImportAt`   DATETIME(3)  NULL AFTER `lastSyncedAt`,
  ADD COLUMN IF NOT EXISTS `lastImportFile` VARCHAR(191) NULL AFTER `lastImportAt`,
  ADD COLUMN IF NOT EXISTS `lastImportBy`   VARCHAR(191) NULL AFTER `lastImportFile`;

ALTER TABLE `trans_recon_lines`
  ADD COLUMN IF NOT EXISTS `importedFrom` VARCHAR(191) NULL AFTER `approvedAt`,
  ADD COLUMN IF NOT EXISTS `importRow`    INT          NULL AFTER `importedFrom`;
