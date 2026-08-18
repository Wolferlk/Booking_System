/**
 * Writes the agent-facing narrative from the dossier.
 *
 * The brief from the desk: the agent wants one report at the end of the trip
 * covering the places actually visited, the travel dates, the client by name,
 * what the client said on the calls, and a genuinely detailed feedback summary
 * — not a day-by-day log. So the model is handed the whole trip at once and
 * asked for prose, and the transcripts go in as evidence for quoting even
 * though they never appear in the mail itself.
 */
import openai, { logAiUsage } from '@/lib/openai'
import type { ExperienceNarrative, RiskAssessment, TripDossier } from './types'

const MODEL = 'gpt-4o'

function fmtLong(iso: string | null) {
  if (!iso) return 'unknown'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    })
  } catch { return iso }
}

function fmtShort(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch { return iso }
}

/**
 * Flattens the dossier into the evidence block the model reads. Transcripts are
 * included here — the model needs the guest's own words to quote — but each is
 * capped so a chatty trip cannot crowd out the later days.
 */
function buildEvidence(dossier: TripDossier): string {
  const parts: string[] = []
  const { facts, itinerary, places, calls, form, deskNotes, stats } = dossier

  parts.push([
    '=== TRIP ===',
    `Booking: ${facts.bookingRef}`,
    `Client: ${facts.clientName ?? 'Guest'}`,
    facts.passengers.length > 1 ? `Travelling party: ${facts.passengers.join(', ')}` : '',
    `Party size: ${facts.pax.adults} adult(s), ${facts.pax.children} child(ren), ${facts.pax.infants} infant(s)`,
    `Dates: ${fmtLong(facts.arrivalDate)} to ${fmtLong(facts.departureDate)}${facts.nights != null ? ` (${facts.nights} nights)` : ''}`,
    facts.destination ? `Destination: ${facts.destination}` : '',
    facts.specialOccasions ? `Special occasion: ${facts.specialOccasions}` : '',
  ].filter(Boolean).join('\n'))

  if (itinerary.length) {
    parts.push([
      '=== ITINERARY AS SOLD (the places they went) ===',
      ...itinerary.map(i => `Day ${i.dayNo} (${fmtShort(i.date)}): ${i.title}${i.description ? ` — ${i.description.slice(0, 300)}` : ''}`),
      places.length ? `Named places: ${places.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }

  if (calls.length) {
    parts.push([
      '=== AI FOLLOW-UP CALLS ===',
      `${stats.callsAnswered} of ${stats.callsScheduled} scheduled calls were answered.`,
      ...calls.map(c => {
        const quotes = c.transcript
          .filter(t => t.speaker === 'customer')
          .map(t => t.text)
          .slice(0, 12)
        return [
          `--- Day ${c.dayNo ?? '?'} (${fmtShort(c.date)}) ---`,
          c.dayBrief ? `Planned that day: ${c.dayBrief}` : '',
          `Sentiment: ${c.sentiment ?? 'not captured'}`,
          `Ratings — hotel: ${c.hotelOk ?? 'not asked'}, meals: ${c.mealsOk ?? 'not asked'}, driver: ${c.driverOk ?? 'not asked'}, vehicle: ${c.vehicleOk ?? 'not asked'}`,
          c.summary ? `Call summary: ${c.summary}` : '',
          c.highlights ? `Highlights: ${c.highlights}` : '',
          c.issues ? `Issues raised: ${c.issues}` : '',
          quotes.length ? `What the guest said, verbatim:\n${quotes.map(q => `  • "${q}"`).join('\n')}` : '',
        ].filter(Boolean).join('\n')
      }),
    ].join('\n'))
  }

  if (form) {
    parts.push([
      '=== FEEDBACK FORM THE GUEST FILLED IN ===',
      `Submitted: ${fmtLong(form.submittedAt)}`,
      form.purpose ? `Travel purpose: ${form.purpose}` : '',
      `Room: ${form.accommodationRoom ?? '—'} | Hotel food: ${form.accommodationFood ?? '—'}`,
      `Restaurant food: ${form.restaurantFood ?? '—'} | Ambience: ${form.restaurantAmbience ?? '—'}`,
      `Vehicle: ${form.transportVehicle ?? '—'} | Driver: ${form.transportDriver ?? '—'}`,
      `Overall: ${form.overallExperience ?? '—'}`,
      form.remarks ? `Guest's written remarks: "${form.remarks}"` : '',
    ].filter(Boolean).join('\n'))
  }

  if (deskNotes.length) {
    parts.push([
      '=== NOTES RECORDED BY OUR DESK ===',
      ...deskNotes.map(n => `${n.rating != null ? `${n.rating}/5 — ` : ''}${n.comment ?? '(no comment)'}${n.savedBy ? ` (saved by ${n.savedBy})` : ''}`),
    ].join('\n'))
  }

  return parts.join('\n\n')
}

const SYSTEM_PROMPT = `You are a senior travel experience analyst at Apple Holidays. You write the single end-of-trip report that goes to the travel agent who sold the trip.

House style:
- Address the agent directly, warmly, as a trusted operating partner.
- Be concrete. Name the actual places, hotels, drivers, dishes and moments that appear in the evidence. Never invent one that is not there.
- Quote the guest's own words when the transcript gives you something worth quoting, in double quotes.
- Detail is the point: the agent has asked for a full summary, not a headline. Write in flowing paragraphs, not bullet fragments.
- Do not write day-by-day. Synthesise the trip as one arc.
- No clichés: never write "unforgettable journey", "memories to last a lifetime", "we are delighted to inform".
- Be candid about problems. An agent who finds out later from their client that you glossed over something will not sell again.
- Never mention that calls were recorded or transcribed, and never refer to the AI system.
- Output ONLY valid JSON matching the schema. Use "" for any field the evidence cannot support.`

export async function generateNarrative(opts: {
  dossier: TripDossier
  risk: RiskAssessment
}): Promise<ExperienceNarrative> {
  const { dossier, risk } = opts
  const { facts, stats } = dossier

  const userPrompt = `Write the end-of-trip experience report for booking ${facts.bookingRef}.

The agent is ${facts.agentName ?? 'our partner agent'}. The client is ${facts.clientName ?? 'the guest'}.

Signals our grading found: ${risk.signals.length ? risk.signals.map(s => s.label).join('; ') : 'none — the trip appears to have gone smoothly'}.
Sentiment tally across calls: ${stats.positive} positive, ${stats.neutral} neutral, ${stats.negative} negative.

EVIDENCE
${buildEvidence(dossier)}

Return JSON with exactly these keys:
{
  "headline": "8-14 words, specific to THIS trip — name a place or a moment from the evidence. Not generic.",
  "opening": "2-3 sentences to the agent. Name the client, the booking reference and the travel dates in prose.",
  "journeyStory": "3-6 sentences walking through where they actually went and how each leg landed. Name the places. This is the 'visited places' section the agent asked for.",
  "guestVoice": "2-4 sentences on what the client themselves said, with direct quotes where the evidence supports them. Empty string if we captured nothing they said.",
  "feedbackSummary": "The core section: 4-8 sentences of detailed, honest feedback analysis across accommodation, dining, transport and guiding. Say what was strong, what was ordinary and what fell short, and attribute each to the channel it came from where that matters.",
  "serviceNotes": {
    "accommodation": "One sentence, or empty string if no evidence",
    "dining": "One sentence, or empty string if no evidence",
    "transport": "One sentence, or empty string if no evidence",
    "guiding": "One sentence, or empty string if no evidence"
  },
  "issuesSummary": "Every problem raised, each with where and when it happened and how serious it was. Empty string ONLY if the evidence contains no problems at all.",
  "keyThemes": ["3-6 short specific observations, each tied to something in the evidence"],
  "overallScore": "e.g. '4.6 / 5.0 — Strongly Positive'. Base it on the sentiment tally and the ratings.",
  "closingRemark": "One warm sentence to close. If there were problems, acknowledge that we are addressing them rather than glossing over."
}`

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2400,
    })

    await logAiUsage({
      callType: 'experience_report_narrative',
      model: MODEL,
      usage: response.usage,
      bookingRef: facts.bookingRef,
      source: 'experience-report',
    })

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Partial<ExperienceNarrative>
    return normalise(parsed, dossier)
  } catch {
    return fallbackNarrative(dossier)
  }
}

/** Guard every field the mail template reads, whatever the model returned. */
function normalise(raw: Partial<ExperienceNarrative>, dossier: TripDossier): ExperienceNarrative {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const fb = fallbackNarrative(dossier)
  return {
    headline: str(raw.headline) || fb.headline,
    opening: str(raw.opening) || fb.opening,
    journeyStory: str(raw.journeyStory) || fb.journeyStory,
    guestVoice: str(raw.guestVoice),
    feedbackSummary: str(raw.feedbackSummary) || fb.feedbackSummary,
    serviceNotes: {
      accommodation: str(raw.serviceNotes?.accommodation) || null,
      dining: str(raw.serviceNotes?.dining) || null,
      transport: str(raw.serviceNotes?.transport) || null,
      guiding: str(raw.serviceNotes?.guiding) || null,
    },
    issuesSummary: str(raw.issuesSummary),
    keyThemes: Array.isArray(raw.keyThemes)
      ? raw.keyThemes.map(t => String(t).trim()).filter(Boolean).slice(0, 8)
      : fb.keyThemes,
    overallScore: str(raw.overallScore) || fb.overallScore,
    closingRemark: str(raw.closingRemark) || fb.closingRemark,
  }
}

/**
 * Stitched from the raw evidence when the model is unavailable. Plainer than
 * the generated version, but it is real data — a report still goes out.
 */
export function fallbackNarrative(dossier: TripDossier): ExperienceNarrative {
  const { facts, places, calls, form, stats } = dossier
  const client = facts.clientName ?? 'the guest'
  const placeList = places.length ? places.slice(0, 8).join(', ') : (facts.destination ?? 'the destination')

  const highlights = calls.map(c => c.highlights).filter(Boolean).join(' ')
  const summaries = calls.map(c => c.summary).filter(Boolean).join(' ')
  const issues = calls
    .filter(c => c.issues?.trim())
    .map(c => `Day ${c.dayNo ?? '?'}: ${c.issues}`)
    .join(' ')

  return {
    headline: `${facts.destination ?? 'Trip'} experience report — ${facts.bookingRef}`,
    opening: `Dear ${facts.agentName ?? 'Partner'}, here is the end-of-trip experience report for ${client}, booking ${facts.bookingRef}, travelling ${fmtShort(facts.arrivalDate)} to ${fmtShort(facts.departureDate)}.`,
    journeyStory: `The itinerary covered ${placeList}.${highlights ? ` ${highlights}` : ''}`,
    guestVoice: '',
    feedbackSummary: summaries
      || (form?.remarks ? `From the guest's feedback form: ${form.remarks}` : '')
      || 'No detailed feedback narrative was captured for this trip.',
    serviceNotes: { accommodation: null, dining: null, transport: null, guiding: null },
    issuesSummary: issues || (form && form.remarks ? '' : ''),
    keyThemes: [
      `${stats.callsAnswered} of ${stats.callsScheduled} follow-up calls answered`,
      `${stats.positive} positive, ${stats.neutral} neutral, ${stats.negative} negative`,
      form ? `Feedback form submitted — overall ${form.overallExperience ?? 'not scored'}` : 'No feedback form submitted',
    ].filter(Boolean),
    overallScore: stats.positive + stats.neutral + stats.negative
      ? `${stats.positive}/${stats.positive + stats.neutral + stats.negative} positive calls`
      : 'Not scored',
    closingRemark: 'Thank you for trusting us with your client.',
  }
}
