-- Adds the GT_VN_USER role (Vietnam Ground Team — Limited) to users.role.
--
-- Additive only: the existing enum members keep their order and no rows are
-- touched, so this is safe to run against the live database and is reversible
-- by re-running the same statement without 'GT_VN_USER' (only while no user
-- holds that role).
--
-- Run with:
--   npx prisma db execute --url "<DATABASE_URL>" --file prisma/sql/add-gt-vn-user-role.sql

ALTER TABLE `users`
  MODIFY `role` ENUM(
    'BT_USER',
    'GT_USER',
    'GT_VN_USER',
    'TE_USER',
    'GT_TE_USER',
    'AC_USER',
    'CLIENT',
    'SUPER_ADMIN',
    'ULTRA_SUPER_ADMIN'
  ) NOT NULL;
