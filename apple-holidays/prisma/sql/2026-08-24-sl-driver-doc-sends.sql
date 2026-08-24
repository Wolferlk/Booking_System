-- Driver document deliveries — the receipt for every settlement pack, booking
-- sheet and ops copy that leaves this system over WhatsApp.
--
-- Why a table at all: a WhatsApp send that "worked" is not a send that arrived.
-- Meta answers 200 and *then* decides — the number was never on WhatsApp, the
-- template was not approved, the 24-hour window had shut. The only truthful
-- answer to "did the driver get his paperwork" is the delivery receipt Meta
-- sends back minutes later, and a receipt has nowhere to land unless something
-- remembers the send it belongs to.
--
-- `whatsapp_messages` already logs the *message*; this logs the *delivery* —
-- which sheets went, to which driver, on whose instruction, under which
-- template, whether an ops copy shadowed it, and every status Meta has reported
-- since. Kept apart from `whatsapp_messages` so the chat history stays a chat
-- history and is not reshaped by an operations concern.
--
-- Additive-only. Creates one brand-new table and touches no existing table,
-- column or row: nothing is altered, dropped, back-filled or rewritten.
--
-- No FK to `bookings`, matching `sl_settlement_docs`: the row is keyed by
-- booking ref so it survives the child-row rewrite an amendment performs, and
-- the record that a driver was handed documents must not vanish under a
-- cascade — it is the evidence, and it outlives the booking.
--
-- Idempotent via IF NOT EXISTS. Safe to run against the live database.
--
--   npx prisma db execute --file prisma/sql/2026-08-24-sl-driver-doc-sends.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `sl_driver_doc_sends` (
    `id`            VARCHAR(191) NOT NULL,
    `bookingRef`    VARCHAR(191) NOT NULL,

    -- What was in the envelope: 'settlement' (the pack), 'booking' (the
    -- booking details sheet). One row per WhatsApp message, because WhatsApp
    -- carries one document per message.
    `kind`          VARCHAR(32)  NOT NULL,

    -- Who it was addressed to: 'driver' for the real recipient, 'copy' for the
    -- shadow send that goes to the standing ops number.
    `audience`      VARCHAR(16)  NOT NULL DEFAULT 'driver',

    `driverId`      VARCHAR(191) NULL,
    `driverName`    VARCHAR(191) NULL,
    `phone`         VARCHAR(32)  NOT NULL,

    -- 'template' outside the 24h window, 'freeform' inside it. Worth keeping:
    -- a run of template sends that never reach 'delivered' is a template
    -- problem, not a driver problem.
    `channel`       VARCHAR(16)  NULL,

    `docs`          VARCHAR(255) NULL,
    `filename`      VARCHAR(255) NULL,
    `mediaUrl`      TEXT         NULL,
    `body`          TEXT         NULL,

    `waMessageId`   VARCHAR(191) NULL,

    -- pending → sent → delivered → read, or failed at any point.
    `status`        VARCHAR(24)  NOT NULL DEFAULT 'pending',
    `failureReason` TEXT         NULL,

    `sentAt`        DATETIME(3)  NULL,
    `deliveredAt`   DATETIME(3)  NULL,
    `readAt`        DATETIME(3)  NULL,
    `failedAt`      DATETIME(3)  NULL,

    -- The driver send this row is a copy of, so the ops copy and the original
    -- read as one event rather than two unrelated sends to two numbers.
    `copyOfId`      VARCHAR(191) NULL,
    `copyLabel`     VARCHAR(191) NULL,

    `sentById`      VARCHAR(191) NULL,
    `sentByName`    VARCHAR(191) NULL,

    `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    INDEX `sl_driver_doc_sends_bookingRef_idx`  (`bookingRef`),
    INDEX `sl_driver_doc_sends_waMessageId_idx` (`waMessageId`),
    INDEX `sl_driver_doc_sends_phone_idx`       (`phone`, `createdAt`),
    INDEX `sl_driver_doc_sends_status_idx`      (`status`),
    INDEX `sl_driver_doc_sends_createdAt_idx`   (`createdAt`),
    INDEX `sl_driver_doc_sends_copyOfId_idx`    (`copyOfId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
