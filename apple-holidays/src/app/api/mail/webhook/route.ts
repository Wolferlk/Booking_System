import { NextRequest, NextResponse } from 'next/server'
import { fetchMessageById, detectEmailType } from '@/lib/mail-processor'
import { classifyPNLCategories } from '@/lib/openai'
import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'
import fs from 'fs'
import path from 'path'

// Force Node.js runtime — required for IMAP/Graph libs
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── Validation helper ─────────────────────────────────────────────────────────
function validationResponse(token: string) {
  // Microsoft requires: 200, Content-Type: text/plain, body = plain token (no encoding)
  return new NextResponse(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

// GET — Microsoft Graph sends GET for lifecycle/validation in some configurations
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (token) return validationResponse(token)
  return new NextResponse('Webhook OK', { status: 200 })
}

// ── Notification handler (POST) ───────────────────────────────────────────────
// Microsoft ALWAYS POSTs the validation with ?validationToken=... first
// Then POSTs actual notifications as JSON
export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'

  // Step 1: Subscription validation challenge
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  let body: GraphNotificationPayload
  try {
    body = await req.json() as GraphNotificationPayload
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Must respond 202 quickly — process async
  processNotifications(body.value ?? [], secret).catch(err =>
    console.error('[Webhook] processing error:', err),
  )

  return new NextResponse(null, { status: 202 })
}

// ── Background processor ──────────────────────────────────────────────────────

async function processNotifications(notifications: GraphNotification[], secret: string) {
  for (const notif of notifications) {
    // Verify clientState to prevent spoofed requests
    if (notif.clientState !== secret) {
      console.warn('[Webhook] invalid clientState, skipping')
      continue
    }
    if (notif.changeType !== 'created') continue

    const graphId = notif.resourceData?.id
    if (!graphId) continue

    console.log('[Webhook] new email arrived, graphId:', graphId)

    const email = await fetchMessageById(graphId)
    if (!email) { console.warn('[Webhook] could not fetch message', graphId); continue }
    if (email.type === 'UNKNOWN') { console.log('[Webhook] unknown type, skipping'); continue }

    console.log('[Webhook] processing:', email.subject, '| type:', email.type)

    try {
      await autoProcessEmail(email)
    } catch (err) {
      console.error('[Webhook] autoProcess failed:', err)
    }
  }
}

// ── Full pipeline (mirrors /api/mail/process) ─────────────────────────────────

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

async function autoProcessEmail(email: { subject: string; rawBody: string; type: 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN' }) {
  const { extractBookingFromEmail } = await import('@/lib/mail-processor')
  const openai = (await import('@/lib/openai')).default

  const extracted = await extractBookingFromEmail(email.rawBody, email.type as 'TOUR_CONFIRMATION' | 'PNL')
  const bookingRef = generateRef(extracted.bookingRef)

  const existingBooking = await prisma.booking.findUnique({ where: { bookingRef } })
  let bookingId: string

  if (existingBooking) {
    bookingId = existingBooking.id
  } else {
    if (!extracted.arrivalDate || !extracted.departureDate) {
      console.warn('[Webhook] missing dates for', bookingRef)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await prisma.booking.create({ data: {
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
    } as any })
    bookingId = created.id

    if (extracted.passengers.length > 0) {
      await prisma.passenger.createMany({ data: extracted.passengers.map(p => ({ bookingId, name: p.name, type: (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD', isLead: p.isLead ?? false })) })
    }
    if (extracted.flights.length > 0) {
      await prisma.flight.createMany({ data: extracted.flights.map(f => ({ bookingId, flightNo: f.flightNo, date: new Date(f.date), fromApt: f.fromApt, depTime: f.depTime ?? '', toApt: f.toApt, arrTime: f.arrTime ?? '', airline: f.airline ?? null })) })
    }
    if (extracted.accommodations.length > 0) {
      await prisma.accommodation.createMany({ data: extracted.accommodations.map(a => ({ bookingId, hotel: a.hotel, city: a.city, checkIn: new Date(a.checkIn), checkOut: new Date(a.checkOut), nights: a.nights, roomType: a.roomType ?? null, mealType: a.mealType ?? null })) })
    }
    if (extracted.itineraryItems.length > 0) {
      await prisma.itineraryItem.createMany({ data: extracted.itineraryItems.map(i => ({ bookingId, dayNo: i.dayNo, date: new Date(i.date), title: i.title, description: i.description ?? null })) })
    }
    if (extracted.emergencyContacts.length > 0) {
      await prisma.emergencyContact.createMany({ data: extracted.emergencyContacts.map(ec => ({ bookingId, name: ec.name, phone: ec.phone ?? null, role: ec.role ?? null })) })
    }
  }

  // P&L
  if (extracted.pnlLines.length > 0) {
    let classifiedLines = extracted.pnlLines
    if (process.env.OPENAI_API_KEY) {
      try {
        const aiCats = await classifyPNLCategories(extracted.pnlLines.map(l => l.activity))
        classifiedLines = extracted.pnlLines.map((l, i) => ({ ...l, category: aiCats[i] ?? l.category }))
      } catch { /* keep extracted */ }
    }

    let pnl = await prisma.pNL.findUnique({ where: { bookingId } })
    if (!pnl) pnl = await prisma.pNL.create({ data: { bookingId, paxAdults: extracted.paxAdults, paxChildren: extracted.paxChildren } })
    await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

    const ticketCats = ['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS']
    for (let i = 0; i < classifiedLines.length; i++) {
      const l = classifiedLines[i]
      const created = await prisma.pNLLineItem.create({
        data: {
          pnlId: pnl.id, activity: l.activity,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: l.category as any,
          mmtRate: l.mmtRate, sicRate: l.sicRate, pvtRatePP: l.pvtRatePP,
          adEntrance: l.adEntrance, chEntrance: l.chEntrance, otherRate: l.otherRate, sortOrder: i,
        },
      })
      if (ticketCats.includes(l.category)) {
        await prisma.ticket.create({ data: { bookingId, pnlLineId: created.id, type: l.activity, qty: extracted.paxAdults + extracted.paxChildren, currency: extracted.currency ?? 'USD', status: 'DRAFT', activated: false } })
      }
    }
  }

  // Agenda
  if (!existingBooking && extracted.arrivalDate && extracted.departureDate) {
    try {
      const conditions = loadConditions()
      const docText = JSON.stringify({ bookingRef, arrivalDate: extracted.arrivalDate, departureDate: extracted.departureDate, paxAdults: extracted.paxAdults, paxChildren: extracted.paxChildren, flights: extracted.flights, accommodations: extracted.accommodations, itineraryItems: extracted.itineraryItems }, null, 2)

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Vietnam tour operations expert. Generate movement chart.\nRULES: ${conditions}\nReturn JSON { "items": [...] }` },
          { role: 'user', content: `Generate for ${bookingRef}:\n\n${docText.slice(0, 10000)}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as { items?: any[] }
      const agendaItems = Array.isArray(parsed) ? parsed : (parsed.items ?? [])

      if (agendaItems.length > 0) {
        let agenda = await prisma.tourAgenda.findUnique({ where: { bookingId } })
        if (!agenda) agenda = await prisma.tourAgenda.create({ data: { bookingId } })
        else await prisma.agendaItem.deleteMany({ where: { agendaId: agenda.id } })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of agendaItems as any[]) {
          if (!item.date) continue
          await prisma.agendaItem.create({ data: { agendaId: agenda.id, date: new Date(item.date), location: item.location ?? '', fromPoint: item.fromPoint ?? null, toPoint: item.toPoint ?? null, details: item.details ?? null, mealPlan: item.mealPlan ?? null, meetingTime: item.meetingTime ?? null, serviceType: (item.serviceType ?? 'OWN_ARRANGEMENT') as 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT' } })
        }
      }
    } catch (err) {
      console.error('[Webhook] agenda generation failed:', err)
    }
  }

  await logActivity({
    userId: 'SYSTEM',
    action: ACTION.BOOKING_CREATED,
    entityType: 'Booking',
    entityId: bookingId,
    details: { source: 'webhook', subject: email.subject, bookingRef },
  })

  console.log('[Webhook] ✓ auto-processed booking', bookingRef)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNotificationPayload { value?: GraphNotification[] }

interface GraphNotification {
  subscriptionId: string
  changeType: string
  clientState: string
  resourceData?: { id?: string }
}
