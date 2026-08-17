'use client'

/**
 * The composer.
 *
 * Everything you can put in a message lives here: text, files of any type,
 * pasted or dropped images, a recorded voice note, and the openable record card
 * that is the reason this chat exists.
 *
 * Uploads happen BEFORE the message is sent. The progress ring runs while the
 * caption is still being typed, so pressing send is instant and the server only
 * has to adopt attachment ids.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudUpload, Mic, Paperclip, Receipt, Send, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatApi, useChat } from './chat-store'
import { mmss } from './bits'
import type { ChatMessage, PendingAttachment, StagedCard } from './types'

export interface ComposerHandle { stageCard: (card: StagedCard) => void }

export function Composer({
  conversationId, compact, replyTo, onClearReply, onSend, onError,
}: {
  conversationId: number
  compact?: boolean
  replyTo: ChatMessage | null
  onClearReply: () => void
  onSend: (payload: {
    body: string | null
    kind: string
    client_uuid: string
    reply_to_id: number | null
    attachment_ids: number[]
    card_type: string | null
    card_ref: string | null
  }) => void
  onError: (message: string) => void
}) {
  const { config, settings, setTyping } = useChat()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [card, setCard] = useState<StagedCard | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cardBoxOpen, setCardBoxOpen] = useState(false)
  const [recorder, setRecorder] = useState<null | { stop: (discard?: boolean) => void }>(null)
  const [recSeconds, setRecSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(40).fill(0.1))

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const dragDepth = useRef(0)

  const canSend = Boolean(text.trim() || pending.some(p => !p.uploading) || card)

  /* ---- uploads ----------------------------------------------------------- */

  const upload = useCallback(async (
    files: File[],
    extra?: { durationMs: number; waveform: number[] },
  ): Promise<number[]> => {
    if (!files.length) return []

    const placeholders: PendingAttachment[] = files.map(f => ({
      uploading: true as const, name: f.name, progress: 4, localId: `${Date.now()}-${f.name}-${Math.random()}`,
    }))
    setPending(prev => [...prev, ...placeholders])
    const localIds = new Set(placeholders.map(p => (p as { localId: string }).localId))

    const form = new FormData()
    form.append('conversation_id', String(conversationId))
    files.forEach(f => form.append('files[]', f))
    if (extra) {
      form.append('duration_ms', String(extra.durationMs))
      extra.waveform.forEach(v => form.append('waveform[]', String(v)))
    }

    return new Promise<number[]>(resolve => {
      // XMLHttpRequest rather than fetch purely for upload progress events — the
      // ring is worth the older API.
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/chat/uploads')

      xhr.upload.addEventListener('progress', e => {
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 100)
        setPending(prev => prev.map(p =>
          p.uploading && localIds.has((p as { localId: string }).localId) ? { ...p, progress: pct } : p))
      })

      const finish = (attachments: PendingAttachment[], error?: string) => {
        setPending(prev => [
          ...prev.filter(p => !(p.uploading && localIds.has((p as { localId: string }).localId))),
          ...attachments,
        ])
        if (error) onError(error)
        resolve(attachments.map(a => (a as { id: number }).id).filter(Boolean))
      }

      xhr.addEventListener('load', () => {
        let json: { attachments?: PendingAttachment[]; message?: string } = {}
        try { json = JSON.parse(xhr.responseText) } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300) finish(json.attachments ?? [])
        else finish([], json.message ?? `Upload failed — files must be under ${config.max_upload_mb} MB.`)
      })

      xhr.addEventListener('error', () => finish([], 'Upload failed — check your connection.'))
      xhr.send(form)
    })
  }, [conversationId, config.max_upload_mb, onError])

  /* ---- drag & drop + paste ---------------------------------------------- */

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.activeElement !== inputRef.current) return
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter(i => i.kind === 'file')
        .map(i => i.getAsFile())
        .filter((f): f is File => Boolean(f))
      if (files.length) { e.preventDefault(); void upload(files) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [upload])

  /* ---- voice recording --------------------------------------------------- */

  const startRecording = async () => {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      onError('This browser cannot record audio.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError('Microphone permission was declined.')
      return
    }

    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const started = Date.now()
    // Sampled DURING the recording, so playback can draw the shape without ever
    // decoding the audio.
    const peaks: number[] = []
    let discarded = false

    const audioCtx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)

    let raf = 0
    const draw = () => {
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
      peaks.push(Math.round(Math.min(1, peak * 1.7) * 100) / 100)
      // The meter scrolls: the newest sample enters from the right.
      setLevels(prev => [...prev.slice(1), Math.max(0.1, Math.min(1, peak * 1.9))])
      setRecSeconds(Date.now() - started)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach(t => t.stop())
      void audioCtx.close().catch(() => {})
      setRecorder(null)
      setLevels(Array(40).fill(0.1))
      setRecSeconds(0)
      if (discarded) return

      const duration = Date.now() - started
      if (duration < 600) { onError('Too short — hold on a moment longer.'); return }

      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const ext = (rec.mimeType || '').includes('ogg') ? 'ogg' : 'webm'
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type })

      // Down-sample to a fixed 34 bars so every voice note has the same visual
      // density regardless of length.
      const step = Math.max(1, Math.floor(peaks.length / 34))
      const waveform: number[] = []
      for (let i = 0; i < peaks.length; i += step) waveform.push(peaks[i])

      const ids = await upload([file], { durationMs: duration, waveform: waveform.slice(0, 34) })
      if (ids.length) {
        onSend({
          body: null, kind: 'voice', client_uuid: crypto.randomUUID(),
          reply_to_id: replyTo?.id ?? null, attachment_ids: ids, card_type: null, card_ref: null,
        })
        setPending([])
        onClearReply()
      }
    }

    rec.start()
    setRecorder({ stop: (discard) => { discarded = Boolean(discard); rec.stop() } })
  }

  /* ---- send -------------------------------------------------------------- */

  const submit = () => {
    const body = text.trim()
    const attachmentIds = pending.filter(p => !p.uploading).map(p => (p as { id: number }).id)
    if (!body && !attachmentIds.length && !card) return

    const kind = card ? 'card'
      : attachmentIds.length
        ? (pending.length === 1 && (pending[0] as { kind?: string }).kind === 'audio' ? 'voice' : 'media')
        : 'text'

    onSend({
      body: body || null,
      kind,
      client_uuid: crypto.randomUUID(),
      reply_to_id: replyTo?.id ?? null,
      attachment_ids: attachmentIds,
      card_type: card?.type ?? null,
      card_ref: card?.ref ?? null,
    })

    setText('')
    setPending([])
    setCard(null)
    onClearReply()
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  /* ---- render ------------------------------------------------------------ */

  return (
    <div
      className={cn('relative flex-shrink-0 border-t border-slate-200 bg-white', compact ? 'px-2.5 pb-2.5 pt-2' : 'px-4 pb-3 pt-3')}
      onDragEnter={e => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
        e.preventDefault(); dragDepth.current++; setDragging(true)
      }}
      onDragOver={e => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault() }}
      onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false) }}
      onDrop={e => {
        if (!e.dataTransfer?.files.length) return
        e.preventDefault(); dragDepth.current = 0; setDragging(false)
        void upload(Array.from(e.dataTransfer.files))
      }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2.5 rounded-2xl border-[2.5px] border-dashed border-teal-500 bg-teal-50/95 text-sm font-extrabold text-teal-700"
          >
            <motion.span animate={{ y: [0, -8, 0] }} transition={{ duration: 1.3, repeat: Infinity }}>
              <CloudUpload className="h-8 w-8" />
            </motion.span>
            Drop to attach — any file type, kept {config.media_ttl_days} days
          </motion.div>
        )}
      </AnimatePresence>

      {/* reply bar */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-2 flex items-center gap-2.5 rounded-xl border-l-[3px] border-indigo-500 bg-indigo-50/70 px-3 py-1.5 text-[.74rem]"
          >
            <div className="min-w-0">
              <b className="block text-[.68rem]">Replying to {replyTo.sender.name}</b>
              <span className="block truncate opacity-75">{replyTo.body ?? '(attachment)'}</span>
            </div>
            <button onClick={onClearReply} className="ml-auto rounded-lg p-1 text-slate-500 hover:bg-white"><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* staged attachments and card */}
      {(pending.length > 0 || card) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <motion.div
              key={p.uploading ? (p as { localId: string }).localId : (p as { id: number }).id}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-2.5 text-[.72rem] font-bold"
            >
              {p.uploading ? (
                <>
                  <span
                    className="relative h-6 w-6 flex-shrink-0 rounded-full"
                    style={{ background: `conic-gradient(#0d9488 ${p.progress}%, #e2e8f0 0)` }}
                  >
                    <span className="absolute inset-1 rounded-full bg-slate-50" />
                  </span>
                  <span className="max-w-[140px] truncate">{p.name}</span>
                </>
              ) : (
                <>
                  {(p as { kind: string }).kind === 'image' && (p as { url: string | null }).url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={(p as { url: string }).url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                    : <Paperclip className="h-3.5 w-3.5 text-teal-600" />}
                  <span className="max-w-[140px] truncate">{(p as { name: string }).name}</span>
                  <button onClick={() => setPending(prev => prev.filter((_, j) => j !== i))} className="text-rose-500"><X className="h-3 w-3" /></button>
                </>
              )}
            </motion.div>
          ))}

          {card && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 text-[.72rem] font-bold"
              style={{ borderColor: config.cards[card.type]?.accent ?? '#6366f1' }}
            >
              <Receipt className="h-3.5 w-3.5" style={{ color: config.cards[card.type]?.accent }} />
              {config.cards[card.type]?.label ?? 'Record'} · {card.ref}
              <button onClick={() => setCard(null)} className="text-rose-500"><X className="h-3 w-3" /></button>
            </motion.div>
          )}
        </div>
      )}

      {/* the record-card picker */}
      <AnimatePresence>
        {cardBoxOpen && (
          <CardPicker
            onPick={c => { setCard(c); setCardBoxOpen(false); inputRef.current?.focus() }}
            onClose={() => setCardBoxOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* input row, or the recorder */}
      {recorder ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 items-center gap-3 rounded-[20px] border-[1.5px] border-rose-300 bg-rose-50/70 px-3.5 py-2">
            <motion.span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-rose-500"
              animate={{ opacity: [1, 0.35, 1], scale: [1, 0.78, 1] }}
              transition={{ duration: 1.1, repeat: Infinity }}
            />
            <span className="min-w-[46px] text-sm font-extrabold tabular-nums text-rose-700">{mmss(recSeconds)}</span>
            <div className="flex h-[26px] flex-1 items-center gap-[2px]">
              {levels.map((v, i) => (
                <span key={i} className="min-w-[2px] flex-1 rounded-sm bg-rose-400/60 transition-transform duration-75" style={{ height: '100%', transform: `scaleY(${v})` }} />
              ))}
            </div>
            <button onClick={() => recorder.stop(true)} className="rounded-lg p-1.5 text-rose-600 hover:bg-white" title="Discard">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => recorder.stop(false)}
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-600 to-teal-700 text-white shadow-lg transition active:scale-90"
            title="Send voice message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 items-end gap-1.5 rounded-[20px] border-[1.5px] border-slate-200 bg-slate-50 py-1 pl-3.5 pr-1.5 transition focus-within:border-teal-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-teal-500/10">
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              placeholder={compact ? 'Message…' : 'Write a message, drop a file, or share a record…'}
              onChange={e => {
                setText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(148, e.target.scrollHeight)}px`
                // Typing is a lease renewed by the next pulse; nothing is sent here.
                setTyping(conversationId)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && settings.enter_to_send !== false) { e.preventDefault(); submit() }
                if (e.key === 'Escape' && replyTo) onClearReply()
              }}
              className="max-h-[148px] flex-1 resize-none border-none bg-transparent py-1.5 text-[.86rem] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
            />

            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }}
            />

            <IconButton title="Attach a file" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></IconButton>
            <IconButton title="Share an invoice, P&L, booking or agenda" active={cardBoxOpen} onClick={() => setCardBoxOpen(v => !v)}>
              <Receipt className="h-4 w-4" />
            </IconButton>
            <IconButton title="Record a voice message" onClick={() => void startRecording()}><Mic className="h-4 w-4" /></IconButton>
          </div>

          <motion.button
            whileHover={canSend ? { scale: 1.08, rotate: 8 } : undefined}
            whileTap={canSend ? { scale: 0.9 } : undefined}
            disabled={!canSend}
            onClick={submit}
            className={cn(
              'grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-white transition',
              canSend
                ? 'bg-gradient-to-br from-teal-600 to-teal-700 shadow-[0_8px_18px_-8px_rgba(13,148,136,.95)]'
                : 'cursor-not-allowed bg-slate-300',
            )}
            title="Send"
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </div>
      )}
    </div>
  )
}

function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl transition active:scale-90',
        active ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

/* ── the record picker ─────────────────────────────────────────────────────── */

/**
 * Pick a record to send: choose the kind, type an IS number, confirm it resolves.
 *
 * The preview call is what stops an unresolvable reference being sent — a card
 * that opens onto nothing is worse than no card.
 */
function CardPicker({ onPick, onClose }: { onPick: (card: StagedCard) => void; onClose: () => void }) {
  const { config } = useChat()
  const types = Object.keys(config.cards)
  const [type, setType] = useState(types.includes('pnl') ? 'pnl' : types[0] ?? 'pnl')
  const [ref, setRef] = useState('')
  const [status, setStatus] = useState('')
  const [suggestions, setSuggestions] = useState<Array<{ ref: string; label: string | null }>>([])

  useEffect(() => {
    if (ref.trim().length < 2) { setSuggestions([]); setStatus(''); return }
    const t = setTimeout(() => {
      setStatus('Searching…')
      chatApi<{ suggestions: Array<{ ref: string; label: string | null }> }>(
        `/cards/suggest?type=${type}&q=${encodeURIComponent(ref.trim())}`,
      )
        .then(d => {
          setSuggestions(d.suggestions ?? [])
          setStatus(d.suggestions?.length ? '' : 'Nothing matches yet — the exact reference will still work.')
        })
        .catch(() => setStatus(''))
    }, 240)
    return () => clearTimeout(t)
  }, [ref, type])

  const attach = (value: string) => {
    setStatus('Checking the record…')
    chatApi(`/cards/preview?type=${type}&ref=${encodeURIComponent(value)}`)
      .then(() => onPick({ type, ref: value.toUpperCase() }))
      .catch(err => setStatus(err.message))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute bottom-full left-3.5 right-3.5 z-50 mb-2.5 max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="bg-gradient-to-br from-slate-900 to-teal-900 px-4 py-3 text-white">
        <b className="text-[.82rem] font-extrabold">Share a record</b>
        <p className="mt-0.5 text-[.68rem] text-teal-200">The other person opens it live, in whichever system they are in.</p>
      </div>

      <div className="grid grid-cols-4 gap-1.5 px-3.5 pb-1.5 pt-3">
        {types.map(key => (
          <button
            key={key}
            onClick={() => setType(key)}
            className={cn(
              'rounded-xl border-[1.5px] px-1.5 py-2.5 text-center transition hover:-translate-y-0.5',
              type === key ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:border-teal-200',
            )}
          >
            <Receipt className="mx-auto mb-1 h-4 w-4" style={{ color: config.cards[key]?.accent }} />
            <span className="text-[.64rem] font-extrabold">{config.cards[key]?.label ?? key}</span>
          </button>
        ))}
      </div>

      <div className="px-3.5 pb-3.5 pt-1.5">
        <input
          autoFocus
          value={ref}
          onChange={e => setRef(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (ref.trim()) attach(ref.trim()) }
            if (e.key === 'Escape') onClose()
          }}
          placeholder="IS number, e.g. IS48541"
          className="w-full rounded-xl border-[1.5px] border-slate-200 px-3.5 py-2.5 text-[.88rem] font-bold uppercase tracking-wide outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
        />

        {!!suggestions.length && (
          <div className="mt-1.5 max-h-[168px] overflow-y-auto">
            {suggestions.map(s => (
              <button
                key={s.ref}
                onClick={() => attach(s.ref)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-100"
              >
                <Receipt className="h-3.5 w-3.5 flex-shrink-0" style={{ color: config.cards[type]?.accent }} />
                <span className="min-w-0">
                  <b className="block text-[.78rem] font-extrabold">{s.ref}</b>
                  <span className="block truncate text-[.68rem] text-slate-500">{s.label ?? ''}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {status && <div className="mt-2 min-h-[18px] text-[.7rem] text-slate-500">{status}</div>}
      </div>
    </motion.div>
  )
}
