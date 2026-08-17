'use client'

/**
 * One message, in every shape it can take: text, files, images, a voice note, an
 * openable record card, or a generated system line.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, Bolt, Download, FileArchive, FileImage, FileSpreadsheet, FileText,
  FileType, Hourglass, Pause, Pencil, Play, Reply, Smile, Trash2, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, Linkified, SystemBadge, clockTime, mmss } from './bits'
import type { ChatAttachment, ChatMessage } from './types'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥']

const FILE_ICON = {
  pdf: FileText, sheet: FileSpreadsheet, doc: FileType, archive: FileArchive,
  video: Video, image: FileImage, audio: FileText, other: FileText,
} as const

const FILE_TINT: Record<string, string> = {
  pdf: 'from-rose-500 to-rose-700',
  sheet: 'from-emerald-500 to-emerald-700',
  doc: 'from-blue-500 to-blue-700',
  archive: 'from-amber-500 to-amber-700',
  video: 'from-violet-500 to-violet-700',
  other: 'from-slate-500 to-slate-700',
}

/* ── voice note ────────────────────────────────────────────────────────────── */

/**
 * The bars come from the waveform captured while recording, so the player paints
 * its shape before a single byte of audio is fetched — and the bar strip doubles
 * as the scrubber.
 */
function VoiceNote({ attachment, mine }: { attachment: ChatAttachment; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ratio, setRatio] = useState(0)
  const [label, setLabel] = useState(attachment.duration_ms ? mmss(attachment.duration_ms) : '0:00')

  const bars = attachment.waveform?.length
    ? attachment.waveform
    : Array.from({ length: 34 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 1.7)) * 0.7)

  useEffect(() => () => { audioRef.current?.pause() }, [])

  const toggle = () => {
    if (!attachment.url) return
    if (!audioRef.current) {
      audioRef.current = new Audio(attachment.url)
      audioRef.current.addEventListener('timeupdate', () => {
        const a = audioRef.current!
        if (!a.duration || !Number.isFinite(a.duration)) return
        setRatio(a.currentTime / a.duration)
        setLabel(mmss((a.duration - a.currentTime) * 1000))
      })
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false); setRatio(0)
        setLabel(attachment.duration_ms ? mmss(attachment.duration_ms) : '0:00')
      })
    }
    if (audioRef.current.paused) {
      // Only one voice note at a time — two people talking over each other out of
      // one thread is nobody's idea of a feature.
      document.querySelectorAll('audio[data-chat-voice]').forEach(el => (el as HTMLAudioElement).pause())
      audioRef.current.setAttribute('data-chat-voice', '1')
      void audioRef.current.play()
      setPlaying(true)
    } else {
      audioRef.current.pause()
      setPlaying(false)
    }
  }

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a?.duration || !Number.isFinite(a.duration)) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
  }

  const playedUpTo = Math.floor(ratio * bars.length)

  return (
    <div className={cn(
      'flex min-w-[234px] max-w-[330px] items-center gap-3 rounded-full border py-1.5 pl-2 pr-4',
      mine ? 'border-white/25 bg-white/15' : 'border-slate-200 bg-white',
    )}>
      <button
        onClick={toggle}
        className={cn(
          'grid h-9 w-9 flex-shrink-0 place-items-center rounded-full transition active:scale-90',
          mine ? 'bg-white text-teal-700' : 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white',
        )}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <div className="flex h-[30px] flex-1 cursor-pointer items-center gap-[2px]" onClick={scrub}>
        {bars.map((v, i) => (
          <span
            key={i}
            className={cn(
              'min-w-[2px] flex-1 rounded-sm transition-colors',
              i <= playedUpTo
                ? (mine ? 'bg-white' : 'bg-indigo-500')
                : (mine ? 'bg-white/40' : 'bg-slate-300'),
            )}
            style={{ height: `${Math.round(Math.max(0.12, Math.min(1, v)) * 100)}%` }}
          />
        ))}
      </div>

      <span className="min-w-[34px] text-right text-[.64rem] font-extrabold tabular-nums opacity-80">{label}</span>
    </div>
  )
}

/* ── attachments ───────────────────────────────────────────────────────────── */

function AttachmentView({
  attachment, mine, ttlDays, onLightbox,
}: { attachment: ChatAttachment; mine: boolean; ttlDays: number; onLightbox: (a: ChatAttachment) => void }) {
  if (attachment.expired) {
    return (
      <div
        className="flex max-w-[330px] items-center gap-2.5 rounded-2xl border border-dashed border-slate-300 px-3.5 py-2.5 text-[.74rem] font-semibold text-slate-500"
        style={{ background: 'repeating-linear-gradient(45deg,#f8fafc,#f8fafc 8px,#f1f5f9 8px,#f1f5f9 16px)' }}
      >
        <Hourglass className="h-4 w-4 flex-shrink-0" />
        <div>
          <div>{attachment.name}</div>
          <div className="text-[.62rem] opacity-80">Expired — chat media is kept for {ttlDays} days</div>
        </div>
      </div>
    )
  }

  if (attachment.kind === 'image') {
    return (
      <button
        onClick={() => onLightbox(attachment)}
        className="group relative block max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- chat media is
            served from an authenticated route on this host; next/image would
            re-proxy every frame of a conversation for no benefit. */}
        <img
          src={attachment.thumb_url ?? attachment.url ?? ''}
          alt={attachment.name}
          loading="lazy"
          className="block max-h-[340px] w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute inset-0 grid place-items-center bg-slate-900/35 opacity-0 transition group-hover:opacity-100">
          <ArrowUpRight className="h-6 w-6 text-white" />
        </span>
      </button>
    )
  }

  if (attachment.kind === 'audio') return <VoiceNote attachment={attachment} mine={mine} />

  const Icon = FILE_ICON[attachment.kind] ?? FILE_ICON.other

  return (
    <a
      href={`${attachment.url}${attachment.url?.includes('?') ? '&' : '?'}download=1`}
      target="_blank"
      rel="noopener noreferrer"
      title={attachment.name}
      className="flex min-w-[210px] max-w-[330px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-slate-900 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg"
    >
      <span className={cn('grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', FILE_TINT[attachment.kind] ?? FILE_TINT.other)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[.78rem] font-bold">{attachment.name}</span>
        <span className="block text-[.62rem] text-slate-500">
          {attachment.size_label}
          {' · '}
          {/* The countdown to the 10-day purge, so nobody is surprised by it. */}
          <span className={attachment.days_left <= 2 ? 'font-bold text-rose-600' : 'font-bold text-amber-600'}>
            {attachment.days_left}d left
          </span>
        </span>
      </span>
      <Download className="h-3.5 w-3.5 text-slate-400" />
    </a>
  )
}

/* ── the record card bubble ────────────────────────────────────────────────── */

function RecordCard({ message, onOpen }: { message: ChatMessage; onOpen: () => void }) {
  const card = message.card!
  const p = card.preview ?? {}

  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      className="group relative w-full max-w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-[0_10px_26px_-16px_rgba(15,23,42,.45)]"
    >
      {/* A slow sheen crossing the card, so it reads as something to open rather
          than as another paragraph of text. */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/55 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

      <div
        className="relative flex items-center gap-2.5 overflow-hidden px-3.5 py-2.5 text-white"
        style={{ background: `linear-gradient(120deg, #0f172a, ${card.accent} 150%)` }}
      >
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl bg-white/20">
          <Bolt className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[.58rem] font-extrabold uppercase tracking-[.12em] opacity-85">{card.label}</span>
          <span className="block truncate text-[.95rem] font-extrabold tracking-tight">{p.title ?? card.ref}</span>
        </span>
        <span className="z-10 ml-auto flex items-center gap-1.5 rounded-full border border-white/30 bg-white/20 px-2.5 py-1 text-[.6rem] font-extrabold uppercase tracking-wide transition group-hover:bg-white group-hover:text-slate-900">
          <ArrowUpRight className="h-3 w-3" /> Open
        </span>
      </div>

      <div className="px-3.5 pb-3 pt-2.5">
        {p.subtitle && <div className="mb-2 truncate text-[.76rem] font-bold text-slate-900">{p.subtitle}</div>}
        {!!p.meta?.length && (
          <div className="flex flex-wrap gap-3.5">
            {p.meta.map((m, i) => (
              <div key={i}>
                <span className="block text-[.55rem] font-extrabold uppercase tracking-[.08em] text-slate-400">{m.label}</span>
                <b className="text-[.8rem] font-extrabold text-slate-900">{m.value || '—'}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-dashed border-slate-200 bg-slate-50/70 px-3.5 py-2 text-[.6rem] font-bold text-slate-400">
        <Bolt className="h-3 w-3" style={{ color: card.accent }} />
        Opens the live record
        {p.status && (
          <span className={cn(
            'ml-auto rounded-full px-2 py-[2px] text-[.58rem] font-extrabold uppercase',
            p.status_tone === 'good' ? 'bg-emerald-100 text-emerald-700'
              : p.status_tone === 'bad' ? 'bg-rose-100 text-rose-700'
              : p.status_tone === 'warn' ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-600',
          )}>
            {p.status}
          </span>
        )}
      </div>
    </motion.button>
  )
}

/* ── the message ───────────────────────────────────────────────────────────── */

export function MessageBubble({
  message, mine, isFirst, myKey, ttlDays,
  onReact, onReply, onEdit, onDelete, onOpenCard, onLightbox,
}: {
  message: ChatMessage
  mine: boolean
  isFirst: boolean
  myKey: string | null
  ttlDays: number
  onReact: (messageId: number, emoji: string) => void
  onReply: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onDelete: (messageId: number) => void
  onOpenCard: (type: string, ref: string) => void
  onLightbox: (a: ChatAttachment) => void
}) {
  const [showEmoji, setShowEmoji] = useState(false)

  if (message.kind === 'system') {
    return (
      <div className="my-3 text-center">
        <span className="inline-block rounded-full border border-slate-200 bg-white/80 px-3.5 py-1.5 text-[.68rem] font-semibold text-slate-500">
          {message.body}
        </span>
      </div>
    )
  }

  const fromOps = message.sender.system === 'ops'

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className={cn('group mb-[3px] flex gap-2.5', mine && 'flex-row-reverse', isFirst && 'mt-3.5')}
    >
      {/* Consecutive messages from one person hide the avatar but keep the column. */}
      <div className={cn(!isFirst && 'invisible h-0')}>
        <Avatar person={message.sender} size={34} />
      </div>

      <div className={cn('flex min-w-0 max-w-[74%] flex-col', mine && 'items-end')}>
        {isFirst && !mine && (
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[.72rem] font-extrabold text-slate-700">{message.sender.name}</span>
            <SystemBadge system={message.sender.system} />
            <span className="text-[.6rem] font-semibold text-slate-400">{clockTime(message.created_at)}</span>
          </div>
        )}

        {message.kind === 'card' && message.card ? (
          <RecordCard message={message} onOpen={() => onOpenCard(message.card!.type, message.card!.ref)} />
        ) : message.deleted ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-100 px-3.5 py-2.5 text-[.855rem] italic text-slate-500">
            This message was deleted
          </div>
        ) : (message.body || message.kind === 'text') ? (
          <div className={cn(
            'relative whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2.5 text-[.855rem] leading-relaxed',
            mine
              ? cn('rounded-br-md border-transparent text-white shadow-lg',
                   fromOps ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' : 'bg-gradient-to-br from-teal-600 to-teal-700')
              : cn('rounded-bl-md border bg-white text-slate-900 shadow-sm',
                   // A message from the other system is tinted, so a cross-system
                   // thread reads as one at a glance.
                   fromOps ? 'border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60' : 'border-teal-200 bg-gradient-to-br from-white to-teal-50/60'),
          )}>
            {message.reply_to && (
              <div className={cn(
                'mb-1.5 rounded-lg border-l-[3px] px-2.5 py-1 text-[.72rem] leading-snug',
                mine ? 'border-white/70 bg-white/20' : 'border-teal-300 bg-slate-900/5',
              )}>
                <b className="block text-[.64rem] opacity-85">{message.reply_to.sender}</b>
                <span className="opacity-80">{message.reply_to.preview}</span>
              </div>
            )}
            <Linkified text={message.body ?? ''} />
            {message.edited_at && <span className="ml-1.5 text-[.58rem] italic opacity-65">(edited)</span>}
          </div>
        ) : null}

        {!!message.attachments.length && (
          <div className={cn('mt-1.5 flex flex-col gap-2', mine && 'items-end')}>
            {message.attachments.map(a => (
              <AttachmentView key={a.id} attachment={a} mine={mine} ttlDays={ttlDays} onLightbox={onLightbox} />
            ))}
          </div>
        )}

        {!!message.reactions.length && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
            {message.reactions.map(r => {
              const isMine = myKey ? r.keys.includes(myKey) : false
              return (
                <motion.button
                  key={r.emoji}
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  whileHover={{ y: -2, scale: 1.06 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  title={r.people.join(', ')}
                  onClick={() => message.id && onReact(message.id, r.emoji)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[.72rem] font-bold',
                    isMine ? 'border-teal-400 bg-teal-100/70 text-teal-800' : 'border-slate-200 bg-white text-slate-700',
                  )}
                >
                  {r.emoji}<span>{r.count}</span>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>

      {/* hover toolbar */}
      {message.id && !message.deleted && (
        <div className="relative flex items-center gap-0.5 self-center opacity-0 transition group-hover:opacity-100">
          <button onClick={() => setShowEmoji(v => !v)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:-translate-y-0.5 hover:text-indigo-600" title="React">
            <Smile className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onReply(message)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:-translate-y-0.5 hover:text-indigo-600" title="Reply">
            <Reply className="h-3.5 w-3.5" />
          </button>
          {mine && message.kind === 'text' && (
            <button onClick={() => onEdit(message)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:-translate-y-0.5 hover:text-indigo-600" title="Edit">
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {mine && (
            <button onClick={() => onDelete(message.id!)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:-translate-y-0.5 hover:text-rose-600" title="Delete">
              <Trash2 className="h-3 w-3" />
            </button>
          )}

          <AnimatePresence>
            {showEmoji && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute bottom-full right-0 z-30 mb-2 flex gap-0.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                {QUICK_REACTIONS.map(e => (
                  <button
                    key={e}
                    onClick={() => { onReact(message.id!, e); setShowEmoji(false) }}
                    className="grid h-8 w-8 place-items-center rounded-lg text-lg transition hover:-translate-y-0.5 hover:scale-125 hover:bg-slate-100"
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}
