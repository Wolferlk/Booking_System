/**
 * B2C movement-chart descriptions = the admin dashboard's product description.
 *
 * The Aahaas admin (admin.aahaas.com → Orders → Product Details) shows each
 * Lifestyle product's `tbl_lifestyle.lifestyle_description`. Ops asked for the
 * movement chart's Details / Timings to read exactly the same, instead of the
 * import's audit line ("Lifestyle · Product: … · Vendor: … · Time: …").
 *
 * That audit line is NOT replaced on the booking: it stays the itinerary row's
 * description, because the agenda code reads it (the transfer chain spots a
 * product by its leading "Lifestyle", a re-added leg takes its time from
 * "Time: HH:MM", and the Update Booking sync compares rows by it). The admin
 * text is only swapped in where a movement's details are written.
 *
 * Pure and client-safe: no DB. The store read lives in
 * `b2c-product-description-server.ts`.
 */

/** `tbl_maincategory.id` for Lifestyle — the only category with a `tbl_lifestyle` row. */
const LIFESTYLE_CATEGORY_ID = 3

/** A runaway description (a visa checklist runs to 4.5k chars) still fits a details box. */
const MAX_DESCRIPTION_CHARS = 6000

// ─── HTML → plain text ────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', deg: '°',
  copy: '©', reg: '®', trade: '™', times: '×', rarr: '→', larr: '←',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', oacute: 'ó', uacute: 'ú', iacute: 'í',
  ntilde: 'ñ', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * "…or special events.Full-day access…" — the admin pastes many bullet lists
 * as one run-on paragraph. The words stay exactly as written; only the missing
 * space after a full stop comes back. Never inside a URL, email or domain
 * ("www.Aahaas.com", "info@Aahaas.com") or an initialism ("U.S.A").
 */
function restoreSentenceSpaces(line: string): string {
  return line.replace(/(\S*?)([a-zß-ÿ)]{2})\.([A-Z][a-z])/g, (whole, head: string, tail: string, next: string) => {
    const token = `${head}${tail}`
    if (/[/@:]|www|https?/i.test(token)) return whole
    return `${token}. ${next}`
  })
}

/** Tags that start and end a paragraph of their own. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'blockquote', 'pre',
  'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'dl', 'dt', 'dd',
])

/** Keeps a nested bullet's indent through the whitespace clean-up below. */
const INDENT = '\u0001'

/**
 * The admin's rich-text description as the plain text it reads as on screen:
 * paragraphs separated by a blank line, `<br>` as a line break, list items as
 * "• …" (nested "◦ …", ordered "1. …"), headings on their own line, entities
 * decoded. Already-plain text comes back trimmed, its own line breaks kept.
 */
export function productDescriptionText(raw: unknown): string {
  let s = String(raw ?? '')
  if (!s.trim()) return ''
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')

  const isHtml = /<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(s)
  let out = ''
  if (!isHtml) {
    out = s
  } else {
    // In HTML a source line break is only a space; the tags decide the breaks.
    s = s.replace(/\s+/g, ' ')
    const lists: { ordered: boolean; n: number }[] = []
    // Breaks never stack: "</li><li>" is one line break, "</p><p>" one blank
    // line. Only an explicit <br> always adds one.
    const ensureBreaks = (n: number) => {
      out = out.replace(/[ \t]+$/, '')
      const have = /\n*$/.exec(out)?.[0].length ?? 0
      if (out && have < n) out += '\n'.repeat(n - have)
    }
    let last = 0
    let freshMarker = false   // a bullet was written and no text has followed yet
    for (const m of Array.from(s.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi))) {
      const chunk = s.slice(last, m.index)
      if (freshMarker) {
        if (chunk.trim()) { out += chunk.trimStart(); freshMarker = false }
      } else {
        out += chunk
      }
      last = (m.index ?? 0) + m[0].length
      const closing = m[1] === '/'
      const tag = m[2].toLowerCase()
      if (tag === 'br') {
        out = out.replace(/[ \t]+$/, '') + '\n'
      } else if (tag === 'ul' || tag === 'ol') {
        if (closing) lists.pop()
        else lists.push({ ordered: tag === 'ol', n: 0 })
        ensureBreaks(1)
      } else if (tag === 'li') {
        ensureBreaks(1)
        if (closing) continue
        const list = lists[lists.length - 1]
        const depth = Math.max(0, lists.length - 1)
        const marker = list?.ordered ? `${++list.n}.` : depth > 0 ? '◦' : '•'
        out += `${INDENT.repeat(depth)}${marker} `
        freshMarker = true
      } else if (tag === 'td' || tag === 'th') {
        if (!closing) out += ' '
      } else if (BLOCK_TAGS.has(tag)) {
        // "<li><p>text</p></li>": the text stays on the bullet's line, and a
        // paragraph inside a list item is a line, not a blank-line block.
        if (!freshMarker) ensureBreaks(lists.length > 0 ? 1 : 2)
      }
      // Inline tags (strong, em, span, a, …) carry no break.
    }
    out += s.slice(last)
  }

  const text = decodeEntities(out)
    .replace(/[�​‌‍﻿]/g, '')   // stray mojibake / zero-width marks
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => restoreSentenceSpaces(line.replace(/[ \t]+/g, ' ').trim()).replace(new RegExp(INDENT, 'g'), '  '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS).replace(/\s+\S*$/, '')} …`
    : text
}

// ─── Itinerary row → store line ───────────────────────────────────────────────

const normKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "(Outbound)" / "(Return)" / "(2 of 3)" — added to twin rows by `distinguishRepeatedRows`. */
const TWIN_SUFFIX_RE = /\s*\((outbound|return|\d+ of \d+)\)\s*$/i

/** The store line fields the index needs (a subset of `B2cOrderProduct`). */
export interface DescribableLine {
  id: number
  category_id: number | null
  product_id: number | null
  product_name: string | null
  service_date: string | null
  line_label?: string | null
}

interface IndexEntry { date: string | null; keys: string[]; description: string }

export interface ProductDescriptionIndex {
  entries: IndexEntry[]
  /** Store order the descriptions were read from — for logs. */
  orderId: number | null
}

export const EMPTY_PRODUCT_DESCRIPTIONS: ProductDescriptionIndex = { entries: [], orderId: null }

/**
 * One entry per Lifestyle line that has an admin description. A line is known
 * by the two titles the importer can give its itinerary row: the storefront's
 * per-line label ("Hotel to Gardens by the Bay – Private Transfer") and the
 * product name.
 */
export function buildProductDescriptionIndex(
  lines: DescribableLine[],
  htmlByLifestyleId: Map<number, string>,
  orderId: number | null = null,
): ProductDescriptionIndex {
  const entries: IndexEntry[] = []
  for (const l of lines) {
    if (Number(l.category_id) !== LIFESTYLE_CATEGORY_ID) continue
    const html = htmlByLifestyleId.get(Number(l.product_id))
    const description = productDescriptionText(html)
    if (!description) continue
    const keys = Array.from(new Set([normKey(l.line_label), normKey(l.product_name)].filter(Boolean)))
    if (keys.length === 0) continue
    entries.push({ date: l.service_date ? String(l.service_date).slice(0, 10) : null, keys, description })
  }
  return { entries, orderId }
}

/**
 * The admin description for one itinerary row, or null when the row is not a
 * Lifestyle line (hotel, flight, chauffeur transport) or cannot be told apart.
 *
 * The description belongs to the product, so two lines of the same product
 * (outbound and return of one transfer) agree whichever is picked. Only when
 * same-titled lines of DIFFERENT products disagree does the date decide, and
 * if it cannot, nothing is returned rather than a guess.
 */
export function productDescriptionFor(
  index: ProductDescriptionIndex,
  row: { title?: string | null; date?: unknown },
): string | null {
  if (index.entries.length === 0) return null
  const key = normKey(String(row.title ?? '').replace(TWIN_SUFFIX_RE, ''))
  if (!key) return null
  const hits = index.entries.filter((e) => e.keys.includes(key))
  if (hits.length === 0) return null
  const distinct = Array.from(new Set(hits.map((h) => h.description)))
  if (distinct.length === 1) return distinct[0]
  const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date ?? '').slice(0, 10)
  const sameDay = Array.from(new Set(hits.filter((h) => h.date === date).map((h) => h.description)))
  return sameDay.length === 1 ? sameDay[0] : null
}

/** The rows with their description swapped for the admin text wherever one is known. */
export function withProductDescriptions<T extends { title?: string | null; date?: unknown; description?: string | null }>(
  rows: T[],
  index: ProductDescriptionIndex,
): T[] {
  if (index.entries.length === 0) return rows
  return rows.map((r) => {
    const admin = productDescriptionFor(index, r)
    return admin ? { ...r, description: admin } : r
  })
}
