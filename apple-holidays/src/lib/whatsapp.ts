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

/** Format tomorrow's itinerary briefing for a guest — sent daily at 6pm while the trip is ongoing. */
export function formatCustomerDailyBriefingMessage(params: {
  bookingRef:    string
  leadName:      string | null
  date:          Date | string
  isDeparting:   boolean
  stayingAtHotel: string | null
  checkIns:      { hotel: string; city: string }[]
  checkOuts:     { hotel: string; city: string }[]
  flights: {
    flightNo: string
    fromApt:  string
    toApt:    string
    depTime:  string
    arrTime:  string
    airline:  string | null
  }[]
  agendaItems: {
    location:     string
    fromPoint:    string | null
    toPoint:      string | null
    meetingTime:  string | null
    mealPlan:     string | null
    serviceType:  string
    driverName:   string | null
    driverPhone:  string | null
    vehicleType:  string | null
    vehiclePlate: string | null
  }[]
}): string {
  const d = new Date(params.date)
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const greeting = params.leadName ? `Hi *${params.leadName}*,` : `Hi there,`

  const lines: (string | null)[] = [
    `🌴 *AppleHolidays — Your Day Plan*`,
    ``,
    `${greeting} here's your plan for *${dateStr}*:`,
    ``,
  ]

  if (params.flights.length > 0) {
    lines.push(`✈️ *Flights*`)
    for (const f of params.flights) {
      lines.push(`   ${f.flightNo}${f.airline ? ` (${f.airline})` : ''} — ${f.fromApt} ${f.depTime} → ${f.toApt} ${f.arrTime}`)
    }
    lines.push(``)
  }

  if (params.checkOuts.length > 0) {
    lines.push(`🧳 *Checking out:* ${params.checkOuts.map(c => `${c.hotel} (${c.city})`).join(', ')}`)
  }
  if (params.checkIns.length > 0) {
    lines.push(`🏨 *Checking in:* ${params.checkIns.map(c => `${c.hotel} (${c.city})`).join(', ')}`)
  }
  if (params.stayingAtHotel && params.checkIns.length === 0 && params.checkOuts.length === 0) {
    lines.push(`🏨 *Staying at:* ${params.stayingAtHotel}`)
  }
  if (params.checkIns.length > 0 || params.checkOuts.length > 0 || params.stayingAtHotel) lines.push(``)

  if (params.agendaItems.length > 0) {
    lines.push(`📋 *Movements & Activities*`)
    for (const item of params.agendaItems) {
      const route = [item.fromPoint, item.toPoint].filter(Boolean).join(' → ') || item.location
      const time  = item.meetingTime ? `⏰ ${item.meetingTime} — ` : ''
      lines.push(`   ${time}${route}`)
      if (item.mealPlan) lines.push(`      🍽 Meals: ${item.mealPlan}`)
      if (item.driverName) {
        const vehicle = [item.vehicleType, item.vehiclePlate].filter(Boolean).join(' ')
        lines.push(`      🚗 Driver: ${item.driverName}${item.driverPhone ? ` (${item.driverPhone})` : ''}${vehicle ? ` — ${vehicle}` : ''}`)
      }
    }
    lines.push(``)
  }

  if (params.isDeparting) {
    lines.push(`👋 Tomorrow is your departure day — safe travels! We'll follow up shortly after with a quick feedback form.`)
    lines.push(``)
  }

  if (params.flights.length === 0 && params.agendaItems.length === 0 && params.checkIns.length === 0 && params.checkOuts.length === 0) {
    lines.push(`Nothing scheduled — a free day to relax and explore at your own pace! 🌞`)
    lines.push(``)
  }

  lines.push(`📁 *Ref:* ${params.bookingRef}`)
  lines.push(``)
  lines.push(`Have a wonderful day — AppleHolidays Team`)

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
