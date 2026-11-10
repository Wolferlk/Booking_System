/**
 * The Ticket Issue Desk's own three tables — the same CREATE TABLE IF NOT EXISTS
 * statements as prisma/sql/2026-11-09-ticket-portal-issue.sql (keep in step).
 *
 * Why this exists: when the tables are missing the desk used to hide itself
 * silently, so Settings said "Desk is ON" and the Tickets page showed no Issue
 * button with no reason (user, 2026-11-10). Now the gap is reported, and an
 * admin can create them from Settings with the critical-services password —
 * no shell access is needed on Amplify.
 *
 * Additive only: three brand-new tables, IF NOT EXISTS, nothing else touched.
 */
import { prisma } from '@/lib/prisma'

export const DESK_TABLES = ['ticket_portal_bookings', 'ticket_portal_otps', 'ticket_portal_cache'] as const

const CREATE_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS \`ticket_portal_bookings\` (
  \`id\`              VARCHAR(191)  NOT NULL,
  \`ticketId\`        VARCHAR(191)  NOT NULL,
  \`bookingId\`       VARCHAR(191)  NOT NULL,
  \`bookingRef\`      VARCHAR(191)  NOT NULL,
  \`provider\`        VARCHAR(16)   NOT NULL,
  \`productId\`       VARCHAR(64)   NOT NULL,
  \`productName\`     VARCHAR(255)  NULL,
  \`optionId\`        VARCHAR(64)   NULL,
  \`optionName\`      VARCHAR(255)  NULL,
  \`kind\`            VARCHAR(32)   NULL,
  \`tickets\`         TEXT          NOT NULL,
  \`alsoCovers\`      TEXT          NULL,
  \`visitDate\`       VARCHAR(10)   NULL,
  \`eventTime\`       VARCHAR(32)   NULL,
  \`customerName\`    VARCHAR(191)  NULL,
  \`customerMobile\`  VARCHAR(32)   NULL,
  \`reference\`       VARCHAR(64)   NULL,
  \`status\`          VARCHAR(16)   NOT NULL,
  \`amount\`          DECIMAL(12,2) NULL,
  \`currency\`        VARCHAR(8)    NULL,
  \`lastError\`       VARCHAR(500)  NULL,
  \`liveKey\`         VARCHAR(191)  NULL,
  \`ticketSnapshot\`  MEDIUMTEXT    NULL,
  \`fileIds\`         TEXT          NULL,
  \`reserveJson\`     MEDIUMTEXT    NULL,
  \`confirmJson\`     MEDIUMTEXT    NULL,
  \`releaseJson\`     MEDIUMTEXT    NULL,
  \`detailsJson\`     MEDIUMTEXT    NULL,
  \`createdById\`     VARCHAR(191)  NULL,
  \`createdByName\`   VARCHAR(191)  NULL,
  \`confirmedByName\` VARCHAR(191)  NULL,
  \`releasedByName\`  VARCHAR(191)  NULL,
  \`cancelledByName\` VARCHAR(191)  NULL,
  \`confirmedAt\`     DATETIME(3)   NULL,
  \`cancelledAt\`     DATETIME(3)   NULL,
  \`createdAt\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`ticket_portal_bookings_liveKey_key\` (\`liveKey\`),
  INDEX \`ticket_portal_bookings_ticketId_idx\` (\`ticketId\`),
  INDEX \`ticket_portal_bookings_bookingId_idx\` (\`bookingId\`),
  INDEX \`ticket_portal_bookings_reference_idx\` (\`reference\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS \`ticket_portal_otps\` (
  \`id\`              VARCHAR(191)  NOT NULL,
  \`portalBookingId\` VARCHAR(191)  NOT NULL,
  \`purpose\`         VARCHAR(16)   NOT NULL,
  \`codeHash\`        VARCHAR(128)  NOT NULL,
  \`bindHash\`        VARCHAR(128)  NOT NULL,
  \`recipients\`      TEXT          NULL,
  \`requestedById\`   VARCHAR(191)  NULL,
  \`requestedByName\` VARCHAR(191)  NULL,
  \`expiresAt\`       DATETIME(3)   NOT NULL,
  \`attempts\`        INT           NOT NULL DEFAULT 0,
  \`consumedAt\`      DATETIME(3)   NULL,
  \`voidedAt\`        DATETIME(3)   NULL,
  \`createdAt\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (\`id\`),
  INDEX \`ticket_portal_otps_booking_idx\` (\`portalBookingId\`, \`purpose\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS \`ticket_portal_cache\` (
  \`cacheKey\`  VARCHAR(191) NOT NULL,
  \`value\`     MEDIUMTEXT   NOT NULL,
  \`fetchedAt\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (\`cacheKey\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
]

export interface DeskTables { ready: boolean; missing: string[]; error: string | null }

/** Which desk tables this database lacks. Never throws. */
export async function deskTables(): Promise<DeskTables> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${DESK_TABLES.map(() => '?').join(',')})`,
      ...DESK_TABLES,
    )
    const have = new Set(rows.map(r => String(r.name).toLowerCase()))
    const missing = DESK_TABLES.filter(t => !have.has(t))
    return { ready: missing.length === 0, missing, error: null }
  } catch (err) {
    return { ready: false, missing: [], error: err instanceof Error ? err.message.split('\n').pop()?.trim() || 'not readable' : String(err) }
  }
}

/** Create whichever desk tables are missing. Safe to run twice. */
export async function createDeskTables(): Promise<DeskTables> {
  for (const sql of CREATE_SQL) await prisma.$executeRawUnsafe(sql)
  return deskTables()
}
