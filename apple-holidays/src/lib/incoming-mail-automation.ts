import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'
import { classifyPNLCategories } from '@/lib/openai'
import { extractBookingFromEmail, type ProcessedEmail, type MailboxKind, type EmailAttachment } from '@/lib/mail-processor'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import fs from 'fs'
import path from 'path'

type SyncResult = {
  bookingRef: string
  bookingId: string
  mode: 'TOUR_CONFIRMATION' | 'PNL'
  isNew: boolean
  pnlLines: number
  agendaItems: number
}

const TICKETABLE_CATEGORIES = new Set(['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS'])

function generateRef(base: string | null): string {
  if (base) {
    const clean = base.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
    if (clean.length >= 4) return clean
  }
  return `AH${Date.now().toString(36).toUpperCase().slice(-6)}`
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

async function buildAgendaItems(data: Awaited<ReturnType<typeof extractBookingFromEmail>>, bookingRef: string): Promise<any[]> {
  const openai = (await import('@/lib/openai')).default
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
        content: `Vietnam tour operations expert. Generate movement chart from booking data.
RULES: ${conditions}
Return JSON { "items": [{"date":"YYYY-MM-DD","location":"string","fromPoint":"string","toPoint":"string","details":"string","mealPlan":"string|null","meetingTime":"HH:MM — required for PVT/SIC","serviceType":"PVT_TRANSFER|SIC_TRANSFER|OWN_ARRANGEMENT"}] }`,
      },
      { role: 'user', content: `Generate for ${bookingRef}:\n\n${docText.slice(0, 10000)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) return []
  const parsed = JSON.parse(content) as { items?: any[] }
  return Array.isArray(parsed) ? parsed : (parsed.items ?? [])
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
        name: p.name,
        type: (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
        isLead: p.isLead ?? false,
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
        title: item.title,
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

async function upsertAgenda(bookingId: string, bookingRef: string, extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>) {
  if (!extracted.arrivalDate || !extracted.departureDate) return 0

  try {
    const agendaItems = await buildAgendaItems(extracted, bookingRef)
    if (!agendaItems.length) return 0

    let agenda = await prisma.tourAgenda.findUnique({ where: { bookingId } })
    if (!agenda) {
      agenda = await prisma.tourAgenda.create({ data: { bookingId } })
    } else {
      await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })
    }

    for (const item of agendaItems as any[]) {
      if (!item.date) continue
      await prisma.agendaItem.create({
        data: {
          agendaId: agenda.id,
          date: new Date(item.date),
          location: item.location ?? '',
          fromPoint: item.fromPoint ?? null,
          toPoint: item.toPoint ?? null,
          details: item.details ?? null,
          mealPlan: item.mealPlan ?? null,
          meetingTime: item.meetingTime ?? null,
          serviceType: (item.serviceType ?? 'OWN_ARRANGEMENT') as 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT',
        },
      })
    }

    return agendaItems.length
  } catch (err) {
    console.error('[Automation] agenda generation failed:', err)
    return 0
  }
}

async function syncTourConfirmation(
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
  createdById: string,
): Promise<SyncResult> {
  const bookingRef = generateRef(extracted.bookingRef)
  const existing = await prisma.booking.findUnique({ where: { bookingRef } })
  const isNew = !existing

  if (!extracted.arrivalDate || !extracted.departureDate) {
    throw new Error(`Missing arrival/departure dates for tour confirmation ${bookingRef}`)
  }

  const bookingData = {
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
    status: 'GT_REVIEW' as const,
    ...(isNew ? { createdById } : {}),
  }

  const booking = isNew
    ? await prisma.booking.create({ data: { ...bookingData, createdById } })
    : await prisma.booking.update({
      where: { bookingRef },
      data: {
        agentBookingId: bookingData.agentBookingId,
        agent: bookingData.agent,
        fileHandler: bookingData.fileHandler,
        arrivalDate: bookingData.arrivalDate,
        departureDate: bookingData.departureDate,
        paxAdults: bookingData.paxAdults,
        paxChildren: bookingData.paxChildren,
        quotedTotal: bookingData.quotedTotal,
        currency: bookingData.currency,
        terms: bookingData.terms,
        exclusions: bookingData.exclusions,
        status: 'GT_REVIEW',
      },
    })

  await replaceBookingChildren(booking.id, extracted)

  const agendaItems = await upsertAgenda(booking.id, bookingRef, extracted)

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
  const rawBookingRef = generateRef(xlsxParsed?.bookingRef ?? extracted.bookingRef)

  // Try exact match first, then fallback to numeric-suffix search.
  // This handles edge cases where the PNL gives "19679" but TQ was stored as "VN19679",
  // or where spaces/dashes caused a slightly different normalization.
  let booking = await prisma.booking.findUnique({ where: { bookingRef: rawBookingRef } })
  if (!booking) {
    const numericPart = rawBookingRef.replace(/[^0-9]/g, '')
    if (numericPart.length >= 4) {
      booking = await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numericPart } },
        orderBy: { createdAt: 'desc' },
      }) ?? null
    }
  }

  // Use the ref from the found booking (may differ from rawBookingRef via fallback)
  const bookingRef = booking?.bookingRef ?? rawBookingRef

  if (!booking) {
    // PNL emails never contain travel dates — they only carry cost data.
    // We cannot create a booking from PNL alone; the TQ must arrive first.
    if (!extracted.arrivalDate || !extracted.departureDate) {
      throw new Error(
        `PNL received for IS Number "${bookingRef}" but no matching TQ booking found. ` +
        `Process the Travel Quotation email first.`,
      )
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
    try {
      const aiCats = await classifyPNLCategories(pnlLines.map(l => l.activity))
      pnlLines = pnlLines.map((l, i) => ({ ...l, category: aiCats[i] ?? l.category }))
    } catch {
      // Keep extracted categories when classification fails.
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
  }
}

export async function processIncomingMail(
  email: ProcessedEmail,
  type: MailboxKind,
  attachments: EmailAttachment[] = [],
): Promise<SyncResult> {
  const createdById = await getAutomationUserId()
  const normalizedType = normalizeType(type)
  const extracted = await extractBookingFromEmail(email.rawBody, normalizedType)

  if (normalizedType === 'TOUR_CONFIRMATION') {
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
    bookingRef: result.bookingRef,
    bookingId: result.bookingId,
    pnlLines: result.pnlLines,
    agendaItems: result.agendaItems,
    status: 'GT_REVIEW',
  }
}
