import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'
import openai, { logAiUsage } from '@/lib/openai'

const TE_BASE = (
  process.env.TE_BASE_URL ?? 'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')
const TE_SECRET = process.env.TE_WEBHOOK_SECRET ?? ''

const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeedbackRecord {
  id: number
  day_no?: number | null
  call_date?: string | null
  created_at: string
  sentiment?: string | null
  highlights?: string | null
  hotel_ok?: string | null
  meals_ok?: string | null
  driver_ok?: string | null
  vehicle_ok?: string | null
  issues?: string | null
  summary?: string | null
  transcript?: unknown
}

export interface ServiceRecord {
  id: number
  booking_ref: string
  status: string
  customer_name?: string | null
  call_phone: string
  schedule?: ScheduleRecord[]
  feedback?: FeedbackRecord[]
}

export interface ScheduleRecord {
  id: number
  day_no: number
  call_date: string
  status: string
  attempts: number
  day_brief?: string | null
}

export interface AIFeedbackResult {
  headline: string          // e.g. "An Excellent Journey — Warm Memories & Smooth Experiences"
  opening: string           // 2-3 sentence intro paragraph
  dayHighlights: string     // narrative of the best/notable moments
  issuesSummary: string     // honest but constructive summary of any issues (or empty string)
  closingRemark: string     // warm closing sentence
  overallScore: string      // e.g. "4.7 / 5.0 — Highly Positive"
  keyThemes: string[]       // e.g. ["Warm welcome", "Excellent driver", "Minor meal delay on Day 3"]
}

// ─── TE API ───────────────────────────────────────────────────────────────────

async function teGet(path: string): Promise<unknown> {
  const url = `${TE_BASE}/${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TE_SECRET) headers['x-te-secret'] = TE_SECRET
  const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
  if (!res.ok) return {}
  return res.json()
}

export async function fetchTEServiceForBooking(ref: string): Promise<{
  service: ServiceRecord | null
  feedback: FeedbackRecord[]
  schedule: ScheduleRecord[]
}> {
  try {
    const svcData = await teGet(`services/${ref}`) as Record<string, unknown>
    const service = (svcData.service ?? svcData.data ?? null) as ServiceRecord | null
    if (!service) return { service: null, feedback: [], schedule: [] }

    const fbData  = await teGet(`feedback?serviceId=${service.id}`) as Record<string, unknown>
    const feedback = ((fbData.feedback ?? fbData.data ?? []) as FeedbackRecord[])
      .sort((a, b) => (a.day_no ?? 0) - (b.day_no ?? 0))
    const schedule = ((service.schedule ?? []) as ScheduleRecord[])
      .sort((a, b) => a.day_no - b.day_no)
    return { service, feedback, schedule }
  } catch {
    return { service: null, feedback: [], schedule: [] }
  }
}

// ─── Mail settings ────────────────────────────────────────────────────────────

async function getMailSettings() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['use_test_data', 'test_email_1', 'test_email_2', 'ai_feedback_cc', 'ai_feedback_auto_send'] } },
  })
  const map: Record<string, string> = {}
  rows.forEach(r => { map[r.key] = r.value })
  return {
    useTestData:         map['use_test_data'] === 'true',
    testEmail1:          map['test_email_1']  ?? DEFAULT_TEST_EMAIL_1,
    testEmail2:          map['test_email_2']  ?? DEFAULT_TEST_EMAIL_2,
    feedbackCcRaw:       map['ai_feedback_cc'] ?? '',
    autoSendEnabled:     map['ai_feedback_auto_send'] !== 'false', // default ON
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sentimentLabel(s?: string | null) {
  const map: Record<string, string> = { positive: '😊 Positive', happy: '😊 Happy', neutral: '😐 Neutral', negative: '😞 Negative' }
  return s ? (map[s] ?? s) : '—'
}

function ratingBadge(v?: string | null) {
  if (!v) return '<span style="color:#94a3b8">—</span>'
  const color = v === 'good' ? '#16a34a' : v === 'bad' ? '#dc2626' : '#64748b'
  const bg    = v === 'good' ? '#f0fdf4' : v === 'bad' ? '#fef2f2' : '#f8fafc'
  return `<span style="background:${bg};color:${color};font-weight:700;font-size:10px;padding:2px 7px;border-radius:20px;border:1px solid ${v === 'good' ? '#bbf7d0' : v === 'bad' ? '#fecaca' : '#e2e8f0'}">${v.toUpperCase()}</span>`
}

function fmtDateLong(iso: string) {
  try {
    return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'))
      .toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function fmtDateShort(iso: string) {
  try {
    return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00'))
      .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  } catch { return iso }
}

function normaliseTranscript(raw: unknown): { speaker: string; text: string }[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return (raw as Record<string, string>[]).map(t => {
      const role = (t.role ?? t.speaker ?? '').toLowerCase()
      const text = t.text ?? t.message ?? t.content ?? ''
      if (['ai','agent','bot','assistant'].includes(role)) return { speaker: 'Agent', text }
      if (['user','customer','human','passenger','caller'].includes(role)) return { speaker: 'Customer', text }
      return { speaker: role || 'System', text }
    }).filter(l => l.text)
  }
  return String(raw).split('\n').filter(Boolean).map(line => {
    if (/^(agent|bot|ai)\s*:/i.test(line)) return { speaker: 'Agent', text: line.replace(/^[^:]+:\s*/i, '') }
    if (/^(customer|user|human)\s*:/i.test(line)) return { speaker: 'Customer', text: line.replace(/^[^:]+:\s*/i, '') }
    return { speaker: 'System', text: line }
  })
}

function buildFeedbackContext(feedback: FeedbackRecord[], schedule: ScheduleRecord[]): string {
  if (!feedback.length) return 'No feedback was collected during this trip.'

  return feedback.map(fb => {
    const sched    = schedule.find(s => s.day_no === fb.day_no)
    const date     = fb.call_date ? fmtDateShort(fb.call_date) : fmtDateShort(fb.created_at)
    const tx       = normaliseTranscript(fb.transcript)
    const txText   = tx.map(t => `  ${t.speaker}: ${t.text}`).join('\n')
    return [
      `--- Day ${fb.day_no ?? '?'} (${date}) ---`,
      sched?.day_brief ? `Context: ${sched.day_brief}` : '',
      `Sentiment: ${fb.sentiment ?? 'not captured'}`,
      `Hotel: ${fb.hotel_ok ?? 'not asked'} | Meals: ${fb.meals_ok ?? 'not asked'} | Driver: ${fb.driver_ok ?? 'not asked'} | Vehicle: ${fb.vehicle_ok ?? 'not asked'}`,
      fb.summary    ? `Summary: ${fb.summary}` : '',
      fb.highlights ? `Highlights: ${fb.highlights}` : '',
      fb.issues     ? `Issues: ${fb.issues}` : '',
      txText ? `Transcript:\n${txText}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

// ─── OpenAI Narrative Generator ───────────────────────────────────────────────

export async function generateAIFeedbackNarrative(opts: {
  ref: string
  agentName: string
  customerName?: string | null
  arrivalDate?: string | null
  departureDate?: string | null
  feedback: FeedbackRecord[]
  schedule: ScheduleRecord[]
}): Promise<AIFeedbackResult> {
  const ctx = buildFeedbackContext(opts.feedback, opts.schedule)

  const totalDays   = opts.schedule.length
  const answered    = opts.schedule.filter(s => s.status === 'answered' || s.status === 'done').length
  const sentiments  = opts.feedback.map(f => f.sentiment).filter(Boolean)
  const positives   = sentiments.filter(s => s === 'positive' || s === 'happy').length
  const hasIssues   = opts.feedback.some(f => f.issues)

  const systemPrompt = `You are a travel experience analyst writing a professional, warm, and insightful trip feedback summary for a travel agent. Your tone is professional yet personal — like a trusted colleague sharing candid, constructive insights.

Rules:
- Be truthful and specific — mention actual places, experiences, or moments from the transcript data
- Highlight genuine positives enthusiastically
- For issues, be diplomatic but clear — agents need honest information
- Keep language polished: no clichés like "unforgettable journey" or generic filler
- Write as if you personally reviewed the entire trip experience
- Output ONLY valid JSON matching the exact schema provided`

  const userPrompt = `Write a creative, insightful feedback summary for booking ${opts.ref}.

Trip Details:
- Agent: ${opts.agentName}
- Customer: ${opts.customerName ?? 'Guest'}
- Travel dates: ${opts.arrivalDate ? fmtDateLong(opts.arrivalDate) : 'unknown'} to ${opts.departureDate ? fmtDateLong(opts.departureDate) : 'unknown'}
- Total scheduled calls: ${totalDays}
- Calls answered: ${answered}/${totalDays}
- Positive sentiments: ${positives}/${sentiments.length || 1}
- Issues reported: ${hasIssues ? 'Yes' : 'None'}

Raw Feedback Data:
${ctx}

Return JSON with EXACTLY this structure:
{
  "headline": "A short, specific, evocative title for this trip experience (8-12 words, NOT generic)",
  "opening": "2-3 sentences opening paragraph addressed to the agent. Mention the booking ref and trip dates. Warm but professional.",
  "dayHighlights": "A 3-5 sentence narrative of the most notable positive moments across the trip days. Be specific — mention what customers said, what they loved. Write in flowing prose.",
  "issuesSummary": "If there were any issues, a 1-3 sentence honest but constructive summary. Include what day and what the issue was. Empty string if no issues.",
  "closingRemark": "One warm closing sentence encouraging the agent's continued partnership.",
  "overallScore": "Calculate a score like '4.8 / 5.0 — Highly Positive' based on sentiments and ratings",
  "keyThemes": ["Array of 3-6 specific key themes or observations, e.g. 'Customer praised driver warmth on Day 2', 'Hotel service rated excellent throughout'"]
}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.72,
      max_tokens: 1200,
    })

    await logAiUsage({
      callType: 'feedback_narrative',
      model: 'gpt-4o',
      usage: response.usage,
      bookingRef: opts.ref,
      source: 'feedback-summary',
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    return JSON.parse(raw) as AIFeedbackResult
  } catch {
    // Graceful fallback — return a sensible default
    return {
      headline: `Trip Summary — Booking ${opts.ref}`,
      opening: `Dear ${opts.agentName}, below is the AI call monitoring report for booking ${opts.ref}. Our system made ${totalDays} scheduled calls during the trip.`,
      dayHighlights: opts.feedback.map(f => f.summary ?? f.highlights).filter(Boolean).join(' ') || 'No detailed highlights captured.',
      issuesSummary: opts.feedback.some(f => f.issues) ? opts.feedback.filter(f => f.issues).map(f => `Day ${f.day_no}: ${f.issues}`).join('. ') : '',
      closingRemark: 'Thank you for choosing Apple Holidays. We look forward to our continued partnership.',
      overallScore: `${positives}/${sentiments.length || 1} positive calls`,
      keyThemes: opts.feedback.slice(0,5).map(f => `Day ${f.day_no}: ${f.sentiment ?? 'call completed'}`),
    }
  }
}

// ─── HTML Email Builder ───────────────────────────────────────────────────────

export function buildFeedbackSummaryEmail(opts: {
  ref: string
  booking: { agent?: string | null; arrivalDate?: string | null; departureDate?: string | null }
  service: ServiceRecord | null
  feedback: FeedbackRecord[]
  schedule: ScheduleRecord[]
  aiNarrative?: AIFeedbackResult | null
  isAutoSend?: boolean
}) {
  const { ref, booking, service, feedback, schedule, aiNarrative, isAutoSend } = opts
  const agentName   = booking.agent ?? 'Agent'

  // ── Day rows ──────────────────────────────────────────────────────────────
  const feedbackRows = feedback.map(fb => {
    const sched      = schedule.find(s => s.day_no === fb.day_no)
    const transcript = normaliseTranscript(fb.transcript)
    const isGood     = sched?.status === 'answered' || sched?.status === 'done'
    const dayBg      = isGood ? '#f0fdf4' : '#f8fafc'
    const dayColor   = isGood ? '#16a34a' : '#64748b'

    const transcriptHtml = transcript.length
      ? `<div style="margin-top:12px;background:#faf5ff;border-left:3px solid #7c3aed;border-radius:0 8px 8px 0;padding:12px 14px">
          <p style="margin:0 0 8px;font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.06em">Full Transcript</p>
          ${transcript.map(t =>
            t.speaker === 'Agent'
              ? `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">
                   <span style="background:#7c3aed;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;flex-shrink:0;margin-top:1px">AGENT</span>
                   <p style="margin:0;font-size:12px;color:#4c1d95;line-height:1.5">${t.text}</p>
                 </div>`
              : `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;flex-direction:row-reverse">
                   <span style="background:#1e293b;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;flex-shrink:0;margin-top:1px">GUEST</span>
                   <p style="margin:0;font-size:12px;color:#1e293b;line-height:1.5;text-align:right">${t.text}</p>
                 </div>`
          ).join('')}
        </div>`
      : ''

    return `<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:16px 12px;vertical-align:top;width:44px">
        <div style="width:36px;height:36px;border-radius:10px;background:${dayBg};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:${dayColor};text-align:center;line-height:36px">${fb.day_no ?? '?'}</div>
      </td>
      <td style="padding:16px 12px;vertical-align:top;width:110px">
        <p style="margin:0;font-size:11px;font-weight:600;color:#475569;font-family:'Courier New',monospace">${fb.call_date ? fmtDateShort(fb.call_date) : fmtDateShort(fb.created_at)}</p>
        ${sched?.day_brief ? `<p style="margin:3px 0 0;font-size:10px;color:#94a3b8;font-style:italic">${sched.day_brief}</p>` : ''}
      </td>
      <td style="padding:16px 12px;vertical-align:top;width:90px">
        ${fb.sentiment ? `<span style="font-size:18px;display:block;margin-bottom:2px">${fb.sentiment === 'positive' || fb.sentiment === 'happy' ? '😊' : fb.sentiment === 'neutral' ? '😐' : '😞'}</span><span style="font-size:10px;color:#64748b;text-transform:capitalize">${fb.sentiment}</span>` : '<span style="color:#cbd5e1;font-size:12px">—</span>'}
      </td>
      <td style="padding:16px 12px;vertical-align:top;width:150px">
        <table style="border-collapse:collapse">
          <tbody>
            ${[['🏨 Hotel', fb.hotel_ok], ['🍽️ Meals', fb.meals_ok], ['🚗 Driver', fb.driver_ok], ['🚌 Vehicle', fb.vehicle_ok]].map(([label, val]) =>
              `<tr><td style="font-size:10px;color:#94a3b8;padding:1px 8px 1px 0;white-space:nowrap">${label}</td><td style="padding:1px 0">${ratingBadge(val)}</td></tr>`
            ).join('')}
          </tbody>
        </table>
      </td>
      <td style="padding:16px 12px;vertical-align:top">
        ${fb.summary ? `<p style="margin:0 0 6px;font-size:12px;color:#334155;line-height:1.6;font-weight:500">${fb.summary}</p>` : ''}
        ${fb.highlights ? `<p style="margin:0 0 5px;font-size:11px;color:#64748b;line-height:1.5"><span style="font-weight:700;color:#7c3aed">✨ Highlights:</span> ${fb.highlights}</p>` : ''}
        ${fb.issues ? `<p style="margin:0 0 5px;font-size:11px;color:#b91c1c;line-height:1.5;background:#fef2f2;padding:4px 8px;border-radius:6px;border-left:3px solid #f87171"><span style="font-weight:700">⚠️ Issue:</span> ${fb.issues}</p>` : ''}
        ${transcriptHtml}
      </td>
    </tr>`
  }).join('')

  const noFeedbackRow = `<tr><td colspan="5" style="padding:32px;text-align:center;color:#94a3b8;font-style:italic;font-size:13px">No call feedback was recorded for this trip</td></tr>`

  // ── Score badge ───────────────────────────────────────────────────────────
  const scoreHtml = aiNarrative?.overallScore
    ? `<div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-size:13px;font-weight:800;padding:6px 16px;border-radius:20px;margin-bottom:8px">${aiNarrative.overallScore}</div>`
    : ''

  // ── Key themes ────────────────────────────────────────────────────────────
  const themesHtml = (aiNarrative?.keyThemes?.length)
    ? `<div style="margin:20px 0;padding:16px 18px;background:#f5f3ff;border-radius:12px;border:1px solid #ddd6fe">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.06em">Key Observations</p>
        ${aiNarrative.keyThemes.map(t => `<p style="margin:0 0 5px;font-size:12px;color:#4c1d95;padding-left:14px;position:relative">◆ ${t}</p>`).join('')}
      </div>`
    : ''

  // ── AI narrative block ────────────────────────────────────────────────────
  const aiNarrativeHtml = aiNarrative
    ? `<div style="margin-bottom:28px;padding:22px 24px;background:#fdfcff;border:1px solid #e0d7ff;border-radius:14px">
        ${scoreHtml}
        ${aiNarrative.headline ? `<h2 style="margin:0 0 14px;font-size:18px;font-weight:800;color:#1e1b4b;line-height:1.3">${aiNarrative.headline}</h2>` : ''}
        <p style="margin:0 0 14px;font-size:13px;color:#475569;line-height:1.75">${aiNarrative.opening}</p>
        ${aiNarrative.dayHighlights ? `<p style="margin:0 0 14px;font-size:13px;color:#374151;line-height:1.75;background:#f0fdf4;padding:12px 16px;border-radius:10px;border-left:4px solid #34d399">${aiNarrative.dayHighlights}</p>` : ''}
        ${aiNarrative.issuesSummary ? `<p style="margin:0 0 14px;font-size:13px;color:#7f1d1d;line-height:1.75;background:#fef2f2;padding:12px 16px;border-radius:10px;border-left:4px solid #f87171">${aiNarrative.issuesSummary}</p>` : ''}
        ${themesHtml}
        ${aiNarrative.closingRemark ? `<p style="margin:0;font-size:13px;color:#475569;font-style:italic;line-height:1.6">${aiNarrative.closingRemark}</p>` : ''}
        <p style="margin:10px 0 0;font-size:9px;color:#a78bfa;text-transform:uppercase;letter-spacing:0.05em">✦ Generated by Apple Holidays AI</p>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">

<div style="max-width:720px;margin:28px auto 48px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10)">

  <!-- Hero banner -->
  <div style="background-color:#4338ca;background:linear-gradient(135deg,#6d28d9 0%,#4338ca 60%,#2563eb 100%);padding:32px 36px;position:relative">
    <div style="position:absolute;top:0;right:0;width:200px;height:100%;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 100%22><circle cx=%22160%22 cy=%2250%22 r=%22120%22 fill=%22rgba(255,255,255,0.05)%22/></svg>') no-repeat center;opacity:0.4"></div>
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#c4b5fd;text-transform:uppercase;letter-spacing:0.12em">🤖 Apple Holidays · AI Call Intelligence</p>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px">Customer Experience Report</h1>
    <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#e0d7ff">Booking: ${ref}</p>
    ${booking.arrivalDate ? `<p style="margin:0;font-size:12px;color:#c4b5fd">${fmtDateLong(booking.arrivalDate)} → ${booking.departureDate ? fmtDateShort(booking.departureDate) : '—'}</p>` : ''}
    ${isAutoSend ? `<div style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:20px"><span style="font-size:10px;color:#e0d7ff;font-weight:600">⚡ Auto-sent post-departure</span></div>` : ''}
  </div>

  <div style="padding:32px 36px">

    <!-- Greeting -->
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.75">
      Dear <strong style="color:#1e293b">${agentName}</strong>,
    </p>

    <!-- AI Narrative section -->
    ${aiNarrativeHtml}

    <!-- Day-by-day table -->
    <h3 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#1e293b;padding-bottom:10px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:8px">
      📋 Day-by-Day Call Report
    </h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:#f8fafc">
          <th style="text-align:left;padding:10px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e2e8f0">Day</th>
          <th style="text-align:left;padding:10px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e2e8f0">Date</th>
          <th style="text-align:left;padding:10px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e2e8f0">Mood</th>
          <th style="text-align:left;padding:10px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e2e8f0">Ratings</th>
          <th style="text-align:left;padding:10px 12px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e2e8f0">Summary & Transcript</th>
        </tr>
      </thead>
      <tbody>
        ${feedbackRows || noFeedbackRow}
      </tbody>
    </table>

    <!-- Footer note -->
    <div style="margin-top:28px;padding:16px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;display:flex;align-items:flex-start;gap:10px">
      <span style="font-size:18px;flex-shrink:0">✅</span>
      <p style="margin:0;font-size:12px;color:#166534;line-height:1.65">
        This report was generated by the <strong>Apple Holidays AI Call Monitoring System</strong>. All calls were placed with the customer's prior WhatsApp consent.
        ${service ? `<br>Service status: <strong>${service.status.toUpperCase()}</strong> · Number monitored: <strong>${service.call_phone}</strong>` : ''}
      </p>
    </div>

  </div>

  <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;display:flex;align-items:center;justify-content:space-between">
    <p style="margin:0;font-size:11px;color:#94a3b8">Apple Holidays · confirm.booking@aahaas.com</p>
    <p style="margin:0;font-size:10px;color:#cbd5e1">Automated system report · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
  </div>

</div>
</body>
</html>`
}

// ─── Send email (main entry point) ────────────────────────────────────────────

export async function sendFeedbackSummaryEmail(
  ref: string,
  opts?: {
    extraCc?: string[]
    agentEmailOverride?: string
    aiNarrative?: AIFeedbackResult | null
    generateNarrative?: boolean
    isAutoSend?: boolean
  },
): Promise<void> {
  const { useTestData, testEmail1, testEmail2, feedbackCcRaw } = await getMailSettings()

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { agentEmail: true, contactEmail: true, agent: true, arrivalDate: true, departureDate: true },
  })
  if (!booking) throw new Error(`Booking not found: ${ref}`)

  const { service, feedback, schedule } = await fetchTEServiceForBooking(ref)

  // Generate AI narrative if requested
  let aiNarrative = opts?.aiNarrative ?? null
  if ((opts?.generateNarrative || opts?.isAutoSend) && !aiNarrative) {
    try {
      aiNarrative = await generateAIFeedbackNarrative({
        ref,
        agentName:    booking.agent ?? 'Agent',
        customerName: service?.customer_name,
        arrivalDate:  booking.arrivalDate?.toISOString() ?? null,
        departureDate: booking.departureDate?.toISOString() ?? null,
        feedback,
        schedule,
      })
    } catch { /* continue without narrative */ }
  }

  const html = buildFeedbackSummaryEmail({
    ref,
    booking: {
      agent: booking.agent,
      arrivalDate:   booking.arrivalDate?.toISOString(),
      departureDate: booking.departureDate?.toISOString(),
    },
    service,
    feedback,
    schedule,
    aiNarrative,
    isAutoSend: opts?.isAutoSend,
  })

  let toEmail: string
  let ccEmails: string[]

  if (useTestData) {
    const t1 = testEmail1.trim()
    if (!t1) throw new Error('Test mode is on but test_email_1 is not configured in Settings → Email Settings')
    toEmail  = t1
    ccEmails = testEmail2.trim() ? [testEmail2.trim()] : []
  } else {
    const agentEmail = (opts?.agentEmailOverride ?? (booking.agentEmail as string | null) ?? '').trim()
    if (!agentEmail) throw new Error('No agent email on file for this booking')
    toEmail = agentEmail

    const settingsCc = feedbackCcRaw
      .split(',').map(e => e.trim()).filter(e => e.includes('@'))
    const extraCc    = (opts?.extraCc ?? []).map(e => e.trim()).filter(e => e.includes('@'))
    const autoCc     = booking.contactEmail && (booking.contactEmail as string).trim() !== toEmail
      ? [(booking.contactEmail as string).trim()] : []
    const combined   = [...settingsCc, ...extraCc, ...autoCc, 'confirm.booking@aahaas.com']
    ccEmails = combined.filter((a, i) => a && combined.indexOf(a) === i && a !== toEmail)
  }

  await sendMailViaGraph({
    to:       toEmail,
    cc:       ccEmails.length ? ccEmails : undefined,
    subject:  `AI Call Experience Report — ${ref} · Apple Holidays`,
    bodyHtml: html,
  })
}

// ─── Auto-send: find bookings eligible for post-departure send ────────────────

export async function runAutoFeedbackSummaries(): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const { useTestData, autoSendEnabled } = await getMailSettings()

  if (!autoSendEnabled) {
    console.log('[FeedbackAuto] Auto-send disabled via settings')
    return { sent: 0, skipped: 0, errors: [] }
  }

  const DEDUP_PREFIX = 'feedback_summary_sent_'

  // Find bookings where departure was 1-3 days ago (trip just ended)
  const now  = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 3)
  const to   = new Date(now)
  to.setDate(to.getDate() - 1)

  const candidates = await prisma.booking.findMany({
    where: {
      departureDate: { gte: from, lte: to },
      OR: [
        { agentEmail: { not: null } },
      ],
    },
    select: { bookingRef: true, agentEmail: true, departureDate: true, agent: true },
  })

  let sent = 0; let skipped = 0
  const errors: string[] = []

  for (const b of candidates) {
    const dedupKey = `${DEDUP_PREFIX}${b.bookingRef}`

    // Skip if already sent
    const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
    if (already) { skipped++; continue }

    // Skip if no agent email in live mode
    if (!useTestData && !b.agentEmail) { skipped++; continue }

    // Fetch TE feedback — skip if no service or no feedback
    const { service, feedback } = await fetchTEServiceForBooking(b.bookingRef)
    if (!service) { skipped++; continue }
    if (!feedback.length) {
      console.log(`[FeedbackAuto] No feedback for ${b.bookingRef}, skipping`)
      skipped++; continue
    }

    try {
      await sendFeedbackSummaryEmail(b.bookingRef, { generateNarrative: true, isAutoSend: true })

      // Mark as sent
      await prisma.systemSetting.upsert({
        where:  { key: dedupKey },
        create: { key: dedupKey, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      })

      console.log(`[FeedbackAuto] ✓ Sent summary for ${b.bookingRef}`)
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${b.bookingRef}: ${msg}`)
      console.error(`[FeedbackAuto] ✗ ${b.bookingRef}: ${msg}`)
    }
  }

  return { sent, skipped, errors }
}
