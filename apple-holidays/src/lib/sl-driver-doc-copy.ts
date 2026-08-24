/**
 * The standing copy number — the second phone every driver document reaches.
 *
 * ---- Why ----
 *
 * A driver's WhatsApp is not a filing cabinet. He deletes the thread, changes
 * the handset, hands the phone to a relative for the week. When a settlement
 * sheet is disputed three months later the only copy that survives is the one
 * that went somewhere else at the same moment, and "somewhere else" has meant a
 * desk officer remembering to forward it, which is exactly the kind of thing
 * that is remembered until it matters.
 *
 * So every document sent to a driver is shadowed to one standing number — the
 * ground manager's line, the operations group's line — automatically, with no
 * tick box to forget. It is configured once here and applies everywhere.
 *
 * ---- What the copy says ----
 *
 * A copy is useless if the reader cannot tell whose it is. The shadow message
 * is not the driver's message re-sent: it opens by naming the driver and the
 * number the original went to, so the manager reading it knows at a glance that
 * this is *Kamal's* transport sheet on *+94 77 562 2923*, not a document
 * addressed to him. Outside the 24-hour window that notice has to survive
 * Meta's template rules — no newlines, no tabs, one line — which is why it is
 * folded into the template's first parameter rather than written above it.
 *
 * ---- Stored where ----
 *
 * Three `system_settings` rows, so nothing new is needed in the schema and the
 * value is one place for the whole company rather than per-user. Reading is
 * open to any staff member who can send documents; changing it is an admin act.
 */
import { prisma } from '@/lib/prisma'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'

export const SETTING_COPY_ENABLED = 'sl_driver_docs_copy_enabled'
export const SETTING_COPY_PHONE   = 'sl_driver_docs_copy_phone'
export const SETTING_COPY_LABEL   = 'sl_driver_docs_copy_label'

export interface DriverDocCopyConfig {
  /** Whether the shadow send happens at all. */
  enabled: boolean
  /** The number exactly as an admin typed it — shown back on the settings screen. */
  phone: string
  /** Digits only, country code, no plus. Empty when the stored number is unreadable. */
  msisdn: string
  /** `+94 77 562 2923` — for reading, never for sending. */
  pretty: string
  /** Who this number belongs to: "Ground manager", "Ops group". Free text. */
  label: string
  /** Why the number cannot be used, when it cannot. */
  reason: string | null
  /** Enabled *and* the number is usable — the only state that actually sends. */
  active: boolean
}

const EMPTY: DriverDocCopyConfig = {
  enabled: false, phone: '', msisdn: '', pretty: '', label: '', reason: null, active: false,
}

/** Read the standing copy contact. Never throws — a settings read must not stop a send. */
export async function readDriverDocCopy(): Promise<DriverDocCopyConfig> {
  let rows: { key: string; value: string }[] = []
  try {
    rows = await prisma.systemSetting.findMany({
      where:  { key: { in: [SETTING_COPY_ENABLED, SETTING_COPY_PHONE, SETTING_COPY_LABEL] } },
      select: { key: true, value: true },
    })
  } catch (err) {
    console.warn('[DriverDocCopy] settings read failed:', err instanceof Error ? err.message : err)
    return EMPTY
  }

  const map = new Map(rows.map(r => [r.key, r.value]))
  return buildConfig(
    map.get(SETTING_COPY_ENABLED) === 'true',
    map.get(SETTING_COPY_PHONE) ?? '',
    map.get(SETTING_COPY_LABEL) ?? '',
  )
}

/** Save it. Returns the config as it now reads, so the screen shows the stored truth. */
export async function saveDriverDocCopy(input: {
  enabled: boolean
  phone: string
  label: string
}): Promise<DriverDocCopyConfig> {
  const phone = input.phone.trim().slice(0, 32)
  const label = input.label.trim().slice(0, 120)

  await prisma.$transaction([
    upsert(SETTING_COPY_ENABLED, input.enabled ? 'true' : 'false'),
    upsert(SETTING_COPY_PHONE, phone),
    upsert(SETTING_COPY_LABEL, label),
  ])

  return buildConfig(input.enabled, phone, label)
}

function upsert(key: string, value: string) {
  return prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

function buildConfig(enabled: boolean, phone: string, label: string): DriverDocCopyConfig {
  if (!phone.trim()) return { ...EMPTY, enabled, label }

  const read = normaliseSriLankanPhone(phone)
  return {
    enabled,
    phone,
    msisdn: read.ok ? read.msisdn : '',
    pretty: read.ok ? read.pretty : '',
    label,
    reason: read.ok ? null : (read.reason ?? 'That number cannot be read as a phone number.'),
    active: enabled && read.ok,
  }
}

/**
 * A copy must never quietly become a second document addressed to the reader.
 *
 * Meta rejects a parameter carrying a newline, a tab or four consecutive spaces
 * and caps the rendered body at 1024 characters, so the whole notice is one
 * flat line and short enough to survive alongside the rest of the template.
 */
export function copyNotice(driverName: string | null, msisdn: string, bookingRef: string): string {
  const who = (driverName ?? '').trim() || 'the driver'
  return `COPY — this document was sent to ${who} on +${msisdn} for booking ${bookingRef}`
}
