-- Additive-only: add media + read-state columns to whatsapp_messages for the
-- global WhatsApp inbox. Safe to run against the live DB — no existing column
-- is dropped, `body` is loosened from NOT NULL to NULL (media messages can
-- arrive with no caption), and every new column is nullable or has a default,
-- so all existing rows remain valid with no backfill required.
ALTER TABLE `whatsapp_messages`
    MODIFY COLUMN `body` TEXT NULL,
    ADD COLUMN `mediaUrl` VARCHAR(191) NULL,
    ADD COLUMN `mediaType` VARCHAR(191) NULL,
    ADD COLUMN `mediaMimeType` VARCHAR(191) NULL,
    ADD COLUMN `read` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `whatsapp_messages_phone_createdAt_idx` ON `whatsapp_messages` (`phone`, `createdAt`);
