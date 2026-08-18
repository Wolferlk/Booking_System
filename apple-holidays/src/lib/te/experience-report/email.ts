/**
 * The two mails this feature can send.
 *
 * `buildAgentEmail` is the one the agent receives at the end of the trip: a
 * single narrative report covering the whole journey. It deliberately contains
 * NO call transcripts and no day-by-day call log — the desk asked for a summary
 * the agent can forward to their client, and raw transcripts are internal.
 * They stay in the dossier and are read on screen instead.
 *
 * `buildEscalationEmail` is what goes out instead when the trip went badly. Its
 * first job is to make unmistakably clear that the agent has NOT been told.
 *
 * Both are table-and-inline-style HTML because Outlook is the reader.
 */
import type { ExperienceNarrative, RiskAssessment, TripDossier } from './types'

export function esc(v: unknown) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtLong(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function fmtShort(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

/** Paragraph text from the model may contain blank-line breaks; keep them. */
function paras(text: string, style: string) {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

// ─── Small parts ──────────────────────────────────────────────────────────────

function factRow(label: string, value: string) {
  return `<tr>
    <td style="padding:7px 0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.07em;white-space:nowrap;vertical-align:top;width:150px">${esc(label)}</td>
    <td style="padding:7px 0;font-size:14px;color:#0f172a;font-weight:600;vertical-align:top">${value}</td>
  </tr>`
}

function sectionHeading(kicker: string, title: string) {
  return `<p style="margin:0 0 3px;font-size:10px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:0.12em">${esc(kicker)}</p>
    <h3 style="margin:0 0 12px;font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-0.2px">${esc(title)}</h3>`
}

function placeChips(places: string[]) {
  if (!places.length) return ''
  return places.slice(0, 16).map(p =>
    `<span style="display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;margin:0 6px 8px 0">${esc(p)}</span>`,
  ).join('')
}

function serviceNoteRows(notes: ExperienceNarrative['serviceNotes']) {
  const rows: [string, string, string | null][] = [
    ['🏨', 'Accommodation', notes.accommodation],
    ['🍽️', 'Dining', notes.dining],
    ['🚘', 'Transport & driver', notes.transport],
    ['🧭', 'Guiding & coordination', notes.guiding],
  ]
  const present = rows.filter(([, , v]) => v?.trim())
  if (!present.length) return ''

  return `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
    ${present.map(([icon, label, value]) => `<tr>
      <td style="padding:0 0 10px">
        <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
          <tr>
            <td width="46" style="width:46px;padding:14px 0 14px 16px;font-size:19px;vertical-align:top">${icon}</td>
            <td style="padding:14px 18px 14px 0;vertical-align:top">
              <p style="margin:0 0 3px;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">${esc(label)}</p>
              <p style="margin:0;font-size:13.5px;color:#334155;line-height:1.65">${esc(value ?? '')}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('')}
  </table>`
}

function itineraryTable(dossier: TripDossier) {
  if (!dossier.itinerary.length) return ''
  return `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 26px">
    ${dossier.itinerary.map((stop, i) => `<tr>
      <td width="64" style="width:64px;padding:12px 0 12px 16px;vertical-align:top;${i ? 'border-top:1px solid #f1f5f9;' : ''}">
        <span style="display:inline-block;background:#0f172a;color:#ffffff;font-size:10px;font-weight:800;padding:4px 9px;border-radius:7px;letter-spacing:0.05em">DAY ${stop.dayNo}</span>
      </td>
      <td style="padding:12px 18px 12px 0;vertical-align:top;${i ? 'border-top:1px solid #f1f5f9;' : ''}">
        <p style="margin:0;font-size:13.5px;font-weight:700;color:#1e293b;line-height:1.5">${esc(stop.title)}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#94a3b8;font-weight:600">${esc(fmtShort(stop.date))}</p>
      </td>
    </tr>`).join('')}
  </table>`
}

// ─── The agent report ─────────────────────────────────────────────────────────

export function buildAgentSubject(dossier: TripDossier) {
  const { facts } = dossier
  const who = facts.clientName ? ` · ${facts.clientName}` : ''
  return `Customer Experience Report — ${facts.bookingRef}${who} · Apple Holidays`
}

export function buildAgentEmail(opts: {
  dossier: TripDossier
  narrative: ExperienceNarrative
  isAutoSend?: boolean
  /** Rendered inside the page instead of mailed — drops the mail-client chrome. */
  forPreview?: boolean
}): string {
  const { dossier, narrative, isAutoSend } = opts
  const { facts, places, stats, form } = dossier

  const body = `font-size:14.5px;color:#334155;line-height:1.8;margin:0 0 14px`

  // Only the counts that mean something to an agent — not our internal call ops.
  const responseNote = [
    stats.callsAnswered ? `${stats.callsAnswered} follow-up conversation${stats.callsAnswered === 1 ? '' : 's'} during the trip` : '',
    form ? 'a completed feedback form' : '',
    dossier.deskNotes.length ? 'notes from our operations desk' : '',
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(buildAgentSubject(dossier))}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT}">
<div style="max-width:740px;margin:0 auto;background:#ffffff">

  <!-- Hero -->
  <div style="background-color:#4338ca;background:linear-gradient(135deg,#6d28d9 0%,#4338ca 55%,#2563eb 100%);padding:38px 40px 34px">
    <p style="margin:0 0 10px;font-size:10.5px;font-weight:800;color:#c4b5fd;text-transform:uppercase;letter-spacing:0.16em">Apple Holidays · Traveller Experience</p>
    <h1 style="margin:0 0 14px;font-size:29px;font-weight:900;color:#ffffff;letter-spacing:-0.7px;line-height:1.2">Customer Experience Report</h1>
    <p style="margin:0 0 5px;font-size:17px;font-weight:800;color:#ffffff">${esc(facts.clientName ?? 'Guest')}</p>
    <p style="margin:0;font-size:13px;color:#ddd6fe;font-weight:600">
      Booking ${esc(facts.bookingRef)} &nbsp;·&nbsp; ${esc(fmtShort(facts.arrivalDate))} → ${esc(fmtShort(facts.departureDate))}${facts.nights != null ? ` &nbsp;·&nbsp; ${facts.nights} nights` : ''}
    </p>
    ${isAutoSend ? `<p style="margin:16px 0 0"><span style="display:inline-block;background:rgba(255,255,255,0.16);color:#ede9fe;font-size:10.5px;font-weight:700;padding:6px 14px;border-radius:20px">Sent automatically at the end of the trip</span></p>` : ''}
  </div>

  <div style="padding:34px 40px 8px">

    <p style="margin:0 0 22px;font-size:14.5px;color:#475569;line-height:1.8">
      Dear <strong style="color:#0f172a">${esc(facts.agentName ?? 'Partner')}</strong>,
    </p>

    <!-- Headline + score -->
    <div style="margin:0 0 26px;padding:24px 26px;background:#faf9ff;border:1px solid #e0d7ff;border-radius:16px">
      ${narrative.overallScore ? `<p style="margin:0 0 12px"><span style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#ffffff;font-size:12.5px;font-weight:800;padding:7px 17px;border-radius:20px;letter-spacing:0.02em">${esc(narrative.overallScore)}</span></p>` : ''}
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:900;color:#1e1b4b;line-height:1.32;letter-spacing:-0.35px">${esc(narrative.headline)}</h2>
      ${paras(narrative.opening, body)}
    </div>

    <!-- Trip facts -->
    ${sectionHeading('At a glance', 'Trip details')}
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 28px;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9">
      ${factRow('Client', esc(facts.clientName ?? 'Guest'))}
      ${facts.passengers.length > 1 ? factRow('Travelling party', esc(facts.passengers.join(', '))) : ''}
      ${factRow('Travel dates', `${esc(fmtLong(facts.arrivalDate))} &nbsp;→&nbsp; ${esc(fmtLong(facts.departureDate))}`)}
      ${facts.nights != null ? factRow('Duration', `${facts.nights} nights`) : ''}
      ${factRow('Party', `${facts.pax.adults} adult${facts.pax.adults === 1 ? '' : 's'}${facts.pax.children ? `, ${facts.pax.children} child${facts.pax.children === 1 ? '' : 'ren'}` : ''}${facts.pax.infants ? `, ${facts.pax.infants} infant${facts.pax.infants === 1 ? '' : 's'}` : ''}`)}
      ${facts.destination ? factRow('Destination', esc(facts.destination)) : ''}
      ${facts.specialOccasions ? factRow('Occasion', esc(facts.specialOccasions)) : ''}
      ${factRow('Booking reference', esc(facts.bookingRef))}
    </table>

    <!-- Places visited -->
    ${places.length ? `${sectionHeading('Where they went', 'Places visited')}
      <div style="margin:0 0 22px">${placeChips(places)}</div>` : ''}

    ${itineraryTable(dossier)}

    <!-- The journey -->
    ${narrative.journeyStory ? `${sectionHeading('The journey', 'How the trip unfolded')}
      <div style="margin:0 0 28px">${paras(narrative.journeyStory, body)}</div>` : ''}

    <!-- In the client's words -->
    ${narrative.guestVoice ? `${sectionHeading('In their words', 'What the client told us')}
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 28px">
        <tr><td style="background:#f0fdf4;border-left:4px solid #34d399;border-radius:0 14px 14px 0;padding:20px 24px">
          ${paras(narrative.guestVoice, 'font-size:14.5px;color:#14532d;line-height:1.8;margin:0 0 12px')}
        </td></tr>
      </table>` : ''}

    <!-- Detailed feedback -->
    ${sectionHeading('The detail', 'Feedback summary')}
    <div style="margin:0 0 24px">${paras(narrative.feedbackSummary, body)}</div>

    ${serviceNoteRows(narrative.serviceNotes)}

    <!-- Issues -->
    ${narrative.issuesSummary ? `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 28px">
      <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:20px 24px">
        <p style="margin:0 0 8px;font-size:10.5px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:0.1em">Points we are following up</p>
        ${paras(narrative.issuesSummary, 'font-size:14px;color:#78350f;line-height:1.8;margin:0 0 10px')}
      </td></tr>
    </table>` : ''}

    <!-- Key observations -->
    ${narrative.keyThemes.length ? `${sectionHeading('Takeaways', 'Key observations')}
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 28px">
        ${narrative.keyThemes.map(t => `<tr>
          <td width="26" style="width:26px;padding:6px 0;vertical-align:top;font-size:13px;color:#a78bfa;font-weight:800">◆</td>
          <td style="padding:6px 0;font-size:13.5px;color:#3730a3;line-height:1.65">${esc(t)}</td>
        </tr>`).join('')}
      </table>` : ''}

    <!-- Close -->
    ${narrative.closingRemark ? `<p style="margin:0 0 8px;font-size:14.5px;color:#475569;line-height:1.8;font-style:italic">${esc(narrative.closingRemark)}</p>` : ''}
    <p style="margin:0 0 30px;font-size:14px;color:#475569;line-height:1.8">Warm regards,<br><strong style="color:#0f172a">Apple Holidays · Traveller Experience Team</strong></p>

    <!-- How we know -->
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 8px">
      <tr><td style="padding:16px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
        <p style="margin:0;font-size:11.5px;color:#64748b;line-height:1.7">
          This report is compiled at the end of the trip from ${responseNote.length ? esc(responseNote.join(', ')) : 'the records held for this booking'}.
          It is a summary — the underlying conversation records are retained internally and are available to you on request.
        </p>
      </td></tr>
    </table>

  </div>

  <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#0f172a">
    <tr>
      <td style="padding:20px 40px;font-size:11px;color:#94a3b8;line-height:1.6">
        <strong style="color:#e2e8f0">Apple Holidays</strong><br>confirm.booking@aahaas.com
      </td>
      <td align="right" style="padding:20px 40px;font-size:10.5px;color:#64748b;text-align:right;vertical-align:bottom">
        ${esc(fmtShort(new Date().toISOString()))}
      </td>
    </tr>
  </table>

</div>
</body></html>`
}

// ─── The hold escalation ──────────────────────────────────────────────────────

export function buildEscalationSubject(dossier: TripDossier, risk: RiskAssessment) {
  return `[HELD — NOT SENT TO AGENT] ${dossier.facts.bookingRef} · ${dossier.facts.clientName ?? 'Guest'} · ${risk.level.toUpperCase()} concern`
}

export function buildEscalationEmail(opts: {
  dossier: TripDossier
  narrative: ExperienceNarrative | null
  risk: RiskAssessment
  /** Deep link back into the Experience Report Centre. */
  reviewUrl: string | null
  /** Free text from whoever escalated by hand. */
  note?: string | null
}): string {
  const { dossier, narrative, risk, reviewUrl, note } = opts
  const { facts } = dossier

  const levelTint: Record<string, { bg: string; line: string; text: string }> = {
    high: { bg: '#fef2f2', line: '#fca5a5', text: '#991b1b' },
    medium: { bg: '#fff7ed', line: '#fdba74', text: '#9a3412' },
    low: { bg: '#fefce8', line: '#fde047', text: '#854d0e' },
    none: { bg: '#f8fafc', line: '#e2e8f0', text: '#475569' },
  }
  const tint = levelTint[risk.level] ?? levelTint.none

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(buildEscalationSubject(dossier, risk))}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT}">
<div style="max-width:720px;margin:0 auto;background:#ffffff">

  <div style="background:linear-gradient(135deg,#991b1b 0%,#b91c1c 60%,#dc2626 100%);padding:34px 38px">
    <p style="margin:0 0 10px;font-size:10.5px;font-weight:800;color:#fecaca;text-transform:uppercase;letter-spacing:0.16em">Apple Holidays · Experience report held</p>
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;line-height:1.25">This report has NOT gone to the agent</h1>
    <p style="margin:0;font-size:14px;color:#fee2e2;line-height:1.7">
      The end-of-trip report for <strong style="color:#ffffff">${esc(facts.bookingRef)}</strong> was stopped before sending because the client's experience was not good. It is waiting for your decision.
    </p>
  </div>

  <div style="padding:30px 38px 10px">

    <!-- The blunt statement first -->
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
      <tr><td style="background:#fef2f2;border:2px solid #fecaca;border-radius:14px;padding:20px 24px">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;color:#991b1b;text-transform:uppercase;letter-spacing:0.1em">Status</p>
        <p style="margin:0;font-size:15px;color:#7f1d1d;line-height:1.75;font-weight:700">
          Held. ${esc(facts.agentName ?? 'The agent')} has not been contacted about this trip.
        </p>
        ${risk.reason ? `<p style="margin:10px 0 0;font-size:13.5px;color:#991b1b;line-height:1.7">${esc(risk.reason)}</p>` : ''}
      </td></tr>
    </table>

    ${note ? `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
      <tr><td style="background:#eef2ff;border-left:4px solid #6366f1;border-radius:0 12px 12px 0;padding:16px 20px">
        <p style="margin:0 0 5px;font-size:10.5px;font-weight:800;color:#4338ca;text-transform:uppercase;letter-spacing:0.1em">Note from the team</p>
        <p style="margin:0;font-size:13.5px;color:#3730a3;line-height:1.7">${esc(note)}</p>
      </td></tr></table>` : ''}

    <!-- Trip facts -->
    ${sectionHeading('The file', 'Trip details')}
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9">
      ${factRow('Booking', esc(facts.bookingRef))}
      ${factRow('Client', esc(facts.clientName ?? 'Guest'))}
      ${factRow('Agent', esc(facts.agentName ?? '—'))}
      ${factRow('Agent email', esc(facts.agentEmail ?? 'not on file'))}
      ${factRow('Travel dates', `${esc(fmtLong(facts.arrivalDate))} → ${esc(fmtLong(facts.departureDate))}`)}
      ${facts.destination ? factRow('Destination', esc(facts.destination)) : ''}
      ${facts.callPhone ? factRow('Contact number', esc(facts.callPhone)) : ''}
    </table>

    <!-- What went wrong -->
    ${sectionHeading('Why it was held', `${risk.signals.length} signal${risk.signals.length === 1 ? '' : 's'} · score ${risk.score} · ${risk.level.toUpperCase()}`)}
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
      ${risk.signals.map(s => `<tr>
        <td style="padding:0 0 10px">
          <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:${tint.bg};border:1px solid ${tint.line};border-radius:12px">
            <tr>
              <td style="padding:14px 18px">
                <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:${tint.text}">
                  ${esc(s.label)}
                  ${s.dayNo ? `<span style="font-weight:600;color:#94a3b8"> · day ${s.dayNo}</span>` : ''}
                  <span style="float:right;font-size:10.5px;font-weight:700;color:#94a3b8">${esc(
                    s.channel === 'ai_call' ? 'Follow-up call'
                    : s.channel === 'guest_form' ? 'Feedback form'
                    : 'Desk note',
                  )}</span>
                </p>
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.7">${esc(s.detail)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`).join('')}
    </table>

    <!-- The draft we would have sent -->
    ${narrative ? `${sectionHeading('Prepared draft', 'What the agent would have received')}
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
        <tr><td style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:14px;padding:20px 24px">
          <p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#334155;line-height:1.4">${esc(narrative.headline)}</p>
          <p style="margin:0 0 12px;font-size:13.5px;color:#64748b;line-height:1.75">${esc(narrative.feedbackSummary)}</p>
          ${narrative.issuesSummary ? `<p style="margin:0;font-size:13.5px;color:#9a3412;line-height:1.75"><strong>Issues:</strong> ${esc(narrative.issuesSummary)}</p>` : ''}
        </td></tr>
      </table>` : ''}

    <!-- What to do -->
    ${sectionHeading('Over to you', 'What happens next')}
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 26px">
      <tr><td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:14px;padding:20px 24px">
        <p style="margin:0 0 10px;font-size:13.5px;color:#075985;line-height:1.75">Someone needs to decide one of the following:</p>
        <p style="margin:0 0 7px;font-size:13.5px;color:#0c4a6e;line-height:1.7"><strong>1.</strong> Resolve it with the client first, then release the report to the agent.</p>
        <p style="margin:0 0 7px;font-size:13.5px;color:#0c4a6e;line-height:1.7"><strong>2.</strong> Ask the Traveller Experience team to write to the agent personally instead of sending the standard report.</p>
        <p style="margin:0;font-size:13.5px;color:#0c4a6e;line-height:1.7"><strong>3.</strong> Cancel the report for this booking altogether.</p>
        ${reviewUrl ? `<p style="margin:18px 0 0"><a href="${esc(reviewUrl)}" style="display:inline-block;background:#0284c7;color:#ffffff;font-size:13.5px;font-weight:800;padding:12px 24px;border-radius:10px;text-decoration:none">Open the report to decide →</a></p>` : ''}
      </td></tr>
    </table>

  </div>

  <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#0f172a">
    <tr><td style="padding:18px 38px;font-size:11px;color:#94a3b8;line-height:1.6">
      Apple Holidays · Traveller Experience · This message is internal. Do not forward it to the agent.
    </td></tr>
  </table>

</div>
</body></html>`
}
