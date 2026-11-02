/**
 * What guests told us during the period — the monthly review's "guest voice".
 *
 * Three channels, each read where it already lives and never re-derived:
 *
 *  1. **AI operation calls** — pre-tour reconfirmations, on-tour check-ins and
 *     post-tour feedback calls. Taken whole from `collectCallReport()`, the same
 *     model behind the AI Call Report page, so the good / warning / bad split,
 *     the post-tour rating and the NPS here are the figures that page shows for
 *     the same dates.
 *  2. **Guest feedback forms** — the form a guest fills in (`guest_feedback_forms`),
 *     rated EXCELLENT / GOOD / AVERAGE / POOR per area.
 *  3. **Desk feedback** — the rating and comment the TE desk saves on a booking
 *     (`customer_feedback`).
 *
 * Complaints themselves stay in the complaints section: they are the alerts the
 * calls raised, already de-duplicated there, and printing them twice would
 * double-count the period's worst news.
 *
 * Every channel degrades on its own: a missing TE stack or an unreachable call
 * service marks that channel unavailable and the rest still print. Never throws.
 */
import { prisma } from '@/lib/prisma'
import type { FeedbackRating, Prisma } from '@prisma/client'
import { collectCallReport, PHASE_LABEL, type CallIssue, type CallPhase } from '@/lib/te/call-report-data'
import { inSelectedCountries, resolveCountry, labelFor } from './booking-lines'
import { reportScope } from './report-scope'
import type { ReportWindow } from './report-window'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallVoice {
  available: boolean
  /** 'api' means the call database was unreadable and the capped API was used. */
  source: 'database' | 'api' | null
  warnings: string[]
  assigned: number
  done: number
  missed: number
  /** done ÷ assigned, 0–100. */
  completionRate: number
  /** Connected calls sorted by how they went, all phases together. */
  verdicts: { calls: number; good: number; warning: number; bad: number; none: number }
  byPhase: { phase: CallPhase; label: string; assigned: number; done: number; good: number; warning: number; bad: number }[]
  postTour: { calls: number; rated: number; avgRating: number | null; nps: number | null; promoters: number; detractors: number; recommendYes: number; recommendNo: number }
  /** On-tour checks answered "bad", by area — where the product failed on the ground. */
  areaProblems: { area: string; bad: number; good: number }[]
  reconfirmMismatches: { dates: number; flight: number; pax: number; contact: number }
  /** Calls that went badly or raised an alert, worst first. */
  issues: CallIssue[]
  issueTotals: { bad: number; warning: number }
}

export interface FormVoice {
  available: boolean
  total: number
  overall: Record<FeedbackRating, number>
  /** Per area, with a 0–100 score (EXCELLENT 100 · GOOD 75 · AVERAGE 40 · POOR 0). */
  areas: { area: string; rated: number; excellent: number; good: number; average: number; poor: number; score: number | null }[]
  /** Remarks worth reading — poor / average first. */
  remarks: { bookingRef: string; country: string; overall: FeedbackRating | null; remarks: string; submittedAt: string }[]
}

export interface DeskVoice {
  available: boolean
  total: number
  rated: number
  avgRating: number | null
  /** Saved with a rating of 2 or less. */
  low: { bookingRef: string; rating: number | null; comment: string | null; savedAt: string }[]
}

export interface GuestVoiceSection {
  calls: CallVoice
  forms: FormVoice
  desk: DeskVoice
}

// ─── AI calls ────────────────────────────────────────────────────────────────

const NO_CALLS: CallVoice = {
  available: false, source: null, warnings: [], assigned: 0, done: 0, missed: 0, completionRate: 0,
  verdicts: { calls: 0, good: 0, warning: 0, bad: 0, none: 0 }, byPhase: [],
  postTour: { calls: 0, rated: 0, avgRating: null, nps: null, promoters: 0, detractors: 0, recommendYes: 0, recommendNo: 0 },
  areaProblems: [], reconfirmMismatches: { dates: 0, flight: 0, pax: 0, contact: 0 },
  issues: [], issueTotals: { bad: 0, warning: 0 },
}

async function collectCalls(w: ReportWindow): Promise<CallVoice> {
  try {
    const r = await collectCallReport({ scope: 'range', from: w.fromDate, to: w.toDate, timezone: w.timezone })
    const ins = r.insights
    const phases: CallPhase[] = ['pre_tour', 'on_tour', 'post_tour']
    const verdicts = phases.reduce(
      (acc, p) => {
        const v = ins.verdicts[p]
        acc.calls += v.calls; acc.good += v.good; acc.warning += v.warning; acc.bad += v.bad; acc.none += v.none
        return acc
      },
      { calls: 0, good: 0, warning: 0, bad: 0, none: 0 },
    )
    const level = { bad: 0, warning: 1 }

    return {
      available: true,
      source: r.source,
      warnings: r.warnings,
      assigned: r.totals.calls.assigned,
      done: r.totals.calls.done,
      missed: r.totals.calls.missed,
      completionRate: r.totals.completionRate,
      verdicts,
      byPhase: phases.map(p => ({
        phase: p,
        label: PHASE_LABEL[p],
        assigned: r.totals.byPhase[p].assigned,
        done: r.totals.byPhase[p].done,
        good: ins.verdicts[p].good,
        warning: ins.verdicts[p].warning,
        bad: ins.verdicts[p].bad,
      })),
      postTour: {
        calls: ins.postTour.calls,
        rated: ins.postTour.rated,
        avgRating: ins.postTour.avgRating,
        nps: ins.postTour.nps,
        promoters: ins.postTour.promoters,
        detractors: ins.postTour.detractors,
        recommendYes: ins.postTour.recommendYes,
        recommendNo: ins.postTour.recommendNo,
      },
      areaProblems: (Object.entries(ins.onTour.areas) as [string, { good: number; bad: number }][])
        .map(([area, a]) => ({ area: area[0].toUpperCase() + area.slice(1), bad: a.bad, good: a.good }))
        .sort((a, b) => b.bad - a.bad),
      reconfirmMismatches: ins.reconfirm.mismatched,
      issues: ins.issues.slice().sort((a, b) => level[a.level] - level[b.level] || (b.at ?? '').localeCompare(a.at ?? '')),
      issueTotals: { bad: ins.issueTotals.bad, warning: ins.issueTotals.warning },
    }
  } catch (err) {
    console.warn('[Reports] AI call voice unavailable:', err instanceof Error ? err.message : err)
    return NO_CALLS
  }
}

// ─── Feedback forms ──────────────────────────────────────────────────────────

const RATING_SCORE: Record<FeedbackRating, number> = { EXCELLENT: 100, GOOD: 75, AVERAGE: 40, POOR: 0 }
const RATING_RANK: Record<FeedbackRating, number> = { POOR: 0, AVERAGE: 1, GOOD: 2, EXCELLENT: 3 }

const FORM_AREAS = [
  ['accommodationRoom', 'Hotel room'],
  ['accommodationFood', 'Hotel food'],
  ['restaurantFood', 'Restaurant food'],
  ['restaurantAmbience', 'Restaurant ambience'],
  ['transportVehicle', 'Vehicle'],
  ['transportDriver', 'Driver'],
  ['overallExperience', 'Overall experience'],
] as const

async function collectForms(w: ReportWindow, countries: string[], scope: Prisma.BookingWhereInput | null): Promise<FormVoice> {
  const empty: FormVoice = { available: false, total: 0, overall: { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, POOR: 0 }, areas: [], remarks: [] }
  try {
    const rows = await prisma.guestFeedbackForm.findMany({
      where: { submittedAt: { gte: w.start, lt: w.end }, ...(scope ? { booking: scope } : {}) },
      include: { booking: { select: { bookingRef: true, operationCountry: true, tourDestination: true } } },
      orderBy: { submittedAt: 'desc' },
    })
    const forms = rows
      .map(r => ({ r, country: resolveCountry(r.booking.operationCountry, r.booking.bookingRef, r.booking.tourDestination) }))
      .filter(x => inSelectedCountries(x.country, countries))

    const overall: Record<FeedbackRating, number> = { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, POOR: 0 }
    for (const { r } of forms) if (r.overallExperience) overall[r.overallExperience]++

    const areas = FORM_AREAS.map(([field, area]) => {
      const vals = forms.map(({ r }) => r[field]).filter((v): v is FeedbackRating => !!v)
      const count = (k: FeedbackRating) => vals.filter(v => v === k).length
      return {
        area,
        rated: vals.length,
        excellent: count('EXCELLENT'), good: count('GOOD'), average: count('AVERAGE'), poor: count('POOR'),
        score: vals.length ? Math.round(vals.reduce((n, v) => n + RATING_SCORE[v], 0) / vals.length) : null,
      }
    })

    const remarks = forms
      .filter(({ r }) => r.remarks?.trim())
      .map(({ r, country }) => ({
        bookingRef: r.booking.bookingRef,
        country: labelFor(country),
        overall: r.overallExperience,
        remarks: r.remarks!.trim(),
        submittedAt: r.submittedAt.toISOString(),
      }))
      .sort((a, b) => (a.overall ? RATING_RANK[a.overall] : 9) - (b.overall ? RATING_RANK[b.overall] : 9))

    return { available: true, total: forms.length, overall, areas, remarks }
  } catch (err) {
    console.warn('[Reports] feedback forms unavailable:', err instanceof Error ? err.message : err)
    return empty
  }
}

// ─── Desk feedback ───────────────────────────────────────────────────────────

async function collectDesk(w: ReportWindow, countries: string[], scope: Prisma.BookingWhereInput | null): Promise<DeskVoice> {
  const empty: DeskVoice = { available: false, total: 0, rated: 0, avgRating: null, low: [] }
  try {
    const rows = await prisma.customerFeedback.findMany({
      where: { createdAt: { gte: w.start, lt: w.end }, ...(scope ? { booking: scope } : {}) },
      include: { booking: { select: { bookingRef: true, operationCountry: true, tourDestination: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const scoped = rows.filter(r =>
      inSelectedCountries(resolveCountry(r.booking.operationCountry, r.booking.bookingRef, r.booking.tourDestination), countries))
    const rated = scoped.filter(r => r.rating !== null)
    return {
      available: true,
      total: scoped.length,
      rated: rated.length,
      avgRating: rated.length ? Math.round((rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
      low: rated
        .filter(r => (r.rating ?? 5) <= 2)
        .map(r => ({ bookingRef: r.booking.bookingRef, rating: r.rating, comment: r.comment, savedAt: r.createdAt.toISOString() })),
    }
  } catch (err) {
    console.warn('[Reports] desk feedback unavailable:', err instanceof Error ? err.message : err)
    return empty
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function collectGuestVoice(w: ReportWindow, countries: string[]): Promise<GuestVoiceSection> {
  const scope = await reportScope(countries).catch(() => null)
  const [calls, forms, desk] = await Promise.all([
    collectCalls(w),
    collectForms(w, countries, scope),
    collectDesk(w, countries, scope),
  ])
  return { calls, forms, desk }
}

export const EMPTY_GUEST_VOICE: GuestVoiceSection = {
  calls: NO_CALLS,
  forms: { available: false, total: 0, overall: { EXCELLENT: 0, GOOD: 0, AVERAGE: 0, POOR: 0 }, areas: [], remarks: [] },
  desk: { available: false, total: 0, rated: 0, avgRating: null, low: [] },
}
