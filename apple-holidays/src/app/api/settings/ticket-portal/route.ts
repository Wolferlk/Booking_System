import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaAuthTemplate, createMetaTemplate, listMetaTemplates } from '@/lib/whatsapp'
import { logActivity } from '@/lib/activity'
import {
  DETAILS_BODY, DETAILS_EXAMPLES, OTP_TTL_MINUTES, getPortalConfig, savePortalConfig, type PortalConfig,
} from '@/lib/ticket-portal/config'
import { sendTestCode } from '@/lib/ticket-portal/otp'

export const dynamic = 'force-dynamic'

const ADMIN = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function admin() {
  const session = await getServerSession(authOptions)
  return session?.user && ADMIN.includes(session.user.role) ? session.user : null
}

async function templateStatus(config: PortalConfig) {
  try {
    const all = await listMetaTemplates('ALL')
    const statusOf = (name: string) => all.find(t => t.name === name && t.language === config.language)?.status ?? all.find(t => t.name === name)?.status ?? 'MISSING'
    return { otp: statusOf(config.otpTemplate), details: statusOf(config.detailsTemplate), error: null }
  } catch (err) {
    return { otp: 'UNKNOWN', details: 'UNKNOWN', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  if (!(await admin())) return buildApiError('Forbidden', 403)
  const config = await getPortalConfig()
  return buildApiSuccess({ config, templates: await templateStatus(config), detailsBody: DETAILS_BODY })
}

/** Saving decides who can approve spending, so it takes the critical-services password. */
export async function PUT(req: NextRequest) {
  const user = await admin()
  if (!user) return buildApiError('Forbidden', 403)
  const { password, config } = (await req.json().catch(() => ({}))) as { password?: string; config?: Partial<PortalConfig> }
  const critical = process.env.CRITICAL_SERVICES_PASSWORD ?? process.env.CRITICAL_OPS_PASSWORD
  if (!critical) return buildApiError('Critical services password is not configured on the server', 500)
  if (!password || password !== critical) return buildApiError('Incorrect critical services password', 403)
  if (!config) return buildApiError('Nothing to save')
  if (config.enabled && !config.recipients?.length) return buildApiError('Add at least one approver number before turning the desk on.')
  const saved = await savePortalConfig(config)
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_SETTINGS', entityType: 'SystemSetting', entityId: 'ticket_portal_config', details: { enabled: saved.enabled, approvers: saved.recipients.map(r => r.name) } })
  return buildApiSuccess({ config: saved, templates: await templateStatus(saved) }, 'Ticket Issue Desk settings saved')
}

/** { action: 'register' } submits both templates to Meta; { action: 'test' } sends a sample code. */
export async function POST(req: NextRequest) {
  if (!(await admin())) return buildApiError('Forbidden', 403)
  const { action } = (await req.json().catch(() => ({}))) as { action?: string }
  const config = await getPortalConfig()

  if (action === 'test') {
    if (!config.recipients.length) return buildApiError('Save at least one approver number first.')
    const sentTo = await sendTestCode(config)
    return buildApiSuccess({ sentTo }, sentTo.some(s => s.ok) ? 'Test code sent' : 'WhatsApp refused the test code')
  }
  if (action === 'register') {
    const results: Record<string, string> = {}
    await createMetaAuthTemplate({ name: config.otpTemplate, language: config.language, expiryMinutes: OTP_TTL_MINUTES })
      .then(r => { results.otp = r.status }).catch(err => { results.otp = err instanceof Error ? err.message : String(err) })
    await createMetaTemplate({ name: config.detailsTemplate, category: 'UTILITY', language: config.language, bodyText: DETAILS_BODY, bodyExamples: DETAILS_EXAMPLES })
      .then(r => { results.details = r.status }).catch(err => { results.details = err instanceof Error ? err.message : String(err) })
    return buildApiSuccess({ results, templates: await templateStatus(config) }, 'Sent to Meta')
  }
  return buildApiError('Unknown action')
}
