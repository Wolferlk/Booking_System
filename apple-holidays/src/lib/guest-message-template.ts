/**
 * Any text message to a guest, delivered as a TEMPLATE when their 24h window is shut.
 *
 * WhatsApp only delivers free-form text inside the 24h customer-service window.
 * Outside it Meta answers 200 and drops the message. The mini-chat used to send
 * a reply-request template instead and QUEUE the desk's text until the guest
 * answered; a guest who never answers never got their day plan.
 *
 * `apple_holidays_guest_message` carries the desk's own text as {{3}}, so it
 * lands cold, right away. Two Meta rules shape what the guest sees:
 *
 *   • A parameter may not contain a newline, a tab or 4+ consecutive spaces.
 *     Lines are joined with " · " and paragraphs with " ▪ ", so a day plan
 *     reads as one tidy block instead of being rejected (error 132018).
 *   • The rendered body is capped at 1024 characters (error 132005). A longer
 *     message goes out as "part 1 of 2", "part 2 of 2"… split on line breaks,
 *     never mid-line unless a single line is itself too long.
 *
 * The body carries no brand: the daily plan is white-labelled for guests of
 * agents who are not Super Partners (lib/super-partners.ts), and so is this.
 *
 * Nothing changes until the template is approved. Every caller falls back to
 * what it did before when this throws GuestTemplateUnavailableError.
 * Register it once from Settings → Customer Daily Trip Details, or
 * POST /api/whatsapp/templates/bootstrap-guest.
 */
import { listMetaTemplates, normalisePhone, sendViaMetaTemplate } from '@/lib/whatsapp'

// ── Template ─────────────────────────────────────────────────────────────────

export const TEMPLATE_GUEST_MESSAGE =
  process.env.WHATSAPP_GUEST_MESSAGE_TEMPLATE?.trim() || 'apple_holidays_guest_message'

export const GUEST_MESSAGE_TEMPLATE_LANG =
  process.env.WHATSAPP_GUEST_MESSAGE_TEMPLATE_LANG?.trim() || 'en'

/** The exact body registered with Meta — also used to render what the guest saw. */
export const GUEST_MESSAGE_BODY =
  'Hello {{1}}, here is an update about your trip (booking {{2}}):\n\n' +
  '{{3}}\n\n' +
  'If you have any questions, simply reply to this message and our team will be happy to help.'

/** Example values Meta reviews the template against. */
export const GUEST_MESSAGE_EXAMPLES = [
  'Mr. Sanjay',
  'VN41510',
  '🌴 *Your Day Plan* ▪ Good day dear *Sanjay*! Here is your plan for *Sat, 12 Sep 2026*: ▪ ' +
    '*Hotel → Noi Bai Airport* · ⏰ Pick-up: *07:00* · 🚐 Private transfer · 🚗 Driver: *Minh* (+84 90 123 4567) ▪ ' +
    'Have a wonderful day 💙',
]

/** Meta caps the rendered template body at 1024 characters. */
const BODY_LIMIT = 1024
/** More parts than this and the desk should shorten the message instead. */
const MAX_PARTS = 4

const LINE_SEP = ' · '
const PARA_SEP = ' ▪ '

// ── Rendering ────────────────────────────────────────────────────────────────

/** Fill {{1}}…{{n}} locally, for the chat log and previews. */
export function renderGuestMessage(params: string[]): string {
  return GUEST_MESSAGE_BODY.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

/** One-line, Meta-safe value: no newlines/tabs, no runs of spaces. */
function oneLine(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Each non-blank line, with the separator that will precede it once flattened. */
function segments(text: string): { sep: string; text: string }[] {
  const out: { sep: string; text: string }[] = []
  let newParagraph = false
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Leading indentation and a "•" / "-" bullet mean nothing on one line.
    const line = oneLine(raw.replace(/^\s*(?:[•\-–]\s+)?/, ''))
    if (!line) { newParagraph = out.length > 0; continue }
    out.push({ sep: out.length === 0 ? '' : newParagraph ? PARA_SEP : LINE_SEP, text: line })
    newParagraph = false
  }
  return out
}

/** Cut at the last space before `max`, without splitting an emoji's surrogate pair. */
function cutPoint(s: string, max: number): number {
  let cut = s.lastIndexOf(' ', max)
  if (cut < max * 0.5) {
    cut = max
    const code = s.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  }
  return cut
}

/** Pack the lines into chunks of at most `room` characters, breaking between lines. */
function chunk(text: string, room: number): string[] {
  const chunks: string[] = []
  let cur = ''
  for (const s of segments(text)) {
    const piece = cur ? s.sep + s.text : s.text
    if (cur.length + piece.length <= room) { cur += piece; continue }
    if (cur) chunks.push(cur)
    let rest = s.text
    while (rest.length > room) {
      const cut = cutPoint(rest, room)
      chunks.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(cut).trimStart()
    }
    cur = rest
  }
  if (cur) chunks.push(cur)
  return chunks
}

export interface GuestMessagePlan {
  /** The {{1}}..{{3}} values for each part, in send order. */
  params: string[][]
  /** What the guest sees, part by part. */
  rendered: string[]
}

/** Split and render a message without sending it — the send and any preview share this. */
export function planGuestMessage(p: { guestName: string; bookingRef: string; text: string }): GuestMessagePlan {
  const name = oneLine(p.guestName).slice(0, 60) || 'Guest'
  const ref  = oneLine(p.bookingRef).slice(0, 40) || '-'
  // Budget for the longest label any part can carry, so every part fits.
  const fixed = renderGuestMessage([name, `${ref} · part 9 of 9`, '']).length
  const room  = BODY_LIMIT - fixed - 8

  const chunks = chunk(p.text, room)
  if (chunks.length === 0) throw new Error('A message is required')
  if (chunks.length > MAX_PARTS) {
    throw new Error(
      `This message is too long for a WhatsApp template (${chunks.length} parts, the limit is ${MAX_PARTS}). ` +
      `Shorten it to about ${room * MAX_PARTS} characters, or wait for the guest to reply.`,
    )
  }
  const params = chunks.map((c, i) => [
    name,
    chunks.length > 1 ? `${ref} · part ${i + 1} of ${chunks.length}` : ref,
    c,
  ])
  return { params, rendered: params.map(renderGuestMessage) }
}

// ── Availability ─────────────────────────────────────────────────────────────

/** The template is missing, unapproved or WhatsApp is not configured — use the old path. */
export class GuestTemplateUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuestTemplateUnavailableError'
  }
}

/**
 * After a "not approved" answer, skip the template for a while: the daily-plan
 * cron would otherwise ask Meta once per guest per run and fail every time.
 */
let unavailableUntil = 0
const UNAVAILABLE_TTL_MS = 10 * 60_000

/** Forget a cached "not approved" — called after the template is (re)registered. */
export function resetGuestTemplateAvailability(): void {
  unavailableUntil = 0
}

export interface GuestTemplateStatus {
  name: string
  language: string
  status: string
  /** Set when the approved template's variable count is not the 3 this code sends. */
  mismatch?: string
  error?: string
}

/** Current status on Meta, for the settings card. Never throws. */
export async function guestTemplateStatus(): Promise<GuestTemplateStatus> {
  const base = { name: TEMPLATE_GUEST_MESSAGE, language: GUEST_MESSAGE_TEMPLATE_LANG }
  try {
    const all  = await listMetaTemplates('ALL')
    const same = all.filter(t => t.name === TEMPLATE_GUEST_MESSAGE)
    const t    = same.find(x => x.language === GUEST_MESSAGE_TEMPLATE_LANG) ?? same[0]
    if (!t) return { ...base, status: 'MISSING' }
    return {
      ...base,
      status: t.status,
      ...(t.bodyVariableCount !== 3 ? { mismatch: `has ${t.bodyVariableCount} body variables, expected 3` } : {}),
    }
  } catch (err) {
    return { ...base, status: 'UNKNOWN', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface GuestTemplateSend {
  phone: string
  /** Parts that reached Meta, with what the guest sees and the message id. */
  sent: { text: string; waMessageId: string | null }[]
  /**
   * Parts after a mid-sequence failure, flattened. The guest already has the
   * first part, so callers queue this for their reply rather than dropping it.
   */
  unsent: string | null
}

/**
 * Send `text` to a guest through the guest-message template, split into parts
 * when it is long. Throws GuestTemplateUnavailableError when the template cannot
 * be used at all (callers fall back), or an Error when Meta refuses the first part.
 */
export async function sendGuestMessageTemplate(p: {
  to: string
  guestName: string
  bookingRef: string
  text: string
}): Promise<GuestTemplateSend> {
  const phone = normalisePhone(p.to)
  if (!phone) throw new Error('Phone number is required')
  if (Date.now() < unavailableUntil) {
    throw new GuestTemplateUnavailableError(`WhatsApp template "${TEMPLATE_GUEST_MESSAGE}" is not approved yet`)
  }

  const plan = planGuestMessage(p)
  const sent: GuestTemplateSend['sent'] = []

  for (let i = 0; i < plan.params.length; i++) {
    try {
      const result = await sendViaMetaTemplate({
        to:           phone,
        templateName: TEMPLATE_GUEST_MESSAGE,
        lang:         GUEST_MESSAGE_TEMPLATE_LANG,
        bodyParams:   plan.params[i],
      })
      if (!result) {
        throw new GuestTemplateUnavailableError('WhatsApp Meta credentials are not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)')
      }
      sent.push({
        text:        plan.rendered[i],
        waMessageId: (result.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const notApproved = err instanceof GuestTemplateUnavailableError ||
        /132001|template name does not exist|does not exist in .*(translation|locale)/i.test(msg)
      if (i === 0) {
        if (notApproved) {
          unavailableUntil = Date.now() + UNAVAILABLE_TTL_MS
          throw new GuestTemplateUnavailableError(
            `WhatsApp template "${TEMPLATE_GUEST_MESSAGE}" (${GUEST_MESSAGE_TEMPLATE_LANG}) is not approved on this account — ${msg}`,
          )
        }
        throw err
      }
      console.error(`[GuestTemplate] part ${i + 1}/${plan.params.length} to ${phone} failed:`, msg)
      return { phone, sent, unsent: plan.params.slice(i).map(x => x[2]).join(PARA_SEP) }
    }
  }
  return { phone, sent, unsent: null }
}
