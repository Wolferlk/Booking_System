/**
 * Automatic tour-confirmation email: 3 days before the customer arrives, email
 * them the agenda PDF with the standard confirmation body.
 *
 * Runs once a day from the in-process Node scheduler
 * (agenda-auto-send-scheduler.ts) — no OS/Vercel cron. Toggled by the
 * `auto_agenda_email_enabled` SystemSetting (defaults to ON when the row is
 * absent). Each booking is de-duplicated with an `agenda_auto_sent_{ref}` row,
 * so a re-run on the same day never emails a guest twice.
 */
import { prisma } from '@/lib/prisma'
import { AGENDA_INCLUDE, sendAgendaEmail } from '@/lib/agenda-mailer'

// Same fixed-offset convention as the other customer-messaging crons (UTC+7 default).
const TZ_OFFSET_HOURS = Number(process.env.CUSTOMER_MSG_TZ_OFFSET_HOURS ?? '7')
const TZ_OFFSET_MS    = TZ_OFFSET_HOURS * 60 * 60 * 1000

/** How many days before arrival the confirmation goes out. */
export const AGENDA_LEAD_DAYS = Number(process.env.AGENDA_AUTO_EMAIL_LEAD_DAYS ?? '3')

export const SETTING_AGENDA_AUTO_EMAIL = 'auto_agenda_email_enabled'

const sentKey = (ref: string) => `agenda_auto_sent_${ref}`

export interface AgendaAutoSendResult {
  date:    string
  sent:    number
  skipped: number
  errors:  string[]
}

function localDateStr(daysAhead = 0): string {
  const localMs = Date.now() + TZ_OFFSET_MS + daysAhead * 24 * 60 * 60 * 1000
  return new Date(localMs).toISOString().slice(0, 10)
}

export async function runAgendaAutoSend(opts: { dryRun?: boolean } = {}): Promise<AgendaAutoSendResult> {
  const targetDate = localDateStr(AGENDA_LEAD_DAYS)
  const result: AgendaAutoSendResult = { date: targetDate, sent: 0, skipped: 0, errors: [] }

  const toggle = await prisma.systemSetting.findUnique({ where: { key: SETTING_AGENDA_AUTO_EMAIL } })
  if (toggle?.value === 'false') {
    result.errors.push('disabled by auto_agenda_email_enabled=false')
    return result
  }

  const bookings = await prisma.booking.findMany({
    where: {
      arrivalDate: {
        gte: new Date(`${targetDate}T00:00:00.000Z`),
        lte: new Date(`${targetDate}T23:59:59.999Z`),
      },
      status:      { notIn: ['CANCELLED', 'DRAFT'] },
      cancelledAt: null,
    },
    include: AGENDA_INCLUDE,
  })

  for (const booking of bookings) {
    const to = booking.contactEmail?.trim()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      result.skipped++
      continue
    }

    // No agenda items → the PDF would be empty; leave it to the team to send manually.
    if ((booking.tourAgenda?.items?.length ?? 0) === 0) {
      result.skipped++
      continue
    }

    const key   = sentKey(booking.bookingRef)
    const prior = await prisma.systemSetting.findUnique({ where: { key } })
    if (prior) {
      result.skipped++
      continue
    }

    if (opts.dryRun) {
      result.sent++
      continue
    }

    try {
      await sendAgendaEmail({
        booking,
        to,
        subject:     `Tour Confirmation — ${booking.bookingRef}`,
        showDrivers: false,   // customer copy never exposes driver allocation
      })
      await prisma.systemSetting.upsert({
        where:  { key },
        create: { key, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      })
      result.sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[agenda-auto-send] ${booking.bookingRef} failed:`, err)
      result.errors.push(`${booking.bookingRef}: ${msg}`)
    }
  }

  return result
}
