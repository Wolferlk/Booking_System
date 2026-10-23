/**
 * Super Partners — the agents whose guests see AppleHolidays branding in the
 * customer daily WhatsApp ("🌴 AppleHolidays — Your Day Plan" header and the
 * "— AppleHolidays Team" sign-off). Every other agent's guests get the same
 * message white-labelled, since those guests booked through the agent and
 * may never have heard of AppleHolidays.
 *
 * Stored as a JSON array of match keys in one system_settings row, so no
 * table changes are needed. A missing row means the defaults below; an empty
 * array means nobody is a super partner. No prisma import here: the settings
 * card uses the same matcher to preview which agents are covered.
 */

export const SETTING_SUPER_PARTNERS = 'customer_msg_super_partners'

/** "MakeMyTrip" also covers "Make My Trip", "MakeMyTrip (India) Pvt Ltd" and "makemytrip.com". */
export const DEFAULT_SUPER_PARTNERS = ['MMT', 'MakeMyTrip']

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Stored value → list of match keys. Accepts a JSON array or a comma/newline list. */
export function parseSuperPartners(raw: string | null | undefined): string[] {
  if (raw == null) return [...DEFAULT_SUPER_PARTNERS]
  let items: unknown[] = []
  try {
    const parsed = JSON.parse(raw)
    items = Array.isArray(parsed) ? parsed : []
  } catch {
    items = raw.split(/[,\n]/)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!key || seen.has(compact(key)) || !compact(key)) continue
    seen.add(compact(key))
    out.push(key)
  }
  return out
}

/**
 * True when the booking's agent matches one of the keys, ignoring case, spaces
 * and punctuation. Short keys (4 characters or fewer, like "MMT") must match a
 * whole word, so they don't fire inside an unrelated agent's name.
 */
export function isSuperPartner(agent: string | null | undefined, keys: string[]): boolean {
  if (!agent?.trim()) return false
  const words = agent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const whole = compact(agent)
  return keys.some(k => {
    const key = compact(k)
    if (!key) return false
    return key.length <= 4 ? words.includes(key) : whole.includes(key)
  })
}
