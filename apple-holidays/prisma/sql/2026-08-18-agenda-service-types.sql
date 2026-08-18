-- Agenda service types — the MC agenda dropdown grows from four options to
-- twelve (SIC Tour, PVT Tour, the PVT Transfer combinations, Meal Coupon, …).
--
-- Purely additive: seven new members on the `agenda_items.serviceType` ENUM.
-- No existing member is dropped or renamed, so every stored row keeps its
-- current value and the column default stays `OWN_ARRANGEMENT`. Two of the
-- twelve dropdown entries reuse members that already exist — `INTERNAL_TOUR`
-- is shown as "Ticket Only" and `ACCOMMODATION` as "Hotel Only" — which is why
-- they are not added again here.
--
-- Applied with `prisma db execute` rather than `db push` because the live
-- database carries schema drift that `db push` would try to "correct".
--
--   npx prisma db execute --file prisma/sql/2026-08-18-agenda-service-types.sql --schema prisma/schema.prisma
--
-- Re-runnable: re-applying simply restates the same column definition.

ALTER TABLE `agenda_items`
  MODIFY COLUMN `serviceType` ENUM(
    'PVT_TRANSFER',
    'SIC_TRANSFER',
    'OWN_ARRANGEMENT',
    'FLIGHT',
    'INTERNAL_TOUR',
    'ACCOMMODATION',
    'SIC_TOUR',
    'PVT_TOUR',
    'PVT_TRANSFER_TICKET',
    'PVT_TRANSFER_SPA',
    'MEAL_COUPON',
    'PVT_TRANSFER_SIC_TOUR',
    'PVT_TRANSFER_MEAL'
  ) NOT NULL DEFAULT 'OWN_ARRANGEMENT';
