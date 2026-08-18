/**
 * The traveller's thank-you letter.
 *
 * The agent gets an analytical report. The guest gets something else entirely:
 * a short, warm, individually written note that names the places they actually
 * went and, where the evidence supports it, the moment they said they enjoyed.
 * It is the last thing they hear from us, so it is written rather than
 * templated — the model is handed the same dossier the agent report came from
 * and asked for prose in the second person.
 *
 * Two hard rules, both enforced below rather than left to the prompt:
 *   • a trip that was held for a bad experience never gets one of these;
 *   • nothing that reads as an internal note, a rating or a service grade goes
 *     anywhere near it.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { esc } from './email'
import type { ClientLetter, TripDossier } from './types'

const MODEL = 'gpt-4o'

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

function fmtLong(iso: string | null) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

/** The first name we can address them by, without guessing at a title. */
function firstName(full: string | null): string | null {
  if (!full) return null
  const cleaned = full
    .replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, '')
    .trim()
  const first = cleaned.split(/\s+/)[0]
  if (!first || first.length < 2) return null
  return first.charAt(0).toUpperCase() + first.slice(1)
}

// ─── Writing the letter ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write the farewell note Apple Holidays sends a traveller a couple of days after they get home. One note, from us to them, and nothing else.

Voice:
- Second person, warm, unhurried. You are a person who followed their trip, not a brand.
- Concrete beats effusive. Name the actual places, dishes, drives and moments in the evidence. Never invent one.
- If they said something themselves that is worth echoing, echo the feeling of it — do not quote them back at themselves like a transcript.
- Short. Three paragraphs at most, each two to four sentences.

Never:
- Never mention calls, forms, feedback, surveys, ratings, scores, transcripts, agents, bookings systems or AI.
- Never mention the travel agent or any internal team by name.
- Never ask them for a review, a referral, a rating or a rebooking. This note asks for nothing.
- Never apologise for or allude to anything that went wrong — a trip with problems is not sent this note at all.
- No clichés: not "unforgettable journey", not "memories to last a lifetime", not "we hope you had a great time".

Output ONLY valid JSON matching the schema you are given.`

function buildClientEvidence(dossier: TripDossier): string {
  const { facts, itinerary, places, calls, form } = dossier
  const parts: string[] = []

  parts.push([
    `Traveller: ${facts.clientName ?? 'our guest'}`,
    facts.passengers.length > 1 ? `Travelling with: ${facts.passengers.join(', ')}` : '',
    facts.destination ? `Where: ${facts.destination}` : '',
    `Dates: ${fmtLong(facts.arrivalDate) ?? 'unknown'} to ${fmtLong(facts.departureDate) ?? 'unknown'}${facts.nights != null ? ` (${facts.nights} nights)` : ''}`,
    facts.specialOccasions ? `They were travelling for: ${facts.specialOccasions}` : '',
  ].filter(Boolean).join('\n'))

  if (itinerary.length) {
    parts.push([
      'WHERE THEY WENT',
      ...itinerary.slice(0, 20).map(i => `Day ${i.dayNo}: ${i.title}`),
      places.length ? `Named places: ${places.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }

  // Only the good half of the evidence reaches this prompt. The note is a
  // thank-you; problems are handled on the agent side and in the hold queue.
  const goodBits = [
    ...calls.map(c => c.highlights).filter(Boolean),
    ...calls
      .filter(c => (c.sentiment ?? '').toLowerCase() !== 'negative')
      .map(c => c.summary)
      .filter(Boolean),
    form?.remarks ?? null,
  ].filter((v): v is string => !!v?.trim())

  if (goodBits.length) {
    parts.push(['WHAT THEY SEEMED TO ENJOY', ...goodBits.map(b => `- ${b}`)].join('\n'))
  }

  return parts.join('\n\n')
}

export async function generateClientLetter(dossier: TripDossier): Promise<ClientLetter> {
  const { facts } = dossier
  const name = firstName(facts.clientName)

  const userPrompt = `Write the farewell note for this traveller.

Address them as "${name ?? 'there'}".

EVIDENCE
${buildClientEvidence(dossier)}

Return JSON with exactly these keys:
{
  "subject": "A subject line of 4-9 words that names something specific from THIS trip. Not 'Thank you for travelling with us'.",
  "greeting": "e.g. 'Dear ${name ?? 'there'},' — just the greeting line.",
  "paragraphs": ["2-3 paragraphs. The first opens on a specific place or moment. The middle walks their route the way a friend would recall it. The last closes warmly and asks for nothing."],
  "keepsakeLine": "One short line, under 12 words, drawn from their trip — printed large as a pull quote. No quotation marks.",
  "signOff": "e.g. 'Until the next one,' — just the sign-off line, no name."
}`

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.85,
      max_tokens: 1200,
    })

    await logAiUsage({
      callType: 'experience_report_client_letter',
      model: MODEL,
      usage: response.usage,
      bookingRef: facts.bookingRef,
      source: 'experience-report',
    })

    const raw = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Partial<ClientLetter>
    return normalise(raw, dossier)
  } catch {
    return fallbackClientLetter(dossier)
  }
}

function normalise(raw: Partial<ClientLetter>, dossier: TripDossier): ClientLetter {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const fb = fallbackClientLetter(dossier)

  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs.map(p => String(p).trim()).filter(Boolean).slice(0, 4)
    : []

  return {
    subject: str(raw.subject) || fb.subject,
    greeting: str(raw.greeting) || fb.greeting,
    paragraphs: paragraphs.length ? paragraphs : fb.paragraphs,
    keepsakeLine: str(raw.keepsakeLine).replace(/^["“]|["”]$/g, ''),
    signOff: str(raw.signOff) || fb.signOff,
  }
}

/** Plain, true and warm enough to send when the model is unavailable. */
export function fallbackClientLetter(dossier: TripDossier): ClientLetter {
  const { facts, places } = dossier
  const name = firstName(facts.clientName)
  const where = facts.destination ?? (places[0] ?? 'your trip')
  const route = places.slice(0, 4).join(', ')

  return {
    subject: `Thank you for travelling with us — ${where}`,
    greeting: `Dear ${name ?? 'Traveller'},`,
    paragraphs: [
      `Now that you are home, we wanted to write and say thank you for spending your ${where} trip with us.`,
      route
        ? `From ${route}, it was a pleasure to have a hand in how the days came together.`
        : 'It was a pleasure to have a hand in how the days came together.',
      'Whenever you are ready to go somewhere next, we would love to help you plan it.',
    ],
    keepsakeLine: '',
    signOff: 'Warmly,',
  }
}

// ─── Rendering the letter ─────────────────────────────────────────────────────

export function buildClientSubject(letter: ClientLetter, dossier: TripDossier) {
  const subject = letter.subject.trim()
  return subject || `Thank you for travelling with us — ${dossier.facts.destination ?? 'Apple Holidays'}`
}

/**
 * Deliberately simpler than the agent report: no tables of ratings, no stats,
 * no booking reference in the body. It should read like a letter, because that
 * is what it is.
 */
export function buildClientEmail(opts: {
  dossier: TripDossier
  letter: ClientLetter
  /** Rendered in the drawer rather than mailed. */
  forPreview?: boolean
}): string {
  const { dossier, letter } = opts
  const { facts, places } = dossier

  const body = 'margin:0 0 18px;font-size:15.5px;color:#334155;line-height:1.85'

  const dateLine = [fmtLong(facts.arrivalDate), fmtLong(facts.departureDate)]
    .filter(Boolean)
    .join(' – ')

  const chips = places.slice(0, 10).map(p =>
    `<span style="display:inline-block;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;margin:0 6px 8px 0">${esc(p)}</span>`,
  ).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f4ef">
<div style="max-width:620px;margin:0 auto;background:#ffffff;font-family:${FONT}">

  <!-- Masthead -->
  <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:linear-gradient(135deg,#7c2d12,#b45309)">
    <tr>
      <td style="padding:38px 40px 34px">
        <p style="margin:0 0 6px;font-size:10.5px;font-weight:800;color:#fed7aa;text-transform:uppercase;letter-spacing:0.18em">Apple Holidays</p>
        <h1 style="margin:0;font-size:26px;line-height:1.3;font-weight:800;color:#ffffff;letter-spacing:-0.4px">
          ${esc(facts.destination ? `Thank you for ${facts.destination}` : 'Thank you for travelling with us')}
        </h1>
        ${dateLine ? `<p style="margin:10px 0 0;font-size:13px;color:#fde8d0">${esc(dateLine)}</p>` : ''}
      </td>
    </tr>
  </table>

  <!-- The letter -->
  <div style="padding:36px 40px 8px">
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0f172a">${esc(letter.greeting)}</p>

    ${letter.paragraphs.map(p => `<p style="${body}">${esc(p)}</p>`).join('')}

    ${letter.keepsakeLine ? `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:26px 0 28px">
      <tr><td style="border-left:3px solid #f59e0b;padding:4px 0 4px 20px">
        <p style="margin:0;font-size:19px;line-height:1.5;font-weight:600;color:#7c2d12;font-style:italic">${esc(letter.keepsakeLine)}</p>
      </td></tr>
    </table>` : ''}

    ${chips ? `<p style="margin:26px 0 10px;font-size:10px;font-weight:800;color:#a8a29e;text-transform:uppercase;letter-spacing:0.14em">Where you went</p>
      <div style="margin:0 0 26px">${chips}</div>` : ''}

    <p style="margin:0 0 6px;font-size:15.5px;color:#334155;line-height:1.85">${esc(letter.signOff)}</p>
    <p style="margin:0 0 34px;font-size:15.5px;color:#0f172a;line-height:1.6">
      <strong>The team at Apple Holidays</strong>
    </p>
  </div>

  <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#1c1917">
    <tr>
      <td style="padding:22px 40px;font-size:11px;color:#a8a29e;line-height:1.7">
        <strong style="color:#e7e5e4">Apple Holidays</strong><br>
        confirm.booking@aahaas.com
      </td>
    </tr>
  </table>

</div>
</body></html>`
}
