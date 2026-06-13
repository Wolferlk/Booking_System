import openai from '@/lib/openai'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { extractTextFromXlsx } from '@/lib/parsers/xlsx-parser'

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

export type MailboxKind = 'TOUR_CONFIRMATION' | 'PNL'

export interface MailboxConfig {
  user: string
  kind: MailboxKind
  label: string
}

export interface EmailAttachment {
  name: string
  contentType: string
  size?: number
  buffer: Buffer
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
  // Agent contact details
  agentEmail: string | null
  agentPhone: string | null
  agentWhatsapp: string | null
  agentCountry: string | null
  agentAddress: string | null
  // Lead customer contact details
  contactEmail: string | null
  contactPhone: string | null
  contactWhatsapp: string | null
  contactCountry: string | null
  contactAddress: string | null
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
  const b = body.toLowerCase().slice(0, 3000)

  // Check PNL signals FIRST — PNL emails also contain "is number" so TQ check must come after
  if (
    s.includes('pnl') || s.includes('p&l') || s.includes('costing') || s.includes('pricing') ||
    b.includes('mmt rate') || b.includes('sic rate') || b.includes('cost per person') ||
    b.includes('pvt rate') || b.includes('hotels/cruises') || b.includes('room night') ||
    b.includes('driver accomodation') || b.includes('bata') || b.includes('quotation_no') ||
    (b.includes('transport') && b.includes('is number'))
  ) {
    return 'PNL'
  }

  if (
    s.includes('quotation') || s.includes('tour confirmation') || s.includes('confirmation') ||
    b.includes('tour confirmation') || b.includes('tour ref') || b.includes('is number') ||
    b.includes('arrival date') || b.includes('no. of guests') || b.includes('itinerary:')
  ) {
    return 'TOUR_CONFIRMATION'
  }

  return 'UNKNOWN'
}

export function getConfiguredMailboxes(): MailboxConfig[] {
  const mailboxes: MailboxConfig[] = []

  const tqUser = process.env.Outlookmail_USERNAME?.trim()
  if (tqUser) {
    mailboxes.push({
      user: tqUser,
      kind: 'TOUR_CONFIRMATION',
      label: 'Travel Quotation',
    })
  }

  const pnlUser = (process.env.GRAPH_PNL_USER ?? '').trim()
  if (pnlUser && pnlUser !== tqUser) {
    mailboxes.push({
      user: pnlUser,
      kind: 'PNL',
      label: 'Travel P&L',
    })
  }

  return mailboxes
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
  "agentEmail": "agent company email address or null",
  "agentPhone": "agent company phone number (any format) or null",
  "agentWhatsapp": "agent WhatsApp number or null",
  "agentCountry": "agent country or null",
  "agentAddress": "agent full office/mailing address or null",
  "contactEmail": "lead customer/passenger email address or null",
  "contactPhone": "lead customer/passenger phone number or null",
  "contactWhatsapp": "lead customer/passenger WhatsApp number or null",
  "contactCountry": "lead customer country or nationality or null",
  "contactAddress": "lead customer home/mailing address or null",
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
Date format must be YYYY-MM-DD strictly.
For contact details: scan email headers (From/Reply-To), email signatures, and booking form fields for email addresses, phone numbers, WhatsApp numbers, countries, and addresses. Look for both agent (sender company) and customer (traveller) contact info separately.`

const PNL_PROMPT = `You are a P&L extraction expert for AppleHolidays (MMT Vietnam).
Extract the booking IS Number and all cost line items from this email/document.

The data may come from TWO formats — handle both:

FORMAT A — HTML email body (sections like "Hotels/Cruises", "Transport", "Meals", etc.)
- Header area contains: Tour No, IS Number, Agent, No. Pax, No. Night, Currency
- Each section (Hotels/Cruises / Transport / Meals / Tickets etc.) is a table
- Use the "Total" or rightmost numeric column as the cost → put it in mmtRate
- Skip rows where Total is 0 or empty

FORMAT B — XLSX/CSV spreadsheet
- Columns: Activity | MMT Rate | SIC Rate | PVT Rate PP | AD Entrance | CH Entrance | Other Rate
- Use each column value directly

CRITICAL — Booking Reference:
1. Look for "Tour No" OR "IS Number:" OR "IS:" label in the body
   - "Tour No= #469083" or "Tour No: #469083" → strip the "#" → bookingRef is "469083"
   - "IS Number: IS 48369" → strip spaces → bookingRef is "IS48369"
   - PREFER "Tour No" over "IS Number" when both exist
2. Also check the subject line (e.g. "PNL:#464045" or "VN19579 P&L" → extract the number)
3. Strip "#" prefix and ALL SPACES: "#469083" → "469083", "VN 19679" → "VN19679"
4. Return only alphanumeric characters — no spaces, dashes, slashes, or "#"

Return ONLY valid JSON (no markdown):
{
  "bookingRef": "Tour No or IS Number cleaned (e.g. 469083, IS48369, VN19679)",
  "paxAdults": number,
  "paxChildren": number,
  "pnlLines": [
    {
      "activity": "item/expense name",
      "category": "HOTEL|TICKETS|GUIDES|MEALS|CRUISE|WATER|TRANSPORT|TAX_FEES|FLIGHT_TICKETS|OTHER",
      "mmtRate": number (agent charge OR total cost from HTML — use Total column),
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 0
    }
  ]
}

Category mapping:
- Hotels, resorts, accommodation, Best Western, check-in/out → HOTEL
- Ha Long cruise, junk, boat, yacht → CRUISE
- Airport transfer, travel km, vehicle, Bata, Paging, highway, driver → TRANSPORT
- Ba Na Hills, entrance, cable car, tickets, night show → TICKETS
- Guide fee, walking tour, city tour, sightseeing → GUIDES
- Kayaking, water sports, snorkelling → WATER
- Domestic/international flight, air ticket → FLIGHT_TICKETS
- Meals, lunch, dinner, breakfast, restaurant, water bottles → MEALS
- Visa, tax, insurance, service charge → TAX_FEES
- Profit, margin, commission, overhead, other cost → OTHER

IMPORTANT: pnlLines must NOT be empty if the email contains a cost table.`

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
    agentEmail:       parsed.agentEmail       ?? null,
    agentPhone:       parsed.agentPhone       ?? null,
    agentWhatsapp:    parsed.agentWhatsapp    ?? null,
    agentCountry:     parsed.agentCountry     ?? null,
    agentAddress:     parsed.agentAddress     ?? null,
    contactEmail:     parsed.contactEmail     ?? null,
    contactPhone:     parsed.contactPhone     ?? null,
    contactWhatsapp:  parsed.contactWhatsapp  ?? null,
    contactCountry:   parsed.contactCountry   ?? null,
    contactAddress:   parsed.contactAddress   ?? null,
    passengers:       parsed.passengers       ?? [],
    flights:          parsed.flights          ?? [],
    accommodations:   parsed.accommodations   ?? [],
    itineraryItems:   parsed.itineraryItems   ?? [],
    emergencyContacts: parsed.emergencyContacts ?? [],
    pnlLines:         parsed.pnlLines         ?? [],
  }
}

// ── Microsoft Graph API email reader ─────────────────────────────────────────

export async function getGraphToken(credentialSet: 'default' | 'pnl' = 'default'): Promise<string> {
  let tenantId: string | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined

  if (credentialSet === 'pnl' && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET) {
    tenantId     = process.env.GRAPH_TENANT_ID ?? process.env.Azure_TENANT_ID
    clientId     = process.env.GRAPH_CLIENT_ID
    clientSecret = process.env.GRAPH_CLIENT_SECRET
  } else {
    tenantId     = process.env.Azure_TENANT_ID
    clientId     = process.env.Azure_CLIENT_ID
    clientSecret = process.env.Azure_CLIENT_SECRET
  }

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

function isPnlMailboxUser(user: string): boolean {
  const pnlUser = process.env.GRAPH_PNL_USER?.trim()
  return !!pnlUser && user === pnlUser
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

async function fetchAttachmentsForMessage(token: string, base: string, graphMessageId: string): Promise<EmailAttachment[]> {
  type GraphAttachment = {
    name?: string
    contentType?: string
    size?: number
    contentBytes?: string
    '@odata.type'?: string
  }

  const url = `${base}/messages/${graphMessageId}/attachments?$top=50`

  try {
    const attachments = await graphGetAllPages<GraphAttachment>(token, url)
    return attachments
      .filter(att => (att['@odata.type'] ?? '').includes('fileAttachment') && att.contentBytes)
      .map(att => ({
        name: att.name ?? 'attachment.bin',
        contentType: att.contentType ?? 'application/octet-stream',
        size: att.size ?? 0,
        buffer: Buffer.from(att.contentBytes ?? '', 'base64'),
      }))
  } catch {
    return []
  }
}

async function buildAttachmentText(attachment: EmailAttachment): Promise<string> {
  const fileName = attachment.name.toLowerCase()

  if (fileName.endsWith('.docx')) {
    return extractTextFromDocx(attachment.buffer)
  }

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return extractTextFromXlsx(attachment.buffer)
  }

  if (fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
    return attachment.buffer.toString('utf-8')
  }

  return ''
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

  return fetchUnprocessedEmailsForUser(user, limit, folder)
}

export async function fetchUnprocessedEmailsForUser(
  user: string,
  limit = 50,
  folder: 'inbox' | 'all' = 'all',
): Promise<ProcessedEmail[]> {
  if (!user) throw new Error('Mailbox user not set')

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
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

  // Mailbox identity is the authoritative source of email type —
  // content-based detection is unreliable (TQ bodies contain PNL keywords like "transport"/"is number")
  const tqUser  = (process.env.Outlookmail_USERNAME ?? '').trim()
  const pnlUser = (process.env.GRAPH_PNL_USER ?? '').trim()
  const forcedType: ProcessedEmail['type'] | null =
    user === tqUser  && tqUser  ? 'TOUR_CONFIRMATION' :
    user === pnlUser && pnlUser ? 'PNL'               : null

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
      type:           forcedType ?? detectEmailType(subject, bodyText),
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

  return fetchMessageByIdForUser(user, graphMessageId)
}

export async function fetchMessageByIdForUser(
  user: string,
  graphMessageId: string,
): Promise<ProcessedEmail | null> {
  if (!user) return null

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
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

export async function fetchMessageAttachmentsForUser(
  user: string,
  graphMessageId: string,
): Promise<EmailAttachment[]> {
  if (!user) return []

  // IMAP emails use a synthetic "imap2_<uid>" graphId — route to IMAP fetcher
  if (graphMessageId.startsWith('imap2_')) {
    const { fetchImapAttachments } = await import('@/lib/imap-pnl')
    return fetchImapAttachments(graphMessageId)
  }

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
  const base  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}`
  return fetchAttachmentsForMessage(token, base, graphMessageId)
}

export async function extractEmailSourceTextForUser(
  user: string,
  email: ProcessedEmail,
): Promise<{ rawText: string; attachments: EmailAttachment[] }> {
  const attachments = email.hasAttachments
    ? await fetchMessageAttachmentsForUser(user, email.graphId)
    : []

  const supportedText = await Promise.all(attachments.map(buildAttachmentText))
  const attachmentText = supportedText.filter(Boolean).join('\n\n')

  return {
    rawText: [email.rawBody, attachmentText].filter(Boolean).join('\n\n'),
    attachments,
  }
}

// ── Webhook subscription — DB-persisted, multi-mailbox ───────────────────────

import { prisma } from '@/lib/prisma'

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

// Per-user DB key helpers
function skSubId(user: string)     { return `webhook_sub_id_${user}` }
function skSubExpiry(user: string) { return `webhook_sub_expiry_${user}` }
function skSubUser(subId: string)  { return `webhook_sub_user_${subId}` }
function skSubKind(subId: string)  { return `webhook_sub_kind_${subId}` }

async function ensureWebhookSubscriptionForUser(
  user: string,
  kind: MailboxKind,
  token: string,
  url: string,
  secret: string,
): Promise<string> {
  const savedId      = await dbGet(skSubId(user))
  const savedExpiry  = await dbGet(skSubExpiry(user))
  const now          = new Date()
  const nextExpiry   = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

  if (savedId && savedExpiry && new Date(savedExpiry) > now) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${savedId}`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expirationDateTime: nextExpiry.toISOString() }),
    })
    if (r.ok) {
      await dbSet(skSubExpiry(user), nextExpiry.toISOString())
      console.log(`[Webhook] renewed ${kind} subscription for ${user}:`, savedId)
      return savedId
    }
    console.warn(`[Webhook] PATCH failed for ${user} (${r.status}), recreating`)
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType:         'created',
      notificationUrl:    url,
      resource:           `users/${user}/mailFolders/inbox/messages`,
      expirationDateTime: nextExpiry.toISOString(),
      clientState:        secret,
    }),
  })

  const json = await res.json() as { id?: string; error?: { message?: string; code?: string } }
  if (!json.id) {
    throw new Error(
      `Subscription failed for ${user} [url: ${url}]: ` +
      (json.error?.message ?? JSON.stringify(json)),
    )
  }

  await Promise.all([
    dbSet(skSubId(user),      json.id),
    dbSet(skSubExpiry(user),  nextExpiry.toISOString()),
    dbSet(skSubUser(json.id), user),
    dbSet(skSubKind(json.id), kind),
  ])

  console.log(`[Webhook] created ${kind} subscription for ${user}:`, json.id)
  return json.id
}

// Subscribe all configured mailboxes and return their subscription IDs
export async function ensureAllWebhookSubscriptions(): Promise<string[]> {
  const url       = notificationUrl()
  const secret    = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'
  const mailboxes = getConfiguredMailboxes()

  const ids: string[] = []
  for (const mb of mailboxes) {
    try {
      const mbToken = await getGraphToken(isPnlMailboxUser(mb.user) ? 'pnl' : 'default')
      const id = await ensureWebhookSubscriptionForUser(mb.user, mb.kind, mbToken, url, secret)
      ids.push(id)
    } catch (err) {
      console.error(`[Webhook] subscription failed for ${mb.user}:`, err instanceof Error ? err.message : err)
    }
  }
  return ids
}

// Look up which mailbox user+kind a subscription ID belongs to
export async function lookupSubscription(subscriptionId: string): Promise<{ user: string; kind: MailboxKind } | null> {
  const [user, kind] = await Promise.all([
    dbGet(skSubUser(subscriptionId)),
    dbGet(skSubKind(subscriptionId)),
  ])
  if (!user || !kind) return null
  return { user, kind: kind as MailboxKind }
}

// Backward-compat: subscribe only the TQ mailbox
export async function ensureWebhookSubscription(): Promise<string> {
  const url    = notificationUrl()
  const secret = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'
  const token  = await getGraphToken()
  const tqUser = process.env.Outlookmail_USERNAME
  if (!tqUser) throw new Error('Outlookmail_USERNAME not set')
  return ensureWebhookSubscriptionForUser(tqUser, 'TOUR_CONFIRMATION', token, url, secret)
}

export async function getSubscriptionStatus(): Promise<{
  active: boolean
  id: string | null
  expiry: string | null
  url: string
  mailboxes: Array<{ user: string; kind: MailboxKind; active: boolean; id: string | null; expiry: string | null; source?: string }>
}> {
  const url      = notificationUrl()
  const now      = new Date()
  const mailboxes = getConfiguredMailboxes()

  const statuses = await Promise.all(mailboxes.map(async mb => {
    const id        = await dbGet(skSubId(mb.user))
    const expiryStr = await dbGet(skSubExpiry(mb.user))
    const expiry    = expiryStr ? new Date(expiryStr) : null
    return { user: mb.user, kind: mb.kind, active: !!(id && expiry && expiry > now), id: id ?? null, expiry: expiryStr ?? null, source: 'graph' as 'graph' | 'imap' }
  }))

  const primary = statuses[0]
  return {
    active:    statuses.some(s => s.active),
    id:        primary?.id ?? null,
    expiry:    primary?.expiry ?? null,
    url,
    mailboxes: statuses,
  }
}

// Called on startup and by cron — silently registers/renews all mailboxes
export async function autoSubscribe(): Promise<void> {
  const url = notificationUrl()
  if (url.includes('localhost') || url.includes('127.0.0.1')) return
  try {
    await ensureAllWebhookSubscriptions()
  } catch (err) {
    console.error('[Webhook] auto-subscribe failed:', err instanceof Error ? err.message : err)
  }
}
