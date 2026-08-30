/** Renderer check for the Feedbacks module — synthetic dossiers, no database. */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderBatchCsv, renderBatchHtml, renderDossierHtml } from '@/lib/feedbacks/html'
import { normaliseTranscript, parseRefList, toSentiment } from '@/lib/feedbacks/collect'
import type { BatchReport, FeedbackDossier } from '@/lib/feedbacks/types'

const now = new Date().toISOString()

function make(ref: string, opts: { score: number; band: FeedbackDossier['score']['band']; complaints: number; form: boolean }): FeedbackDossier {
  const calls: FeedbackDossier['calls'] = [
    {
      uid: `reconfirm-1`, kind: 'reconfirm', id: 1, serviceId: 9, scheduleId: 3, bookingRef: ref,
      dayNo: null, at: now, createdAt: now, sentiment: 'positive', rawSentiment: 'happy',
      outcome: 'confirmed', rating: null, summary: 'Guest confirmed dates and flight.\nAsked for a late check-in.',
      notes: [{ label: 'Special requests', text: 'Late check-in at 22:00' }],
      checks: [
        { label: 'Dates', raw: 'yes', answer: 'good' },
        { label: 'Flight', raw: 'yes', answer: 'good' },
        { label: 'Pax', raw: 'no', answer: 'bad' },
      ],
      conversationId: 'conv-1',
      transcript: normaliseTranscript([
        { role: 'agent', text: 'Good evening, calling from Apple Holidays.' },
        { role: 'customer', text: 'Yes, hello.' },
      ]),
      hasSubstance: true,
    },
    {
      uid: `on_ground-1`, kind: 'on_ground', id: 2, serviceId: 9, scheduleId: 4, bookingRef: ref,
      dayNo: 3, at: now, createdAt: now, sentiment: 'negative', rawSentiment: 'unhappy',
      outcome: null, rating: null, summary: 'Air-conditioning in the room was not working.',
      notes: [{ label: 'Issues', text: 'AC broken, room changed at 23:00' }],
      checks: [
        { label: 'Hotel', raw: 'bad', answer: 'bad' },
        { label: 'Driver', raw: 'good', answer: 'good' },
      ],
      conversationId: 'conv-2',
      transcript: normaliseTranscript('Agent: How was the hotel?\nCustomer: The AC did not work all night.'),
      hasSubstance: true,
    },
    {
      uid: `post_tour-1`, kind: 'post_tour', id: 3, serviceId: 9, scheduleId: 5, bookingRef: ref,
      dayNo: null, at: now, createdAt: now, sentiment: 'positive', rawSentiment: 'positive',
      outcome: 'completed', rating: 9, summary: 'Overall a great trip.',
      notes: [
        { label: 'Best moment', text: 'The sunrise at Sigiriya' },
        { label: 'Would recommend', text: 'Yes' },
        { label: 'Reached home safely', text: 'Yes' },
      ],
      checks: [], conversationId: 'conv-3', transcript: [], hasSubstance: true,
    },
  ]

  const core = {
    facts: {
      id: 'x', bookingRef: ref, isNumber: '48375', dealName: null, status: 'COMPLETED',
      operationCountry: 'SRILANKA', tourDestination: 'Sri Lanka Classic',
      agent: 'MakeMyTrip', agentEmail: 'ops@mmt.com', fileHandler: 'Abdul',
      contactEmail: 'guest@example.com', contactPhone: '+94 77 000 0000',
      clientName: 'Priya Sharma', leadPassenger: 'Priya Sharma',
      passengers: [{ name: 'Priya Sharma', type: 'ADULT', isLead: true }],
      pax: { adults: 2, children: 1, infants: 0, total: 3 },
      arrivalDate: now, departureDate: now, nights: 6,
      specialOccasions: 'Anniversary', languagePreference: 'English',
      callService: { id: 9, status: 'active', callPhone: '+94770000000', callTime: '18:00', reconfirmEnabled: true, postTourEnabled: true, registeredAt: now },
    },
    score: {
      value: opts.score, band: opts.band,
      components: [
        { key: 'sentiment', label: 'Call sentiment', value: 70, weight: 1.4, detail: '3 calls read, 1 negative' },
        { key: 'checks', label: 'Service checks', value: 60, weight: 1.2, detail: '3/5 answered well' },
        { key: 'post_tour', label: 'Post-tour rating', value: 90, weight: 1.6, detail: '9.0 / 10' },
      ],
      complaintPenalty: opts.complaints ? 14 : 0,
      reasons: ['1 call came back negative.', 'Flagged on the ground: Hotel, Pax.'],
    },
    coverage: { reconfirmCall: true, onGroundCall: true, postTourCall: true, guestForm: opts.form, deskNote: true, complaints: opts.complaints > 0, count: opts.form ? 5 : 4 },
    stats: {
      callsScheduled: 7, callsCompleted: 5, callsMissed: 1, callsPending: 1, callsLogged: 3,
      byKind: { reconfirm: 1, on_ground: 1, post_tour: 1 },
      sentiment: { positive: 2, neutral: 0, negative: 1, unknown: 0 },
      transcriptTurns: 4, goodChecks: 3, badChecks: 2,
      complaintsOpen: opts.complaints, complaintsTotal: opts.complaints, complaintsHigh: opts.complaints ? 1 : 0,
      npsRating: 9, wouldRecommend: true, reachedHomeSafely: true,
    },
    calls,
    schedule: [
      { id: 1, dayNo: 1, callDate: now, scheduledAt: now, phase: 'reconfirm', status: 'done', attempts: 1, error: null, dayBrief: 'Arrival day' },
      { id: 2, dayNo: 3, callDate: now, scheduledAt: now, phase: null, status: 'missed', attempts: 3, error: 'no answer', dayBrief: 'Kandy' },
    ],
    form: opts.form ? {
      id: 'f1', submittedAt: now, clientName: 'Priya Sharma', purpose: 'Leisure',
      answers: [
        { label: 'Accommodation — room', value: 'Good', score: 3 },
        { label: 'Accommodation — food', value: 'Excellent', score: 4 },
        { label: 'Restaurant — food', value: 'Average', score: 2 },
        { label: 'Restaurant — ambience', value: null, score: null },
        { label: 'Transport — vehicle', value: 'Excellent', score: 4 },
        { label: 'Transport — driver', value: 'Excellent', score: 4 },
        { label: 'Overall experience', value: 'Good', score: 3 },
      ],
      remarks: 'Driver was outstanding. Hotel in Kandy needs attention.',
      scorePct: 72,
    } : null,
    deskNotes: [{ id: 'd1', rating: 4, comment: 'Called to apologise for the AC issue.', savedBy: 'Nimal', createdAt: now, updatedAt: now }],
    complaints: Array.from({ length: opts.complaints }, (_, i) => ({
      id: i + 1, bookingRef: ref, customerName: 'Priya Sharma', callKind: 'on_tour', category: 'accommodation',
      severity: 'high' as const, status: 'open', isOpen: true,
      title: 'Air-conditioning not working', details: 'Room 402 had no working AC on night two.',
      customerQuote: 'We could not sleep at all.', sentiment: 'negative' as const,
      resolutionNote: null, resolvedAt: null, createdAt: now, updatedAt: now, conversationId: 'conv-2',
    })),
    contactLogs: [{ id: 'c1', type: 'CALL', subject: 'Apology call', notes: 'Offered a complimentary dinner.', contactedAt: now, by: 'Nimal' }],
    experienceReports: [{ id: 'r1', status: 'held', riskLevel: 'high', riskScore: 62, holdReason: 'Open complaint', subject: 'Your clients’ trip — IS48375', toEmail: 'ops@mmt.com', sentAt: null, sentBy: null, createdAt: now }],
    itinerary: [{ dayNo: 1, date: now.slice(0, 10), title: 'Colombo — Arrival', description: null }],
    warnings: [],
  }

  const timeline: FeedbackDossier['timeline'] = [
    { at: now, kind: 'call', title: 'Post-tour call', detail: 'Overall a great trip.', sentiment: 'positive', severity: null, ref: 'post_tour-1' },
    { at: now, kind: 'complaint', title: 'Air-conditioning not working', detail: 'Room 402 had no working AC.', sentiment: 'negative', severity: 'high', ref: 'complaint-1' },
  ]

  return { ...core, timeline, collectedAt: now } as FeedbackDossier
}

const dossiers = [
  make('IS48375', { score: 61, band: 'watch', complaints: 1, form: true }),
  make('IS48380', { score: 91, band: 'excellent', complaints: 0, form: false }),
]

const report: BatchReport = {
  generatedAt: now,
  warnings: ['1 reference did not match a booking you can see: IS99999'],
  dossiers,
  totals: {
    requested: 3, found: 2, missing: ['IS99999'],
    withAnyFeedback: 2, withNoFeedback: 0, avgScore: 76,
    band: { excellent: 1, good: 0, watch: 1, at_risk: 0, unknown: 0 },
    calls: { logged: 6, scheduled: 14, completed: 10, missed: 2 },
    byKind: { reconfirm: 2, on_ground: 2, post_tour: 2 },
    sentiment: { positive: 4, neutral: 0, negative: 2, unknown: 0 },
    forms: 1, deskNotes: 2,
    complaints: { total: 1, open: 1, high: 1 },
    npsAverage: 9, promoters: 2, detractors: 0, recommendYes: 2, recommendNo: 0,
    coverage: { reconfirmCall: 2, onGroundCall: 2, postTourCall: 2, guestForm: 1, deskNote: 2 },
    topComplaintCategories: [{ category: 'accommodation', count: 1, open: 1 }],
    attention: [{ bookingRef: 'IS48375', clientName: 'Priya Sharma', score: 61, band: 'watch', reason: '1 complaint still open (1 high severity).' }],
  },
}

// Parser sanity, then render.
const parsed = parseRefList(' is48375, IS48380\nIS48375\tVN10233 ')
console.assert(parsed.join(',') === 'IS48375,IS48380,VN10233', 'parseRefList wrong: ' + parsed.join(','))
console.assert(toSentiment('HAPPY') === 'positive' && toSentiment('') === 'unknown', 'toSentiment wrong')
console.assert(normaliseTranscript('Agent: hi\nCustomer: hello').length === 2, 'transcript wrong')

// Never write into the repo: the check is about the renderers, not artefacts.
const out = process.env.OUT_DIR ?? mkdtempSync(join(tmpdir(), 'feedbacks-render-'))
const dossierHtml = renderDossierHtml(dossiers[0], { autoPrint: false, generatedBy: 'render check' })
const batchHtml = renderBatchHtml(report, { autoPrint: false, includeTranscripts: true, generatedBy: 'render check' })
const csv = renderBatchCsv(report)

for (const [name, content] of [['dossier.html', dossierHtml], ['batch.html', batchHtml], ['batch.csv', csv]] as const) {
  writeFileSync(`${out}/${name}`, content)
  console.log(name.padEnd(13), content.length.toLocaleString(), 'bytes')
}
console.assert(dossierHtml.includes('IS48375') && dossierHtml.includes('Air-conditioning'), 'dossier missing content')
console.assert(batchHtml.includes('IS48380') && batchHtml.includes('Needs attention'), 'batch missing content')
// A summary containing a newline is quoted, so count parsed records, not lines.
const records = csv.replace(/\uFEFF/, '').split(/\n(?=IS|Booking Ref)/)
console.assert(records.length === 3, 'csv rows wrong: ' + records.length)
console.assert(records[1].startsWith('IS48375') && records[2].startsWith('IS48380'), 'csv refs wrong')
console.log('all render checks passed —', out)
