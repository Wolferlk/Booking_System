import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'
import { classifyPNLCategories } from '@/lib/openai'
import { extractBookingFromEmail, type ProcessedEmail, type MailboxKind, type EmailAttachment } from '@/lib/mail-processor'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { detectCountryFromText, detectCountryFromRef } from '@/lib/country-detection'
import fs from 'fs'
import path from 'path'

// ── Terminal logging helpers ──────────────────────────────────────────────────

const SEP = '─'.repeat(60)

function mailLog(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return
  const pad = 14
  console.log(`[Mail]  ${label.padEnd(pad)}: ${value}`)
}

function mailHeader(type: string, subject: string, from: string, fromName: string) {
  console.log(`\n${SEP}`)
  console.log(` NEW EMAIL  →  ${type}`)
  console.log(`  From    : ${fromName ? `${fromName} <${from}>` : from}`)
  console.log(`  Subject : ${subject}`)
  console.log(SEP)
}

type SyncResult = {
  bookingRef: string
  bookingId: string
  mode: 'TOUR_CONFIRMATION' | 'PNL'
  isNew: boolean
  pnlLines: number
  agendaItems: number
  status: 'GT_REVIEW' | 'PNL_WAITING'
}

const TICKETABLE_CATEGORIES = new Set(['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS'])

// Use IS number (VN/IS/SG/MY prefix) as the system ref when available; fall back to AH-prefixed ref
function generateRef(isNumber?: string | null): string {
  if (isNumber && IS_NUMBER_RE.test(isNumber)) return isNumber.toUpperCase()
  return `AH${Date.now().toString(36).toUpperCase().slice(-6)}`
}

// IS Number pattern: VN / IS / SG / MY / AH followed by digits
const IS_NUMBER_RE = /^(VN|IS|SG|MY|AH)\d{3,}/i

// CNTL number pattern: digits followed by CNTL, or CNTL followed by digits
const CNTL_RE = /^\d+CNTL$|^CNTL\d+$/i

/**
 * Some TC Tour Refs embed the IS Number after `||` or ` / `.
 * e.g. "463720CNTL||SG22228" or "459773CNTL / VN19428"
 * Returns { tourRef, isNumber, cntlNumber } where cntlNumber is populated
 * when the tourRef portion matches a CNTL pattern.
 */
function splitTourRef(raw: string | null): { tourRef: string | null; isNumber: string | null; cntlNumber: string | null } {
  if (!raw) return { tourRef: null, isNumber: null, cntlNumber: null }

  let before: string = raw
  let embeddedIsNumber: string | null = null

  // Check for || separator
  const pipeIdx = raw.indexOf('||')
  if (pipeIdx !== -1) {
    const b = raw.slice(0, pipeIdx).trim()
    const a = raw.slice(pipeIdx + 2).trim()
    if (IS_NUMBER_RE.test(a)) { before = b; embeddedIsNumber = a.toUpperCase() }
  }
  // Check for " / " separator
  if (!embeddedIsNumber) {
    const slashIdx = raw.indexOf(' / ')
    if (slashIdx !== -1) {
      const b = raw.slice(0, slashIdx).trim()
      const a = raw.slice(slashIdx + 3).trim()
      if (IS_NUMBER_RE.test(a)) { before = b; embeddedIsNumber = a.toUpperCase() }
    }
  }

  const cntlNumber = CNTL_RE.test(before) ? before.toUpperCase() : null
  const tourRef    = cntlNumber ? null : (before || null)
  return { tourRef, isNumber: embeddedIsNumber, cntlNumber }
}

function normalizeType(type: MailboxKind): 'TOUR_CONFIRMATION' | 'PNL' {
  return type === 'PNL' ? 'PNL' : 'TOUR_CONFIRMATION'
}

function pickAttachment(attachments: EmailAttachment[], extensions: string[]): EmailAttachment | null {
  return attachments.find(att => extensions.some(ext => att.name.toLowerCase().endsWith(ext))) ?? null
}

function loadConditions(): string {
  const conditionsPath = path.join(process.cwd(), 'public', 'Generating_Agenda_conditions.md')
  try {
    return fs.readFileSync(conditionsPath, 'utf-8')
  } catch {
    return ''
  }
}

const MEAL_ABBREV: Record<string, string> = {
  'B':   'Breakfast',
  'L':   'Lunch',
  'D':   'Dinner',
  'BL':  'Breakfast, Lunch',
  'LB':  'Breakfast, Lunch',
  'BD':  'Breakfast, Dinner',
  'DB':  'Breakfast, Dinner',
  'LD':  'Lunch, Dinner',
  'DL':  'Lunch, Dinner',
  'BLD': 'Breakfast, Lunch, Dinner',
  'BDL': 'Breakfast, Lunch, Dinner',
  'LBD': 'Breakfast, Lunch, Dinner',
}

function normalizeMealPlan(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()
  const upper = trimmed.toUpperCase().replace(/[\s,\/]+/g, '')
  if (MEAL_ABBREV[upper]) return MEAL_ABBREV[upper]
  return trimmed
}

async function buildAgendaItems(data: Awaited<ReturnType<typeof extractBookingFromEmail>>, bookingRef: string): Promise<any[]> {
  const openaiModule = await import('@/lib/openai')
  const openai = openaiModule.default
  const { logAiUsage } = openaiModule
  const conditions = loadConditions()

  const docText = JSON.stringify({
    bookingRef,
    arrivalDate:    data.arrivalDate,
    departureDate:  data.departureDate,
    paxAdults:      data.paxAdults,
    paxChildren:    data.paxChildren,
    flights:        data.flights,
    accommodations: data.accommodations,
    itineraryItems: data.itineraryItems,
  }, null, 2)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Vietnam/Asia tour operations expert. Generate movement chart from booking data.
RULES: ${conditions}

SERVICE TYPE — MANDATORY (use exactly one of these values):
- International/domestic flight leg → serviceType="FLIGHT", meetingTime = depTime minus 3 hours, fromPoint = "Flight <flightNo>" (e.g. "Flight VZ123"), toPoint = destination airport code
- ARRIVAL airport road transfer (airport → hotel) → serviceType="PVT_TRANSFER", meetingTime = flight arrTime PLUS 30 minutes (NOT 45), fromPoint = "Airport" or flight number, toPoint = hotel name
- DEPARTURE airport road transfer (hotel → airport) → serviceType="PVT_TRANSFER", meetingTime = flight depTime minus 3 hours, fromPoint = hotel name, toPoint = "Airport"
- Internal SIC tour: the word "SIC" must be EXPLICITLY in the ACTIVITY TITLE → serviceType="SIC_TRANSFER"
- Private tour / private transfer / waterfall / nature activity / "Private basis" → serviceType="PVT_TRANSFER"
- Hotel check-in / accommodation stay only → serviceType="ACCOMMODATION", meetingTime=null
- Private guided day tour (not SIC) → serviceType="PVT_TRANSFER"
- "Own Arrangement" / leisure day / free time / at leisure — PRESERVE EXACTLY, never convert to PVT_TRANSFER → serviceType="OWN_ARRANGEMENT", meetingTime=null
- Ticket-only / self-guided / entrance only (no vehicle transfer) → serviceType="INTERNAL_TOUR", meetingTime=activity start time or 08:00

MEAL PLAN — Always use full English names (NEVER abbreviations like B, L, D):
- "Breakfast" (not B)
- "Lunch" (not L)
- "Dinner" (not D)
- "Breakfast, Lunch" (not BL)
- "Breakfast, Dinner" (not BD)
- "Breakfast, Lunch, Dinner" (not BLD)
- If TC states "Not Included" or meals are not provided, use null

ARRIVAL TRANSFER TIMING: meetingTime for arrival road transfer = flight arrival time + 30 minutes exactly.

SIC TIME RANGE — For SIC_TRANSFER items, always include timeFrom and timeTo fields:
- timeFrom: pickup/meeting time (e.g. "07:30")
- timeTo: estimated return time (e.g. "18:00")

Return JSON { "items": [{"date":"YYYY-MM-DD","location":"string","fromPoint":"string|null","toPoint":"string|null","details":"string|null","mealPlan":"Breakfast|Lunch|Dinner|Breakfast, Lunch|Breakfast, Dinner|Breakfast, Lunch, Dinner|null","meetingTime":"HH:MM or null","timeFrom":"HH:MM or null","timeTo":"HH:MM or null","serviceType":"PVT_TRANSFER|SIC_TRANSFER|OWN_ARRANGEMENT|FLIGHT|INTERNAL_TOUR|ACCOMMODATION"}] }`,
      },
      { role: 'user', content: `Generate movement chart for booking ${bookingRef}:\n\n${docText.slice(0, 10000)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })
  await logAiUsage({ callType: 'agenda_generation', model: 'gpt-4o', usage: response.usage, bookingRef, source: 'email' })

  const content = response.choices[0]?.message?.content
  if (!content) return []
  try {
    const parsed = JSON.parse(content) as { items?: any[] }
    const rawItems: any[] = Array.isArray(parsed) ? parsed : (parsed.items ?? [])

    const AIRPORT_ROAD_RE  = /\b(airport|terminal|arr\.|dep\.|arrival|departure)\b/i
    const FLIGHT_RE        = /\b(fly|flight|✈|airline|airways)\b/i
    const LEISURE_RE       = /\b(leisure|free day|free time|at leisure|relax|no activ|own arrangement)\b/i
    const ACCOMMODATION_RE = /\b(check.?in|check.?out|hotel stay|accommodation)\b/i
    const SIC_RE           = /\bsic\b/i
    const VALID_TYPES      = new Set(['PVT_TRANSFER','SIC_TRANSFER','OWN_ARRANGEMENT','FLIGHT','INTERNAL_TOUR','ACCOMMODATION'])

    return rawItems.map((item: any) => {
      const from = String(item.fromPoint ?? '')
      const to   = String(item.toPoint   ?? '')
      const det  = String(item.details   ?? '')
      const loc  = String(item.location  ?? '')
      const aiType: string = VALID_TYPES.has(item.serviceType) ? item.serviceType : 'OWN_ARRANGEMENT'
      let serviceType = aiType

      // OWN_ARRANGEMENT from AI must be preserved — never silently convert to PVT_TRANSFER
      if (aiType === 'OWN_ARRANGEMENT') {
        serviceType = 'OWN_ARRANGEMENT'
      } else if (FLIGHT_RE.test(loc) || FLIGHT_RE.test(det)) {
        serviceType = 'FLIGHT'
      } else if (AIRPORT_ROAD_RE.test(from) || AIRPORT_ROAD_RE.test(to)) {
        serviceType = 'PVT_TRANSFER'
      } else if (SIC_RE.test(loc)) {
        serviceType = 'SIC_TRANSFER'
      } else if (LEISURE_RE.test(det) || LEISURE_RE.test(loc)) {
        serviceType = 'OWN_ARRANGEMENT'
      } else if (ACCOMMODATION_RE.test(det) || ACCOMMODATION_RE.test(loc)) {
        serviceType = 'ACCOMMODATION'
      }

      const meetingTime = serviceType === 'OWN_ARRANGEMENT' || serviceType === 'ACCOMMODATION'
        ? null
        : (item.meetingTime ?? null)

      return {
        ...item,
        serviceType,
        meetingTime,
        mealPlan: normalizeMealPlan(item.mealPlan),
        timeFrom: item.timeFrom ?? null,
        timeTo:   item.timeTo   ?? null,
      }
    })
  } catch {
    return []
  }
}

// Builds a minimal fallback agenda from raw booking data when OpenAI returns nothing.
function buildSkeletonAgenda(data: Awaited<ReturnType<typeof extractBookingFromEmail>>): any[] {
  if (!data.arrivalDate || !data.departureDate) return []

  const items: any[] = []

  // Arrival transfer
  const firstHotel = data.accommodations[0]?.hotel ?? 'Hotel'
  items.push({
    date:        data.arrivalDate,
    location:    'Arrival',
    fromPoint:   'Airport',
    toPoint:     firstHotel,
    details:     `Airport → ${firstHotel} transfer${data.paxAdults > 0 ? ` · ${data.paxAdults} Adults${data.paxChildren > 0 ? ` ${data.paxChildren} Children` : ''}` : ''}`,
    mealPlan:    null,
    meetingTime: null,
    serviceType: 'PVT_TRANSFER',
  })

  // One item per accommodation stay
  for (const acc of data.accommodations) {
    if (!acc.checkIn) continue
    items.push({
      date:        acc.checkIn,
      location:    acc.city ?? acc.hotel,
      fromPoint:   null,
      toPoint:     acc.hotel,
      details:     `Check-in ${acc.hotel}${acc.nights ? ` · ${acc.nights} night${acc.nights > 1 ? 's' : ''}` : ''}${acc.mealType ? ` · ${acc.mealType}` : ''}`,
      mealPlan:    acc.mealType ?? null,
      meetingTime: null,
      serviceType: 'OWN_ARRANGEMENT',
    })
  }

  // Flights as transfer items
  for (const flight of data.flights) {
    if (!flight.date) continue
    const depM = flight.depTime ? (() => {
      const [h, m] = flight.depTime!.split(':').map(Number)
      const total = h * 60 + m - 180
      const nh = Math.max(0, Math.floor(total / 60))
      const nm = ((total % 60) + 60) % 60
      return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
    })() : null
    items.push({
      date:        flight.date,
      location:    flight.fromApt,
      fromPoint:   flight.fromApt,
      toPoint:     flight.toApt,
      details:     `Flight ${flight.flightNo}${flight.depTime ? ` dep ${flight.depTime}` : ''}${flight.arrTime ? ` arr ${flight.arrTime}` : ''}`,
      mealPlan:    null,
      meetingTime: depM,
      serviceType: 'PVT_TRANSFER',
    })
  }

  // Departure transfer
  const lastHotel = data.accommodations.at(-1)?.hotel ?? 'Hotel'
  if (data.departureDate !== data.arrivalDate) {
    items.push({
      date:        data.departureDate,
      location:    'Departure',
      fromPoint:   lastHotel,
      toPoint:     'Airport',
      details:     `${lastHotel} → Airport transfer`,
      mealPlan:    null,
      meetingTime: null,
      serviceType: 'PVT_TRANSFER',
    })
  }

  // Sort by date then location
  items.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  return items
}

async function getAutomationUserId(): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  })
  if (user?.id) return user.id

  const bt = await prisma.user.findFirst({
    where: { role: 'BT_USER' },
    select: { id: true },
  })
  if (bt?.id) return bt.id

  throw new Error('No automation user found')
}

async function replaceBookingChildren(bookingId: string, extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>) {
  await prisma.passenger.deleteMany({ where: { bookingId } })
  await prisma.flight.deleteMany({ where: { bookingId } })
  await prisma.accommodation.deleteMany({ where: { bookingId } })
  await prisma.itineraryItem.deleteMany({ where: { bookingId } })
  await prisma.emergencyContact.deleteMany({ where: { bookingId } })

  if (extracted.passengers.length > 0) {
    await prisma.passenger.createMany({
      data: extracted.passengers.map(p => ({
        bookingId,
        name:           p.name,
        type:           (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
        isLead:         p.isLead ?? false,
        age:            (p as Record<string, unknown>).age as number | null ?? null,
        passport:       (p as Record<string, unknown>).passport as string | null ?? null,
        nationality:    (p as Record<string, unknown>).nationality as string | null ?? null,
        contact:        (p as Record<string, unknown>).contact as string | null ?? null,
        mealPreference: (p as Record<string, unknown>).mealPreference as string | null ?? null,
      })),
    })
  }

  if (extracted.flights.length > 0) {
    await prisma.flight.createMany({
      data: extracted.flights.map(f => ({
        bookingId,
        flightNo: f.flightNo,
        date: new Date(f.date),
        fromApt: f.fromApt,
        depTime: f.depTime ?? '',
        toApt: f.toApt,
        arrTime: f.arrTime ?? '',
        airline: f.airline ?? null,
      })),
    })
  }

  if (extracted.accommodations.length > 0) {
    await prisma.accommodation.createMany({
      data: extracted.accommodations.map(a => ({
        bookingId,
        hotel: a.hotel,
        city: a.city,
        checkIn: new Date(a.checkIn),
        checkOut: new Date(a.checkOut),
        nights: a.nights,
        roomType: a.roomType ?? null,
        mealType: a.mealType ?? null,
      })),
    })
  }

  if (extracted.itineraryItems.length > 0) {
    await prisma.itineraryItem.createMany({
      data: extracted.itineraryItems.map(item => ({
        bookingId,
        dayNo: item.dayNo,
        date: new Date(item.date),
        title: String(item.title ?? '').slice(0, 1000),
        description: item.description ?? null,
      })),
    })
  }

  if (extracted.emergencyContacts.length > 0) {
    await prisma.emergencyContact.createMany({
      data: extracted.emergencyContacts.map(ec => ({
        bookingId,
        name: ec.name,
        phone: ec.phone ?? null,
        role: ec.role ?? null,
      })),
    })
  }
}

export async function upsertAgenda(
  bookingId: string,
  bookingRef: string,
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
  skipIfExists = false,
) {
  if (!extracted.arrivalDate || !extracted.departureDate) return 0

  // If the caller wants to preserve an already-generated agenda, skip
  if (skipIfExists) {
    const existing = await prisma.tourAgenda.findUnique({ where: { bookingId } })
    if (existing) return 0
  }

  try {
    // Check if AI agenda generation is enabled (default: true)
    const agendaSetting = await prisma.systemSetting.findUnique({ where: { key: 'ai_auto_agenda_generate' } })
    const agendaAIEnabled = agendaSetting?.value !== 'false'

    // 1st attempt: AI-generated movement chart (skipped if setting is OFF)
    let agendaItems: any[] = agendaAIEnabled
      ? await buildAgendaItems(extracted, bookingRef)
      : []

    if (!agendaAIEnabled) {
      console.log(`[Automation] AI agenda generation disabled for ${bookingRef} — using skeleton only`)
    }

    // 2nd attempt (fallback): build a minimal skeleton from raw booking data
    if (!agendaItems.length) {
      console.warn(`[Automation] OpenAI returned no agenda items for ${bookingRef} — using skeleton fallback`)
      agendaItems = buildSkeletonAgenda(extracted)
    }

    if (!agendaItems.length) return 0

    let agenda = await prisma.tourAgenda.findUnique({ where: { bookingId } })
    if (!agenda) {
      agenda = await prisma.tourAgenda.create({ data: { bookingId } })
    } else {
      await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })
    }

    for (const item of agendaItems as any[]) {
      if (!item.date) continue
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma.agendaItem as any).create({
          data: {
            agendaId:    agenda.id,
            date:        new Date(item.date),
            location:    item.location ?? '',
            fromPoint:   item.fromPoint ?? null,
            toPoint:     item.toPoint ?? null,
            details:     item.details ?? null,
            mealPlan:    item.mealPlan ?? null,
            meetingTime: item.meetingTime ?? null,
            timeFrom:    item.timeFrom ?? null,
            timeTo:      item.timeTo ?? null,
            serviceType: item.serviceType ?? 'OWN_ARRANGEMENT',
          },
        })
      } catch (itemErr) {
        console.error(`[Automation] Failed to save agenda item for ${bookingRef}:`, itemErr)
      }
    }

    return agendaItems.length
  } catch (err) {
    console.error(`[Automation] Agenda generation failed for ${bookingRef}:`, err)
    return 0
  }
}

async function syncTourConfirmation(
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
  createdById: string,
): Promise<SyncResult> {
  // Split TC Tour Ref: may embed IS Number after || or " / "; CNTL part goes to cntlNumber
  const { tourRef: tcTourRef, isNumber: embeddedIsNumber, cntlNumber: embeddedCntlNumber } = splitTourRef(extracted.bookingRef as string | null)

  // Prefer explicitly extracted IS Number; fall back to embedded one from Tour Ref;
  // finally check if tourRef itself IS an IS/VN/SG/MY number (AI put it in bookingRef only)
  const resolvedIsNumber: string | null =
    (extracted.isNumber as string | null) ??
    embeddedIsNumber ??
    (tcTourRef && IS_NUMBER_RE.test(tcTourRef) ? tcTourRef.toUpperCase() : null)

  // CNTL number: from AI extraction or embedded in TC Tour Ref
  const resolvedCntlNumber: string | null = extracted.cntlNumber ?? embeddedCntlNumber ?? null

  // Non-CNTL agent reference (agent's own booking ID)
  const resolvedAgentBookingId: string | null = tcTourRef ?? (extracted.agentBookingId as string | null) ?? null

  // Try to find an existing booking to update (e.g. amendment of an existing TC):
  // 1. Match by cntlNumber (most specific for quotation-based TCs)
  // 2. Match by agentBookingId (non-CNTL agent refs, or legacy CNTL stored before new field)
  // 3. Match by isNumber
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing = resolvedCntlNumber
    ? await (prisma.booking.findFirst as any)({ where: { cntlNumber: resolvedCntlNumber } })
    : null
  if (!existing && resolvedAgentBookingId) {
    existing = await prisma.booking.findFirst({ where: { agentBookingId: resolvedAgentBookingId } })
  }
  if (!existing && resolvedIsNumber) {
    existing = await prisma.booking.findFirst({ where: { isNumber: resolvedIsNumber }, orderBy: { createdAt: 'desc' } })
  }

  // Prefer IS number as bookingRef; fall back to AH-prefixed ref for new bookings
  const bookingRef = existing?.bookingRef ?? generateRef(resolvedIsNumber)
  const isNew = !existing

  if (!extracted.arrivalDate || !extracted.departureDate) {
    throw new Error(`Missing arrival/departure dates for tour confirmation ${bookingRef}`)
  }

  // Detect country from IS number prefix (VN/IS/SG/MY), TC Tour Ref, or email text
  const detectedCountry =
    (resolvedIsNumber ? detectCountryFromRef(resolvedIsNumber) : null) ??
    (tcTourRef        ? detectCountryFromRef(tcTourRef)         : null) ??
    (extracted as any)._detectedCountry ??
    null

  const bookingData = {
    bookingRef,
    agentBookingId:   resolvedAgentBookingId,
    cntlNumber:       resolvedCntlNumber,
    agent:            extracted.agent ?? 'Unknown Agent',
    fileHandler:      extracted.fileHandler,
    arrivalDate:      new Date(extracted.arrivalDate),
    departureDate:    new Date(extracted.departureDate),
    paxAdults:        extracted.paxAdults,
    paxChildren:      extracted.paxChildren,
    quotedTotal:      extracted.quotedTotal ?? 0,
    currency:         extracted.currency ?? 'USD',
    terms:            extracted.terms,
    exclusions:       extracted.exclusions,
    valueAddedServices: extracted.valueAddedServices ?? undefined,
    packageIncludes:    extracted.packageIncludes    ?? undefined,
    packageExcludes:    extracted.packageExcludes    ?? undefined,
    importantNotes:     extracted.importantNotes     ?? undefined,
    tips:               extracted.tips               ?? undefined,
    otherNote:          extracted.otherNote          ?? undefined,
    clientRequest:      extracted.clientRequest      ?? undefined,
    agentEmail:       extracted.agentEmail,
    agentPhone:       extracted.agentPhone,
    agentWhatsapp:    extracted.agentWhatsapp,
    agentCountry:     extracted.agentCountry,
    agentAddress:     extracted.agentAddress,
    contactEmail:     extracted.contactEmail,
    contactPhone:     extracted.contactPhone,
    contactWhatsapp:  extracted.contactWhatsapp,
    contactCountry:   extracted.contactCountry,
    contactAddress:   extracted.contactAddress,
    operationCountry: detectedCountry ?? undefined,
    status:           'GT_REVIEW' as const,
    // TC-specific fields
    isNumber:           resolvedIsNumber            ?? undefined,
    dealName:           extracted.dealName         ?? undefined,
    tourDestination:    extracted.tourDestination  ?? undefined,
    chauffeurContact:   extracted.chauffeurContact ?? undefined,
    languagePreference: extracted.languagePreference ?? undefined,
    specialOccasions:   extracted.specialOccasions ?? undefined,
    checkedBy:          extracted.checkedBy        ?? undefined,
    reconfirmBy:        extracted.reconfirmBy      ?? undefined,
    ...(isNew ? { createdById } : {}),
  }

  const booking = isNew
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (prisma.booking.create as any)({ data: { ...bookingData, createdById } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : await (prisma.booking.update as any)({
      where: { bookingRef },
      data: {
        agentBookingId:     bookingData.agentBookingId,
        cntlNumber:         bookingData.cntlNumber,
        agent:              bookingData.agent,
        fileHandler:        bookingData.fileHandler,
        arrivalDate:        bookingData.arrivalDate,
        departureDate:      bookingData.departureDate,
        paxAdults:          bookingData.paxAdults,
        paxChildren:        bookingData.paxChildren,
        quotedTotal:        bookingData.quotedTotal,
        currency:           bookingData.currency,
        terms:              bookingData.terms,
        exclusions:         bookingData.exclusions,
        valueAddedServices: bookingData.valueAddedServices,
        packageIncludes:    bookingData.packageIncludes,
        packageExcludes:    bookingData.packageExcludes,
        importantNotes:     bookingData.importantNotes,
        tips:               bookingData.tips,
        otherNote:          bookingData.otherNote,
        clientRequest:      bookingData.clientRequest,
        agentEmail:         bookingData.agentEmail,
        agentPhone:         bookingData.agentPhone,
        agentWhatsapp:      bookingData.agentWhatsapp,
        agentCountry:       bookingData.agentCountry,
        agentAddress:       bookingData.agentAddress,
        contactEmail:       bookingData.contactEmail,
        contactPhone:       bookingData.contactPhone,
        contactWhatsapp:    bookingData.contactWhatsapp,
        contactCountry:     bookingData.contactCountry,
        contactAddress:     bookingData.contactAddress,
        isNumber:           bookingData.isNumber,
        dealName:           bookingData.dealName,
        tourDestination:    bookingData.tourDestination,
        chauffeurContact:   bookingData.chauffeurContact,
        languagePreference: bookingData.languagePreference,
        specialOccasions:   bookingData.specialOccasions,
        checkedBy:          bookingData.checkedBy,
        reconfirmBy:        bookingData.reconfirmBy,
        status: 'GT_REVIEW',
      },
    })

  await replaceBookingChildren(booking.id, extracted)

  const agendaItems = await upsertAgenda(booking.id, bookingRef, extracted)

  // ── Terminal output ───────────────────────────────────────────────────────
  console.log(`[Mail]  Booking ref  : ${bookingRef}  (${isNew ? 'CREATED NEW' : 'UPDATED existing'})`)
  mailLog('Agent',        extracted.agent)
  mailLog('Deal',         extracted.dealName)
  mailLog('Destination',  extracted.tourDestination)
  mailLog('Arrive',       extracted.arrivalDate)
  mailLog('Depart',       extracted.departureDate)
  mailLog('Pax',          `${extracted.paxAdults} adult${extracted.paxAdults !== 1 ? 's' : ''}${extracted.paxChildren ? ` + ${extracted.paxChildren} child${extracted.paxChildren !== 1 ? 'ren' : ''}` : ''}`)
  mailLog('Passengers',   extracted.passengers.length ? extracted.passengers.map(p => p.name).join(', ') : null)
  mailLog('Flights',      extracted.flights.length ? `${extracted.flights.length} flight(s)` : null)
  mailLog('Hotels',       extracted.accommodations.length ? extracted.accommodations.map(a => a.hotel).join(' → ') : null)
  mailLog('Agenda items', agendaItems > 0 ? `${agendaItems} generated` : 'none')
  console.log(`[Mail]  ✓ DONE${SEP.slice(8)}\n`)
  // ─────────────────────────────────────────────────────────────────────────

  await logActivity({
    userId: createdById,
    action: ACTION.BOOKING_CREATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: { source: 'email', emailType: 'TOUR_CONFIRMATION', bookingRef, agendaItems, pnlLines: 0 },
  })

  return {
    bookingRef,
    bookingId: booking.id,
    mode: 'TOUR_CONFIRMATION',
    isNew,
    pnlLines: 0,
    agendaItems,
    status: 'GT_REVIEW' as const,
  }
}

async function syncPnL(
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
  attachments: EmailAttachment[],
  createdById: string,
): Promise<SyncResult> {
  // Parse XLSX once up-front so we get both the booking ref and the line items
  const xlsxAttachment = pickAttachment(attachments, ['.xlsx', '.xls'])
  let xlsxParsed: ReturnType<typeof parsePNLXlsx> | null = null
  if (xlsxAttachment) {
    try { xlsxParsed = parsePNLXlsx(xlsxAttachment.buffer) } catch { /* ignore parse errors */ }
  }

  // Prefer the ref embedded in the XLSX (row 1, col 1) over the OpenAI extraction
  const rawTcRef = (xlsxParsed?.bookingRef ?? extracted.bookingRef ?? '') as string

  // Split || or " / " from PNL Tour Ref to get IS Number too
  const { tourRef: pnlTourRef, isNumber: pnlEmbeddedIsNumber } = splitTourRef(rawTcRef || null)
  const pnlIsNumber: string | null = (extracted.isNumber as string | null) ?? pnlEmbeddedIsNumber ?? null

  // Match in order:
  // 1. agentBookingId = TC Tour Ref (most reliable since we now always store TC Tour Ref there)
  // 2. isNumber = extracted IS Number from PNL
  // 3. bookingRef exact/numeric fallback (legacy AH-ref bookings)
  let booking = pnlTourRef
    ? await prisma.booking.findFirst({ where: { agentBookingId: pnlTourRef }, orderBy: { createdAt: 'desc' } })
    : null
  if (!booking && pnlIsNumber) {
    booking = await prisma.booking.findFirst({ where: { isNumber: pnlIsNumber }, orderBy: { createdAt: 'desc' } }) ?? null
  }
  if (!booking && rawTcRef) {
    // Legacy numeric fallback
    const numericPart = rawTcRef.replace(/[^0-9]/g, '')
    if (numericPart.length >= 4) {
      booking = await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numericPart } },
        orderBy: { createdAt: 'desc' },
      }) ?? null
      if (!booking) {
        booking = await prisma.booking.findFirst({
          where: { bookingRef: { startsWith: numericPart } },
          orderBy: { createdAt: 'desc' },
        }) ?? null
      }
    }
  }

  // Use the ref from the found booking (may differ from rawTcRef via fallback)
  const bookingRef = booking?.bookingRef ?? rawTcRef

  if (!booking) {
    // PNL emails never contain travel dates — they only carry cost data.
    // Return PNL_WAITING so the caller stores the email for retry (without writing
    // the dedup key). When the TQ booking arrives the cron will re-process it.
    if (!extracted.arrivalDate || !extracted.departureDate) {
      console.log(`[Mail]  PNL Tour No "${rawTcRef}" — no matching booking yet, will retry when TQ arrives`)
      return {
        bookingRef: rawTcRef,
        bookingId:  '',
        mode:       'PNL' as const,
        isNew:      false,
        pnlLines:   0,
        agendaItems: 0,
        status:     'PNL_WAITING' as const,
      }
    }

    const created = await prisma.booking.create({
      data: {
        bookingRef,
        agentBookingId: extracted.agentBookingId,
        agent: extracted.agent ?? 'Unknown Agent',
        fileHandler: extracted.fileHandler,
        arrivalDate: new Date(extracted.arrivalDate),
        departureDate: new Date(extracted.departureDate),
        paxAdults: extracted.paxAdults,
        paxChildren: extracted.paxChildren,
        quotedTotal: extracted.quotedTotal ?? 0,
        currency: extracted.currency ?? 'USD',
        terms: extracted.terms,
        exclusions: extracted.exclusions,
        agentEmail: extracted.agentEmail,
        agentPhone: extracted.agentPhone,
        agentWhatsapp: extracted.agentWhatsapp,
        agentCountry: extracted.agentCountry,
        agentAddress: extracted.agentAddress,
        contactEmail: extracted.contactEmail,
        contactPhone: extracted.contactPhone,
        contactWhatsapp: extracted.contactWhatsapp,
        contactCountry: extracted.contactCountry,
        contactAddress: extracted.contactAddress,
        status: 'GT_REVIEW',
        createdById,
      },
    })

    await replaceBookingChildren(created.id, extracted)
    await logActivity({
      userId: createdById,
      action: ACTION.BOOKING_CREATED,
      entityType: 'Booking',
      entityId: created.id,
      details: { source: 'email', emailType: 'PNL', bookingRef, agendaItems: 0, pnlLines: 0 },
    })
  }

  const fullBooking = await prisma.booking.findUnique({
    where: { bookingRef },
    include: { pnl: { include: { lineItems: { orderBy: { sortOrder: 'asc' } } } } },
  })

  if (!fullBooking) {
    throw new Error(`Unable to load booking ${bookingRef} for PNL sync`)
  }

  let pnlLines = extracted.pnlLines ?? []
  let paxAdults = extracted.paxAdults
  let paxChildren = extracted.paxChildren

  if (xlsxParsed) {
    paxAdults = xlsxParsed.paxAdults || paxAdults
    paxChildren = xlsxParsed.paxChildren || paxChildren
    pnlLines = xlsxParsed.lineItems.map(item => ({
      activity: item.activity,
      category: item.category,
      mmtRate: item.mmtRate,
      sicRate: item.sicRate,
      pvtRatePP: item.pvtRatePP,
      adEntrance: item.adEntrance,
      chEntrance: item.chEntrance,
      otherRate: item.otherRate,
    }))
  }

  if (pnlLines.length > 0 && process.env.OPENAI_API_KEY) {
    const classifySetting = await prisma.systemSetting.findUnique({ where: { key: 'ai_pnl_auto_classify' } })
    const classifyEnabled = classifySetting?.value !== 'false'
    if (classifyEnabled) {
      try {
        const aiCats = await classifyPNLCategories(pnlLines.map(l => l.activity))
        pnlLines = pnlLines.map((l, i) => ({ ...l, category: aiCats[i] ?? l.category }))
      } catch {
        // Keep extracted categories when classification fails.
      }
    } else {
      console.log('[Automation] AI PNL classify disabled — keeping keyword-based categories')
    }
  }

  let pnl = await prisma.pNL.findUnique({ where: { bookingId: fullBooking.id } })
  if (!pnl) {
    pnl = await prisma.pNL.create({
      data: { bookingId: fullBooking.id, paxAdults, paxChildren },
    })
  } else {
    pnl = await prisma.pNL.update({
      where: { id: pnl.id },
      data: { paxAdults, paxChildren },
    })
  }

  await prisma.ticket.updateMany({
    where: { bookingId: fullBooking.id, activated: false },
    data: { pnlLineId: null },
  })
  await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

  const createdLines = []
  for (let i = 0; i < pnlLines.length; i++) {
    const line = pnlLines[i]
    const created = await prisma.pNLLineItem.create({
      data: {
        pnlId: pnl.id,
        activity: line.activity,
        category: line.category as any,
        mmtRate: line.mmtRate,
        sicRate: line.sicRate,
        pvtRatePP: line.pvtRatePP,
        adEntrance: line.adEntrance,
        chEntrance: line.chEntrance,
        otherRate: line.otherRate,
        sortOrder: i,
      },
    })
    createdLines.push(created)

    if (TICKETABLE_CATEGORIES.has(line.category)) {
      await prisma.ticket.create({
        data: {
          bookingId: fullBooking.id,
          pnlLineId: created.id,
          type: line.activity,
          qty: paxAdults + paxChildren,
          currency: fullBooking.currency ?? 'USD',
          status: 'DRAFT',
          activated: false,
        },
      })
    }
  }

  if (fullBooking.status === 'DRAFT') {
    await prisma.booking.update({
      where: { id: fullBooking.id },
      data: { status: 'GT_REVIEW' },
    })
  }

  // ── Terminal output ───────────────────────────────────────────────────────
  console.log(`[Mail]  Booking ref  : ${bookingRef}`)
  mailLog('Pax',       `${paxAdults} adult${paxAdults !== 1 ? 's' : ''}${paxChildren ? ` + ${paxChildren} child${paxChildren !== 1 ? 'ren' : ''}` : ''}`)
  mailLog('PNL lines',  createdLines.length.toString())
  for (const line of pnlLines.slice(0, 15)) {
    console.log(`[Mail]    ${String(line.category).padEnd(14)}  ${line.activity}`)
  }
  if (pnlLines.length > 15) console.log(`[Mail]    ... and ${pnlLines.length - 15} more`)
  console.log(`[Mail]  ✓ DONE${SEP.slice(8)}\n`)
  // ─────────────────────────────────────────────────────────────────────────

  await logActivity({
    userId: createdById,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: fullBooking.id,
    details: { source: 'email', emailType: 'PNL', bookingRef, pnlLines: createdLines.length },
  })

  return {
    bookingRef,
    bookingId: fullBooking.id,
    mode: 'PNL',
    isNew: false,
    pnlLines: createdLines.length,
    agendaItems: 0,
    status: 'GT_REVIEW' as const,
  }
}

export async function processIncomingMail(
  email: ProcessedEmail,
  type: MailboxKind,
  attachments: EmailAttachment[] = [],
): Promise<SyncResult> {
  const normalizedType = normalizeType(type)

  // ── Print header so every email is visible in the terminal immediately ───
  mailHeader(normalizedType, email.subject, email.from, email.fromName)
  if (attachments.length > 0) {
    console.log(`[Mail]  Attachments  : ${attachments.map(a => a.name).join(', ')}`)
  }
  console.log(`[Mail]  Extracting data via OpenAI...`)
  // ─────────────────────────────────────────────────────────────────────────

  const createdById = await getAutomationUserId()

  // If PNL mail extraction is disabled, skip without calling OpenAI
  if (normalizedType === 'PNL') {
    const pnlSetting = await prisma.systemSetting.findUnique({ where: { key: 'ai_pnl_auto_extract' } })
    if (pnlSetting?.value === 'false') {
      console.log(`[Mail]  PNL skipped — ai_pnl_auto_extract is OFF${SEP.slice(8)}\n`)
      return { bookingRef: '', bookingId: '', mode: 'PNL', isNew: false, pnlLines: 0, agendaItems: 0, status: 'GT_REVIEW' as const }
    }
  }

  const extracted = await extractBookingFromEmail(email.rawBody, normalizedType)

  // Attach detected country to extracted object so syncTourConfirmation can use it
  if (normalizedType === 'TOUR_CONFIRMATION') {
    const country = detectCountryFromText(email.subject, email.rawBody)
    ;(extracted as any)._detectedCountry = country
    return syncTourConfirmation(extracted, createdById)
  }

  return syncPnL(extracted, attachments, createdById)
}

export async function processMailboxEmail(
  email: ProcessedEmail,
  type: MailboxKind,
  attachments: EmailAttachment[] = [],
): Promise<{ bookingRef: string; bookingId: string; pnlLines: number; agendaItems: number; status: string }> {
  const result = await processIncomingMail(email, type, attachments)
  return {
    bookingRef:  result.bookingRef,
    bookingId:   result.bookingId,
    pnlLines:    result.pnlLines,
    agendaItems: result.agendaItems,
    status:      result.status,
  }
}
