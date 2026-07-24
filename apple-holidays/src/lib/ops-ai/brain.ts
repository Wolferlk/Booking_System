import openai, { logAiUsage } from '@/lib/openai'
import { ROLE_LABELS } from '@/lib/rbac'
import { NAVIGABLE_ROUTES, EDITABLE_BOOKING_FIELDS, SERVICE_TYPES, BOOKING_STATUSES, openAiToolSpecs } from './registry'
import type { BookingSnapshot, OpsActor } from './context'

/**
 * The agent's understanding of AppleHolidays MMT. Everything here is fed to the
 * model on every turn — it is what makes the difference between "a chatbot" and
 * "something that knows this system".
 */

const SYSTEM_OVERVIEW = `
# What AppleHolidays MMT is

A multi-role travel booking operations system for tours in Vietnam, Sri Lanka, Singapore and Malaysia.
A booking flows: document/email intake → AI extraction → team review → financial sign-off → operations → customer portal.

## Booking references
- \`VN…\` → Vietnam · \`IS…\` → Sri Lanka · \`SG…\`/\`MY…\` → Singapore/Malaysia
- Bookings also carry an **IS Number** (the tour-confirmation identifier), a **CNTL number**, and an **agent booking ID**.
- "Agent" is the selling travel agency. "File handler" is the AppleHolidays staff member who owns the file.

## Booking lifecycle statuses
${BOOKING_STATUSES.join(' → ')}

## Core records on a booking
- **Passengers** — lead passenger flagged \`isLead\`
- **Flights**, **Accommodations** (hotel, city, check-in/out, nights, room type, meal type)
- **Tour Agenda → Agenda Items** — the day-by-day operational movement chart. Each item has a date,
  location/activity, from/to points, times, meal plan and a **service type**
  (${SERVICE_TYPES.join(' | ')}). A full-day sightseeing tour is \`INTERNAL_TOUR\`; a private car
  transfer is \`PVT_TRANSFER\`; a seat-in-coach transfer is \`SIC_TRANSFER\`.
- **Assignment** — the driver/vehicle/vendor attached to one agenda item
- **P&L → P&L line items** — the financial record, owned by Accounts
- **Tickets**, **Payments**, **Change Requests**, **Contact Logs**, **Reminders**

## Tour day numbering
Day 1 is the **arrival date**. "3rd day" means arrivalDate + 2 days. Always express this as a
\`dayNumber\` and let the system resolve the calendar date — do not do the arithmetic yourself
unless the user names an explicit calendar date.
`.trim()

const OPERATING_RULES = `
# How you work

You are **OPS_AI** — the operations copilot embedded in AppleHolidays MMT. You do not just answer;
you propose concrete, executable actions that the user confirms with one click.

1. **Prefer acting over explaining.** If the user's intent maps to a capability, call it. Do not ask
   for permission in prose — proposing the action IS the permission request, because every write is
   confirm-gated in the UI before it touches the database.

2. **Resolve "this booking" from context.** When the user is on a booking page, the current booking
   is given to you below. "this booking", "here", "it" all mean that booking.

3. **Get real IDs before editing children.** Agenda items, accommodations and assignments are edited
   by ID. If the booking snapshot below already lists them, use those IDs directly. If not, call
   \`read_booking\` first, then propose the edit in the same turn.

4. **One field per \`update_booking_field\` call.** To change several fields, emit several calls.

5. **Be decisive about details.** If the user says "Sigiriya full day sightseeing tour on day 3",
   fill in a sensible \`details\` description and \`serviceType: INTERNAL_TOUR\` rather than asking.
   State any assumption you made in one short sentence.

6. **Ask only when genuinely ambiguous** — e.g. the request names a booking you cannot find, or two
   agenda items match equally well. Otherwise proceed.

7. **Never claim you did something.** The user runs the action. Say what the action *will* do.

# Hard limits (non-negotiable)

You have no capability to delete anything, cancel a booking, move a booking's status, alter users or
roles, confirm payments, or run SQL. These are not hidden behind a flag — they do not exist in your
toolset. If asked, say plainly that OPS_AI cannot do it and point the user at the relevant screen:
cancellations at /dashboard/accounts/cancellations, status moves on the booking page itself, user
admin at /dashboard/admin/users.

# Writing style

Terse and operational. One or two sentences. No preamble, no "Certainly!", no restating the request.
Use the booking ref when naming a booking. Never invent data you were not given.
`.trim()

function routeCatalogue(): string {
  return NAVIGABLE_ROUTES.map(r => `- \`${r.path}\` — **${r.label}**: ${r.hint}`).join('\n')
}

const NAV_RECIPES = `
# Navigation recipes

The All Bookings list at \`/dashboard/bookings\` accepts these query parameters:
- \`search\` — free text (ref, IS number, agent, file handler)
- \`status\` — one status, or several comma-separated
- \`dateFrom\` / \`dateTo\` — YYYY-MM-DD inclusive range
- \`dateField\` — \`arrivalDate\` (default) or \`createdAt\`; controls which column the range applies to
- \`dateFilter\` — quick period: \`today\`, \`week\`, \`month\`
- \`sortBy\` — arrivalDate | departureDate | createdAt | updatedAt · \`sortDir\` — asc | desc

Worked example — "find bookings arriving on 1 July":
\`navigate\` with path \`/dashboard/bookings\`, query
\`{ "dateFrom": "<that year>-07-01", "dateTo": "<that year>-07-01", "dateField": "arrivalDate", "sortDir": "asc" }\`,
label "Arrivals on 1 Jul".

When the user wants to *see a list on screen*, use \`navigate\`. When they want the *answer in chat*,
use \`search_bookings\`. When both would help, do both — search first, then offer the navigation.
`.trim()

export function buildSystemPrompt(actor: OpsActor, snapshot: BookingSnapshot | null, pathname?: string): string {
  const today = new Date()
  const parts = [
    SYSTEM_OVERVIEW,
    OPERATING_RULES,
    `# Pages you can open\n${routeCatalogue()}`,
    NAV_RECIPES,
    `# Booking fields you may edit\n${Object.entries(EDITABLE_BOOKING_FIELDS)
      .map(([k, v]) => `\`${k}\` (${v.label})`)
      .join(', ')}`,
    [
      '# Current session',
      `- User: ${actor.name} — ${ROLE_LABELS[actor.role] ?? actor.role}`,
      `- Country scope: ${actor.country ?? 'ALL'}${actor.countries?.length ? ` (also ${actor.countries.join(', ')})` : ''}`,
      `- Today: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString('en-GB', { weekday: 'long' })})`,
      `- Current page: ${pathname ?? 'unknown'}`,
      'When the user says a bare month/day with no year, assume the nearest sensible upcoming date relative to today.',
    ].join('\n'),
  ]

  if (snapshot) {
    parts.push(
      '# Booking currently open (this is what "this booking" refers to)\n' +
      '```json\n' + JSON.stringify(snapshot, null, 1) + '\n```\n' +
      'The `agendaItemId` and `accommodationId` values above are real primary keys — use them directly.',
    )
  } else {
    parts.push('# Booking currently open\nNone. If the user says "this booking", ask which one, or search for it.')
  }

  return parts.join('\n\n---\n\n')
}

export interface PlannedCall {
  tool: string
  args: Record<string, unknown>
}

export interface PlanResult {
  reply:    string
  /** WRITE and NAV calls, surfaced to the user as confirmable action cards. */
  proposals: PlannedCall[]
  /** READ calls the agent already ran, with their results, shown as evidence. */
  lookups:   { tool: string; args: Record<string, unknown>; result: unknown; message: string }[]
}

type ChatMessage = Parameters<typeof openai.chat.completions.create>[0]['messages'][number]

const MAX_READ_ROUNDS = 3

/**
 * One planning turn.
 *
 * READ capabilities are resolved inside this loop — they cannot change anything,
 * so making the user click "Run" on a lookup would be pure friction, and the
 * model needs their output (real record IDs, real dates) to propose an accurate
 * write. WRITE and NAV calls are never executed here; they come back as
 * proposals for the user to confirm.
 */
export async function planTurn(params: {
  system:   string
  history:  { role: 'user' | 'assistant'; content: string }[]
  message:  string
  bookingRef?: string | null
  /** Injected so this module never imports the executor directly (avoids a cycle). */
  runRead:  (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; message: string; data?: unknown }>
  isReadTool: (tool: string) => boolean
}): Promise<PlanResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: params.system },
    ...params.history.slice(-8).map(m => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: params.message },
  ]

  const lookups: PlanResult['lookups'] = []
  let reply = ''
  const proposals: PlannedCall[] = []

  for (let round = 0; round < MAX_READ_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 1200,
      messages,
      tools: openAiToolSpecs(),
      tool_choice: 'auto',
    })

    await logAiUsage({
      callType: 'ops_ai_plan',
      model: 'gpt-4o',
      usage: response.usage,
      bookingRef: params.bookingRef ?? null,
      source: 'ops_ai',
    })

    const choice = response.choices[0]?.message
    if (choice?.content) reply = choice.content.trim()

    const toolCalls = (choice?.tool_calls ?? []).filter(tc => tc.type === 'function')
    if (!toolCalls.length) break

    const parsed = toolCalls.map(tc => {
      let args: Record<string, unknown> = {}
      let valid = true
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch {
        valid = false   // a malformed argument blob is dropped rather than guessed at
      }
      return { id: tc.id, tool: tc.function.name, args, valid }
    })

    const reads = parsed.filter(c => c.valid && params.isReadTool(c.tool))
    for (const c of parsed) {
      if (c.valid && !params.isReadTool(c.tool)) proposals.push({ tool: c.tool, args: c.args })
    }

    // Nothing to resolve — the model has committed to its proposals.
    if (!reads.length) break

    messages.push(choice as ChatMessage)

    for (const call of parsed) {
      if (!call.valid) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error: arguments were not valid JSON.' })
        continue
      }
      if (!params.isReadTool(call.tool)) {
        // Proposals are queued for the user; tell the model so it stops re-emitting them.
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Queued as a confirmation card for the user. Do not repeat this call.',
        })
        continue
      }
      const result = await params.runRead(call.tool, call.args)
      lookups.push({ tool: call.tool, args: call.args, result: result.data, message: result.message })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ ok: result.ok, message: result.message, data: result.data ?? null }).slice(0, 20000),
      })
    }
  }

  return { reply, proposals, lookups }
}

/**
 * Fast, cheap "what might you mean?" pass used by the type-ahead. Returns short
 * command phrasings, never tool calls — clicking one submits it as a real turn.
 */
export async function suggestCommands(params: {
  partial:  string
  actor:    OpsActor
  snapshot: BookingSnapshot | null
  pathname?: string
}): Promise<string[]> {
  const ctx = params.snapshot
    ? `The user is on booking ${params.snapshot.bookingRef} (${params.snapshot.status}, agent "${params.snapshot.agent ?? 'unknown'}", ` +
      `arrives ${params.snapshot.arrivalDate}, ${params.snapshot.agenda.length} agenda items).`
    : `The user is on ${params.pathname ?? 'the dashboard'} with no booking open.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 220,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You autocomplete operator commands for OPS_AI, the copilot inside a travel booking operations system.\n' +
          'Given a partially typed instruction, return the 4 most likely COMPLETE commands the operator is reaching for.\n' +
          'Capabilities: search bookings, open a booking, navigate to a filtered page, edit booking fields ' +
          '(agent name, file handler, IS number, dates, pax, contact details, notes), add or edit tour agenda items, ' +
          'assign a driver to a movement, update a hotel row, create a reminder, log a customer contact.\n' +
          'There is NO delete, cancel, status-change or user-admin capability — never suggest those.\n' +
          'Each suggestion must be a single imperative sentence under 70 characters, concrete, and directly runnable.\n' +
          `Context: ${ctx}\n` +
          'Respond as JSON: {"suggestions": ["…", "…", "…", "…"]}',
      },
      { role: 'user', content: params.partial },
    ],
  })

  await logAiUsage({
    callType: 'ops_ai_suggest',
    model: 'gpt-4o-mini',
    usage: response.usage,
    bookingRef: params.snapshot?.bookingRef ?? null,
    source: 'ops_ai',
  })

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    const out = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    return out.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 4).map((s: string) => s.trim())
  } catch {
    return []
  }
}
