'use client'

/**
 * Shared primitives for the DB-backed transcript surfaces:
 *   • BookingCallTranscripts   (per-booking, light theme)
 *   • TranscriptsExplorer      (AI Call Bot global tab, dark theme)
 *
 * Fed by GET /api/te/transcripts. Keeps normalisation, kind/sentiment styling
 * and the chat-bubble renderer in one place so both surfaces stay identical.
 */
import { Phone, ClipboardCheck, Award, Bot, User } from 'lucide-react'
import type { ElementType } from 'react'

export type Kind = 'on_tour' | 'reconfirm' | 'post_tour'

export interface TranscriptRecord {
  uid: string
  kind: Kind
  id: number
  service_id: number
  schedule_id: number | null
  booking_ref: string
  customer_name: string | null
  lead_name: string | null
  operation_country: string | null
  day_no: number | null
  call_date: string | null
  at: string | null
  sentiment: string | null
  outcome: string | null
  rating: number | null
  summary: string | null
  conversation_id: string | null
  transcript: TranscriptTurn[] | string | null
  transcript_turns: number
  detail: Record<string, unknown>
}

export interface TranscriptStats {
  total: number
  byKind: Record<Kind, number>
  withTranscript: number
  bookings: number
  avgRating: number | null
  sentimentBreakdown: Record<string, number>
}

interface TranscriptTurn { role?: string; speaker?: string; text?: string; message?: string; content?: string }

export const KIND_META: Record<Kind, { label: string; short: string; icon: ElementType; accent: string; solid: string; chip: string; ring: string }> = {
  reconfirm: { label: 'Pre-tour · Reconfirmation', short: 'Reconfirm', icon: ClipboardCheck, accent: 'sky',    solid: 'bg-sky-500',    chip: 'bg-sky-50 text-sky-700 border-sky-200',           ring: 'ring-sky-400/40' },
  on_tour:   { label: 'On-tour · Daily check-in',   short: 'On-tour',   icon: Phone,         accent: 'violet', solid: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200',  ring: 'ring-violet-400/40' },
  post_tour: { label: 'Post-tour · Feedback',       short: 'Post-tour', icon: Award,         accent: 'amber',  solid: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700 border-amber-200',     ring: 'ring-amber-400/40' },
}

export const SENTIMENT_META: Record<string, { emoji: string; label: string; cls: string }> = {
  happy:     { emoji: '😊', label: 'Happy',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  satisfied: { emoji: '😊', label: 'Satisfied', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  positive:  { emoji: '😊', label: 'Positive',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  neutral:   { emoji: '😐', label: 'Neutral',   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  mixed:     { emoji: '😕', label: 'Mixed',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unhappy:   { emoji: '😞', label: 'Unhappy',   cls: 'bg-red-50 text-red-600 border-red-200' },
  negative:  { emoji: '😞', label: 'Negative',  cls: 'bg-red-50 text-red-600 border-red-200' },
}

export const OUTCOME_LABEL: Record<string, string> = {
  all_good: 'All good', confirmed: 'Confirmed', issue_raised: 'Issue raised', change_requested: 'Change requested',
  no_answer: 'No answer', voicemail: 'Voicemail', callback: 'Callback', declined: 'Declined',
}

export function fmtDate(s: string | null | undefined) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtDateTime(s: string | null | undefined) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export type NormLine = { speaker: 'agent' | 'customer' | 'system'; text: string }

export function normaliseTranscript(raw: TranscriptTurn[] | string | null | undefined): NormLine[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map(t => {
        const role = (t.role ?? t.speaker ?? '').toLowerCase()
        const text = t.text ?? t.message ?? t.content ?? ''
        if (['ai', 'agent', 'bot', 'assistant'].includes(role)) return { speaker: 'agent' as const, text }
        if (['user', 'customer', 'human', 'passenger', 'caller'].includes(role)) return { speaker: 'customer' as const, text }
        return { speaker: 'system' as const, text }
      })
      .filter(l => l.text)
  }
  return String(raw)
    .split('\n')
    .filter(Boolean)
    .map(line => {
      if (/^(agent|bot|ai|assistant)\s*:/i.test(line)) return { speaker: 'agent' as const, text: line.replace(/^[^:]+:\s*/i, '') }
      if (/^(customer|user|human|caller)\s*:/i.test(line)) return { speaker: 'customer' as const, text: line.replace(/^[^:]+:\s*/i, '') }
      return { speaker: 'system' as const, text: line }
    })
}

/** Chat-style transcript renderer. `dark` swaps to the AI Call Bot palette. */
export function TranscriptChat({ transcript, dark = false }: { transcript: TranscriptRecord['transcript']; dark?: boolean }) {
  const lines = normaliseTranscript(transcript)
  if (!lines.length) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
        <Bot className="w-7 h-7 opacity-40" />
        <p className="text-xs italic">No conversation turns recorded for this call yet.</p>
        <p className="text-[10px] opacity-70">Only the AI summary was captured — the full transcript appears here once the voice agent stores it.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2.5">
      {lines.map((l, i) => {
        if (l.speaker === 'system') {
          return <p key={i} className={`text-center text-[10px] italic ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{l.text}</p>
        }
        const isAgent = l.speaker === 'agent'
        return (
          <div key={i} className={`flex items-end gap-2 ${isAgent ? '' : 'flex-row-reverse'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isAgent ? 'bg-violet-500' : 'bg-emerald-500'}`}>
              {isAgent ? <Bot className="w-3.5 h-3.5 text-white" /> : <User className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
              isAgent
                ? (dark ? 'bg-violet-500/15 text-violet-100 rounded-bl-sm border border-violet-500/20' : 'bg-violet-50 text-slate-800 rounded-bl-sm border border-violet-100')
                : (dark ? 'bg-emerald-500/15 text-emerald-50 rounded-br-sm border border-emerald-500/20' : 'bg-emerald-50 text-slate-800 rounded-br-sm border border-emerald-100')
            }`}>
              <p className={`text-[9px] font-bold uppercase tracking-wide mb-0.5 ${isAgent ? (dark ? 'text-violet-300' : 'text-violet-500') : (dark ? 'text-emerald-300' : 'text-emerald-600')}`}>{isAgent ? 'AI Agent' : 'Guest'}</p>
              {l.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** yes/no/unsure tri-state flag → styling. Accepts booleans too. */
export function triState(v: unknown): 'yes' | 'no' | 'unsure' | null {
  if (v === true || v === 'yes' || v === 'good') return 'yes'
  if (v === false || v === 'no' || v === 'bad') return 'no'
  if (v === 'unsure' || v === 'unclear') return 'unsure'
  return null
}
