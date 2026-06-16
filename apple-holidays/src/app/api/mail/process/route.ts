import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractBookingFromEmail, fetchMessageAttachmentsForUser, type ExtractedBooking } from '@/lib/mail-processor'
import { classifyPNLCategories } from '@/lib/openai'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'
import { upsertAgenda } from '@/lib/incoming-mail-automation'
import { upsertCachedMailMessage } from '@/lib/mail-cache'
import type { ProcessedEmail } from '@/lib/mail-processor'

function generateRef(base: string | null): string {
  if (base) {
    // Strip trailing non-numeric suffix (e.g. CNTL from 463658CNTL → 463658)
    const stripped = base.replace(/[A-Z]+$/i, '')
    const clean = (stripped.length >= 4 ? stripped : base).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
    if (clean.length >= 4) return clean
  }
  return `AH${Date.now().toString(36).toUpperCase().slice(-6)}`
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
    bodyHtml?: string
    date?: string
    folder?: string
    from?: string
    fromName?: string
    to?: string[]
    cc?: string[]
    isRead?: boolean
    hasAttachments?: boolean
    importance?: string
    conversationId?: string
    uid?: number
  }
  if (!rawBody) return buildApiError('rawBody is required')

  const type = (emailType ?? 'TOUR_CONFIRMATION') as 'TOUR_CONFIRMATION' | 'PNL'
  const emailSnapshot: ProcessedEmail | null = graphId && mailboxUser
    ? {
        uid: body.uid ?? 0,
        graphId,
        subject: subject ?? '',
        from: body.from ?? '',
        fromName: body.fromName ?? '',
        to: Array.isArray(body.to) ? body.to : [],
        cc: Array.isArray(body.cc) ? body.cc : [],
        date: body.date ?? new Date().toISOString(),
        type,
        rawBody,
        bodyHtml: body.bodyHtml ?? '',
        folder: body.folder ?? 'Inbox',
        isRead: body.isRead ?? false,
        hasAttachments: body.hasAttachments ?? false,
        importance: body.importance ?? 'normal',
        conversationId: body.conversationId ?? '',
        parsed: null,
      }
    : null

  if (emailSnapshot && mailboxUser) {
    await upsertCachedMailMessage({
      email: emailSnapshot,
      mailboxUser,
      mailboxKind: type,
      status: 'RECEIVED',
    }).catch(() => {})
  }

  // ── 1. Extract via OpenAI (email body) ────────────────────────────────────
  let extracted: ExtractedBooking
  try {
    extracted = await extractBookingFromEmail(rawBody, type)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isQuota = msg.includes('insufficient_quota') || msg.includes('429') || msg.includes('exceeded your current quota')
    if (emailSnapshot && mailboxUser) {
      await upsertCachedMailMessage({
        email: emailSnapshot,
        mailboxUser,
        mailboxKind: type,
        status: 'ERROR',
      }).catch(() => {})
    }
    if (isQuota) {
      return buildApiError('OpenAI quota exceeded — please add billing credits at platform.openai.com/account/billing', 503)
    }
    return buildApiError(`AI extraction failed: ${msg}`, 500)
  }

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

  // For Tour Confirmation: only accept Tour Ref — reject IS/VN numbers
  if (type === 'TOUR_CONFIRMATION' && extracted.bookingRef) {
    if (/^(IS|VN)\d+$/i.test(extracted.bookingRef.replace(/[^A-Z0-9]/gi, ''))) {
      extracted.bookingRef = null
    }
  }

  const rawBookingRef = generateRef(extracted.bookingRef)

  // ── 2. Find or create booking ─────────────────────────────────────────────
  // Try exact match first, then numeric-suffix fallback
  // (handles "IS48369" vs "IS 48369", or PNL giving "48369" vs TQ stored "IS48369")
  let existingBooking = await prisma.booking.findUnique({ where: { bookingRef: rawBookingRef } })
  if (!existingBooking) {
    const numericPart = rawBookingRef.replace(/[^0-9]/g, '')
    if (numericPart.length >= 4) {
      // endsWith handles "VN19679" prefix case (PNL gives "19679")
      existingBooking = await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numericPart } },
        orderBy: { createdAt: 'desc' },
      }) ?? null
      // startsWith handles "469083CNTL" suffix case (PNL gives "469083", TQ stored "469083CNTL")
      if (!existingBooking) {
        existingBooking = await prisma.booking.findFirst({
          where: { bookingRef: { startsWith: numericPart } },
          orderBy: { createdAt: 'desc' },
        }) ?? null
      }
    }
  }

  // Use the booking's actual ref (may differ via fallback), or fall back to rawBookingRef for new creation
  const bookingRef = existingBooking?.bookingRef ?? rawBookingRef

  let bookingId: string

  if (existingBooking) {
    bookingId = existingBooking.id
  } else {
    // PNL emails never contain arrival/departure dates — they only carry cost data.
    // Store as PNL_WAITING — when the TQ arrives, the UI will auto-retry linking.
    if (type === 'PNL') {
      const numericRef = rawBookingRef.replace(/[^0-9]/g, '')
      if (emailSnapshot && mailboxUser) {
        await upsertCachedMailMessage({
          email: emailSnapshot,
          mailboxUser,
          mailboxKind: type,
          bookingRef: numericRef,
          status: 'WAITING',
        }).catch(() => {})
      }
      return buildApiSuccess(
        {
          status:      'PNL_WAITING',
          bookingRef:  numericRef,   // Tour No numeric part, e.g. "469083"
          bookingId:   '',
          isNew:       false,
          pnlLines:    0,
          agendaItems: 0,
        },
        `PNL for Tour No #${numericRef} received — waiting for Travel Quotation`,
      )
    }

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
        agentEmail:     extracted.agentEmail,
        agentPhone:     extracted.agentPhone,
        agentWhatsapp:  extracted.agentWhatsapp,
        agentCountry:   extracted.agentCountry,
        agentAddress:   extracted.agentAddress,
        contactEmail:   extracted.contactEmail,
        contactPhone:   extracted.contactPhone,
        contactWhatsapp: extracted.contactWhatsapp,
        contactCountry: extracted.contactCountry,
        contactAddress: extracted.contactAddress,
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
  // Run for every TQ booking that doesn't have an agenda yet.
  // upsertAgenda uses AI generation with a skeleton fallback, so there is always output.
  let agendaCount = 0
  if (type === 'TOUR_CONFIRMATION') {
    agendaCount = await upsertAgenda(bookingId, bookingRef, extracted, /* skipIfExists */ true)
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

  // Fetch final booking timestamps
  const finalBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { createdAt: true, updatedAt: true },
  }).catch(() => null)

  const processedAt = new Date().toISOString()

  if (emailSnapshot && mailboxUser) {
    await upsertCachedMailMessage({
      email: emailSnapshot,
      mailboxUser,
      mailboxKind: type,
      bookingRef,
      status: 'PROCESSED',
      processedAt,
    }).catch(() => {})
  }

  return buildApiSuccess({
    bookingRef,
    bookingId,
    isNew:            !existingBooking,
    pnlLines:         createdPnlLineCount,
    agendaItems:      agendaCount,
    status:           'GT_REVIEW',
    xlsxUsed:         !!xlsxParsed,
    bookingCreatedAt: finalBooking?.createdAt?.toISOString() ?? null,
    processedAt,
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
