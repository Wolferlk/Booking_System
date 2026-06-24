/**
 * Cron: Driver WhatsApp daily briefing
 * Runs at 23:00 UTC = 06:00 Vietnam / 07:00 Sri Lanka time
 * Sends today's movement details to each assigned driver.
 * Also triggered hourly to catch "3 hours before trip" window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendWhatsAppText, formatDriverMovementMessage, normalisePhone } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
// Vietnam offset is UTC+7; cron fires at 23:00 UTC = 06:00 local
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000

function todayLocalDateStr(): string {
  const localMs = Date.now() + TZ_OFFSET_MS
  return new Date(localMs).toISOString().slice(0, 10)
}

function localNowHHMM(): string {
  const localMs = Date.now() + TZ_OFFSET_MS
  const d = new Date(localMs)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const todayStr  = todayLocalDateStr()
  const nowHHMM   = localNowHHMM()
  const todayStart = new Date(`${todayStr}T00:00:00.000Z`)
  const todayEnd   = new Date(`${todayStr}T23:59:59.999Z`)

  console.log(`[DriverNotify] Running for ${todayStr} (local now: ${nowHHMM})`)

  // Fetch all agenda items for today that have an assigned driver with a phone
  const items = await prisma.agendaItem.findMany({
    where: {
      date: { gte: todayStart, lte: todayEnd },
      assignment: {
        driverPhone: { not: null },
        driverName:  { not: null },
      },
    },
    include: {
      assignment: true,
      agenda: {
        include: {
          booking: {
            include: {
              passengers: { where: { isLead: true }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: [{ date: 'asc' }, { meetingTime: 'asc' }],
  })

  console.log(`[DriverNotify] ${items.length} movements found for today`)

  let sent = 0
  let skipped = 0

  for (const item of items) {
    const assignment = item.assignment
    if (!assignment?.driverPhone || !assignment?.driverName) { skipped++; continue }

    // Skip if morning briefing already sent today
    const alreadySentToday = assignment.waSentAt
      && assignment.waSentAt >= todayStart
      && assignment.waSentAt <= todayEnd

    // Determine if we should send now:
    // Mode A — 6 AM morning blast: send all items for today
    // Mode B — 3-hour pre-trip: send if meetingTime is within 2h55m–3h05m from now
    const isMorningRun = nowHHMM >= '05:50' && nowHHMM <= '06:30'
    let shouldSend = isMorningRun && !alreadySentToday

    if (!shouldSend && item.meetingTime && !alreadySentToday) {
      // 3-hour window check
      const [mh, mm] = item.meetingTime.split(':').map(Number)
      const [nh, nm] = nowHHMM.split(':').map(Number)
      const meetingMinutes = mh * 60 + mm
      const nowMinutes     = nh * 60 + nm
      const diffMinutes    = meetingMinutes - nowMinutes
      if (diffMinutes >= 170 && diffMinutes <= 185) {
        shouldSend = true
      }
    }

    if (!shouldSend) { skipped++; continue }

    const booking = item.agenda.booking
    const msg = formatDriverMovementMessage({
      driverName:    assignment.driverName,
      bookingRef:    booking.bookingRef,
      date:          item.date,
      location:      item.location,
      fromPoint:     item.fromPoint,
      toPoint:       item.toPoint,
      details:       item.details,
      meetingTime:   item.meetingTime,
      paxAdults:     booking.paxAdults,
      paxChildren:   booking.paxChildren,
      leadPassenger: booking.passengers[0]?.name ?? null,
      vehicleType:   assignment.vehicleType,
      vehiclePlate:  assignment.vehiclePlate,
      driverRate:    assignment.driverRate ? Number(assignment.driverRate) : null,
      rateCurrency:  assignment.rateCurrency,
    })

    const ok = await sendWhatsAppText(assignment.driverPhone, msg, assignment.driverName)
    if (ok) {
      // Record in WhatsApp log and update waSentAt
      await Promise.all([
        prisma.whatsAppMessage.create({
          data: {
            bookingRef: booking.bookingRef,
            phone:      normalisePhone(assignment.driverPhone),
            direction:  'outbound',
            body:       msg,
            status:     'sent',
            senderName: `[DRIVER] ${assignment.driverName}`,
          },
        }),
        prisma.assignment.update({
          where: { id: assignment.id },
          data:  { waSentAt: new Date() },
        }),
      ])
      console.log(`[DriverNotify] ✅ Sent to ${assignment.driverName} (${assignment.driverPhone}) — ${booking.bookingRef} @ ${item.meetingTime ?? '?'}`)
      sent++
    } else {
      console.error(`[DriverNotify] ❌ Failed for ${assignment.driverName} (${assignment.driverPhone})`)
    }
  }

  console.log(`[DriverNotify] Done — sent: ${sent}, skipped: ${skipped}`)
  return NextResponse.json({ ok: true, date: todayStr, sent, skipped })
}
