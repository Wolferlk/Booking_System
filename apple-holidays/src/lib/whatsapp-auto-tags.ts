/**
 * Reads the automation tag every system sender writes into
 * `whatsapp_messages.senderName` — `[DRIVER] Name`, `[DRIVER-DOCS] Name · by`,
 * `[MOVEMENT:<id>] Driver · Name`, `[DAILY-BRIEFING] Guest`, `QC1 Auto-Send` …
 * Desk sends carry the staff member's plain name, so "has a tag" is the line
 * between an automatic send and a person typing.
 *
 * Pure (no Prisma) — the inbox API and the inbox page both use it.
 */

/** Tags that are a person typing, relayed — not an automatic send. */
const MANUAL_TAGS = new Set(['GROUP-CHAT'])

export interface AutoTag {
  /** Short label: DRIVER, DRIVER-DOCS, MOVEMENT, DAILY-BRIEFING, QC1 … */
  tag: string
  /** The message went to a driver (not a guest, agent or the ops copy). */
  driver: boolean
  /** Driver / recipient name parsed from the tag, when it carries one. */
  name: string | null
}

export function parseAutoTag(senderName: string | null | undefined, direction?: string): AutoTag | null {
  if (direction && direction !== 'outbound') return null
  const s = (senderName ?? '').trim()
  if (!s) return null

  const qc = /^(QC\d)\s+Auto-Send\b/i.exec(s)
  if (qc) return { tag: qc[1].toUpperCase(), driver: false, name: null }

  // `[MOVEMENT:<itemId>] Driver · Name`
  const mv = /^\[MOVEMENT:[^\]]*\]\s*(.*)$/.exec(s)
  if (mv) {
    const [role, ...rest] = mv[1].split(' · ')
    const isDriver = /^driver$/i.test(role.trim())
    return { tag: 'MOVEMENT', driver: isDriver, name: rest.join(' · ').trim() || null }
  }

  const m = /^\[([A-Z0-9-]+)(?::[^\]]*)?\]\s*(.*)$/.exec(s)
  if (!m) return null
  const tag = m[1]
  if (MANUAL_TAGS.has(tag)) return null
  let rest = m[2].trim()

  // `[DRIVER-DOCS] Copy Name` is the shadow copy to the standing ops number.
  const isCopy = /^Copy\b/.test(rest)
  if (isCopy) rest = rest.replace(/^Copy\s*/, '')
  // `[DRIVER-DOCS] Name · sent-by` — keep the recipient only.
  const name = rest.split(' · ')[0].trim() || null

  const driver = tag.startsWith('DRIVER') && !isCopy
  return { tag, driver, name: name && !/^\+?\d[\d\s]+$/.test(name) ? name : null }
}

/** Rows that carry a file — the document/photo the send attached. */
export function hasFile(m: { mediaUrl?: string | null; mediaType?: string | null }): boolean {
  return !!m.mediaUrl
}
