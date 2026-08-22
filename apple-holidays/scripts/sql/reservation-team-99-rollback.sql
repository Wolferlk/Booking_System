-- Reservation Team — rollback.
--
-- ⚠  DESTRUCTIVE. This drops the eight Reservation Team tables and everything
--    in them. Run it ONLY to undo a migration that has not been used yet.
--
--    Check first that they are empty:
--      npx tsx scripts/rs-verify.mts
--
--    It does NOT undo the users.role ENUM change, and deliberately so: removing
--    a value from an ENUM rewrites the column and would corrupt any user row
--    already set to RS_USER. If you need that reversed, first move those users
--    to another role, then narrow the ENUM by hand.
--
-- Drop order is the reverse of creation, so foreign keys never block a drop.

DROP TABLE IF EXISTS `credit_notes`;
DROP TABLE IF EXISTS `proforma_invoices`;
DROP TABLE IF EXISTS `hotel_contract_rates`;
DROP TABLE IF EXISTS `hotel_contracts`;
DROP TABLE IF EXISTS `reservation_events`;
DROP TABLE IF EXISTS `reservation_special_requests`;
DROP TABLE IF EXISTS `reservation_options`;
DROP TABLE IF EXISTS `hotel_reservations`;
