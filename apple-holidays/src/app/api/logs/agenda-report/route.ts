/**
 * GET /api/logs/agenda-report?from=YYYY-MM-DD&to=YYYY-MM-DD&actor=&ref=&auto=1
 *
 * Agenda Edit Report: which movement charts were saved or edited, by whom,
 * how often and when last. Read-only. Built from the Booking Logs rows that
 * every agenda save already writes (booking_event_logs, section 'agenda'),
 * plus older OPS AI agenda edits that were only written to activity_logs.
 *
 * Kept light on the live DB: one indexed range read (section + createdAt),
 * a date window of at most 92 days, and a hard row cap.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { detectCountryFromRef, isInCountryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MAX_DAYS = 92
const ROW_CAP = 25_000

type Kind = 'save' | 'edit' | 'assign' | 'auto'

/** What one log row means for the report. */
function kindOf(action: string, summary: string, source: string | null): Kind {
  if (source && source !== 'user') return 'auto'
  if (action === 'assigned' || action === 'unassigned') return 'assign'
  if (/^Movement chart/i.test(summary) || action === 'created' || action === 'saved') return 'save'
  return 'edit'
}

const day = (v: string | null, endOfDay = false): Date | null => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
}

interface Counts { saves: number; edits: number; assigns: number; auto: number }
const zero = (): Counts => ({ saves: 0, edits: 0, assigns: 0, auto: 0 })
function bump(c: Counts, k: Kind) {
  if (k === 'save') c.saves++
  else if (k === 'edit') c.edits++
  else if (k === 'assign') c.assigns++
  else c.auto++
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCountries = canSeeAllCountries(role, userCountry as any) || !userCountry || userCountry === 'ALL'
  const inScope = (ref: string) => {
    if (allCountries) return true
    const c = detectCountryFromRef(ref)
    return !!c && isInCountryScope(c, userCountry)
  }

  const sp = req.nextUrl.searchParams
  const to = day(sp.get('to'), true) ?? new Date()
  let from = day(sp.get('from')) ?? new Date(to.getTime() - 7 * 86_400_000)
  const earliest = new Date(to.getTime() - MAX_DAYS * 86_400_000)
  const clamped = from < earliest
  if (clamped) from = earliest
  const actor = sp.get('actor')?.trim() || null
  const ref = sp.get('ref')?.trim().toUpperCase() || null
  const includeAuto = sp.get('auto') === '1'

  let rows: { bookingRef: string; action: string; summary: string; actorName: string | null; source: string | null; createdAt: Date }[] = []
  try {
    rows = await prisma.bookingEventLog.findMany({
      where: {
        section: 'agenda',
        createdAt: { gte: from, lte: to },
        ...(ref ? { bookingRef: { startsWith: ref } } : {}),
        ...(actor ? { actorName: { contains: actor } } : {}),
        ...(includeAuto ? {} : { OR: [{ source: 'user' }, { source: null }] }),
        // Skipped automatic runs changed nothing.
        NOT: { status: 'skipped' },
      },
      orderBy: { createdAt: 'desc' },
      take: ROW_CAP,
      select: { bookingRef: true, action: true, summary: true, actorName: true, source: true, createdAt: true },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/booking_event_logs|1146|P2021/i.test(msg)) {
      return buildApiError('The Booking Logs table is not set up on this database yet', 503)
    }
    throw err
  }
  const truncated = rows.length >= ROW_CAP

  // Older OPS AI agenda edits were written only to activity_logs, keyed by the
  // movement id with the booking ref in the details. New ones are in the rows
  // above (and carry `logged: true` there, so they are not counted twice).
  if (!truncated) {
    const ai = await prisma.activityLog.findMany({
      where: {
        entityType: 'AgendaItem',
        createdAt: { gte: from, lte: to },
        ...(actor ? { user: { name: { contains: actor } } } : {}),
      },
      take: 2_000,
      select: { details: true, createdAt: true, user: { select: { name: true, email: true } } },
    }).catch(() => [])
    for (const a of ai) {
      let d: Record<string, unknown> = {}
      try { d = a.details ? JSON.parse(a.details) : {} } catch { continue }
      if (d.logged === true || typeof d.bookingRef !== 'string') continue
      const bookingRef = d.bookingRef.toUpperCase()
      if (ref && !bookingRef.startsWith(ref)) continue
      rows.push({
        bookingRef,
        action: d.op === 'agenda_item_added' ? 'created' : 'updated',
        summary: d.op === 'agenda_item_added' ? `Movement added via OPS AI` : `Movement edited via OPS AI`,
        actorName: a.user?.name || a.user?.email || null,
        source: 'user',
        createdAt: a.createdAt,
      })
    }
  }

  const label = (r: { actorName: string | null; source: string | null }) =>
    r.actorName?.trim() || (r.source === 'excel' ? 'Excel MC' : r.source && r.source !== 'user' ? 'System' : 'Unknown user')

  const bookings = new Map<string, {
    bookingRef: string; counts: Counts; people: Map<string, number>
    lastAt: Date; lastBy: string; lastSummary: string; firstAt: Date
  }>()
  const people = new Map<string, { name: string; counts: Counts; bookings: Set<string>; lastAt: Date }>()
  const byDay = new Map<string, number>()

  for (const r of rows) {
    if (!inScope(r.bookingRef)) continue
    const k = kindOf(r.action, r.summary, r.source)
    const who = label(r)

    let b = bookings.get(r.bookingRef)
    if (!b) {
      b = { bookingRef: r.bookingRef, counts: zero(), people: new Map(), lastAt: r.createdAt, lastBy: who, lastSummary: r.summary, firstAt: r.createdAt }
      bookings.set(r.bookingRef, b)
    }
    bump(b.counts, k)
    b.people.set(who, (b.people.get(who) ?? 0) + 1)
    if (r.createdAt > b.lastAt) { b.lastAt = r.createdAt; b.lastBy = who; b.lastSummary = r.summary }
    if (r.createdAt < b.firstAt) b.firstAt = r.createdAt

    let p = people.get(who)
    if (!p) { p = { name: who, counts: zero(), bookings: new Set(), lastAt: r.createdAt }; people.set(who, p) }
    bump(p.counts, k)
    p.bookings.add(r.bookingRef)
    if (r.createdAt > p.lastAt) p.lastAt = r.createdAt

    const d = r.createdAt.toISOString().slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }

  // Booking context for the table: lead guest, arrival, country, status.
  const refs = Array.from(bookings.keys())
  const info = refs.length
    ? await prisma.booking.findMany({
        where: { bookingRef: { in: refs.slice(0, 5_000) } },
        select: {
          bookingRef: true, arrivalDate: true, operationCountry: true, status: true,
          passengers: { where: { isLead: true }, take: 1, select: { name: true } },
        },
      }).catch(() => [])
    : []
  const infoByRef = new Map(info.map(i => [i.bookingRef, i]))

  const bookingRows = Array.from(bookings.values())
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map(b => {
      const i = infoByRef.get(b.bookingRef)
      return {
        bookingRef: b.bookingRef,
        leadGuest: i?.passengers[0]?.name ?? null,
        arrivalDate: i?.arrivalDate?.toISOString().slice(0, 10) ?? null,
        country: i?.operationCountry ?? null,
        status: i?.status ?? null,
        ...b.counts,
        total: b.counts.saves + b.counts.edits + b.counts.assigns + b.counts.auto,
        people: Array.from(b.people, ([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n),
        lastAt: b.lastAt.toISOString(),
        lastBy: b.lastBy,
        lastSummary: b.lastSummary,
        firstAt: b.firstAt.toISOString(),
      }
    })

  const peopleRows = Array.from(people.values())
    .map(p => ({
      name: p.name, ...p.counts,
      total: p.counts.saves + p.counts.edits + p.counts.assigns + p.counts.auto,
      bookings: p.bookings.size, lastAt: p.lastAt.toISOString(),
    }))
    .sort((a, b) => b.total - a.total)

  return buildApiSuccess({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    clamped, truncated, includeAuto,
    totals: {
      bookings: bookingRows.length,
      people: peopleRows.length,
      saves: bookingRows.reduce((n, b) => n + b.saves, 0),
      edits: bookingRows.reduce((n, b) => n + b.edits, 0),
      assigns: bookingRows.reduce((n, b) => n + b.assigns, 0),
      auto: bookingRows.reduce((n, b) => n + b.auto, 0),
    },
    byDay: Array.from(byDay, ([date, n]) => ({ date, n })).sort((a, b) => a.date.localeCompare(b.date)),
    people: peopleRows,
    bookings: bookingRows,
  })
}
