/**
 * Customer-facing brand switch — "white-label mode".
 *
 * Guests often book through a store or an agent and have never heard of
 * Apple Holidays; seeing the name on a WhatsApp, a mail or a PDF confuses them
 * ("who is this?"). This module decides, per channel and per audience, whether
 * the name goes out, and rewrites text so it still reads naturally without it:
 *
 *   "Greetings from Apple Holidays! 🌟"          → "Greetings from Your Travel Team! 🌟"
 *   "Thank you for travelling with AppleHolidays" → "Thank you for travelling with us"
 *   "*AppleHolidays — Your Day Plan*"             → "*Your Day Plan*"
 *   "— AppleHolidays Operations"                  → "— Your Travel Team"
 *   "Apple Holidays  ·  Ref: VN43206"             → "Ref: VN43206"
 *
 * URLs, e-mail addresses and domains are never touched — a link that still
 * says appleholidays.com must keep working.
 *
 * Pure: no DB, no network, safe in client components (the settings card uses
 * it for its live preview). The server reader lives in customer-branding-server.ts.
 */

export const CUSTOMER_BRANDING_KEY = 'customer_branding'

export type BrandChannel = 'whatsapp' | 'email' | 'pdf' | 'word'

/**
 * Who is reading.
 *  - guest:    the traveller — always follows the channel switch.
 *  - agent:    a travel agent / B2B partner — follows the switch only when
 *              "also hide from agents" is on (agents usually know us).
 *  - superPartnerGuest: a guest of a Super Partner agent (MMT by default) —
 *              follows the switch unless "Super Partner guests keep the name" is on.
 *  - internal: staff, drivers, vendors, approvers, OTP codes — never rewritten.
 */
export type BrandAudience = 'guest' | 'superPartnerGuest' | 'agent' | 'internal'

export interface CustomerBrandingPolicy {
  /** true = the name is REMOVED from that channel. */
  hide: Record<BrandChannel, boolean>
  /** Apply the same switches to travel agents, not only guests. */
  includeAgents: boolean
  /** What customers see where the name used to be ("Greetings from …"). */
  replacement: string
  /**
   * Guests of Super Partner agents (Settings → Customer Daily Trip Details)
   * still get the AppleHolidays-branded daily plan. Off by default: the
   * switches win unless someone asks for the exception.
   */
  superPartnersKeepName: boolean
}

export const BRAND_CHANNELS: BrandChannel[] = ['whatsapp', 'email', 'pdf', 'word']

export const DEFAULT_REPLACEMENT = 'Your Travel Team'

export const DEFAULT_CUSTOMER_BRANDING: CustomerBrandingPolicy = {
  hide: { whatsapp: true, email: true, pdf: true, word: true },
  includeAgents: false,
  replacement: DEFAULT_REPLACEMENT,
  superPartnersKeepName: false,
}

export function parseCustomerBranding(raw: string | null | undefined): CustomerBrandingPolicy {
  const d = DEFAULT_CUSTOMER_BRANDING
  if (!raw) return { ...d, hide: { ...d.hide } }
  try {
    const j = JSON.parse(raw) as Partial<CustomerBrandingPolicy>
    const h = (j.hide ?? {}) as Partial<Record<BrandChannel, unknown>>
    const pick = (c: BrandChannel) => (typeof h[c] === 'boolean' ? (h[c] as boolean) : d.hide[c])
    const replacement = typeof j.replacement === 'string' ? j.replacement.trim().slice(0, 60) : d.replacement
    return {
      hide: { whatsapp: pick('whatsapp'), email: pick('email'), pdf: pick('pdf'), word: pick('word') },
      includeAgents: typeof j.includeAgents === 'boolean' ? j.includeAgents : d.includeAgents,
      replacement: replacement || d.replacement,
      superPartnersKeepName: typeof j.superPartnersKeepName === 'boolean' ? j.superPartnersKeepName : d.superPartnersKeepName,
    }
  } catch {
    return { ...d, hide: { ...d.hide } }
  }
}

export function serialiseCustomerBranding(p: CustomerBrandingPolicy): string {
  return JSON.stringify({
    hide: p.hide, includeAgents: p.includeAgents, replacement: p.replacement.trim(), superPartnersKeepName: p.superPartnersKeepName,
  })
}

/** Should the name be removed for this channel + reader? */
export function shouldHideBrand(p: CustomerBrandingPolicy, channel: BrandChannel, audience: BrandAudience): boolean {
  if (audience === 'internal') return false
  if (audience === 'agent' && !p.includeAgents) return false
  if (audience === 'superPartnerGuest' && p.superPartnersKeepName) return false
  return Boolean(p.hide[channel])
}

/* ── Text rewriting ──────────────────────────────────────────────────────── */

// "Apple Holidays", "AppleHolidays", "Apple-Holidays", "apple_holiday", optional "MMT".
// Not preceded by a word char, @ . / (so domains and addresses are skipped).
const B = String.raw`(?<![\w@./-])apple[ \t\-_]*holidays?(?:[ \t]+MMT)?(?![\w@])`
const re = (src: string, flags = 'gi') => new RegExp(src, flags)

/** Segments that must survive verbatim: links, addresses, bare domains. */
const PROTECTED = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[\w-]+\.(?:com|lk|net|org|vn|sg|my|io|co)(?:\/[^\s<>"']*)?)/gi

function rewrite(s: string, name: string): string {
  if (!/apple/i.test(s)) return s
  let t = s
  // Sign-offs that name the team: "— AppleHolidays Operations", "AppleHolidays Team"
  t = t.replace(re(String.raw`${B}[ \t]+(?:Operations[ \t]+Team|Operations|Ops[ \t]+Team|Team)\b`), name)
  // "Apple Holidays Booking System — Confidential" → "Booking System — Confidential"
  t = t.replace(re(String.raw`${B}[ \t]+(?=Booking System\b)`), '')
  // "travelling with / booking with / choosing Apple Holidays" → "… us"
  t = t.replace(re(String.raw`\b(with|choosing)[ \t]+(?:the[ \t]+)?${B}`), '$1 us')
  // Possessive: "Apple Holidays' team", "AppleHolidays's" → "our"
  t = t.replace(re(String.raw`${B}['’]s?(?=\s)`), 'our')
  // Header prefix "AppleHolidays — Your Day Plan" → "Your Day Plan"
  t = t.replace(re(String.raw`${B}[ \t]*[—–|][ \t]*`), '')
  // Footer lead-in "Apple Holidays  ·  Ref: X" → "Ref: X"
  t = t.replace(re(String.raw`${B}[ \t]*(?:[·•]|&middot;|&#183;)[ \t]*`), '')
  // Trailing "Ref X · Apple Holidays" / "Plan — Apple Holidays" (not a bare sign-off line)
  t = t.replace(re(String.raw`(\S)[ \t]*[·•—–|][ \t]*${B}(?=[ \t]*(?:\*|$))`, 'gim'), '$1')
  // Everything else: the chosen name ("Greetings from Apple Holidays!")
  t = t.replace(re(B), name)
  // Tidy what the removals left behind, without touching line breaks.
  return t
    .replace(/[ \t]{2,}/g, m => (m.includes('\t') ? m : ' '))
    .replace(/[ \t]+([!?.,;:])(?=\s|$)/g, '$1')
    .replace(/\*\s*\*/g, '')
}

/** Rewrite plain text (WhatsApp, subjects, PDF strings). */
export function debrandText(text: string, replacement = DEFAULT_REPLACEMENT): string {
  if (!text || !/apple/i.test(text)) return text
  const name = replacement.trim() || DEFAULT_REPLACEMENT
  return text
    .split(PROTECTED)
    .map((part, i) => (i % 2 === 1 ? part : rewrite(part, name)))
    .join('')
}

/**
 * Rewrite HTML: only text between tags and the human-readable attributes
 * (alt, title). href/src and everything inside <style>/<script> are left alone.
 * The Apple mark is dropped too, so the logo can't give the name away.
 */
export function debrandHtml(html: string, replacement = DEFAULT_REPLACEMENT): string {
  if (!html || !/apple/i.test(html)) return html
  const out: string[] = []
  let raw = false // inside <style>/<script>
  for (const part of html.split(/(<[^>]*>)/g)) {
    if (part.startsWith('<')) {
      if (/^<(style|script)\b/i.test(part)) raw = true
      else if (/^<\/(style|script)\b/i.test(part)) raw = false
      if (/^<img\b/i.test(part) && /apple[-_]?logo/i.test(part)) continue
      out.push(part.replace(/\b(alt|title)=(["'])(.*?)\2/gi, (_m, a, q, v) => `${a}=${q}${debrandText(v, replacement)}${q}`))
    } else {
      out.push(raw ? part : debrandText(part, replacement))
    }
  }
  return out.join('')
}

/** "AppleHolidays_Agenda_VN43206.pdf" → "Agenda_VN43206.pdf" */
export function debrandFilename(name: string): string {
  if (!name || !/apple/i.test(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const cleaned = stem
    .replace(/apple[\s\-_]*holidays?(?:[\s\-_]*MMT)?/gi, '')
    .replace(/[\s\-_]{2,}/g, m => m[0])
    .replace(/^[\s\-_.]+|[\s\-_.]+$/g, '')
  return (cleaned || 'Document') + ext
}

/** What a sender holds: whether to rewrite, and the rewriters bound to the policy. */
export interface BrandGuard {
  hidden: boolean
  /** The name customers see instead (also used for document headers). */
  name: string
  text: (s: string) => string
  html: (s: string) => string
  file: (s: string) => string
}

export function makeBrandGuard(p: CustomerBrandingPolicy, channel: BrandChannel, audience: BrandAudience): BrandGuard {
  const hidden = shouldHideBrand(p, channel, audience)
  const name = p.replacement.trim() || DEFAULT_REPLACEMENT
  if (!hidden) {
    const same = (s: string) => s
    return { hidden, name: 'Apple Holidays', text: same, html: same, file: same }
  }
  return {
    hidden,
    name,
    text: s => debrandText(s, name),
    html: s => debrandHtml(s, name),
    file: s => debrandFilename(s),
  }
}

/** Guard that never rewrites — for tests and fallbacks. */
export const PASSTHROUGH_GUARD: BrandGuard = makeBrandGuard(
  { ...DEFAULT_CUSTOMER_BRANDING, hide: { whatsapp: false, email: false, pdf: false, word: false } },
  'whatsapp',
  'guest',
)
