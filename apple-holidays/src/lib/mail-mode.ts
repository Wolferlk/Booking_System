import { prisma } from './prisma'

export const LESS_CREDIT_MODE_KEY    = 'less_credit_mode'
export const TQ_MAILBOX_ENABLED_KEY  = 'tq_mailbox_enabled'
export const PNL_MAILBOX_ENABLED_KEY = 'pnl_mailbox_enabled'
export const RECENT_MAIL_WINDOW_MINUTES = 15

export async function getLessCreditModeEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LESS_CREDIT_MODE_KEY } })
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
