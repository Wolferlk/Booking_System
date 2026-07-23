import { prisma } from './prisma'
import { AUTO_MAIL_HARD_DISABLED } from './automation-switches'

export const LESS_CREDIT_MODE_KEY    = 'less_credit_mode'
export const TQ_MAILBOX_ENABLED_KEY  = 'tq_mailbox_enabled'
export const PNL_MAILBOX_ENABLED_KEY = 'pnl_mailbox_enabled'
export const AUTO_MAIL_ENABLED_KEY   = 'auto_mail_enabled'
export const RECENT_MAIL_WINDOW_MINUTES = 15

// Permanent code-level kill switch — see automation-switches.ts. Re-exported
// here so every mail caller can reach it from the module it already imports.
export { AUTO_MAIL_HARD_DISABLED }

export async function getLessCreditModeEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LESS_CREDIT_MODE_KEY } })
    return row?.value === 'true'
  } catch {
    return false
  }
}

/**
 * The single authority for "is automatic mail extraction & processing ON?".
 *
 * Opt-in: only an explicit `'true'` enables it (unset ⇒ OFF = manual only). ALL
 * automatic mail paths must honour this — the 5-min scheduler and HTTP cron
 * (which already check `auto_mail_enabled`), plus the real-time IMAP IDLE watcher
 * and the Graph mail webhook. When OFF, mail becomes a booking only via the
 * manual `POST /api/mail/process` action. On any DB error we fail CLOSED (return
 * false) so a hiccup never silently resumes auto-processing.
 */
export async function isAutoMailProcessingEnabled(): Promise<boolean> {
  // Hard-disabled in code — always report OFF regardless of the DB toggle.
  if (AUTO_MAIL_HARD_DISABLED) return false
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: AUTO_MAIL_ENABLED_KEY } })
    return row?.value === 'true'
  } catch {
    return false
  }
}

export async function getMailboxEnabledFlags(): Promise<{ tqEnabled: boolean; pnlEnabled: boolean }> {
  try {
    const [tqRow, pnlRow] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: TQ_MAILBOX_ENABLED_KEY } }),
      prisma.systemSetting.findUnique({ where: { key: PNL_MAILBOX_ENABLED_KEY } }),
    ])
    return {
      tqEnabled:  tqRow  ? tqRow.value  === 'true' : true,
      pnlEnabled: pnlRow ? pnlRow.value === 'true' : true,
    }
  } catch {
    return { tqEnabled: true, pnlEnabled: true }
  }
}
