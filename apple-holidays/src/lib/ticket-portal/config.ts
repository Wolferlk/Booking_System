/**
 * Ticket Issue Desk settings — one JSON row in `system_settings`, so no table
 * depends on it. Off unless an admin turns it on with the critical-services
 * password, and an unreadable setting reads as off: "we could not check" must
 * never mean "spend the money". Never cached, for the same reason.
 */
import { prisma } from '@/lib/prisma'
import { normalisePhone } from '@/lib/whatsapp'

export const TICKET_PORTAL_KEY = 'ticket_portal_config'
export const OTP_TTL_MINUTES = 5

export const DEFAULT_OTP_TEMPLATE = 'aahaas_ticket_issue_otp'
export const DEFAULT_DETAILS_TEMPLATE = 'aahaas_ticket_approval_details'
/**
 * The first details template. Meta REJECTED it (2026-11-09): it named "a code"
 * inside a UTILITY template, which Meta reads as authentication content, and it
 * was six variables in very few words. A saved setting still naming it moves to
 * the new one, so nobody has to edit Settings by hand.
 */
export const REJECTED_DETAILS_TEMPLATES = ['aahaas_ticket_issue_request']

/**
 * Sent to each approver just before the code. A UTILITY template: no mention of
 * a code, password or OTP (Meta rejects that outside AUTHENTICATION), plenty of
 * fixed words around the six variables, and it neither starts nor ends on one.
 */
export const DETAILS_BODY =
  'Hello, a ticket purchase on the Aahaas operations desk is waiting for your approval.\n\nAction: {{1}}\nBooking reference: {{2}}\nTicket: {{3}}\nSupplier portal: {{4}}\nAmount: {{5}}\nRequested by: {{6}}\n\nPlease check these details before you approve. If you do not recognise this request, do not approve it and tell the operations manager.'
export const DETAILS_EXAMPLES = ['Issue ticket', 'SG49518', 'Singapore Cable Car Sky Pass', 'Cebu', 'SGD 484.50', 'Sasindu']

export interface OtpRecipient { name: string; phone: string }

export interface PortalConfig {
  enabled: boolean
  providers: { globaltix: boolean; cebu: boolean }
  recipients: OtpRecipient[]
  otpTemplate: string
  detailsTemplate: string
  language: string
}

const cleanTemplate = (v: unknown, fallback: string) =>
  String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || fallback

export function normaliseConfig(raw: Partial<PortalConfig> | null | undefined): PortalConfig {
  const seen = new Set<string>()
  const recipients: OtpRecipient[] = []
  for (const r of Array.isArray(raw?.recipients) ? raw!.recipients : []) {
    const phone = normalisePhone(String(r?.phone ?? ''))
    if (!phone || seen.has(phone)) continue
    seen.add(phone)
    recipients.push({ name: String(r?.name ?? '').trim().slice(0, 60) || 'Approver', phone })
  }
  return {
    enabled: raw?.enabled === true,
    providers: { globaltix: raw?.providers?.globaltix !== false, cebu: raw?.providers?.cebu !== false },
    recipients: recipients.slice(0, 10),
    otpTemplate: cleanTemplate(raw?.otpTemplate, DEFAULT_OTP_TEMPLATE),
    detailsTemplate: (() => {
      const name = cleanTemplate(raw?.detailsTemplate, DEFAULT_DETAILS_TEMPLATE)
      return REJECTED_DETAILS_TEMPLATES.includes(name) ? DEFAULT_DETAILS_TEMPLATE : name
    })(),
    language: String(raw?.language ?? 'en').trim() || 'en',
  }
}

export async function getPortalConfig(): Promise<PortalConfig> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: TICKET_PORTAL_KEY } })
    return normaliseConfig(row ? JSON.parse(row.value) : null)
  } catch (err) {
    console.warn('[ticket-portal] settings unreadable, desk stays off:', err instanceof Error ? err.message : err)
    return normaliseConfig(null)
  }
}

export async function savePortalConfig(input: Partial<PortalConfig>): Promise<PortalConfig> {
  const config = normaliseConfig(input)
  const value = JSON.stringify(config)
  await prisma.systemSetting.upsert({ where: { key: TICKET_PORTAL_KEY }, create: { key: TICKET_PORTAL_KEY, value }, update: { value } })
  return config
}

export const maskPhone = (p: string) => `••••${p.slice(-4)}`
