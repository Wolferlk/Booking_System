-- Reservation Team — step 2 of 2: widen `users.role` with RS_USER.
--
-- PREFER THE SCRIPT, NOT THIS FILE:
--
--   npx tsx scripts/rs-apply-role.mts           # dry run
--   npx tsx scripts/rs-apply-role.mts --apply
--
-- The script builds the ALTER from the ENUM definition actually in the live
-- database. This file assumes the value list matches schema.prisma exactly. The
-- live schema is known to carry drift, and if it has a role this list omits,
-- applying this file would DROP that role from the column and blank the
-- affected users. Run scripts/rs-preflight.mts and compare before using it.
--
-- Appending a value to the END of an ENUM is metadata-only: existing values
-- keep their ordinals, so no row is rewritten. Never re-order or remove values.

ALTER TABLE `users` MODIFY COLUMN `role` ENUM(
  'BT_USER',
  'GT_USER',
  'GT_VN_USER',
  'TE_USER',
  'GT_TE_USER',
  'AC_USER',
  'CLIENT',
  'SUPER_ADMIN',
  'ULTRA_SUPER_ADMIN',
  'RS_USER'
) NOT NULL;
