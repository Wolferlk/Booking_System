-- "No Tickets" — a booking that sells no tickets at all.
--
-- Plenty of files are pure transfers: no attractions, no entrances, no
-- vouchers. The tickets page for one of those sits empty forever, and QC read
-- that emptiness as *N/A* — a grey dash that is indistinguishable from "nobody
-- has got to it yet". Operations could never show the rung as finished.
--
-- So the emptiness becomes a decision. Ground marks the booking "No Tickets"
-- on the tickets page; QC then reports Ticket Activation as done, with the
-- reason spelled out, and the ops board and daily report agree because they
-- read the same flag through `computeReadiness()`.
--
-- Run with:
--   npx prisma db execute --file prisma/manual-sql/2026-08-21-no-tickets.sql --schema prisma/schema.prisma
--
-- Additive and defaulted. Every existing booking reads as "not decided", which
-- is exactly what it is — nothing already on the system changes behaviour.

ALTER TABLE `bookings`
  ADD COLUMN `noTickets`     TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN `noTicketsAt`   DATETIME(3)  NULL,
  ADD COLUMN `noTicketsBy`   VARCHAR(191) NULL,
  ADD COLUMN `noTicketsNote` TEXT         NULL;
