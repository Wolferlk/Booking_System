/**
 * Ground-partner performance analytics — drivers, vehicle vendors, guides and
 * tour vendors.
 *
 * Everything in this module is READ-ONLY. It never writes, and it never widens
 * an existing query: it re-reads `assignments` (the movement chart's driver /
 * vendor allocation), the two feedback tables the guest fills in, and the
 * realtime complaint alerts raised on calls, then does all of the arithmetic in
 * JS. Nothing here is allowed to mutate a booking, an assignment or a partner.
 *
 * Where the numbers come from
 * ───────────────────────────
 *   trips / bookings   `assignments` → `agenda_items` → `tour_agendas` → `bookings`
 *                      One assignment = one movement. A booking usually has
 *                      several, so "trips" is always ≥ "files".
 *   guest rating       `guest_feedback_forms.transportDriver` — the guest's own
 *                      four-point score for the chauffeur, mapped onto 5 stars.
 *   overall rating     `guest_feedback_forms.overallExperience` and
 *                      `customer_feedback.rating` (already 1-5).
 *   complaints         a POOR driver/vehicle score, a customer_feedback rating
 *                      of ≤ 2, or an open row in `tbl_te_important_alerts`
 *                      for one of this partner's bookings.
 *
 * Feedback is captured per *booking*, not per movement, so a score is credited
 * to every partner who drove on that file. With more than one driver on a file
 * the score is shared — that is stated in the UI rather than hidden.
 */
import { prisma } from '@/lib/prisma'
import type { FeedbackRating, OperationCountry, Prisma } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PartnerKind = 'driver' | 'vendor' | 'guide' | 'tourVendor'

export interface PartnerComment {
  bookingId: string
  bookingRef: string
  /** 'praise' | 'complaint' | 'neutral' — see classifyComment(). */
  tone: CommentTone
  /** Where it came from, for the source chip in the UI. */
  source: 'GUEST_FORM' | 'STAFF_FEEDBACK' | 'CALL_ALERT'
  text: string
  /** 1-5, normalised. Null when the source carried no score. */
  score: number | null
  /** Raw guest-form driver score, when this row had one. */
  driverRating: FeedbackRating | null
  /** true when the words actually name the driver / vehicle. */
  mentionsDriver: boolean
  clientName: string | null
  date: string | null
  /** Call-alert extras. */
  category?: string | null
  severity?: string | null
  status?: string | null
}

export type CommentTone = 'praise' | 'complaint' | 'neutral'

export interface MonthPoint {
  /** yyyy-MM */
  month: string
  label: string
  trips: number
  bookings: number
  pax: number
}

export interface PartnerAnalytics {
  kind: PartnerKind
  id: string
  /** Movements driven. */
  trips: number
  /** Distinct booking files worked. */
  bookings: number
  /** Distinct calendar days on the road. */
  daysOnRoad: number
  /** Guests carried, counted once per file. */
  pax: number
  upcomingTrips: number
  completedTrips: number
  cancelledBookings: number
  firstTrip: string | null
  lastTrip: string | null
  /** Days since the last completed movement — null when never driven. */
  daysSinceLastTrip: number | null
  /** Movements in the last 30 / 90 days. */
  trips30d: number
  trips90d: number
  /** Internal cost of this partner's movements, per currency. Never shown to the partner. */
  value: { currency: string; total: number; trips: number }[]
  monthly: MonthPoint[]
  topRoutes: { label: string; count: number }[]
  topAgents: { label: string; count: number }[]
  countries: { country: string; count: number }[]
  vehicleTypes: { label: string; count: number }[]
  /** Bookings worked more than once for the same agent — a loose loyalty signal. */
  repeatAgents: number

  // ── Feedback ───────────────────────────────────────────────────────────────
  /** Headline 1-5 star score from the guest's driver rating. Null = never rated. */
  rating: number | null
  /** Blended score used for ranking: driver rating, falling back to overall. */
  ratingBlended: number | null
  vehicleRating: number | null
  overallRating: number | null
  ratingBreakdown: Record<FeedbackRating, number>
  /** Feedback forms received / completed files — how much of the record is actually rated. */
  ratedBookings: number
  responseRate: number | null
  praiseCount: number
  complaintCount: number
  openAlerts: number
  comments: PartnerComment[]
  /** 0-100 composite used for the league table. Null until there is anything to score. */
  score: number | null
  grade: PartnerGrade | null
  /** Set when the realtime call-alert table could not be read (schema drift). */
  alertsUnavailable: boolean
}

export type PartnerGrade = 'A+' | 'A' | 'B' | 'C' | 'D'

export interface PartnerSummary {
  kind: PartnerKind
  id: string
  trips: number
  bookings: number
  trips90d: number
  lastTrip: string | null
  rating: number | null
  ratedBookings: number
  praiseCount: number
  complaintCount: number
  score: number | null
  grade: PartnerGrade | null
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * The guest form is a four-point scale; every other rating in the system is out
 * of five. POOR maps to 1 rather than 2 so a single bad file visibly drags the
 * average — that is the point of tracking it.
 */
export const RATING_SCORE: Record<FeedbackRating, number> = {
  EXCELLENT: 5,
  GOOD: 4,
  AVERAGE: 3,
  POOR: 1,
}

const NEGATIVE_WORDS = /\b(rude|late|delay|delayed|dirty|unsafe|smok\w*|drunk|slow|lost|angry|argu\w*|complain\w*|refus\w*|overcharg\w*|scam|bad|poor|worst|terrible|awful|unprofessional|reckless|speeding|broke\w*|breakdown|aircon|a\/c not|no show|noshow|never came|didn'?t come)\b/i
const POSITIVE_WORDS = /\b(excellent|amazing|wonderful|fantastic|great|best|friendly|helpful|polite|punctual|safe|clean|knowledg\w*|caring|patient|professional|superb|outstanding|kind|courteous|smooth|comfortable|recommend\w*)\b/i
const DRIVER_WORDS = /\b(driver|drivers|chauffeur|driving|vehicle|van|car|bus|coach|transport|guide)\b/i

/** Which realtime call-alert categories count against a ground partner. */
const DRIVER_ALERT_CATEGORIES = /transport|driver|vehicle|guide|ground/i

// ── Row loading ───────────────────────────────────────────────────────────────

const assignmentSelect = {
  id: true,
  driverId: true,
  vendorId: true,
  guideId: true,
  tourVendorId: true,
  driverRate: true,
  rateCurrency: true,
  vehicleType: true,
  agendaItem: {
    select: {
      date: true,
      location: true,
      agenda: {
        select: {
          booking: {
            select: {
              id: true,
              bookingRef: true,
              agent: true,
              status: true,
              arrivalDate: true,
              paxAdults: true,
              paxChildren: true,
              paxInfants: true,
              operationCountry: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.AssignmentSelect

type AssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof assignmentSelect }>

function partnerWhere(kind: PartnerKind, id: string | null): Prisma.AssignmentWhereInput {
  const field = ({ driver: 'driverId', vendor: 'vendorId', guide: 'guideId', tourVendor: 'tourVendorId' } as const)[kind]
  return id ? { [field]: id } : { [field]: { not: null } }
}

function partnerIdOf(kind: PartnerKind, row: AssignmentRow): string | null {
  switch (kind) {
    case 'driver': return row.driverId
    case 'vendor': return row.vendorId
    case 'guide': return row.guideId
    case 'tourVendor': return row.tourVendorId
  }
}

async function loadAssignments(
  where: Prisma.AssignmentWhereInput,
  sinceMonths: number | null,
): Promise<AssignmentRow[]> {
  const dateWhere = sinceMonths
    ? { agendaItem: { date: { gte: monthsAgo(sinceMonths) } } }
    : {}
  return prisma.assignment.findMany({
    where: { ...where, ...dateWhere },
    select: assignmentSelect,
    orderBy: { assignedAt: 'desc' },
  })
}

function monthsAgo(months: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() - months)
  return d
}

// ── Feedback loading ──────────────────────────────────────────────────────────

interface FeedbackBundle {
  guest: {
    bookingId: string
    transportDriver: FeedbackRating | null
    transportVehicle: FeedbackRating | null
    overallExperience: FeedbackRating | null
    remarks: string | null
    clientName: string | null
    submittedAt: Date
  }[]
  staff: { bookingId: string; rating: number | null; comment: string | null; createdAt: Date }[]
  alerts: {
    booking_ref: string | null
    category: string | null
    severity: string
    title: string | null
    details: string | null
    customer_quote: string | null
    status: string
    created_at: Date
  }[]
  alertsUnavailable: boolean
}

async function loadFeedback(bookingIds: string[], bookingRefs: string[]): Promise<FeedbackBundle> {
  if (bookingIds.length === 0) {
    return { guest: [], staff: [], alerts: [], alertsUnavailable: false }
  }

  const [guest, staff] = await Promise.all([
    prisma.guestFeedbackForm.findMany({
      where: { bookingId: { in: bookingIds } },
      select: {
        bookingId: true, transportDriver: true, transportVehicle: true,
        overallExperience: true, remarks: true, clientName: true, submittedAt: true,
      },
    }),
    prisma.customerFeedback.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { bookingId: true, rating: true, comment: true, createdAt: true },
    }),
  ])

  // The realtime call-alert tables live behind the TE call bot and are not on
  // every environment (the live schema has drifted). A missing table must not
  // take the whole analytics panel down — complaints simply come from the
  // feedback forms alone, and the UI says so.
  let alerts: FeedbackBundle['alerts'] = []
  let alertsUnavailable = false
  if (bookingRefs.length > 0) {
    try {
      alerts = await prisma.tbl_te_important_alerts.findMany({
        where: { booking_ref: { in: bookingRefs } },
        select: {
          booking_ref: true, category: true, severity: true, title: true,
          details: true, customer_quote: true, status: true, created_at: true,
        },
        orderBy: { created_at: 'desc' },
      })
    } catch {
      alertsUnavailable = true
    }
  }

  return { guest, staff, alerts, alertsUnavailable }
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyComment(score: number | null, text: string): CommentTone {
  const negative = NEGATIVE_WORDS.test(text)
  const positive = POSITIVE_WORDS.test(text)
  // The score leads — a guest who ticked POOR is complaining whatever the
  // wording — and the words only decide the unscored or middling rows.
  if (score !== null) {
    if (score <= 2) return 'complaint'
    if (score >= 4) return negative && !positive ? 'neutral' : 'praise'
    return negative ? 'complaint' : positive ? 'praise' : 'neutral'
  }
  if (negative && !positive) return 'complaint'
  if (positive && !negative) return 'praise'
  return 'neutral'
}

function gradeFor(score: number): PartnerGrade {
  if (score >= 88) return 'A+'
  if (score >= 75) return 'A'
  if (score >= 60) return 'B'
  if (score >= 45) return 'C'
  return 'D'
}

/**
 * Composite 0-100 used to rank the league table.
 *
 *   60 pts  guest rating (blended driver / overall score out of 5)
 *   20 pts  volume — how much work this partner has actually done, saturating
 *           at 40 movements so a busy veteran cannot be beaten on volume alone
 *   10 pts  recency — still driving for us in the last 90 days
 *   10 pts  clean record, minus 6 per complaint
 *
 * A partner with no rating at all scores on volume and recency only, which is
 * why the UI shows "unrated" beside the number instead of pretending it ranks.
 */
function compositeScore(a: {
  ratingBlended: number | null
  trips: number
  trips90d: number
  complaintCount: number
  ratedBookings: number
}): number | null {
  if (a.trips === 0) return null
  const rating = a.ratingBlended != null
    ? (a.ratingBlended / 5) * 60
    // Unrated: park them at the middle of the rating band rather than at zero,
    // so "never rated" does not read as "rated terribly".
    : 0.6 * 60
  const volume = Math.min(a.trips / 40, 1) * 20
  const recency = a.trips90d > 0 ? 10 : a.trips > 0 ? 4 : 0
  const record = Math.max(0, 10 - a.complaintCount * 6)
  return Math.round(Math.min(100, rating + volume + recency + record))
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function topOf(counts: Map<string, number>, limit: number) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100
}

interface AggregateInput {
  kind: PartnerKind
  id: string
  rows: AssignmentRow[]
  feedback: FeedbackBundle
  /** Full comment list, or just the counts — the league table only needs counts. */
  withComments: boolean
}

function aggregate({ kind, id, rows, feedback, withComments }: AggregateInput): PartnerAnalytics {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30)
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90)

  const bookingsSeen = new Map<string, { ref: string; pax: number; status: string; agent: string | null }>()
  const dayKeys = new Set<string>()
  const routeCounts = new Map<string, number>()
  const agentCounts = new Map<string, number>()
  const countryCounts = new Map<string, number>()
  const vehicleCounts = new Map<string, number>()
  const valueByCurrency = new Map<string, { total: number; trips: number }>()
  const monthlyMap = new Map<string, { trips: number; bookings: Set<string>; pax: number }>()

  let upcomingTrips = 0
  let completedTrips = 0
  let trips30d = 0
  let trips90d = 0
  let firstTrip: Date | null = null
  let lastTrip: Date | null = null

  for (const row of rows) {
    const item = row.agendaItem
    const booking = item?.agenda?.booking
    const date = item?.date ? new Date(item.date) : null

    if (date) {
      if (!firstTrip || date < firstTrip) firstTrip = date
      if (!lastTrip || date > lastTrip) lastTrip = date
      if (date >= today) upcomingTrips++
      else {
        completedTrips++
        if (date >= d30) trips30d++
        if (date >= d90) trips90d++
      }
    }

    if (booking) {
      const pax = booking.paxAdults + booking.paxChildren + booking.paxInfants
      if (!bookingsSeen.has(booking.id)) {
        bookingsSeen.set(booking.id, {
          ref: booking.bookingRef, pax, status: booking.status, agent: booking.agent,
        })
        if (booking.agent) agentCounts.set(booking.agent, (agentCounts.get(booking.agent) ?? 0) + 1)
        if (booking.operationCountry) {
          countryCounts.set(booking.operationCountry, (countryCounts.get(booking.operationCountry) ?? 0) + 1)
        }
      }
      if (date) dayKeys.add(`${booking.id}|${date.toISOString().slice(0, 10)}`)
    }

    if (date) {
      const key = monthKey(date)
      const bucket = monthlyMap.get(key) ?? { trips: 0, bookings: new Set<string>(), pax: 0 }
      bucket.trips++
      if (booking && !bucket.bookings.has(booking.id)) {
        bucket.bookings.add(booking.id)
        bucket.pax += booking.paxAdults + booking.paxChildren + booking.paxInfants
      }
      monthlyMap.set(key, bucket)
    }

    const place = item?.location?.trim()
    if (place) routeCounts.set(place, (routeCounts.get(place) ?? 0) + 1)
    if (row.vehicleType) {
      const v = row.vehicleType.trim().toLowerCase()
      if (v) vehicleCounts.set(v, (vehicleCounts.get(v) ?? 0) + 1)
    }
    if (row.driverRate != null) {
      const cur = (row.rateCurrency || 'USD').toUpperCase()
      const slot = valueByCurrency.get(cur) ?? { total: 0, trips: 0 }
      slot.total += Number(row.driverRate)
      slot.trips++
      valueByCurrency.set(cur, slot)
    }
  }

  // Last 12 months, zero-filled so a quiet month reads as a gap and not as a
  // missing point the chart silently bridges over.
  const monthly: MonthPoint[] = []
  const cursor = new Date(today.getFullYear(), today.getMonth(), 1)
  cursor.setMonth(cursor.getMonth() - 11)
  for (let i = 0; i < 12; i++) {
    const key = monthKey(cursor)
    const bucket = monthlyMap.get(key)
    monthly.push({
      month: key,
      label: `${MONTH_LABELS[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
      trips: bucket?.trips ?? 0,
      bookings: bucket?.bookings.size ?? 0,
      pax: bucket?.pax ?? 0,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  // ── Feedback roll-up ────────────────────────────────────────────────────────
  const refToBooking = new Map<string, string>()
  bookingsSeen.forEach((b, bid) => refToBooking.set(b.ref, bid))

  const driverScores: number[] = []
  const vehicleScores: number[] = []
  const overallScores: number[] = []
  const breakdown: Record<FeedbackRating, number> = { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, POOR: 0 }
  const comments: PartnerComment[] = []
  const ratedBookingIds = new Set<string>()

  for (const g of feedback.guest) {
    const booking = bookingsSeen.get(g.bookingId)
    if (!booking) continue
    ratedBookingIds.add(g.bookingId)
    if (g.transportDriver) {
      driverScores.push(RATING_SCORE[g.transportDriver])
      breakdown[g.transportDriver]++
    }
    if (g.transportVehicle) vehicleScores.push(RATING_SCORE[g.transportVehicle])
    if (g.overallExperience) overallScores.push(RATING_SCORE[g.overallExperience])

    const text = g.remarks?.trim()
    // A POOR score with no words written is still a complaint worth showing, so
    // it gets a stand-in line rather than being dropped for having no remark.
    const hasWords = Boolean(text)
    const score = g.transportDriver ? RATING_SCORE[g.transportDriver] : (g.overallExperience ? RATING_SCORE[g.overallExperience] : null)
    if (hasWords || g.transportDriver === 'POOR' || g.transportDriver === 'EXCELLENT') {
      comments.push({
        bookingId: g.bookingId,
        bookingRef: booking.ref,
        tone: classifyComment(score, text ?? ''),
        source: 'GUEST_FORM',
        text: text || (g.transportDriver === 'POOR'
          ? 'Guest rated the chauffeur Poor without leaving a written remark.'
          : 'Guest rated the chauffeur Excellent without leaving a written remark.'),
        score,
        driverRating: g.transportDriver,
        mentionsDriver: DRIVER_WORDS.test(text ?? ''),
        clientName: g.clientName,
        date: g.submittedAt.toISOString(),
      })
    }
  }

  for (const s of feedback.staff) {
    const booking = bookingsSeen.get(s.bookingId)
    if (!booking) continue
    ratedBookingIds.add(s.bookingId)
    if (s.rating != null) overallScores.push(Math.max(1, Math.min(5, s.rating)))
    const text = s.comment?.trim()
    if (!text) continue
    comments.push({
      bookingId: s.bookingId,
      bookingRef: booking.ref,
      tone: classifyComment(s.rating ?? null, text),
      source: 'STAFF_FEEDBACK',
      text,
      score: s.rating ?? null,
      driverRating: null,
      mentionsDriver: DRIVER_WORDS.test(text),
      clientName: null,
      date: s.createdAt.toISOString(),
    })
  }

  let openAlerts = 0
  for (const a of feedback.alerts) {
    if (!a.booking_ref) continue
    const bookingId = refToBooking.get(a.booking_ref)
    if (!bookingId) continue
    // Only the ground-side categories belong on a driver's record. A hotel
    // complaint on the same file is not this driver's problem.
    const relevantCategory = a.category ? DRIVER_ALERT_CATEGORIES.test(a.category) : false
    const body = [a.title, a.details, a.customer_quote].filter(Boolean).join(' — ')
    if (!relevantCategory && !DRIVER_WORDS.test(body)) continue
    if (a.status === 'open') openAlerts++
    comments.push({
      bookingId,
      bookingRef: a.booking_ref,
      tone: 'complaint',
      source: 'CALL_ALERT',
      text: body || 'Complaint raised on a call.',
      score: null,
      driverRating: null,
      mentionsDriver: true,
      clientName: null,
      date: a.created_at.toISOString(),
      category: a.category,
      severity: a.severity,
      status: a.status,
    })
  }

  comments.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const rating = avg(driverScores)
  const overallRating = avg(overallScores)
  const ratingBlended = rating ?? overallRating
  const praiseCount = comments.filter(c => c.tone === 'praise').length
  const complaintCount = comments.filter(c => c.tone === 'complaint').length

  const cancelledBookings = Array.from(bookingsSeen.values()).filter(b => b.status === 'CANCELLED').length
  const completedBookings = bookingsSeen.size - cancelledBookings

  const score = compositeScore({
    ratingBlended, trips: rows.length, trips90d, complaintCount, ratedBookings: ratedBookingIds.size,
  })

  return {
    kind,
    id,
    trips: rows.length,
    bookings: bookingsSeen.size,
    daysOnRoad: dayKeys.size,
    pax: Array.from(bookingsSeen.values()).reduce((s, b) => s + b.pax, 0),
    upcomingTrips,
    completedTrips,
    cancelledBookings,
    firstTrip: firstTrip ? (firstTrip as Date).toISOString() : null,
    lastTrip: lastTrip ? (lastTrip as Date).toISOString() : null,
    daysSinceLastTrip: lastTrip
      ? Math.max(0, Math.floor((today.getTime() - (lastTrip as Date).getTime()) / 86_400_000))
      : null,
    trips30d,
    trips90d,
    value: Array.from(valueByCurrency.entries())
      .map(([currency, v]) => ({ currency, total: Math.round(v.total * 100) / 100, trips: v.trips }))
      .sort((a, b) => b.total - a.total),
    monthly,
    topRoutes: topOf(routeCounts, 8),
    topAgents: topOf(agentCounts, 6),
    countries: topOf(countryCounts, 6).map(c => ({ country: c.label, count: c.count })),
    vehicleTypes: topOf(vehicleCounts, 6),
    repeatAgents: Array.from(agentCounts.values()).filter(n => n > 1).length,
    rating,
    ratingBlended,
    vehicleRating: avg(vehicleScores),
    overallRating,
    ratingBreakdown: breakdown,
    ratedBookings: ratedBookingIds.size,
    responseRate: completedBookings > 0
      ? Math.round((ratedBookingIds.size / completedBookings) * 100)
      : null,
    praiseCount,
    complaintCount,
    openAlerts,
    comments: withComments ? comments.slice(0, 60) : [],
    score,
    grade: score != null ? gradeFor(score) : null,
    alertsUnavailable: feedback.alertsUnavailable,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Full analytics for one partner, all-time. Read-only. */
export async function getPartnerAnalytics(kind: PartnerKind, id: string): Promise<PartnerAnalytics> {
  const rows = await loadAssignments(partnerWhere(kind, id), null)
  const { bookingIds, bookingRefs } = collectBookings(rows)
  const feedback = await loadFeedback(bookingIds, bookingRefs)
  return aggregate({ kind, id, rows, feedback, withComments: true })
}

/**
 * League-table row for every partner of a kind that has driven at all.
 *
 * One pass over the windowed assignments plus one feedback fetch, then all of
 * the grouping in memory — cheaper and far less fragile than a hand-written
 * aggregate against a schema that has drifted between environments.
 */
export async function getPartnerLeaderboard(
  kind: PartnerKind,
  opts: { months?: number | null; country?: OperationCountry | null; ids?: string[] } = {},
): Promise<PartnerSummary[]> {
  const where: Prisma.AssignmentWhereInput = { ...partnerWhere(kind, null) }
  if (opts.ids?.length) {
    const field = ({ driver: 'driverId', vendor: 'vendorId', guide: 'guideId', tourVendor: 'tourVendorId' } as const)[kind]
    Object.assign(where, { [field]: { in: opts.ids } })
  }
  if (opts.country) {
    where.agendaItem = {
      ...(where.agendaItem as object ?? {}),
      agenda: { booking: { operationCountry: opts.country } },
    }
  }

  const rows = await loadAssignments(where, opts.months ?? null)
  const { bookingIds, bookingRefs } = collectBookings(rows)
  const feedback = await loadFeedback(bookingIds, bookingRefs)

  const byPartner = new Map<string, AssignmentRow[]>()
  for (const row of rows) {
    const pid = partnerIdOf(kind, row)
    if (!pid) continue
    const list = byPartner.get(pid)
    if (list) list.push(row)
    else byPartner.set(pid, [row])
  }

  // Slicing the feedback per partner keeps this linear-ish. Handing every
  // partner the whole bundle would make the roll-up O(partners × feedback rows),
  // which on a country with a few hundred drivers is a real stall.
  const guestByBooking = groupBy(feedback.guest, g => g.bookingId)
  const staffByBooking = groupBy(feedback.staff, s => s.bookingId)
  const alertsByRef = groupBy(feedback.alerts, a => a.booking_ref ?? '')

  const out: PartnerSummary[] = []
  Array.from(byPartner.entries()).forEach(([pid, partnerRows]) => {
    const slice = collectBookings(partnerRows)
    const partnerFeedback: FeedbackBundle = {
      guest: slice.bookingIds.flatMap(id => guestByBooking.get(id) ?? []),
      staff: slice.bookingIds.flatMap(id => staffByBooking.get(id) ?? []),
      alerts: slice.bookingRefs.flatMap(ref => alertsByRef.get(ref) ?? []),
      alertsUnavailable: feedback.alertsUnavailable,
    }
    const a = aggregate({ kind, id: pid, rows: partnerRows, feedback: partnerFeedback, withComments: false })
    out.push({
      kind, id: pid,
      trips: a.trips, bookings: a.bookings, trips90d: a.trips90d, lastTrip: a.lastTrip,
      rating: a.ratingBlended, ratedBookings: a.ratedBookings,
      praiseCount: a.praiseCount, complaintCount: a.complaintCount,
      score: a.score, grade: a.grade,
    })
  })
  out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.trips - a.trips)
  return out
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (!k) continue
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

function collectBookings(rows: AssignmentRow[]) {
  const bookingIds = new Set<string>()
  const bookingRefs = new Set<string>()
  for (const r of rows) {
    const b = r.agendaItem?.agenda?.booking
    if (!b) continue
    bookingIds.add(b.id)
    bookingRefs.add(b.bookingRef)
  }
  return { bookingIds: Array.from(bookingIds), bookingRefs: Array.from(bookingRefs) }
}
