import type { BookingStatus, OperationCountry } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConversationBooking {
  bookingRef: string
  status: BookingStatus
  operationCountry: OperationCountry | null
}

export interface Conversation {
  phone: string
  displayName: string | null
  snippet: string
  direction: 'inbound' | 'outbound'
  updatedAt: string
  unreadCount: number
  booking: ConversationBooking | null
}

export interface WaMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  senderName: string | null
  status: string
  createdAt: string
  mediaUrl: string | null
  mediaType: string | null
}

export interface ThreadBooking extends ConversationBooking {
  leadName: string | null
  arrivalDate: string
  departureDate: string
}

/**
 * Another number carrying messages for the same booking as the open thread.
 * These exist whenever staff messaged a booking from a second line (an agent's
 * number, or one typed by hand in the booking panel) — the booking page's mini
 * chat lumps them all together because it keys on bookingRef, so without this
 * the phone-keyed inbox looks stale next to it.
 */
export interface RelatedThread {
  phone: string
  bookingRef: string
  displayName: string | null
  messageCount: number
  lastAt: string
}

export interface WaTemplate {
  name: string
  language: string
  status: string
  category: string | null
  headerFormat: string | null
  headerText: string
  bodyText: string
  bodyVariableCount: number
  headerVariableCount: number
}

/** A message the desk sent that the server hasn't confirmed yet. */
export interface PendingMessage {
  tempId: string
  phone: string
  body: string
  fileName: string | null
  createdAt: string
  state: 'sending' | 'failed'
  error?: string
}

export interface QuickReply {
  id: string
  shortcut: string
  text: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CONV_POLL_MS = 8000
export const THREAD_POLL_MS = 5000
export const WA_TEXT_LIMIT = 4096

/** Subtle chat-wallpaper dot grid, as an inline style so no global CSS is needed. */
export const DOODLE_BG = {
  backgroundImage:
    'radial-gradient(rgba(15,23,42,0.05) 1px, transparent 1px), radial-gradient(rgba(16,185,129,0.06) 1px, transparent 1px)',
  backgroundSize: '22px 22px, 22px 22px',
  backgroundPosition: '0 0, 11px 11px',
} as const

const AVATAR_GRADIENTS = [
  ['#10b981', '#047857'], ['#3b82f6', '#1d4ed8'], ['#8b5cf6', '#6d28d9'], ['#f43f5e', '#be123c'],
  ['#f59e0b', '#b45309'], ['#06b6d4', '#0e7490'], ['#ec4899', '#be185d'], ['#6366f1', '#4338ca'],
]

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-hello', shortcut: 'hello', text: 'Hello! Thank you for contacting Apple Holidays. How can we help you today?' },
  { id: 'qr-check', shortcut: 'check', text: 'Thank you — let me check this with the team and get back to you shortly.' },
  { id: 'qr-driver', shortcut: 'driver', text: 'Your driver details will be shared with you before the pickup time.' },
  { id: 'qr-thanks', shortcut: 'thanks', text: 'Thank you for travelling with Apple Holidays. Have a wonderful trip!' },
]

export const EMOJIS = [
  '😊', '😀', '🙏', '👍', '👌', '🙌', '👏', '❤️', '🎉', '✨', '✅', '❌',
  '⚠️', '📍', '🕐', '📅', '✈️', '🚗', '🏨', '🧳', '🌴', '📄', '📞', '💬',
]

// ─── Helpers ────────────────────────────────────────────────────────────────

export function countPlaceholders(s: string): number {
  const matches = s.match(/\{\{\s*\d+\s*\}\}/g)
  return matches ? new Set(matches).size : 0
}

// Singapore & Malaysia are one shared ops team (see lib/country-detection.ts) —
// collapse both (and the legacy combined value) into one group here too, so
// the country tabs match how the rest of the app already scopes by country.
export const UNASSIGNED = 'UNASSIGNED'
export function countryGroupKey(oc: OperationCountry | null | undefined): string {
  if (!oc || oc === 'ALL') return UNASSIGNED
  if (oc === 'SINGAPORE' || oc === 'MALAYSIA' || oc === 'SINGAPORE_MALAYSIA') return 'SINGAPORE_MALAYSIA'
  return oc
}

export function avatarGradient(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const [a, b] = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

export function initials(name: string | null, phone: string) {
  const n = (name ?? '').trim()
  if (n) return n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return phone.slice(-2)
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtDayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA')
}

export function fmtDayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (fmtDayKey(iso) === fmtDayKey(now.toISOString())) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (fmtDayKey(iso) === fmtDayKey(y.toISOString())) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

/** List timestamp: time today, "Yesterday", weekday this week, else a date. */
export function fmtListStamp(iso: string) {
  const d = new Date(iso)
  const label = fmtDayLabel(iso)
  if (label === 'Today') return fmtTime(iso)
  if (label === 'Yesterday') return 'Yesterday'
  if (Date.now() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

export function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Cheap change detector so a poll that returns the same data doesn't re-render. */
export function messagesSignature(ms: WaMessage[]) {
  return ms.map(m => `${m.id}:${m.status}`).join('|')
}

export function conversationsSignature(cs: Conversation[]) {
  return cs.map(c => `${c.phone}:${c.updatedAt}:${c.unreadCount}:${c.booking?.bookingRef ?? ''}:${c.booking?.status ?? ''}`).join('|')
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeLocal(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

/** Short two-tone chime via WebAudio — no asset to ship. */
export function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const tone = (freq: number, start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + 0.25)
    }
    tone(880, 0)
    tone(1320, 0.12)
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch { /* audio unavailable */ }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
