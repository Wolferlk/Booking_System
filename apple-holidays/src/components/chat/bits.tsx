'use client'

/**
 * The small pieces every chat surface shares.
 *
 * Two accents carry meaning here and are never used decoratively: teal is
 * Accounts, indigo is Operations. You should be able to tell which side of the
 * business someone is writing from without reading a word.
 */

import { motion } from 'framer-motion'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ChatConversation, ChatPerson } from './types'

/* ── the aurora ────────────────────────────────────────────────────────────── */

/**
 * Three blurred blobs on long, offset drifts behind a header. The periods are
 * coprime, so the pattern never visibly repeats.
 */
export function Aurora({ className }: { className?: string }) {
  const blobs: Array<{
    size: number; color: string; dur: number; dx: number; dy: number
    top?: number | string; left?: number | string; right?: number | string; bottom?: number | string
  }> = [
    { size: 320, top: -140, left: -60, color: '#5eead4', dur: 19, dx: 70, dy: 34 },
    { size: 260, top: -110, right: '6%', color: '#818cf8', dur: 23, dx: -58, dy: 44 },
    { size: 300, bottom: -190, left: '42%', color: '#38bdf8', dur: 29, dx: 46, dy: -40 },
  ]
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      {blobs.map((b, i) => (
        <motion.i
          key={i}
          className="absolute block rounded-full"
          style={{
            width: b.size, height: b.size,
            top: b.top, left: b.left, right: b.right, bottom: b.bottom,
            background: `radial-gradient(circle, ${b.color}, transparent 68%)`,
            filter: 'blur(46px)', opacity: 0.55,
          }}
          animate={{ x: [0, b.dx, 0], y: [0, b.dy, 0], scale: [1, 1.16, 1] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

/* ── avatars ───────────────────────────────────────────────────────────────── */

const SIZES = { 28: 'w-7 h-7 text-[.6rem]', 34: 'w-[34px] h-[34px] text-[.68rem]', 40: 'w-10 h-10 text-[.78rem]', 48: 'w-12 h-12 text-sm', 52: 'w-[52px] h-[52px] text-[.95rem]' } as const

export function Avatar({ person, size = 34 }: { person: ChatPerson; size?: keyof typeof SIZES }) {
  // A broken photo must never become a broken-image icon.
  const [failed, setFailed] = useState(false)
  const showImage = person.avatar && !failed

  return (
    <span
      className={cn(
        'relative inline-flex flex-shrink-0 items-center justify-center rounded-full font-extrabold text-white select-none',
        SIZES[size],
        person.system === 'ops'
          ? 'bg-gradient-to-br from-indigo-900 to-indigo-600'
          : 'bg-gradient-to-br from-slate-900 to-teal-800',
      )}
      title={`${person.name}${person.role_label ? ` · ${person.role_label}` : ''}`}
    >
      {/* Avatars come from two different hosts — this app and the Accounts app —
          and next/image would need every one of them declared as a remote
          pattern for no benefit at 34 pixels wide. */}
      {showImage
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={person.avatar!} alt={person.name} onError={() => setFailed(true)} className="h-full w-full rounded-full object-cover" />
        : person.initials}

      <span
        className={cn(
          'absolute -bottom-px -right-px h-1/3 w-1/3 min-h-[9px] min-w-[9px] rounded-full border-2 border-white',
          person.is_online ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        {/* The halo expands, the dot itself never moves — a pulsing dot beside
            text is distracting, an expanding ring is not. */}
        {person.is_online && (
          <motion.span
            className="absolute -inset-[3px] rounded-full border-2 border-emerald-500"
            animate={{ scale: [0.7, 2.1], opacity: [0.9, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </span>
    </span>
  )
}

/** A group gets a coloured tile with an emoji — an icon that cannot expire. */
export function ConversationAvatar({ conversation, size = 40 }: { conversation: ChatConversation; size?: keyof typeof SIZES }) {
  if (conversation.type === 'group') {
    return (
      <span
        className={cn(
          'inline-flex flex-shrink-0 items-center justify-center rounded-xl text-white',
          SIZES[size],
        )}
        style={{ background: `linear-gradient(135deg, #0d9488, ${conversation.accent || '#6366f1'})`, fontSize: Number(size) / 2.4 }}
      >
        {conversation.emoji || '💬'}
      </span>
    )
  }
  return conversation.peer
    ? <Avatar person={conversation.peer} size={size} />
    : <span className={cn('inline-flex items-center justify-center rounded-full bg-slate-300 text-white', SIZES[size])}>?</span>
}

/* ── badges ────────────────────────────────────────────────────────────────── */

export function SystemBadge({ system, label }: { system: string; label?: string }) {
  const isOps = system === 'ops'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-[7px] py-[2px] text-[.55rem] font-extrabold uppercase tracking-[.09em]',
        isOps
          ? 'border-indigo-300/60 bg-indigo-50 text-indigo-700'
          : 'border-teal-300/60 bg-teal-50 text-teal-700',
      )}
    >
      {label ?? (isOps ? 'OPS' : 'ACC')}
    </span>
  )
}

const TONES: Record<string, string> = {
  good: 'border-emerald-300/60 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-300/60 bg-amber-50 text-amber-700',
  bad: 'border-rose-300/60 bg-rose-50 text-rose-700',
  ghost: 'border-slate-200 bg-transparent text-slate-500',
  neutral: 'border-slate-200 bg-slate-100 text-slate-600',
}

export function Chip({ label, tone = 'neutral', className }: { label: string; tone?: string; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[.62rem] font-extrabold uppercase tracking-wide',
      TONES[tone] ?? TONES.neutral, className,
    )}>
      {label}
    </span>
  )
}

export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-1.5 text-[.62rem] font-extrabold text-white shadow-[0_4px_10px_-3px_rgba(244,63,94,.8)]"
    >
      {count > 99 ? '99+' : count}
    </motion.span>
  )
}

/** The three-dot "…is typing" animation. */
export function TypingDots() {
  return (
    <span className="inline-flex gap-[3px]">
      {[0, 0.16, 0.32].map(delay => (
        <motion.i
          key={delay}
          className="block h-1.5 w-1.5 rounded-full bg-indigo-500"
          animate={{ y: [0, -6, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut', delay }}
        />
      ))}
    </span>
  )
}

/* ── formatting ────────────────────────────────────────────────────────────── */

/** The shortest label that is still unambiguous. */
export function shortTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' })
}

export function clockTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

export function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Bare URLs become links. Everything else stays text — nothing is set as HTML. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{part}</a>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
