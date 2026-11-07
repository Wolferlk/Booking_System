/**
 * WhatsApp's inline formatting (*bold*, _italic_, ~strike~), read the way the
 * app reads it: a marker only counts at a word edge and hugging its text, so
 * "2 * 3 * 4" and snake_case_names stay as typed. Links are matched first
 * because their underscores are never formatting.
 */
export type WaSpanKind = 'text' | 'bold' | 'italic' | 'strike' | 'link'
export interface WaSpan { kind: WaSpanKind; text: string }

const TOKEN =
  /(https?:\/\/[^\s]+)|(?<![A-Za-z0-9])(?:\*(?=\S)([^*\n]+?)(?<=\S)\*|_(?=\S)([^_\n]+?)(?<=\S)_|~(?=\S)([^~\n]+?)(?<=\S)~)(?![A-Za-z0-9])/g

export function parseWaText(text: string): WaSpan[] {
  const spans: WaSpan[] = []
  let at = 0
  for (const m of Array.from(text.matchAll(TOKEN))) {
    const start = m.index ?? 0
    if (start > at) spans.push({ kind: 'text', text: text.slice(at, start) })
    if (m[1]) spans.push({ kind: 'link', text: m[1] })
    else if (m[2]) spans.push({ kind: 'bold', text: m[2] })
    else if (m[3]) spans.push({ kind: 'italic', text: m[3] })
    else spans.push({ kind: 'strike', text: m[4] })
    at = start + m[0].length
  }
  if (at < text.length) spans.push({ kind: 'text', text: text.slice(at) })
  return spans
}

/** The same text for anywhere that doesn't read WhatsApp markers, such as an email. */
export function stripWaFormatting(text: string): string {
  return parseWaText(text).map(s => s.text).join('')
}
