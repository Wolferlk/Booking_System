import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractBookingFromEmail, fetchMessageAttachmentsForUser, type ExtractedBooking } from '@/lib/mail-processor'
import { classifyPNLCategories } from '@/lib/openai'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'
import fs from 'fs'
import path from 'path'

const CONDITIONS_PATH = path.join(process.cwd(), 'public', 'Generating_Agenda_conditions.md')
function loadConditions() {
  try { return fs.readFileSync(CONDITIONS_PATH, 'utf-8') } catch { return '' }
}

function generateRef(base: string | null): string {
  if (base) {
    const clean = base.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
    if (clean.length >= 4) return clean
  }
  return `AH${Date.now().toString(36).toUpperCase().slice(-6)}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildAgendaItems(data: ExtractedBooking, bookingRef: string): Promise<any[]> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = JSON.parse(content) as { items?: any[] }
  return Array.isArray(parsed) ? parsed : (parsed.items ?? [])
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { rawBody, subject, emailType, graphId, mailboxUser } = body as {
    rawBody: string
    subject: string
    emailType?: string
    graphId?: string
    mailboxUser?: string
  }
  if (!rawBody) return buildApiError('rawBody is required')

  const type = (emailType ?? 'TOUR_CONFIRMATION') as 'TOUR_CONFIRMATION' | 'PNL'

  // ── 1. Extract via OpenAI (email body) ────────────────────────────────────
  const extracted: ExtractedBooking = await extractBookingFromEmail(rawBody, type)

  // ── 1b. For PNL: also parse XLSX attachment if available ──────────────────
  let xlsxParsed: ReturnType<typeof parsePNLXlsx> | null = null
  if (type === 'PNL' && graphId && mailboxUser) {
    try {
      const atts = await fetchMessageAttachmentsForUser(mailboxUser, graphId)
      const xlsx = atts.find(a => a.name.toLowerCase().endsWith('.xlsx') || a.name.toLowerCase().endsWith('.xls'))
      if (xlsx) xlsxParsed = parsePNLXlsx(xlsx.buffer)
    } catch { /* non-fatal */ }
  }

  // Merge XLSX data into extracted (XLSX wins for ref, pax, and line items)
  if (xlsxParsed) {
    if (xlsxParsed.bookingRef) extracted.bookingRef = xlsxParsed.bookingRef
    if (xlsxParsed.paxAdults)  extracted.paxAdults  = xlsxParsed.paxAdults
    if (xlsxParsed.paxChildren !== undefined) extracted.paxChildren = xlsxParsed.paxChildren
    if (xlsxParsed.lineItems.length > 0) {
      extracted.pnlLines = xlsxParsed.lineItems.map(l => ({
        activity:   l.activity,
        category:   l.category,
        mmtRate:    l.mmtRate,
        sicRate:    l.sicRate,
        pvtRatePP:  l.pvtRatePP,
        adEntrance: l.adEntrance,
        chEntrance: l.chEntrance,
        otherRate:  l.otherRate,
      }))
    }
  }

  const bookingRef = generateRef(extracted.bookingRef)

  // ── 2. Find or create booking ─────────────────────────────────────────────
  const existingBooking = await prisma.booking.findUnique({ where: { bookingRef } })
  let bookingId: string

  if (existingBooking) {
    bookingId = existingBooking.id
  } else {
    if (!extracted.arrivalDate || !extracted.departureDate) {
      return buildApiError('Could not extract arrival/departure dates from email')
    }

    const created = await prisma.booking.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        bookingRef,
        agentBookingId: extracted.agentBookingId,
        agent:          extracted.agent ?? 'Unknown Agent',
        fileHandler:    extracted.fileHandler,
        arrivalDate:    new Date(extracted.arrivalDate),
        departureDate:  new Date(extracted.departureDate),
        paxAdults:      extracted.paxAdults,
        paxChildren:    extracted.paxChildren,
        quotedTotal:    extracted.quotedTotal ?? undefined,
        currency:       extracted.currency ?? 'USD',
        terms:          extracted.terms,
        exclusions:     extracted.exclusions,
        status:         'GT_REVIEW',
        createdById:    session.user.id,
      } as any,
    })
    bookingId = created.id

    // Passengers
    if (extracted.passengers.length > 0) {
      await prisma.passenger.createMany({
        data: extracted.passengers.map(p => ({
          bookingId,
          name:    p.name,
          type:    (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
          isLead:  p.isLead ?? false,
        })),
      })
    }

    // Flights (depTime/arrTime must be non-empty string per schema)
    if (extracted.flights.length > 0) {
      await prisma.flight.createMany({
        data: extracted.flights.map(f => ({
          bookingId,
          flightNo: f.flightNo,
          date:     new Date(f.date),
          fromApt:  f.fromApt,
          depTime:  f.depTime ?? '',
          toApt:    f.toApt,
          arrTime:  f.arrTime ?? '',
          airline:  f.airline ?? null,
        })),
      })
    }

    // Accommodations
    if (extracted.accommodations.length > 0) {
      await prisma.accommodation.createMany({
        data: extracted.accommodations.map(a => ({
          bookingId,
          hotel:    a.hotel,
          city:     a.city,
          checkIn:  new Date(a.checkIn),
          checkOut: new Date(a.checkOut),
          nights:   a.nights,
          roomType: a.roomType ?? null,
          mealType: a.mealType ?? null,
        })),
      })
    }

    // Itinerary
    if (extracted.itineraryItems.length > 0) {
      await prisma.itineraryItem.createMany({
        data: extracted.itineraryItems.map(item => ({
          bookingId,
          dayNo:       item.dayNo,
          date:        new Date(item.date),
          title:       item.title,
          description: item.description ?? null,
        })),
      })
    }

    // Emergency contacts
    if (extracted.emergencyContacts.length > 0) {
      await prisma.emergencyContact.createMany({
        data: extracted.emergencyContacts.map(ec => ({
          bookingId,
          name:  ec.name,
          phone: ec.phone ?? null,
          role:  ec.role ?? null,
        })),
      })
    }
  }

  // ── 3. P&L ───────────────────────────────────────────────────────────────
  const pnlLines = extracted.pnlLines ?? []
  let createdPnlLineCount = pnlLines.length

  if (pnlLines.length > 0) {
    let classifiedLines = pnlLines
    if (process.env.OPENAI_API_KEY) {
      try {
        const aiCats = await classifyPNLCategories(pnlLines.map(l => l.activity))
        classifiedLines = pnlLines.map((l, i) => ({ ...l, category: aiCats[i] ?? l.category }))
      } catch { /* keep extracted categories */ }
    }

    let pnl = await prisma.pNL.findUnique({ where: { bookingId } })
    if (!pnl) {
      pnl = await prisma.pNL.create({
        data: { bookingId, paxAdults: extracted.paxAdults, paxChildren: extracted.paxChildren },
      })
    }
    await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

    const ticketCats = ['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS']
    for (let i = 0; i < classifiedLines.length; i++) {
      const l = classifiedLines[i]
      const created = await prisma.pNLLineItem.create({
        data: {
          pnlId:      pnl.id,
          activity:   l.activity,
          category:   l.category as 'HOTEL' | 'TICKETS' | 'GUIDES' | 'MEALS' | 'CRUISE' | 'WATER' | 'TRANSPORT' | 'TAX_FEES' | 'FLIGHT_TICKETS' | 'OTHER',
          mmtRate:    l.mmtRate,
          sicRate:    l.sicRate,
          pvtRatePP:  l.pvtRatePP,
          adEntrance: l.adEntrance,
          chEntrance: l.chEntrance,
          otherRate:  l.otherRate,
          sortOrder:  i,
        },
      })
      if (ticketCats.includes(l.category)) {
        const existing = await prisma.ticket.findFirst({ where: { pnlLineId: created.id } })
        if (!existing) {
          await prisma.ticket.create({
            data: {
              bookingId,
              pnlLineId: created.id,
              type:      l.activity,
              qty:       extracted.paxAdults + extracted.paxChildren,
              currency:  extracted.currency ?? 'USD',
              status:    'DRAFT',
              activated: false,
            },
          })
        }
      }
    }
    createdPnlLineCount = classifiedLines.length
  }

  // ── 4. Movement chart (agenda) ────────────────────────────────────────────
  let agendaCount = 0
  if (!existingBooking && extracted.arrivalDate && extracted.departureDate) {
    try {
      const agendaItems = await buildAgendaItems(extracted, bookingRef)

      if (agendaItems.length > 0) {
        // Upsert TourAgenda
        let agenda = await prisma.tourAgenda.findUnique({ where: { bookingId } })
        if (!agenda) {
          agenda = await prisma.tourAgenda.create({ data: { bookingId } })
        } else {
          await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of agendaItems as any[]) {
          if (!item.date) continue
          await prisma.agendaItem.create({
            data: {
              agendaId:    agenda.id,
              date:        new Date(item.date),
              location:    item.location ?? '',
              fromPoint:   item.fromPoint ?? null,
              toPoint:     item.toPoint ?? null,
              details:     item.details ?? null,
              mealPlan:    item.mealPlan ?? null,
              meetingTime: item.meetingTime ?? null,
              serviceType: (item.serviceType ?? 'OWN_ARRANGEMENT') as 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT',
            },
          })
        }
        agendaCount = agendaItems.length
      }
    } catch (err) {
      console.error('Agenda generation failed (non-fatal):', err)
    }
  }

  // ── 5. Mark as processed (dedup key for mail inbox) ──────────────────────
  if (graphId) {
    await prisma.systemSetting.upsert({
      where:  { key: `processed_email_${graphId}` },
      update: { value: `${bookingRef}|${new Date().toISOString()}` },
      create: { key: `processed_email_${graphId}`, value: `${bookingRef}|${new Date().toISOString()}` },
    }).catch(() => {})
  }

  // ── 6. Activity log ───────────────────────────────────────────────────────
  await logActivity({
    userId:     session.user.id,
    action:     ACTION.BOOKING_CREATED,
    entityType: 'Booking',
    entityId:   bookingId,
    details:    { source: 'email', subject, emailType: type, bookingRef, agendaItems: agendaCount, pnlLines: createdPnlLineCount },
  })

  return buildApiSuccess({
    bookingRef,
    bookingId,
    isNew:       !existingBooking,
    pnlLines:    createdPnlLineCount,
    agendaItems: agendaCount,
    status:      'GT_REVIEW',
    xlsxUsed:    !!xlsxParsed,
    extracted: {
      agent:           extracted.agent,
      fileHandler:     extracted.fileHandler,
      agentBookingId:  extracted.agentBookingId,
      arrivalDate:     extracted.arrivalDate,
      departureDate:   extracted.departureDate,
      paxAdults:       extracted.paxAdults,
      paxChildren:     extracted.paxChildren,
      quotedTotal:     extracted.quotedTotal,
      currency:        extracted.currency,
      passengers:      extracted.passengers,
      flights:         extracted.flights,
      accommodations:  extracted.accommodations,
      itineraryItems:  extracted.itineraryItems.slice(0, 10),
      emergencyContacts: extracted.emergencyContacts,
      pnlLines:        extracted.pnlLines,
    },
  }, existingBooking
    ? `P&L updated for existing booking ${bookingRef}`
    : `Booking ${bookingRef} created → Travel Experience Review`)
}
