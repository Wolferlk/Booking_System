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
