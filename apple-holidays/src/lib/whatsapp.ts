/**
 * Shared WhatsApp sending utility — used for both customer messages and driver notifications.
 * Uses Meta Graph API or the internal notify proxy, whichever is configured.
 */

import { prisma } from '@/lib/prisma'
import { contentTypeFor } from '@/lib/storage'
import { SERVICE_TYPE_LABELS } from '@/lib/service-types'

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

/** Every staff role allowed to read/send WhatsApp — used by the global inbox routes. */
export const WHATSAPP_STAFF_ROLES = [
  'BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
] as const

/**
 * Find the booking whose contact/agent phone matches. Shared by the inbound
 * webhook and the global inbox, so "which booking does this number belong to"
 * is resolved the same way everywhere — live, by phone, not by trusting
 * whatever bookingRef a message happened to be filed under at receipt time.
 */
export async function findBookingByPhone(phone: string) {
  const normalized = normalisePhone(phone)
  if (!normalized) return null
  const variants = [normalized, `+${normalized}`]

  return prisma.booking.findFirst({
    where: {
      OR: [
        { contactWhatsapp: { in: variants } },
        { contactPhone:    { in: variants } },
        { agentWhatsapp:   { in: variants } },
        { agentPhone:      { in: variants } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Send a text message and/or a media attachment via the Meta Graph API in one
 * call. Shared by the booking-scoped composer and the global inbox so there's
 * one implementation of the Meta send flow instead of two.
 */
/**
 * Upload a file to Meta's media store and return its media id (valid ~30 days).
 *
 * Uploading the bytes is strictly better than handing Meta a link: no public URL
 * has to exist, so nothing depends on the serverless host's read-only disk or on
 * the CDN having the file yet. The id works for both free-form media messages
 * and a template's DOCUMENT/IMAGE header. Throws on a Graph API error.
 */
export async function uploadMetaMedia(buffer: Buffer, filename: string): Promise<string> {
  const { accessToken, phoneNumberId } = getMetaCreds()
  if (!accessToken || !phoneNumberId) throw new Error('WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured')

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  form.append('file', new Blob([arrayBuffer], { type: contentTypeFor(filename) }), filename)

  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Meta media upload failed ${res.status}: ${body.slice(0, 300)}`)
  const json = JSON.parse(body) as { id?: string }
  if (!json.id) throw new Error('Meta media upload returned no media id')
  return json.id
}

export async function sendViaMetaApi(params: {
  to: string
  message?: string
  media?: {
    buffer:   Buffer
    filename: string
    kind:     'document' | 'image'
    caption?: string
  }
}): Promise<{ channel: 'meta'; text: unknown; media: unknown } | null> {
  const { accessToken, phoneNumberId } = getMetaCreds()
  if (!accessToken || !phoneNumberId) return null

  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
  const headers = { Authorization: `Bearer ${accessToken}` }

  let textResult: unknown = null
  if (params.message) {
    const textRes = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   params.to,
        type: 'text',
        text: { body: params.message },
      }),
    })
    const textBody = await textRes.text()
    if (!textRes.ok) throw new Error(`Meta text send failed ${textRes.status}: ${textBody.slice(0, 300)}`)
    textResult = JSON.parse(textBody)
  }

  let mediaResult: unknown = null
  if (params.media) {
    const { buffer, filename, kind, caption } = params.media
    const mediaId = await uploadMetaMedia(buffer, filename)

    const mediaPayload: Record<string, unknown> = kind === 'document'
      ? { id: mediaId, filename, ...(caption ? { caption } : {}) }
      : { id: mediaId, ...(caption ? { caption } : {}) }

    const sendRes = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   params.to,
        type: kind,
        [kind]: mediaPayload,
      }),
    })
    const sendBody = await sendRes.text()
    if (!sendRes.ok) throw new Error(`Meta ${kind} send failed ${sendRes.status}: ${sendBody.slice(0, 300)}`)
    mediaResult = JSON.parse(sendBody)
  }

  return { channel: 'meta', text: textResult, media: mediaResult }
}

/**
 * Send an approved WhatsApp TEMPLATE via the Meta Graph API. Unlike free-form
 * text/media, a template delivers OUTSIDE the 24h customer-service window — so
 * this is the only way to reach a customer who hasn't messaged us in >24h (or
 * ever). Used for the booking-update "opener": it asks the customer to reply,
 * their reply reopens the window, and only THEN can the full Tour Confirmation
 * (dynamic text + PDF, which can't be a template) be sent free-form.
 *
 * `bodyParams` fills the template body's {{1}}, {{2}}… placeholders in order.
 * Returns null when Meta creds aren't configured; throws on a Meta API error.
 */
export async function sendViaMetaTemplate(params: {
  to:            string
  templateName:  string
  lang?:         string
  bodyParams?:   string[]
  headerParams?: string[]
  /**
   * Fills a DOCUMENT-header template — the only way to deliver a PDF to a number
   * outside the 24h window. `id` comes from uploadMetaMedia(); `link` must be a
   * publicly fetchable HTTPS URL. Mutually exclusive with `headerParams`.
   */
  headerDocument?: { id?: string; link?: string; filename?: string }
}): Promise<{ channel: 'meta'; template: unknown } | null> {
  const { accessToken, phoneNumberId } = getMetaCreds()
  if (!accessToken || !phoneNumberId) return null

  const to = normalisePhone(params.to)
  if (!to) return null

  const components: Record<string, unknown>[] = []
  if (params.headerDocument && (params.headerDocument.id || params.headerDocument.link)) {
    const { id, link, filename } = params.headerDocument
    components.push({
      type: 'header',
      parameters: [{
        type: 'document',
        document: {
          ...(id ? { id } : { link }),
          ...(filename ? { filename } : {}),
        },
      }],
    })
  } else if (params.headerParams && params.headerParams.length) {
    components.push({ type: 'header', parameters: params.headerParams.map(text => ({ type: 'text', text })) })
  }
  if (params.bodyParams && params.bodyParams.length) {
    components.push({ type: 'body', parameters: params.bodyParams.map(text => ({ type: 'text', text })) })
  }

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:     params.templateName,
          language: { code: params.lang || 'en' },
          ...(components.length ? { components } : {}),
        },
      }),
    },
  )
  const body = await res.text()
  if (!res.ok) throw new Error(`Meta template send failed ${res.status}: ${body.slice(0, 300)}`)
  return { channel: 'meta', template: JSON.parse(body) }
}

function getWabaCreds() {
  return {
    accessToken:       process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim(),
  }
}

/** Count distinct {{n}} placeholders in a template header/body string. */
function countPlaceholders(s: string | null | undefined): number {
  const matches = String(s ?? '').match(/\{\{\s*\d+\s*\}\}/g)
  return matches ? new Set(matches).size : 0
}

export interface WaTemplateSummary {
  name: string
  language: string
  status: string
  category: string | null
  headerFormat: string | null
  headerText: string
  bodyText: string
  bodyVariableCount: number
  headerVariableCount: number
}

/** Flatten a Meta message-template object into the shape the send picker needs. */
function summarizeTemplate(t: {
  name?: string
  language?: string
  status?: string
  category?: string
  components?: Array<{ type?: string; format?: string; text?: string }>
}): WaTemplateSummary {
  const components = Array.isArray(t?.components) ? t.components : []
  const byType = (name: string) => components.find(c => String(c?.type).toUpperCase() === name) ?? null
  const header = byType('HEADER')
  const bodyComp = byType('BODY')
  const headerFormat = header ? String(header.format || 'TEXT').toUpperCase() : null
  const headerText = headerFormat === 'TEXT' ? (header?.text || '') : ''
  const bodyText = bodyComp?.text || ''
  return {
    name: t?.name || '',
    language: t?.language || 'en',
    status: String(t?.status || '').toUpperCase(),
    category: t?.category || null,
    headerFormat,
    headerText,
    bodyText,
    bodyVariableCount: countPlaceholders(bodyText),
    headerVariableCount: countPlaceholders(headerText),
  }
}

/**
 * List the WhatsApp message templates configured on the business account.
 * Same WABA (2077665446131914) n8n-project's WhatsApp dashboard talks to —
 * called directly against Meta here rather than proxying through n8n, since
 * this is a WABA-level resource, not data unique to n8n's own store.
 */
export async function listMetaTemplates(status = 'APPROVED'): Promise<WaTemplateSummary[]> {
  const { accessToken, businessAccountId } = getWabaCreds()
  if (!accessToken || !businessAccountId) {
    throw new Error('Templates unavailable: WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID not configured')
  }
  const fields = 'name,language,status,category,components'
  const out: WaTemplateSummary[] = []
  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/${businessAccountId}/message_templates?fields=${encodeURIComponent(fields)}&limit=200`
  let page = 0
  while (url && page < 10) {
    const currentUrl: string = url
    const res: Response = await fetch(currentUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    const raw: string = await res.text()
    let json: { data?: unknown[]; paging?: { next?: string }; error?: { message?: string } } | null = null
    try { json = raw ? JSON.parse(raw) : null } catch { json = null }
    if (!res.ok) throw new Error(json?.error?.message || `Graph API ${res.status}`)
    for (const t of (Array.isArray(json?.data) ? json.data : [])) out.push(summarizeTemplate(t as Parameters<typeof summarizeTemplate>[0]))
    url = json?.paging?.next || null
    page += 1
  }
  const wanted = status.toUpperCase()
  const filtered = wanted && wanted !== 'ALL' ? out.filter(t => t.status === wanted) : out
  filtered.sort((a, b) => a.name.localeCompare(b.name))
  return filtered
}

/**
 * Register a NEW template with Meta for review (Business Manager approval,
 * typically minutes to ~24h). Mirrors n8n-project's whatsapp.service.js
 * createMessageTemplate() — same Graph API shape, same WABA. Throws on any
 * validation failure or Graph API error.
 */
/**
 * Get a template header handle for a media (DOCUMENT/IMAGE) header, via Meta's
 * resumable upload API. Template *creation* will not accept a media id — it needs
 * this app-scoped handle, which is why an app id is required here but nowhere
 * else. Only needed to register a template; sending uses uploadMetaMedia().
 */
export async function uploadTemplateHeaderHandle(
  buffer: Buffer,
  filename: string,
  mimeType = 'application/pdf',
): Promise<string> {
  const { accessToken } = getWabaCreds()
  const appId = (process.env.WHATSAPP_APP_ID || process.env.FACEBOOK_APP_ID || process.env.META_APP_ID)?.trim()
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not configured')
  if (!appId) {
    throw new Error(
      'WHATSAPP_APP_ID is not set — a media-header template can only be registered from the API with an app id. ' +
      'Set WHATSAPP_APP_ID, or create the template once in WhatsApp Manager instead.',
    )
  }

  const startRes = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${appId}/uploads` +
      `?file_name=${encodeURIComponent(filename)}&file_length=${buffer.byteLength}&file_type=${encodeURIComponent(mimeType)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const startBody = await startRes.text()
  if (!startRes.ok) throw new Error(`Upload session failed ${startRes.status}: ${startBody.slice(0, 300)}`)
  const sessionId = (JSON.parse(startBody) as { id?: string }).id
  if (!sessionId) throw new Error('Upload session returned no id')

  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const putRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${sessionId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
    body: arrayBuffer,
  })
  const putBody = await putRes.text()
  if (!putRes.ok) throw new Error(`Header upload failed ${putRes.status}: ${putBody.slice(0, 300)}`)
  const handle = (JSON.parse(putBody) as { h?: string }).h
  if (!handle) throw new Error('Header upload returned no handle')
  return handle
}

export async function createMetaTemplate(params: {
  name: string
  category?: string
  language?: string
  bodyText: string
  bodyExamples?: string[]
  headerText?: string | null
  headerExamples?: string[]
  /** Media header (e.g. a PDF attachment slot). Requires `headerHandle`. */
  headerFormat?: 'DOCUMENT' | 'IMAGE' | 'VIDEO'
  headerHandle?: string
  footerText?: string | null
}): Promise<{ id: string | null; status: string; category: string; name: string }> {
  const { accessToken, businessAccountId } = getWabaCreds()
  if (!accessToken || !businessAccountId) {
    throw new Error('Templates unavailable: WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID not configured')
  }
  const templateName = params.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!templateName) throw new Error('name is required')
  const bodyText = params.bodyText.trim()
  if (!bodyText) throw new Error('bodyText is required')

  const components: Record<string, unknown>[] = []
  const headerText = (params.headerText || '').trim()
  if (params.headerFormat) {
    if (!params.headerHandle) {
      throw new Error(`A ${params.headerFormat} header needs an uploaded example — see uploadTemplateHeaderHandle()`)
    }
    components.push({
      type: 'HEADER',
      format: params.headerFormat,
      example: { header_handle: [params.headerHandle] },
    })
  } else if (headerText) {
    const hVars = countPlaceholders(headerText)
    const headerComp: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text: headerText }
    if (hVars > 0) {
      const examples = (params.headerExamples || []).map(e => String(e ?? '').trim())
      if (examples.length < hVars || examples.slice(0, hVars).some(e => !e)) {
        throw new Error(`Header text has ${hVars} placeholder(s) — an example value is required for each`)
      }
      headerComp.example = { header_text: examples.slice(0, hVars) }
    }
    components.push(headerComp)
  }

  const bodyComp: Record<string, unknown> = { type: 'BODY', text: bodyText }
  const bVars = countPlaceholders(bodyText)
  if (bVars > 0) {
    const examples = (params.bodyExamples || []).map(e => String(e ?? '').trim())
    if (examples.length < bVars || examples.slice(0, bVars).some(e => !e)) {
      throw new Error(`Body text has ${bVars} placeholder(s) — an example value is required for each, for Meta to review the template`)
    }
    bodyComp.example = { body_text: [examples.slice(0, bVars)] }
  }
  components.push(bodyComp)

  const footerText = (params.footerText || '').trim()
  if (footerText) components.push({ type: 'FOOTER', text: footerText })

  const payload = {
    name: templateName,
    category: (params.category || 'UTILITY').toUpperCase(),
    language: (params.language || 'en').trim() || 'en',
    components,
  }
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${businessAccountId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json: { id?: string; status?: string; category?: string; error?: { message?: string } } | null = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!res.ok) throw new Error(json?.error?.message || `Graph API ${res.status}`)
  return { id: json?.id ?? null, status: json?.status ?? 'PENDING', category: json?.category ?? payload.category, name: templateName }
}

/**
 * Is this phone inside WhatsApp's 24h customer-service window (free-form text
 * allowed) or not (only an approved template will deliver)? Computed LOCALLY
 * from our own whatsapp_messages table — no Meta/n8n call needed, since inbound
 * rows are already kept in sync (see whatsapp-shared-inbox-sync.ts) and carry
 * correct UTC timestamps. Caller should sync the phone first for a fresh read.
 */
export async function isWithin24hWindow(phone: string): Promise<boolean> {
  const last = await prisma.whatsAppMessage.findFirst({
    where: { phone: normalisePhone(phone), direction: 'inbound' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!last) return false
  return Date.now() - last.createdAt.getTime() < 24 * 60 * 60 * 1000
}

/**
 * Fall back to the internal notify proxy (text + link-based files only) when
 * Meta credentials aren't configured.
 */
export async function sendViaNotifyProxy(params: {
  to: string
  name?: string
  message: string
  files?: Array<{ url: string; filename: string; caption?: string }>
}): Promise<{ channel: 'proxy'; response: unknown } | null> {
  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET?.trim()
  if (!notifySecret) return null

  const res = await fetch(WHATSAPP_API, {
    method: 'POST',
    headers: { 'x-notify-secret': notifySecret, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`)
  return { channel: 'proxy', response: json }
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

/**
 * Format a consolidated driver briefing covering one OR MORE movements assigned to
 * the same driver within a single booking. Used when the whole movement chart is
 * saved, so a driver handling several activities on the same file receives a single
 * message listing every movement rather than one message per stop.
 */
export function formatDriverBriefingMessage(params: {
  driverName:    string
  bookingRef:    string
  paxAdults:     number
  paxChildren:   number
  leadPassenger: string | null
  vehicleType:   string | null
  vehiclePlate:  string | null
  driverRate?:   number | null
  rateCurrency?: string | null
  movements: {
    date:        Date | string
    location:    string
    fromPoint:   string | null
    toPoint:     string | null
    details:     string | null
    meetingTime: string | null
  }[]
}): string {
  // Single movement → reuse the detailed single-movement layout for consistency.
  if (params.movements.length === 1) {
    const m = params.movements[0]
    return formatDriverMovementMessage({
      driverName:    params.driverName,
      bookingRef:    params.bookingRef,
      date:          m.date,
      location:      m.location,
      fromPoint:     m.fromPoint,
      toPoint:       m.toPoint,
      details:       m.details,
      meetingTime:   m.meetingTime,
      paxAdults:     params.paxAdults,
      paxChildren:   params.paxChildren,
      leadPassenger: params.leadPassenger,
      vehicleType:   params.vehicleType,
      vehiclePlate:  params.vehiclePlate,
      driverRate:    params.driverRate,
      rateCurrency:  params.rateCurrency,
    })
  }

  const pax = params.paxChildren > 0
    ? `${params.paxAdults} Adult(s), ${params.paxChildren} Child(ren)`
    : `${params.paxAdults} Adult(s)`
  const vehicle = [params.vehicleType, params.vehiclePlate].filter(Boolean).join(' · ') || 'TBC'
  const rateStr = params.driverRate
    ? `${params.rateCurrency ?? 'USD'} ${Number(params.driverRate).toFixed(2)}`
    : null

  const sorted = [...params.movements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const lines: (string | null)[] = [
    `🚗 *AppleHolidays — Driver Briefing*`,
    ``,
    `Hi *${params.driverName}*, you have been assigned for the following *${sorted.length}* movements:`,
    ``,
    `👥 *Pax:*     ${pax}`,
    params.leadPassenger ? `👤 *Guest:*   ${params.leadPassenger}` : null,
    `🚌 *Vehicle:* ${vehicle}`,
    rateStr ? `💰 *Rate:*    ${rateStr}` : null,
    ``,
  ]

  sorted.forEach((m, idx) => {
    const d       = new Date(m.date)
    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    const from    = m.fromPoint ?? m.location
    const to      = m.toPoint ?? ''
    lines.push(`*${idx + 1}. ${dateStr}*`)
    lines.push(`   📍 ${m.location}`)
    lines.push(`   🛣  ${from}${to ? ` → ${to}` : ''}`)
    if (m.meetingTime) lines.push(`   ⏰ Pick-up: ${m.meetingTime}`)
    if (m.details)     lines.push(`   📋 ${m.details}`)
    lines.push(``)
  })

  lines.push(`📁 *Ref:*     ${params.bookingRef}`)
  lines.push(``)
  lines.push(`Please confirm receipt of this assignment.`)
  lines.push(`— AppleHolidays Operations`)

  return lines.filter(l => l !== null).join('\n')
}

/** Format a cancellation notice sent to a driver who has been un-assigned / replaced. */
export function formatDriverCancellationMessage(params: {
  driverName: string
  bookingRef: string
}): string {
  return [
    `⚠️ *AppleHolidays — Assignment Cancelled*`,
    ``,
    `Hi *${params.driverName}*, your assignment for booking *${params.bookingRef}* has been *cancelled* and is no longer required.`,
    ``,
    `Please disregard the earlier movement briefing for this booking. We're sorry for any inconvenience and will be in touch for future trips.`,
    ``,
    `— AppleHolidays Operations`,
  ].join('\n')
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
  ...SERVICE_TYPE_LABELS,
  PVT_TRANSFER:  'Private transfer (PVT)',
  SIC_TRANSFER:  'Seat-in-coach (SIC)',
  SIC_TOUR:      'Seat-in-coach tour (SIC)',
  INTERNAL_TOUR: 'Guided tour',
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
