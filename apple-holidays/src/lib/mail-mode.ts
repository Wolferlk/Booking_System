import { prisma } from './prisma'

export const LESS_CREDIT_MODE_KEY = 'less_credit_mode'
export const RECENT_MAIL_WINDOW_MINUTES = 15

export async function getLessCreditModeEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: LESS_CREDIT_MODE_KEY },
    })
    return row?.value === 'true'
  } catch {
    return false
  }
}
