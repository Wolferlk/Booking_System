/**
 * Builds the trip dossier: one read of everything we know about a finished trip.
 *
 * Three feedback channels feed a report and any one of them is enough — the AI
 * voice calls, the guest-filled feedback form, and whatever the desk saved by
 * hand. The itinerary comes along too, because the agent asked for the places
 * actually visited rather than a bare list of call outcomes.
 */
import { prisma } from '@/lib/prisma'
import { fetchTEServiceForBooking, type FeedbackRecord } from '@/lib/send-feedback-summary'
import type {
  CallEvidence, DeskNoteEvidence, FeedbackChannel, FormEvidence,
  ItineraryStop, TranscriptLine, TripDossier, TripFacts,
} from './types'

// ─── Transcript normalisation ─────────────────────────────────────────────────

/**
 * The TE API returns transcripts either as a turn array or as one newline
 * blob, and the role vocabulary drifts between call providers. Fold both into
 * the three speakers the viewer knows how to draw.
 */
export function normaliseTranscript(raw: unknown): TranscriptLine[] {
  if (!raw) return []

  const AGENT = ['ai', 'agent', 'bot', 'assistant']
  const GUEST = ['user', 'customer', 'human', 'passenger', 'caller', 'guest']

  if (Array.isArray(raw)) {
    return (raw as Record<string, string>[])
      .map(turn => {
        const role = (turn.role ?? turn.speaker ?? '').toLowerCase()
        const text = (turn.text ?? turn.message ?? turn.content ?? '').trim()
        const speaker: TranscriptLine['speaker'] =
          AGENT.includes(role) ? 'agent' : GUEST.includes(role) ? 'customer' : 'system'
        return { speaker, text }
      })
      .filter(l => l.text)
  }

  return String(raw)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const strip = (s: string) => s.replace(/^[^:]+:\s*/, '')
      if (/^(agent|bot|ai|assistant)\s*:/i.test(line)) return { speaker: 'agent' as const, text: strip(line) }
      if (/^(customer|user|human|guest)\s*:/i.test(line)) return { speaker: 'customer' as const, text: strip(line) }
      return { speaker: 'system' as const, text: line }
    })
    .filter(l => l.text)
}

// ─── Place mining ─────────────────────────────────────────────────────────────

/** Words that show up in itinerary titles but are not places. */
const NOT_A_PLACE = new Set([
  'arrival', 'departure', 'transfer', 'check', 'in', 'out', 'day', 'free', 'leisure',
  'at', 'to', 'from', 'the', 'and', 'city', 'tour', 'visit', 'hotel', 'breakfast',
  'lunch', 'dinner', 'airport', 'flight', 'drive', 'via', 'overnight', 'am', 'pm',
])

/**
 * Pull place names out of itinerary titles like "Hanoi to Da Nang — Golden
 * Bridge". Titles are hand-typed, so this is a best-effort extraction whose
 * only job is to give the narrative writer concrete nouns to work with; the
 * full titles are passed to the model too, so a miss here costs nothing.
 */
export function minePlaces(items: ItineraryStop[], destination: string | null): string[] {
  const seen = new Map<string, string>()

  const add = (candidate: string) => {
    const clean = candidate.replace(/[^A-Za-z0-9\u00C0-\u024F\s'-]/g, ' ').trim()
    if (clean.length < 3) return
    const words = clean.split(/\s+/)
    if (words.length > 4) return
    if (words.every(w => NOT_A_PLACE.has(w.toLowerCase()))) return
    // Place names are Capitalised in these titles; lowercase runs are prose.
    if (!/^[A-Z\u00C0-\u00DE]/.test(clean)) return
    const key = clean.toLowerCase()
    if (!seen.has(key)) seen.set(key, clean)
  }

  for (const item of items) {
    // Split on the separators the desk actually types between legs.
    for (const chunk of item.title.split(/\s*(?:—|–|-|\/|›|>|\||,|\bto\b|\bvia\b)\s*/i)) {
      add(chunk)
    }
  }
  if (destination) add(destination)

  return Array.from(seen.values()).slice(0, 24)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const dayOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

function titleCase(v: string | null | undefined) {
  if (!v) return null
  return v.charAt(0) + v.slice(1).toLowerCase()
}

function nightsBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null
  const ms = b.getTime() - a.getTime()
  if (ms < 0) return null
  return Math.round(ms / 86_400_000)
}

/** 'good' / 'bad' from the call bot; EXCELLENT…POOR from the form. */
function isBadRating(v: string | null | undefined) {
  if (!v) return false
  const s = v.toLowerCase()
  return s === 'bad' || s === 'poor' || s === 'average'
}

// ─── Main collector ───────────────────────────────────────────────────────────

export async function collectTripDossier(bookingRef: string): Promise<TripDossier> {
  const warnings: string[] = []

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, agent: true, agentEmail: true, contactEmail: true,
      arrivalDate: true, departureDate: true, tourDestination: true,
      operationCountry: true, specialOccasions: true,
      paxAdults: true, paxChildren: true, paxInfants: true,
      passengers: { select: { name: true, isLead: true, type: true } },
      itineraryItems: {
        select: { dayNo: true, date: true, title: true, description: true },
        orderBy: { dayNo: 'asc' },
      },
      guestFeedback: true,
      customerFeedback: { include: { savedBy: { select: { name: true, email: true } } } },
    },
  })
  if (!booking) throw new Error(`Booking not found: ${bookingRef}`)

  // ── AI voice calls (external TE service — never fatal) ──────────────────────
  let service: Awaited<ReturnType<typeof fetchTEServiceForBooking>>['service'] = null
  let rawFeedback: FeedbackRecord[] = []
  let schedule: Awaited<ReturnType<typeof fetchTEServiceForBooking>>['schedule'] = []
  try {
    const te = await fetchTEServiceForBooking(bookingRef)
    service = te.service
    rawFeedback = te.feedback
    schedule = te.schedule
    if (!te.service) warnings.push('No AI call service is registered for this booking.')
  } catch {
    warnings.push('The AI call service could not be reached — this report covers the other channels only.')
  }

  const calls: CallEvidence[] = rawFeedback.map(fb => {
    const sched = schedule.find(s => s.day_no === fb.day_no)
    return {
      dayNo: fb.day_no ?? null,
      date: fb.call_date ?? fb.created_at ?? null,
      status: sched?.status ?? null,
      dayBrief: sched?.day_brief ?? null,
      sentiment: fb.sentiment ?? null,
      hotelOk: fb.hotel_ok ?? null,
      mealsOk: fb.meals_ok ?? null,
      driverOk: fb.driver_ok ?? null,
      vehicleOk: fb.vehicle_ok ?? null,
      summary: fb.summary ?? null,
      highlights: fb.highlights ?? null,
      issues: fb.issues ?? null,
      transcript: normaliseTranscript(fb.transcript),
    }
  })

  // ── Guest feedback form ────────────────────────────────────────────────────
  const gf = booking.guestFeedback
  const form: FormEvidence | null = gf
    ? {
        submittedAt: gf.submittedAt.toISOString(),
        clientName: gf.clientName,
        purpose: titleCase(gf.purpose),
        accommodationRoom: titleCase(gf.accommodationRoom),
        accommodationFood: titleCase(gf.accommodationFood),
        restaurantFood: titleCase(gf.restaurantFood),
        restaurantAmbience: titleCase(gf.restaurantAmbience),
        transportVehicle: titleCase(gf.transportVehicle),
        transportDriver: titleCase(gf.transportDriver),
        overallExperience: titleCase(gf.overallExperience),
        remarks: gf.remarks,
      }
    : null

  // ── Desk-saved rating ──────────────────────────────────────────────────────
  const cf = booking.customerFeedback
  const deskNotes: DeskNoteEvidence[] = cf
    ? [{
        rating: cf.rating,
        comment: cf.comment,
        savedBy: cf.savedBy?.name ?? cf.savedBy?.email ?? null,
        createdAt: cf.createdAt.toISOString(),
      }]
    : []

  // ── Itinerary ──────────────────────────────────────────────────────────────
  const itinerary: ItineraryStop[] = booking.itineraryItems.map(i => ({
    dayNo: i.dayNo,
    date: dayOnly(i.date) ?? '',
    title: i.title,
    description: i.description,
  }))
  if (!itinerary.length) warnings.push('This booking has no itinerary, so no visited places could be listed.')

  // ── Facts ──────────────────────────────────────────────────────────────────
  const lead = booking.passengers.find(p => p.isLead) ?? booking.passengers[0] ?? null
  const facts: TripFacts = {
    bookingRef: booking.bookingRef,
    agentName: booking.agent,
    agentEmail: booking.agentEmail,
    contactEmail: booking.contactEmail,
    // The call bot's own record of who it spoke to wins — it is the name the
    // guest answered to — then the lead passenger, then the form.
    clientName: service?.customer_name ?? lead?.name ?? form?.clientName ?? null,
    leadPassenger: lead?.name ?? null,
    passengers: booking.passengers.map(p => p.name),
    pax: { adults: booking.paxAdults, children: booking.paxChildren, infants: booking.paxInfants },
    arrivalDate: iso(booking.arrivalDate),
    departureDate: iso(booking.departureDate),
    nights: nightsBetween(booking.arrivalDate, booking.departureDate),
    destination: booking.tourDestination,
    country: booking.operationCountry,
    specialOccasions: booking.specialOccasions,
    callPhone: service?.call_phone ?? null,
    serviceStatus: service?.status ?? null,
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const sentimentIs = (c: CallEvidence, ...vals: string[]) =>
    !!c.sentiment && vals.includes(c.sentiment.toLowerCase())

  const formRatings = form
    ? [form.accommodationRoom, form.accommodationFood, form.restaurantFood,
       form.restaurantAmbience, form.transportVehicle, form.transportDriver,
       form.overallExperience]
    : []

  const stats: TripDossier['stats'] = {
    callsScheduled: schedule.length,
    callsAnswered: schedule.filter(s => s.status === 'answered' || s.status === 'done').length,
    positive: calls.filter(c => sentimentIs(c, 'positive', 'happy')).length,
    neutral: calls.filter(c => sentimentIs(c, 'neutral')).length,
    negative: calls.filter(c => sentimentIs(c, 'negative', 'sad', 'angry')).length,
    issuesLogged: calls.filter(c => !!c.issues?.trim()).length,
    badRatings:
      calls.reduce((n, c) => n + [c.hotelOk, c.mealsOk, c.driverOk, c.vehicleOk].filter(isBadRating).length, 0) +
      formRatings.filter(isBadRating).length,
  }

  return {
    facts,
    itinerary,
    places: minePlaces(itinerary, booking.tourDestination),
    calls,
    form,
    deskNotes,
    stats,
    collectedAt: new Date().toISOString(),
    warnings,
  }
}

/** Which channels actually produced something for this trip. */
export function dossierChannels(d: TripDossier): FeedbackChannel[] {
  const out: FeedbackChannel[] = []
  if (d.calls.length) out.push('ai_call')
  if (d.form) out.push('guest_form')
  if (d.deskNotes.length) out.push('desk_note')
  return out
}
