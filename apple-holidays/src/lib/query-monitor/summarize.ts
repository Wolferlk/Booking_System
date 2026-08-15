/**
 * One-sentence summaries for the Query Monitor — the "AI reads every new mail"
 * switch.
 *
 * The rest of the AI in this feature is a *fallback*: GPT is asked only about
 * the fields the regexes could not read. This is the opposite, and that is why
 * it is off by default and has a switch of its own. Every new mail costs a
 * call, so the prompt is small, the answer is capped at one sentence, and a
 * failure is never allowed to reach the sweep — a mail without a summary is a
 * blank cell, not a lost row.
 *
 * What the team wants out of column T is the thing they currently open the mail
 * to find out: what is being asked for, for how many people, and by when. So the
 * prompt asks for exactly that and forbids the padding a model reaches for
 * ("This email is a request regarding…").
 */
import openai, { logAiUsage } from '@/lib/openai'

/** Hard ceiling on the cell — a summary that needs scrolling is not a summary. */
const MAX_CHARS = 300

const SYSTEM = `You summarise inbound B2B travel emails for a Sri Lankan DMC's operations sheet.

Reply with ONE sentence, under 200 characters, in plain past/present tense.
Lead with the ask itself. Include pax count, nights and travel dates when the mail states them.
Never begin with "This email", "The sender" or "A request" — start with the substance.
Never invent a detail the mail does not contain. If the mail says nothing concrete, say what it is (e.g. "Chaser on an earlier quote, no new details.").
Return the sentence only — no quotes, no prefix, no bullet.`

/**
 * A one-sentence reading of a mail, or null if GPT could not be reached.
 *
 * `kind` only shapes the wording: a voucher or an on-ground incident is not a
 * sales query and should not be summarised as if it were one.
 */
export async function summarizeMail(
  subject: string,
  body: string,
  kind: 'QUERY' | 'EXCLUDED' = 'QUERY',
): Promise<string | null> {
  const text = `${subject}\n\n${body}`.trim()
  if (!text) return null

  const framing = kind === 'EXCLUDED'
    ? 'This mail is post-booking or operational traffic, not a new sales enquiry. Say what happened and what is needed.'
    : 'This mail is an inbound sales enquiry from a travel agent. Say what is being quoted for.'

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${framing}\n\nSUBJECT: ${subject}\n\nBODY:\n${body.slice(0, 2500)}` },
      ],
      temperature: 0.2,
      max_tokens: 90,
    })

    await logAiUsage({
      callType: 'query_monitor_summary',
      model:    'gpt-4o-mini',
      usage:    response.usage,
      source:   'query-monitor',
    })

    return cleanSentence(response.choices[0]?.message?.content ?? '')
  } catch (err) {
    console.error('[QueryMonitor] summary failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * The same job over a whole conversation instead of one mail.
 *
 * Column T reads the mail that opened the thread and never moves again — which
 * is right for "what was asked" and useless for "where does this stand". This
 * writes column AA: what has happened since, across every mail the ledger
 * carries, rewritten each time the thread grows.
 *
 * The model is given the timeline as *facts already established* — who wrote,
 * when, to whom, and which of ours was a reply rather than a forward. It is
 * asked to narrate them, never to work them out: the classification is done in
 * thread-events.ts from the actual recipients, and a model second-guessing it
 * would undo the one thing that makes the reply attribution trustworthy.
 */
const THREAD_SYSTEM = `You describe the state of an email thread for a Sri Lankan DMC's operations sheet.

You are given the thread's events in order, already classified. Narrate them; never re-interpret them.
Reply with at most TWO short sentences, under 260 characters total.
Say what the agent wanted, what the team did about it, and what is outstanding right now.
Name people as they are named in the events. Keep the times only where they matter.
Never begin with "This thread" or "The email". Never invent a detail the events do not contain.
Return the sentences only — no quotes, no prefix, no bullet.`

/** Hard ceiling on the thread cell — roomier than column T, still one glance. */
const MAX_THREAD_CHARS = 400

export async function summarizeThread(
  subject: string, timeline: string[],
): Promise<string | null> {
  if (timeline.length === 0) return null

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: THREAD_SYSTEM },
        {
          role: 'user',
          // Only the last 20 events are sent. A thread longer than that is an
          // on-ground incident running for days, and its opening and its current
          // state are what matter — the middle is the part nobody re-reads.
          content: `SUBJECT: ${subject}\n\nEVENTS (oldest first):\n`
            + timeline.slice(-20).join('\n'),
        },
      ],
      temperature: 0.2,
      max_tokens: 130,
    })

    await logAiUsage({
      callType: 'query_monitor_thread_summary',
      model:    'gpt-4o-mini',
      usage:    response.usage,
      source:   'query-monitor',
    })

    return cleanSentence(response.choices[0]?.message?.content ?? '', MAX_THREAD_CHARS)
  } catch (err) {
    console.error('[QueryMonitor] thread summary failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Flatten the model's answer into something a spreadsheet cell can hold.
 *
 * Newlines are stripped rather than kept: a cell with a line break in it breaks
 * the team's row heights, and anything past the first sentence is padding we
 * asked the model not to write in the first place.
 */
export function cleanSentence(raw: string, maxChars = MAX_CHARS): string | null {
  const flat = raw
    .replace(/\s+/g, ' ')
    .replace(/^["'“”\s-]+|["'“”\s]+$/g, '')
    .trim()

  return flat ? flat.slice(0, maxChars) : null
}
