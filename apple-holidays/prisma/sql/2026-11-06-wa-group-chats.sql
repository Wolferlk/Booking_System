-- WhatsApp chat groups: one booking, many contacts, one shared timeline.
--
-- SAFETY: additive only. Three brand-new tables, no foreign keys, no ALTER, DROP,
-- TRUNCATE, DELETE or UPDATE of anything existing. Safe to run twice.

CREATE TABLE IF NOT EXISTS `wa_group_participants` (
  `id`        VARCHAR(191) NOT NULL,
  `groupId`   VARCHAR(191) NOT NULL,
  `phone`     VARCHAR(32)  NOT NULL,
  `name`      VARCHAR(191) NULL,
  -- guest | family | driver | guide | agent | staff | other
  `role`      VARCHAR(16)  NOT NULL DEFAULT 'guest',
  -- active | invited | joined | left
  `joinState` VARCHAR(16)  NOT NULL DEFAULT 'active',
  `removedAt` DATETIME(3)  NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `wa_group_participants_unique` (`groupId`, `phone`),
  KEY `wa_group_participants_phone_idx` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_group_messages` (
  `id`          VARCHAR(191) NOT NULL,
  `groupId`     VARCHAR(191) NOT NULL,
  `bookingRef`  VARCHAR(191) NOT NULL,
  `direction`   VARCHAR(8)   NOT NULL,
  `senderName`  VARCHAR(191) NULL,
  `senderPhone` VARCHAR(32)  NULL,
  `body`        TEXT         NULL,
  `kind`        VARCHAR(16)  NULL,
  `tag`         VARCHAR(32)  NULL,
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'sent',
  `detail`      TEXT         NULL,
  `recipients`  INT          NOT NULL DEFAULT 0,
  `waMessageId` VARCHAR(191) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `wa_group_messages_group_idx` (`groupId`, `createdAt`),
  KEY `wa_group_messages_ref_idx` (`bookingRef`),
  KEY `wa_group_messages_wamid_idx` (`waMessageId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wa_group_channels` (
  `groupId`    VARCHAR(191) NOT NULL,
  -- inbox | pending | whatsapp
  `mode`       VARCHAR(16)  NOT NULL DEFAULT 'inbox',
  `waGroupId`  VARCHAR(191) NULL,
  `inviteLink` VARCHAR(255) NULL,
  `lastError`  TEXT         NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`groupId`),
  UNIQUE KEY `wa_group_channels_waGroupId_key` (`waGroupId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
