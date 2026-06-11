import { simpleParser } from 'mailparser'
import openai from '@/lib/openai'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessedEmail {
  uid: number
  graphId: string
  subject: string
  from: string
  fromName: string
  to: string[]
  cc: string[]
  date: string
  type: 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN'
  rawBody: string
  bodyHtml: string
  folder: string
  isRead: boolean
  hasAttachments: boolean
  importance: string
  conversationId: string
  parsed: Record<string, unknown> | null
  error?: string
}

export interface ExtractedBooking {
  bookingRef: string | null
  agentBookingId: string | null
  agent: string | null
  fileHandler: string | null
  arrivalDate: string | null
  departureDate: string | null
  paxAdults: number
  paxChildren: number
  quotedTotal: number | null
  currency: string
  terms: string | null
  exclusions: string | null
  passengers: { name: string; type: string; isLead: boolean }[]
  flights: { flightNo: string; date: string; fromApt: string; depTime?: string; toApt: string; arrTime?: string; airline?: string }[]
  accommodations: { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string; mealType?: string }[]
  itineraryItems: { dayNo: number; date: string; title: string; description?: string }[]
  emergencyContacts: { name: string; phone?: string; role?: string }[]
  pnlLines: {
    activity: string
    category: string
    mmtRate: number
    sicRate: number
    pvtRatePP: number
    adEntrance: number
    chEntrance: number
    otherRate: number
  }[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function detectEmailType(subject: string, body: string): 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN' {
  const s = subject.toLowerCase()
  const b = body.toLowerCase().slice(0, 2000)

  if (
    s.includes('quotation') || s.includes('tour confirmation') || s.includes('confirmation') ||
    b.includes('tour confirmation') || b.includes('tour ref') || b.includes('is number') ||
    b.includes('arrival date') || b.includes('no. of guests') || b.includes('itinerary:')
  ) {
    return 'TOUR_CONFIRMATION'
  }

  if (
    s.includes('pnl') || s.includes('costing') || s.includes('pricing') ||
    b.includes('mmt rate') || b.includes('sic rate') || b.includes('cost per person') ||
    b.includes('pvt rate') || b.includes('profit')
  ) {
    return 'PNL'
  }

  return 'UNKNOWN'
}

// ── OpenAI extraction ────────────────────────────────────────────────────────

const TOUR_CONFIRMATION_PROMPT = `You are a Vietnam travel booking extraction expert for AppleHolidays (MMT Vietnam).
Extract ALL booking details from this email thread. Focus on the MOST RECENT tour confirmation section.

Return ONLY valid JSON matching this exact schema:
{
  "bookingRef": "IS Number or Tour Ref or internal booking reference (e.g. VN19730, 468600CNTL)",
  "agentBookingId": "Agent's booking ID (e.g. 402011138462)",
  "agent": "Agent company name (e.g. 30 Sundays, Make My Trip)",
  "fileHandler": "File handler name (e.g. Yogi)",
  "arrivalDate": "YYYY-MM-DD",
  "departureDate": "YYYY-MM-DD",
  "paxAdults": number,
  "paxChildren": number,
  "quotedTotal": number or null,
  "currency": "USD",
  "terms": "full terms and conditions text or null",
  "exclusions": "exclusions text or null",
  "emergencyContacts": [{ "name": "string", "phone": "string or null", "role": "string or null" }],
  "passengers": [{ "name": "string", "type": "ADULT or CHILD", "isLead": true/false }],
  "flights": [{ "flightNo": "string", "date": "YYYY-MM-DD", "fromApt": "IATA code", "depTime": "HH:MM or null", "toApt": "IATA code", "arrTime": "HH:MM or null", "airline": "string or null" }],
  "accommodations": [{ "hotel": "hotel name", "city": "city name", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "nights": number, "roomType": "string or null", "mealType": "BB/HB/FB/null" }],
  "itineraryItems": [{ "dayNo": number, "date": "YYYY-MM-DD", "title": "short activity title", "description": "detailed description or null" }],
  "pnlLines": []
}

IMPORTANT: Extract the IS Number as bookingRef (format: VN#####). If no IS Number, use Tour Ref.
For pax names, extract from "Guests Name" or similar sections. If only one name is given, mark as isLead:true.
For airports, use 3-letter IATA codes (HAN=Hanoi, DAD=Da Nang, SGN=Ho Chi Minh, etc.).
Date format must be YYYY-MM-DD strictly.`

const PNL_PROMPT = `You are a P&L extraction expert for AppleHolidays (MMT Vietnam).
Extract cost line items from this email. Focus on the pricing/costing table.

Return ONLY valid JSON:
{
  "bookingRef": "IS Number or reference number",
  "paxAdults": number,
  "paxChildren": number,
  "pnlLines": [
    {
      "activity": "service/activity name",
      "category": "one of: HOTEL, TICKETS, GUIDES, MEALS, CRUISE, WATER, TRANSPORT, TAX_FEES, FLIGHT_TICKETS, OTHER",
      "mmtRate": number (rate charged to agent per person),
      "sicRate": number (SIC cost per person, 0 if not applicable),
      "pvtRatePP": number (private vehicle cost per person, 0 if not applicable),
      "adEntrance": number (adult entrance fee, 0 if not applicable),
      "chEntrance": number (child entrance fee, 0 if not applicable),
      "otherRate": number (any other cost, 0 if not applicable)
    }
  ]
}

Category rules for Vietnam:
- Airport/hotel transfers → TRANSPORT
- Ha Long cruise, boat trips → CRUISE
- Hotel stays → HOTEL
- Ba Na Hills, entrance tickets, cable car → TICKETS
- Walking tours, guided tours, city tours → GUIDES
- Kayaking, water sports → WATER
- Flights → FLIGHT_TICKETS
- Meals at restaurants → MEALS
- Visa, tax, service charge → TAX_FEES`

export async function extractBookingFromEmail(emailBody: string, emailType: 'TOUR_CONFIRMATION' | 'PNL'): Promise<ExtractedBooking> {
  const prompt = emailType === 'TOUR_CONFIRMATION' ? TOUR_CONFIRMATION_PROMPT : PNL_PROMPT

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Extract from this email:\n\n${emailBody.slice(0, 14000)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response')

  const parsed = JSON.parse(content) as Partial<ExtractedBooking>

  return {
    bookingRef:       parsed.bookingRef       ?? null,
    agentBookingId:   parsed.agentBookingId   ?? null,
    agent:            parsed.agent            ?? null,
    fileHandler:      parsed.fileHandler      ?? null,
    arrivalDate:      parsed.arrivalDate      ?? null,
    departureDate:    parsed.departureDate    ?? null,
    paxAdults:        Number(parsed.paxAdults  ?? 2),
    paxChildren:      Number(parsed.paxChildren ?? 0),
    quotedTotal:      parsed.quotedTotal      ? Number(parsed.quotedTotal) : null,
    currency:         parsed.currency         ?? 'USD',
    terms:            parsed.terms            ?? null,
    exclusions:       parsed.exclusions       ?? null,
    passengers:       parsed.passengers       ?? [],
    flights:          parsed.flights          ?? [],
    accommodations:   parsed.accommodations   ?? [],
    itineraryItems:   parsed.itineraryItems   ?? [],
    emergencyContacts: parsed.emergencyContacts ?? [],
    pnlLines:         parsed.pnlLines         ?? [],
  }
}

// ── Microsoft Graph API email reader ─────────────────────────────────────────

export async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.Azure_TENANT_ID
  const clientId     = process.env.Azure_CLIENT_ID
  const clientSecret = process.env.Azure_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure AD credentials not set (Azure_TENANT_ID / Azure_CLIENT_ID / Azure_CLIENT_SECRET)')
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         'https://graph.microsoft.com/.default',
      }).toString(),
    },
  )

  const json = await res.json() as { access_token?: string; error?: string; error_description?: string }
  if (!json.access_token) {
    throw new Error(`Token request failed: ${json.error_description ?? json.error ?? 'unknown'}`)
  }
  return json.access_token
}

interface GraphMessage {
  id: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[]
  ccRecipients?:  { emailAddress?: { address?: string; name?: string } }[]
  receivedDateTime?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  isRead?: boolean
  hasAttachments?: boolean
  importance?: string
  conversationId?: string
  parentFolderId?: string
  inferenceClassification?: string
}

interface GraphFolder { id: string; displayName: string }

async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph ${res.status}: ${err.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

async function graphGetAllPages<T>(token: string, url: string): Promise<T[]> {
  const items: T[] = []
  let nextUrl: string | undefined = url
  while (nextUrl) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await graphGet(token, nextUrl)
    items.push(...(page.value ?? []))
    nextUrl = page['@odata.nextLink']
  }
  return items
}

function parseBody(msg: GraphMessage): { text: string; html: string } {
  const content = msg.body?.content ?? ''
  const type = msg.body?.contentType ?? 'text'
  if (type === 'html') {
    // Strip tags for plain text
    const stripped = content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return { text: stripped, html: content }
  }
  return { text: content, html: '' }
}

export async function fetchUnprocessedEmails(
  limit = 50,
  folder: 'inbox' | 'all' = 'all',
): Promise<ProcessedEmail[]> {
  const user = process.env.Outlookmail_USERNAME
  if (!user) throw new Error('Outlookmail_USERNAME not set')

  const token = await getGraphToken()
  const base  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}`
  const select = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments,importance,conversationId,parentFolderId,inferenceClassification'

  // Build folder ID → name map
  const folderMap = new Map<string, string>()
  if (folder === 'all') {
    try {
      const folders = await graphGetAllPages<GraphFolder>(token, `${base}/mailFolders?$top=50`)
      folders.forEach(f => folderMap.set(f.id, f.displayName))
      // Also fetch child folders
      for (const f of folders) {
        try {
          const children = await graphGetAllPages<GraphFolder>(token, `${base}/mailFolders/${f.id}/childFolders?$top=50`)
          children.forEach(c => folderMap.set(c.id, `${f.displayName} / ${c.displayName}`))
        } catch { /* skip */ }
      }
    } catch { /* folder map is optional */ }
  }

  const url = folder === 'inbox'
    ? `${base}/mailFolders/inbox/messages?$top=${Math.min(limit, 999)}&$orderby=receivedDateTime desc&$select=${select}`
    : `${base}/messages?$top=${Math.min(limit, 999)}&$orderby=receivedDateTime desc&$select=${select}`

  const messages = await graphGetAllPages<GraphMessage>(token, url)
  const limited  = messages.slice(0, limit)

  const results: ProcessedEmail[] = limited.map((msg, i) => {
    const { text, html } = parseBody(msg)
    const subject  = msg.subject ?? ''
    const bodyText = text || msg.bodyPreview || ''

    return {
      uid:            i + 1,
      graphId:        msg.id,
      subject,
      from:           msg.from?.emailAddress?.address ?? '',
      fromName:       msg.from?.emailAddress?.name ?? '',
      to:             (msg.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      cc:             (msg.ccRecipients  ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      date:           msg.receivedDateTime ?? new Date().toISOString(),
      type:           detectEmailType(subject, bodyText),
      rawBody:        bodyText.slice(0, 30000),
      bodyHtml:       html.slice(0, 100000),
      folder:         folderMap.get(msg.parentFolderId ?? '') ?? (msg.inferenceClassification === 'focused' ? 'Focused' : 'Inbox'),
      isRead:         msg.isRead ?? true,
      hasAttachments: msg.hasAttachments ?? false,
      importance:     msg.importance ?? 'normal',
      conversationId: msg.conversationId ?? '',
      parsed:         null,
    }
  })

  return results
}

// Fetch a single message by Graph message ID (used by webhook)
export async function fetchMessageById(graphMessageId: string): Promise<ProcessedEmail | null> {
  const user = process.env.Outlookmail_USERNAME
  if (!user) return null

  const token = await getGraphToken()
  const select = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments,importance,conversationId,parentFolderId,inferenceClassification'
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/messages/${graphMessageId}?$select=${select}`

  try {
    const msg: GraphMessage = await graphGet(token, url)
    const { text, html } = parseBody(msg)
    const subject = msg.subject ?? ''
    const bodyText = text || msg.bodyPreview || ''

    return {
      uid:            0,
      graphId:        msg.id,
      subject,
      from:           msg.from?.emailAddress?.address ?? '',
      fromName:       msg.from?.emailAddress?.name ?? '',
      to:             (msg.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      cc:             (msg.ccRecipients  ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      date:           msg.receivedDateTime ?? new Date().toISOString(),
      type:           detectEmailType(subject, bodyText),
      rawBody:        bodyText.slice(0, 30000),
      bodyHtml:       html.slice(0, 100000),
      folder:         'Inbox',
      isRead:         msg.isRead ?? false,
      hasAttachments: msg.hasAttachments ?? false,
      importance:     msg.importance ?? 'normal',
      conversationId: msg.conversationId ?? '',
      parsed:         null,
    }
  } catch {
    return null
  }
}

// ── Webhook subscription — DB-persisted, always-on ───────────────────────────

import { prisma } from '@/lib/prisma'

const SK_ID     = 'webhook_subscription_id'
const SK_EXPIRY = 'webhook_subscription_expiry'
const SK_URL    = 'webhook_subscription_url'

async function dbGet(key: string): Promise<string | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } })
    return row?.value ?? null
  } catch { return null }
}

async function dbSet(key: string, value: string) {
  await prisma.systemSetting.upsert({
    where:  { key },
    update: { value },
    create: { key, value },
  })
}

function notificationUrl(): string {
  const raw = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '')
  return `${raw.replace(/^http:\/\//i, 'https://')}/api/mail/webhook`
}

export async function ensureWebhookSubscription(): Promise<string> {
  const url    = notificationUrl()
  const token  = await getGraphToken()
  const user   = process.env.Outlookmail_USERNAME!
  const secret = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'

  // Load persisted state
  const [savedId, savedExpiryStr, savedUrl] = await Promise.all([
    dbGet(SK_ID), dbGet(SK_EXPIRY), dbGet(SK_URL),
  ])

  const now    = new Date()
  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days

  // Renew if still valid, URL unchanged, and not expiring within 12 h
  if (
    savedId &&
    savedExpiryStr &&
    savedUrl === url &&
    new Date(savedExpiryStr).getTime() - now.getTime() > 12 * 3600_000
  ) {
    // Patch to extend expiry
    try {
      const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${savedId}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expirationDateTime: expiry.toISOString() }),
      })
      if (r.ok) {
        await dbSet(SK_EXPIRY, expiry.toISOString())
        console.log('[Webhook] subscription renewed:', savedId)
        return savedId
      }
    } catch { /* fall through */ }
  }

  // Create new subscription
  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType:         'created',
      notificationUrl:    url,
      resource:           `users/${user}/mailFolders/inbox/messages`,
      expirationDateTime: expiry.toISOString(),
      clientState:        secret,
    }),
  })

  const json = await res.json() as { id?: string; error?: { message?: string; code?: string } }
  if (!json.id) {
    throw new Error(
      `Subscription failed [url: ${url}]: ` +
      (json.error?.message ?? JSON.stringify(json)),
    )
  }

  await Promise.all([
    dbSet(SK_ID,     json.id),
    dbSet(SK_EXPIRY, expiry.toISOString()),
    dbSet(SK_URL,    url),
  ])

  console.log('[Webhook] subscription created:', json.id)
  return json.id
}

export async function getSubscriptionStatus(): Promise<{ active: boolean; id: string | null; expiry: string | null; url: string }> {
  const [id, expiryStr] = await Promise.all([dbGet(SK_ID), dbGet(SK_EXPIRY)])
  const now    = new Date()
  const expiry = expiryStr ? new Date(expiryStr) : null
  return {
    active: !!(id && expiry && expiry > now),
    id,
    expiry: expiryStr,
    url:    notificationUrl(),
  }
}

// Called on startup and by cron — silently auto-registers/renews
export async function autoSubscribe(): Promise<void> {
  const url = notificationUrl()
  if (url.includes('localhost') || url.includes('127.0.0.1')) return // skip in local dev
  try {
    await ensureWebhookSubscription()
  } catch (err) {
    console.error('[Webhook] auto-subscribe failed:', err instanceof Error ? err.message : err)
  }
}
