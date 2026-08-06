/**
 * Field extraction for the Query Monitor.
 *
 * Sales queries arrive as free prose — "SRILANKA FIT TOUR 05th FEB 2026 TO 10th
 * FEB 2026", "inq \\ 06 pax \\ 07N08D \\05.02.2026", "Urgent Quote for Ms.
 * Gandhi". Deterministic regex handles the common shapes for free; GPT is only
 * asked about the mails the regex could not read, and only when the AI switch is
 * on. Rule output always wins over AI output for a field the rules resolved.
 */
import openai, { logAiUsage } from '@/lib/openai'

export interface ExtractedFields {
  destination:    string | null
  travelDate:     Date | null
  travelDateText: string | null
  cntl:           string | null
  region:         string | null
  isUrgent:       boolean
  source:         'RULE' | 'AI'
  confidence:     number | null
}

// ── Destination vocabulary ───────────────────────────────────────────────────

/**
 * Canonical destination → the spellings seen in real subject lines. The
 * canonical form is what lands in the sheet, so the team's pivot on that column
 * keeps grouping correctly no matter how the agent spelled it.
 */
const DESTINATIONS: { canonical: string; aliases: string[] }[] = [
  { canonical: 'Sri Lanka',  aliases: ['sri lanka', 'srilanka', 'sri-lanka', 'srilankan', 'ceylon', 'colombo', 'kandy', 'ella', 'galle', 'bentota', 'sigiriya', 'nuwara eliya'] },
  { canonical: 'Maldives',   aliases: ['maldives', 'maldive', 'male atoll'] },
  { canonical: 'Vietnam',    aliases: ['vietnam', 'viet nam', 'hanoi', 'ho chi minh', 'da nang', 'danang', 'halong', 'ha long', 'phu quoc'] },
  { canonical: 'Thailand',   aliases: ['thailand', 'bangkok', 'phuket', 'krabi', 'pattaya', 'chiang mai'] },
  { canonical: 'Singapore',  aliases: ['singapore', 'sentosa'] },
  { canonical: 'Malaysia',   aliases: ['malaysia', 'kuala lumpur', 'langkawi', 'penang'] },
  { canonical: 'Bali',       aliases: ['bali', 'indonesia', 'ubud', 'denpasar'] },
  { canonical: 'Dubai',      aliases: ['dubai', 'uae', 'abu dhabi'] },
  { canonical: 'Bhutan',     aliases: ['bhutan', 'thimphu', 'paro'] },
  { canonical: 'Nepal',      aliases: ['nepal', 'kathmandu', 'pokhara'] },
  { canonical: 'Mauritius',  aliases: ['mauritius'] },
  { canonical: 'Seychelles', aliases: ['seychelles'] },
  { canonical: 'Azerbaijan', aliases: ['azerbaijan', 'baku'] },
  { canonical: 'Georgia',    aliases: ['georgia', 'tbilisi'] },
  { canonical: 'Turkey',     aliases: ['turkey', 'istanbul', 'cappadocia'] },
  { canonical: 'Egypt',      aliases: ['egypt', 'cairo'] },
  { canonical: 'Kazakhstan', aliases: ['kazakhstan', 'almaty'] },
]

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
}

const URGENT_MARKERS = ['urgent', 'asap', 'immediate', 'today itself', 'high priority', 'rush']

// ── Deterministic passes ─────────────────────────────────────────────────────

export function extractDestination(text: string): string | null {
  const haystack = text.toLowerCase()
  let best: { canonical: string; index: number } | null = null

  for (const dest of DESTINATIONS) {
    for (const alias of dest.aliases) {
      const index = haystack.indexOf(alias)
      if (index === -1) continue
      // Earliest mention wins — subjects lead with the destination.
      if (!best || index < best.index) best = { canonical: dest.canonical, index }
    }
  }
  return best?.canonical ?? null
}

/**
 * Travel date out of the subject/body. Only future-ish dates are accepted: a
 * query mentioning "2024" is quoting history, not asking to travel then.
 */
export function extractTravelDate(text: string, receivedAt: Date): { date: Date | null; raw: string | null } {
  const candidates: { date: Date; raw: string }[] = []
  const push = (y: number, m: number, d: number, raw: string) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return
    const date = new Date(Date.UTC(y, m, d))
    if (Number.isNaN(date.getTime())) return
    candidates.push({ date, raw })
  }

  const currentYear = receivedAt.getUTCFullYear()
  const normaliseYear = (raw: string | undefined): number => {
    if (!raw) return currentYear
    const n = Number(raw)
    return n < 100 ? 2000 + n : n
  }

  // 05.02.2026 · 05/02/2026 · 5-2-26   (day first — the agents are Indian/Sri Lankan)
  for (const m of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g)) {
    push(normaliseYear(m[3]), Number(m[2]) - 1, Number(m[1]), m[0])
  }

  // 05th FEB 2026 · 5 February 2026 · 22/Jan/2026
  // (?!\d) stops the day group from biting the first digits of a 4-digit year.
  for (const m of text.matchAll(/\b(\d{1,2})(?!\d)\s*(?:st|nd|rd|th)?[\s/-]*([a-z]{3,9})[\s/-]*(\d{2,4})?\b/gi)) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month === undefined) continue
    push(normaliseYear(m[3]), month, Number(m[1]), m[0])
  }

  // FEB 05 2026 · March 14
  // Without (?!\d), "Jan/2026" reads as day 20 of January — an earlier date than
  // the real one, which then wins the "earliest plausible" pick.
  for (const m of text.matchAll(/\b([a-z]{3,9})[\s/-]+(\d{1,2})(?!\d)\s*(?:st|nd|rd|th)?[\s,/-]*(\d{2,4})?\b/gi)) {
    const month = MONTHS[m[1].toLowerCase()]
    if (month === undefined) continue
    push(normaliseYear(m[3]), month, Number(m[2]), m[0])
  }

  if (candidates.length === 0) return { date: null, raw: null }

  // A travel date is in the future, or at most a few days behind (mail sent the
  // morning of a same-day request). Take the earliest such date mentioned.
  const floor = receivedAt.getTime() - 3 * 86_400_000
  const ceiling = receivedAt.getTime() + 550 * 86_400_000
  const plausible = candidates
    .filter(c => c.date.getTime() >= floor && c.date.getTime() <= ceiling)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const chosen = plausible[0]
  return chosen ? { date: chosen.date, raw: chosen.raw } : { date: null, raw: null }
}

export function extractCntl(text: string): string | null {
  const labelled = text.match(/\bCNTL\s*[:#-]?\s*(\d{4,12})\b/i)
             ?? text.match(/\b(\d{4,12})\s*CNTL\b/i)
  if (labelled?.[1]) return labelled[1]

  const crm = text.match(/\b(?:crm\s*id|reference|ref|booking\s*id)\s*[:#-]?\s*(\d{6,20})\b/i)
  return crm?.[1] ?? null
}

export function detectUrgent(text: string): boolean {
  const lower = text.toLowerCase()
  return URGENT_MARKERS.some(marker => lower.includes(marker))
}

/**
 * "Region" in this sheet means the agent's home city (Mangalore, Ahmedabad) —
 * only meaningful when the mail says so outright, so nothing is guessed here.
 */
export function extractRegion(text: string): string | null {
  const m = text.match(/\b(?:region|city|branch|location)\s*[:-]\s*([A-Za-z][A-Za-z\s]{2,25})\b/i)
  return m?.[1]?.trim() ?? null
}

/** The free pass: everything the regexes can see, with no network calls. */
export function extractByRules(subject: string, body: string, receivedAt: Date): ExtractedFields {
  // The subject carries the signal; the body's opening lines add context but its
  // tail is signatures and quoted threads, which produce false date matches.
  const head = `${subject}\n${body.slice(0, 1500)}`
  const travel = extractTravelDate(head, receivedAt)

  return {
    destination:    extractDestination(head),
    travelDate:     travel.date,
    travelDateText: travel.raw,
    cntl:           extractCntl(head),
    region:         extractRegion(head),
    isUrgent:       detectUrgent(subject),
    source:         'RULE',
    confidence:     null,
  }
}

// ── AI pass ──────────────────────────────────────────────────────────────────

interface AiExtraction {
  destination?: string | null
  travelDate?:  string | null
  region?:      string | null
  isUrgent?:    boolean
  confidence?:  number
}

/**
 * Ask GPT only about the fields the rules left empty. Returns null on any
 * failure — a monitoring sweep must never fail because the AI hiccupped.
 */
export async function extractWithAi(
  subject: string, body: string, receivedAt: Date, missing: ('destination' | 'travelDate')[],
): Promise<{ fields: Partial<ExtractedFields>; ok: boolean }> {
  if (missing.length === 0) return { fields: {}, ok: false }

  const prompt = `You are reading an inbound B2B travel-agent enquiry sent to a Sri Lankan DMC.
Today's reference date is ${receivedAt.toISOString().slice(0, 10)}.

Return JSON with exactly these keys:
  "destination" — the country or main destination being asked about, in Title Case (e.g. "Sri Lanka", "Maldives", "Vietnam"). null if the mail names none.
  "travelDate"  — the START date of travel as "YYYY-MM-DD". Not the date the mail was sent, not a hotel check-out. null if absent.
  "region"      — the agent's city/branch if explicitly stated, else null.
  "isUrgent"    — true only if the sender asks for an urgent/immediate/ASAP response.
  "confidence"  — your confidence 0-1 in the destination and travel date.

SUBJECT: ${subject}

BODY:
${body.slice(0, 3000)}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 300,
    })

    await logAiUsage({
      callType: 'query_monitor_extraction',
      model:    'gpt-4o-mini',
      usage:    response.usage,
      source:   'query-monitor',
    })

    const content = response.choices[0]?.message?.content
    if (!content) return { fields: {}, ok: false }

    const parsed = JSON.parse(content) as AiExtraction
    const fields: Partial<ExtractedFields> = { source: 'AI', confidence: parsed.confidence ?? null }

    if (missing.includes('destination') && parsed.destination) {
      fields.destination = String(parsed.destination).trim().slice(0, 80)
    }
    if (missing.includes('travelDate') && parsed.travelDate) {
      const date = new Date(`${parsed.travelDate}T00:00:00Z`)
      if (!Number.isNaN(date.getTime())) {
        fields.travelDate     = date
        fields.travelDateText = parsed.travelDate
      }
    }
    if (parsed.region)   fields.region   = String(parsed.region).trim().slice(0, 60)
    if (parsed.isUrgent) fields.isUrgent = true

    return { fields, ok: true }
  } catch (err) {
    console.error('[QueryMonitor] AI extraction failed:', err instanceof Error ? err.message : err)
    return { fields: {}, ok: false }
  }
}
