/**
 * Shared WhatsApp sending utility — used for both customer messages and driver notifications.
 * Uses Meta Graph API or the internal notify proxy, whichever is configured.
 */

const WHATSAPP_API     = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'
const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

function getMetaCreds() {
  return {
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
  }
}

/** Normalise a phone number to E.164 (strip leading + and spaces). */
export function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^\+/, '').replace(/[^0-9]/g, '')
}

/**
 * Send a plain-text WhatsApp message via Meta or the notify proxy.
 * Returns true on success, false on failure (never throws).
 */
export async function sendWhatsAppText(
  to: string,
  message: string,
  recipientName?: string,
): Promise<boolean> {
  const phone = normalisePhone(to)
  if (!phone) return false

  // Try Meta API first
  const { accessToken, phoneNumberId } = getMetaCreds()
  if (accessToken && phoneNumberId) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to:   phone,
            type: 'text',
            text: { body: message },
          }),
        },
      )
      if (res.ok) return true
      const err = await res.text()
      console.error(`[WhatsApp] Meta send failed for ${phone}: ${err.slice(0, 200)}`)
    } catch (e) {
      console.error('[WhatsApp] Meta API error:', e)
    }
  }

  // Fallback: notify proxy
  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET?.trim()
  if (notifySecret) {
    try {
      const res = await fetch(WHATSAPP_API, {
        method: 'POST',
        headers: { 'x-notify-secret': notifySecret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, name: recipientName, message }),
      })
      if (res.ok) return true
      const err = await res.text()
      console.error(`[WhatsApp] Proxy send failed for ${phone}: ${err.slice(0, 200)}`)
    } catch (e) {
      console.error('[WhatsApp] Proxy error:', e)
    }
  }

  return false
}

/**
 * Send a media WhatsApp message (image or document) by public link via the Meta Graph API.
 * `mediaUrl` must be an absolute, publicly-fetchable HTTPS URL (Meta pulls it server-side).
 * Returns true on success, false otherwise (never throws). Media is Meta-only — the notify
 * proxy is text-only, so this is skipped when Meta creds are absent.
 */
export async function sendWhatsAppMedia(
  to: string,
  mediaUrl: string,
  kind: 'image' | 'document',
  opts: { caption?: string; filename?: string } = {},
): Promise<boolean> {
  const phone = normalisePhone(to)
  if (!phone || !/^https:\/\//i.test(mediaUrl)) return false

  const { accessToken, phoneNumberId } = getMetaCreds()
  if (!accessToken || !phoneNumberId) {
    console.warn('[WhatsApp] Media send skipped — Meta credentials not configured')
    return false
  }

  const media: Record<string, string> = { link: mediaUrl }
  if (opts.caption) media.caption = opts.caption
  if (kind === 'document' && opts.filename) media.filename = opts.filename

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   phone,
          type: kind,
          [kind]: media,
        }),
      },
    )
    if (res.ok) return true
    const err = await res.text()
    console.error(`[WhatsApp] Meta media send failed for ${phone}: ${err.slice(0, 200)}`)
  } catch (e) {
    console.error('[WhatsApp] Meta media API error:', e)
  }
  return false
}

/** Format a driver movement WhatsApp message from agenda item + booking context. */
export function formatDriverMovementMessage(params: {
  driverName:    string
  bookingRef:    string
  date:          Date | string
  location:      string
  fromPoint:     string | null
  toPoint:       string | null
  details:       string | null
  meetingTime:   string | null
  paxAdults:     number
  paxChildren:   number
  leadPassenger: string | null
  vehicleType:   string | null
  vehiclePlate:  string | null
  driverRate?:   number | null
  rateCurrency?: string | null
}): string {
  const d    = new Date(params.date)
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const from = params.fromPoint ?? params.location
  const to   = params.toPoint   ?? ''
  const pax  = params.paxChildren > 0
    ? `${params.paxAdults} Adult(s), ${params.paxChildren} Child(ren)`
    : `${params.paxAdults} Adult(s)`
  const vehicle = [params.vehicleType, params.vehiclePlate].filter(Boolean).join(' · ') || 'TBC'
  const rateStr = params.driverRate
    ? `${params.rateCurrency ?? 'USD'} ${Number(params.driverRate).toFixed(2)}`
    : null

  return [
    `🚗 *AppleHolidays — Driver Briefing*`,
    ``,
    `Hi *${params.driverName}*, you have been assigned for the following movement:`,
    ``,
    `📅 *Date:*      ${dateStr}`,
    `📍 *Location:*  ${params.location}`,
    `🛣  *Route:*     ${from}${to ? ` → ${to}` : ''}`,
    params.meetingTime ? `⏰ *Pick-up:*   ${params.meetingTime}` : null,
    `🚌 *Vehicle:*   ${vehicle}`,
    ``,
    `👥 *Pax:*       ${pax}`,
    params.leadPassenger ? `👤 *Guest:*     ${params.leadPassenger}` : null,
    rateStr ? `💰 *Rate:*      ${rateStr}` : null,
    params.details ? `📋 *Notes:*     ${params.details}` : null,
    ``,
    `📁 *Ref:*       ${params.bookingRef}`,
    ``,
    `Please confirm receipt of this assignment.`,
    `— AppleHolidays Operations`,
  ].filter(l => l !== null).join('\n')
}

export interface BriefingTicket {
  label:     string          // human ticket/voucher name (type or category)
  reference: string | null   // booking/confirmation reference
  supplier:  string | null
  confirmed: boolean         // PURCHASED/PAID vs still pending
  hasImage:  boolean         // a file is attached below
}

export interface BriefingMovement {
  location:     string
  fromPoint:    string | null
  toPoint:      string | null
  meetingTime:  string | null   // pick-up / meeting time
  timeFrom:     string | null
  timeTo:       string | null
  details:      string | null   // the "job" / activity description
  mealPlan:     string | null
  serviceType:  string          // ServiceType enum name
  driverName:   string | null
  driverPhone:  string | null
  vehicleType:  string | null
  vehiclePlate: string | null
  tickets:      BriefingTicket[]
}

const SERVICE_LABEL: Record<string, string> = {
  PVT_TRANSFER:  'Private transfer (PVT)',
  SIC_TRANSFER:  'Seat-in-coach (SIC)',
  INTERNAL_TOUR: 'Guided tour',
  FLIGHT:        'Flight',
  ACCOMMODATION: 'Accommodation',
}

function paxLine(a: number, c: number, i = 0): string {
  const parts: string[] = []
  if (a > 0) parts.push(`${a} adult${a > 1 ? 's' : ''}`)
  if (c > 0) parts.push(`${c} child${c > 1 ? 'ren' : ''}`)
  if (i > 0) parts.push(`${i} infant${i > 1 ? 's' : ''}`)
  return parts.join(', ') || '—'
}

/**
 * Format a warm, guest-facing day plan — sent the evening before each trip day
 * (and on-demand per day from the Customer WhatsApp panel). Adapts its tone to
 * arrival / mid-trip / departure days and folds in flights, hotels, per-movement
 * driver + ticket details, activities, and meal plans.
 */
export function formatCustomerDailyBriefingMessage(params: {
  bookingRef:     string
  leadName:       string | null
  leadPhone:      string | null
  date:           Date | string
  isArrival:      boolean
  isDeparting:    boolean
  paxAdults:      number
  paxChildren:    number
  paxInfants:     number
  managerContact: string | null   // driver / operations manager hotline
  stayingAtHotel: string | null
  checkIns:       { hotel: string; city: string }[]
  checkOuts:      { hotel: string; city: string }[]
  flights: {
    flightNo: string
    fromApt:  string
    toApt:    string
    depTime:  string
    arrTime:  string
    airline:  string | null
  }[]
  movements:       BriefingMovement[]
  attachmentCount: number          // ticket/voucher images sent right after this text
}): string {
  const d = new Date(params.date)
  const dateStr  = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const name     = params.leadName ?? 'traveller'
  const totalPax = params.paxAdults + params.paxChildren + params.paxInfants

  // Tone-setting opener that adapts to where in the trip we are.
  let opener: string
  if (params.isArrival) {
    opener = `Warm welcome, dear *${name}*! 🌴 We're delighted to have you with us. Here's everything set up for your arrival on *${dateStr}*:`
  } else if (params.isDeparting) {
    opener = `Good day dear *${name}*, time flies so fast — *${dateStr}* is already your departure day 🥹. Here's your schedule below:`
  } else {
    opener = `Good day dear *${name}*! ☀️ Here's your plan for *${dateStr}*:`
  }

  const lines: (string | null)[] = [
    `🌴 *AppleHolidays — Your Day Plan*`,
    ``,
    opener,
    ``,
    `👤 *Guest:* ${name}${params.leadPhone ? ` · ${params.leadPhone}` : ''}`,
    `👥 *Total guests:* ${totalPax} (${paxLine(params.paxAdults, params.paxChildren, params.paxInfants)})`,
    ``,
  ]

  if (params.flights.length > 0) {
    lines.push(`✈️ *Flight${params.flights.length > 1 ? 's' : ''}*`)
    for (const f of params.flights) {
      lines.push(`   • *${f.flightNo}*${f.airline ? ` — ${f.airline}` : ''}`)
      lines.push(`     ${f.fromApt} ${f.depTime} → ${f.toApt} ${f.arrTime}`)
    }
    lines.push(``)
  }

  if (params.checkOuts.length > 0) {
    lines.push(`🧳 *Check-out:* ${params.checkOuts.map(c => `${c.hotel} (${c.city})`).join(', ')}`)
  }
  if (params.checkIns.length > 0) {
    lines.push(`🏨 *Check-in:* ${params.checkIns.map(c => `${c.hotel} (${c.city})`).join(', ')}`)
  }
  if (params.stayingAtHotel && params.checkIns.length === 0 && params.checkOuts.length === 0) {
    lines.push(`🏨 *Staying at:* ${params.stayingAtHotel}`)
  }
  if (params.checkIns.length > 0 || params.checkOuts.length > 0 || params.stayingAtHotel) lines.push(``)

  if (params.movements.length > 0) {
    const multi = params.movements.length > 1
    lines.push(`📋 *Today's Movements & Activities*`)
    lines.push(``)
    params.movements.forEach((m, idx) => {
      const route = [m.fromPoint, m.toPoint].filter(Boolean).join(' → ') || m.location
      const window = m.timeFrom ? `${m.timeFrom}${m.timeTo ? `–${m.timeTo}` : ''}` : null
      lines.push(`${multi ? `*${idx + 1}. ` : `*`}${route}*`)
      if (m.meetingTime) lines.push(`   ⏰ Pick-up: *${m.meetingTime}*`)
      else if (window)   lines.push(`   ⏰ ${window}`)
      const svc = SERVICE_LABEL[m.serviceType]
      if (svc && m.serviceType !== 'OWN_ARRANGEMENT') lines.push(`   🚐 ${svc}`)
      if (m.details)  lines.push(`   📝 ${m.details}`)
      if (m.mealPlan) lines.push(`   🍽 Meals: ${m.mealPlan}`)
      if (m.driverName) {
        const vehicle = [m.vehicleType, m.vehiclePlate].filter(Boolean).join(' · ')
        lines.push(`   🚗 Driver: *${m.driverName}*${m.driverPhone ? ` (${m.driverPhone})` : ''}${vehicle ? ` — ${vehicle}` : ''}`)
      }
      for (const t of m.tickets) {
        const status = t.confirmed ? '✅ Confirmed' : '🕓 Reserved'
        const ref    = t.reference ? ` · Ref ${t.reference}` : ''
        const sup    = t.supplier ? ` · ${t.supplier}` : ''
        const img    = t.hasImage ? ' 📎' : ''
        lines.push(`   🎫 ${t.label}${ref}${sup} — ${status}${img}`)
      }
      lines.push(``)
    })
  }

  if (params.managerContact) {
    lines.push(`📞 *On-ground manager:* ${params.managerContact}`)
    lines.push(``)
  }

  if (params.attachmentCount > 0) {
    lines.push(`📎 We've attached ${params.attachmentCount} ticket/voucher${params.attachmentCount > 1 ? 's' : ''} below — please keep ${params.attachmentCount > 1 ? 'them' : 'it'} handy. 👇`)
    lines.push(``)
  }

  if (params.isDeparting) {
    lines.push(`Before you fly, a couple of gentle reminders:`)
    lines.push(`1️⃣ For check-in luggage 🧳, please confirm with the airline staff at the counter whether you need to re-collect it for any connecting flight or if it transfers automatically.`)
    lines.push(`2️⃣ If you have a connecting flight, ask the airport staff to guide you between terminals and allow time for any additional security check.`)
    lines.push(``)
    lines.push(`We truly hope you had a lovely time with us 🥰 — we'll follow up shortly with a short feedback form; your thoughts help us serve future travellers better. Safe travels home! 🙏`)
    lines.push(``)
  }

  const nothing = params.flights.length === 0 && params.movements.length === 0 &&
    params.checkIns.length === 0 && params.checkOuts.length === 0
  if (nothing && !params.isDeparting) {
    lines.push(`Nothing scheduled today — a free day to relax and explore at your own pace! 🌞`)
    lines.push(``)
  }

  lines.push(`📁 *Ref:* ${params.bookingRef}`)
  lines.push(``)
  lines.push(`Have a wonderful day 💙 — AppleHolidays Team`)

  return lines.filter(l => l !== null).join('\n')
}

/** Format the post-departure feedback-form invite WhatsApp message. */
export function formatFeedbackRequestMessage(params: {
  bookingRef: string
  leadName:   string | null
  formUrl:    string
}): string {
  const greeting = params.leadName ? `Hi *${params.leadName}*,` : `Hi there,`
  return [
    `🙏 *AppleHolidays — We'd love your feedback!*`,
    ``,
    `${greeting} we hope you had a wonderful trip with us.`,
    ``,
    `Could you spare two minutes to share your feedback? It really helps our team improve.`,
    ``,
    `📝 ${params.formUrl}`,
    ``,
    `📁 *Ref:* ${params.bookingRef}`,
    ``,
    `Thank you for travelling with AppleHolidays!`,
  ].join('\n')
}
