/**
 * Driver App — reminder sweep (hourly, /api/cron/mobile-notify).
 *
 *   TRIP_ASSIGNED      a movement / round trip given to the driver after they
 *                      installed the app (assignedAt / allocation time later
 *                      than their app account), so installing the app does
 *                      not replay every old assignment as "new"
 *   TRIP_TOMORROW      evening before the first day, from 17:00 local
 *   TODAY_PLAN         morning of each driving day, from 05:00 local
 *   VEHICLE_CHECK_DUE  once a week while the 60-day photos are due
 *
 * Every notification has a dedupeKey, so running the sweep twice sends nothing
 * new. Only drivers with an app account are considered.
 */
import { prisma } from '@/lib/prisma'
import { notify } from './notify'
import { addDaysYmd, loadDriverTrips, localTodayFor } from './trips'
import { vehicleCheckState } from './profile'

function localHour(country: string | null): number {
  const tz = country === 'VIETNAM' ? 'Asia/Ho_Chi_Minh' : country === 'SRILANKA' || !country ? 'Asia/Colombo' : 'Asia/Singapore'
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()))
}

function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function runMobileReminders(): Promise<{ drivers: number; sent: number }> {
  const accounts = await prisma.mobileDriverAccount.findMany({
    where: { passwordHash: { not: null } },
    select: { driverId: true, createdAt: true },
  })
  let sent = 0
  for (const acc of accounts) {
    const driver = await prisma.driver.findUnique({ where: { id: acc.driverId }, select: { isActive: true, country: true, name: true } })
    if (!driver?.isActive) continue
    const today = localTodayFor(driver.country)
    const hour = localHour(driver.country)
    const first = driver.name.split(/\s+/)[0]
    const trips = await loadDriverTrips(acc.driverId, today, addDaysYmd(today, 30))

    // New assignments since the driver joined the app.
    const fresh = await prisma.assignment.findMany({
      where: { driverId: acc.driverId, assignedAt: { gt: acc.createdAt }, agendaItem: { date: { gte: new Date(`${today}T00:00:00.000Z`) } } },
      select: { agendaItem: { select: { agenda: { select: { booking: { select: { bookingRef: true } } } } } } },
      take: 100,
    })
    const freshAlloc = await prisma.sriLankaDriverAllocation.findMany({
      where: { driverId: acc.driverId, OR: [{ createdAt: { gt: acc.createdAt } }, { changedAt: { gt: acc.createdAt } }] },
      select: { booking: { select: { bookingRef: true } } },
      take: 50,
    })
    const freshRefs = new Set([...fresh.map(f => f.agendaItem.agenda.booking.bookingRef), ...freshAlloc.map(f => f.booking.bookingRef)])
    for (const t of trips.filter(t => freshRefs.has(t.bookingRef))) {
      if (await notify({
        actorType: 'DRIVER', actorId: acc.driverId, kind: 'TRIP_ASSIGNED',
        title: `New trip · ${t.fileNo}`,
        body: `${t.startDate}${t.endDate !== t.startDate ? ` → ${t.endDate}` : ''} · ${t.leadGuest ?? 'Guest'} (${t.pax.adults + t.pax.children} pax)`,
        data: { bookingRef: t.bookingRef, screen: 'trip' },
        dedupeKey: `assigned:${acc.driverId}:${t.bookingRef}`,
      })) sent++
    }

    // Evening before the first day.
    if (hour >= 17) {
      const tomorrow = addDaysYmd(today, 1)
      for (const t of trips.filter(t => t.startDate === tomorrow)) {
        const m = t.days[0]?.movements.find(x => x.mine)
        if (await notify({
          actorType: 'DRIVER', actorId: acc.driverId, kind: 'TRIP_TOMORROW',
          title: `Tomorrow: ${t.fileNo} 🚗`,
          body: m ? `${m.time ? `${m.time} · ` : ''}${m.from ?? m.location}. Check fuel and clean the car tonight, ${first}!` : `Your trip with ${t.leadGuest ?? 'the guest'} starts tomorrow.`,
          data: { bookingRef: t.bookingRef, screen: 'trip' },
          dedupeKey: `tomorrow:${acc.driverId}:${t.bookingRef}`,
        })) sent++
      }
    }

    // Morning of each driving day.
    if (hour >= 5) {
      for (const t of trips) {
        const day = t.days.find(d => d.date === today)
        const m = day?.movements.find(x => x.mine && !x.noDriverNeeded)
        if (!day || !m) continue
        if (await notify({
          actorType: 'DRIVER', actorId: acc.driverId, kind: 'TODAY_PLAN',
          title: `Good morning ${first} ☀️ Day ${day.dayNo} · ${t.fileNo}`,
          body: `${m.time ? `${m.time} · ` : ''}${m.from ?? m.location}${m.to ? ` → ${m.to}` : ''}. Swipe "Start day" when you leave.`,
          data: { bookingRef: t.bookingRef, screen: 'home' },
          dedupeKey: `today:${acc.driverId}:${t.bookingRef}:${today}`,
        })) sent++
      }
    }

    // Vehicle photos due — once a week, mornings.
    if (hour >= 8) {
      const vc = await vehicleCheckState(acc.driverId)
      if (vc.due && await notify({
        actorType: 'DRIVER', actorId: acc.driverId, kind: 'VEHICLE_CHECK_DUE',
        title: 'Time to renew your vehicle photos 📸',
        body: vc.rejectedNote ? `Ops asked: ${vc.rejectedNote}` : 'It takes 2 minutes — 3 photos of your vehicle.',
        data: { screen: 'vehicle' },
        dedupeKey: `vc-due:${acc.driverId}:${isoWeek(today)}`,
      })) sent++
    }
  }
  return { drivers: accounts.length, sent }
}
