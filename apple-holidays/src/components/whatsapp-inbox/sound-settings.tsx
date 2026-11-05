'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, BellRing, Eye, Loader2, Music, Play, Trash2, Upload, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SOUND, MAX_CUSTOM_BYTES, MAX_VOLUME, TONES,
  isAudioBlocked, playTone, setCustomTone, toneLabel, updateSoundSettings, useSoundSettings,
  type ToneId,
} from './sound'

const PANEL_W = 316
const GUTTER = 12

/**
 * Bell button + popover for the new-message sound. `variant` only changes how
 * the trigger looks: `inbox` sits in the light inbox header, `mini` on the
 * green header of the booking-page mini chat.
 */
export function SoundSettingsButton({ variant }: { variant: 'inbox' | 'mini' }) {
  const [s, custom] = useSoundSettings()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const on = s.enabled && s.volume > 0

  const title = on
    ? `Message sound: ${toneLabel(s.tone, custom)} at ${s.volume}% — click to change`
    : 'Message sound is off — click to set it up'

  return (
    <>
      <motion.button
        ref={btnRef}
        type="button"
        whileTap={{ scale: 0.88 }}
        onClick={() => setOpen(o => !o)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'relative grid shrink-0 place-items-center transition',
          variant === 'inbox'
            ? cn('h-8 w-8 rounded-lg', on || open ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700')
            : cn('h-[26px] w-[26px] rounded-lg', open ? 'bg-white/25' : 'hover:bg-white/20'),
        )}
      >
        {on ? <BellRing className={variant === 'inbox' ? 'h-4 w-4' : 'h-3.5 w-3.5'} /> : <BellOff className={variant === 'inbox' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
        {on && s.volume > 100 && (
          <span className={cn('absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full', variant === 'inbox' ? 'bg-amber-500' : 'bg-amber-300')} />
        )}
      </motion.button>
      <SoundPanel open={open} anchor={btnRef} onClose={() => setOpen(false)} />
    </>
  )
}

function SoundPanel({ open, anchor, onClose }: { open: boolean; anchor: React.RefObject<HTMLElement>; onClose: () => void }) {
  const [s, custom] = useSoundSettings()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [playing, setPlaying] = useState<ToneId | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [uploading, setUploading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const playTimer = useRef<ReturnType<typeof setTimeout>>()

  // Fixed to the viewport and clamped inside it, so it works from the inbox's
  // narrow left column and from the mini chat at the screen's right edge.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const w = Math.min(PANEL_W, window.innerWidth - GUTTER * 2)
      const left = Math.max(GUTTER, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - GUTTER))
      const h = panelRef.current?.offsetHeight ?? 520
      const below = r.bottom + 8
      const top = below + h > window.innerHeight - GUTTER ? Math.max(GUTTER, window.innerHeight - h - GUTTER) : below
      setPos({ top, left })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    // Capture phase so the mini chat's own Esc handler doesn't minimise the chat too.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor, onClose])

  useEffect(() => () => clearTimeout(playTimer.current), [])

  async function preview(tone: ToneId = s.tone, volume = s.volume, repeat: number = 1) {
    clearTimeout(playTimer.current)
    setPlaying(tone)
    const ok = await playTone(tone, Math.max(volume, 1), repeat)
    // The context may still be warming up on the very first click.
    setTimeout(() => setBlocked(!ok && isAudioBlocked()), 150)
    playTimer.current = setTimeout(() => setPlaying(null), 900 * repeat)
  }

  function pick(tone: ToneId) {
    updateSoundSettings({ tone, enabled: true })
    void preview(tone)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('audio/')) { toast.error('Pick an audio file (mp3, wav, ogg, m4a)'); return }
    if (file.size > MAX_CUSTOM_BYTES) { toast.error(`Keep it under ${MAX_CUSTOM_BYTES / 1024} KB — a 1–3 second clip is ideal`); return }
    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(file)
      })
      // Make sure the browser can actually play it before we keep it.
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const probe = new Ctor()
      try { await probe.decodeAudioData(await file.arrayBuffer()) } finally { probe.close().catch(() => {}) }
      setCustomTone({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'My sound', dataUrl })
      updateSoundSettings({ tone: 'custom', enabled: true })
      void preview('custom')
      toast.success('Your sound is set')
    } catch (e) {
      toast.error(e instanceof Error && e.message.includes('room') ? e.message : "This browser can't play that file — try an mp3 or wav")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (typeof document === 'undefined') return null
  const boost = s.volume > 100
  const VolIcon = s.volume === 0 ? VolumeX : s.volume < 50 ? Volume1 : Volume2
  const fill = (s.volume / MAX_VOLUME) * 100

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="Message sound"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.14 }}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: `min(${PANEL_W}px, calc(100vw - ${GUTTER * 2}px))` }}
          className="fixed z-[1000] overflow-hidden rounded-2xl bg-white text-slate-700 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/10"
        >
          {/* Header + master switch */}
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-gradient-to-br from-emerald-50 to-white px-3.5 py-3">
            <div className={cn('grid h-8 w-8 place-items-center rounded-xl transition', s.enabled ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' : 'bg-slate-200 text-slate-500')}>
              {s.enabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold leading-tight text-slate-900">Message sound</p>
              <p className="truncate text-[11px] text-slate-500">
                {s.enabled ? `${toneLabel(s.tone, custom)} · ${s.volume}%${s.repeat > 1 ? ` · ${s.repeat}×` : ''}` : 'Off — new messages are silent'}
              </p>
            </div>
            <Switch checked={s.enabled} onChange={v => { updateSoundSettings({ enabled: v }); if (v) void preview() }} label="Sound on new messages" />
            <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Close (Esc)">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className={cn('space-y-3.5 px-3.5 py-3 transition', !s.enabled && 'pointer-events-none opacity-45 grayscale')}>
            {/* Volume */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Volume</span>
                <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums', boost ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                  {boost ? `Boost ${s.volume}%` : `${s.volume}%`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateSoundSettings({ volume: s.volume === 0 ? DEFAULT_SOUND.volume : 0 })}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                  title={s.volume === 0 ? 'Unmute' : 'Mute'}
                >
                  <VolIcon className="h-4 w-4" />
                </button>
                <div className="flex flex-1 items-center">
                  <input
                    type="range"
                    min={0}
                    max={MAX_VOLUME}
                    step={5}
                    value={s.volume}
                    onChange={e => updateSoundSettings({ volume: Number(e.target.value) })}
                    onPointerUp={() => void preview()}
                    onKeyUp={e => { if (e.key.startsWith('Arrow')) void preview() }}
                    aria-label="Volume"
                    className="wa-sound-range relative h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent"
                    style={{ background: trackFill(fill, boost) }}
                  />
                </div>
              </div>
              <div className="relative ml-9 mt-1 h-3 text-[10px] leading-3 text-slate-400">
                <span className="absolute left-0">Quiet</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${NORMAL_END}%` }}>100%</span>
                <span className="absolute right-0 text-amber-600">Boost</span>
              </div>
            </section>

            {/* Tones */}
            <section>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Tone</span>
              <div className="grid grid-cols-2 gap-1.5">
                {TONES.map(t => (
                  <ToneTile key={t.id} active={s.tone === t.id} playing={playing === t.id} emoji={t.emoji} label={t.label} hint={t.hint} onClick={() => pick(t.id)} />
                ))}
              </div>
              {custom ? (
                <div className="mt-1.5 flex gap-1.5">
                  <div className="min-w-0 flex-1">
                    <ToneTile active={s.tone === 'custom'} playing={playing === 'custom'} emoji="🎧" label={custom.name} hint="Your own sound" onClick={() => pick('custom')} />
                  </div>
                  <button type="button" onClick={() => fileRef.current?.click()} className="grid w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 hover:border-emerald-300 hover:text-emerald-600" title="Replace with another file">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" onClick={() => setCustomTone(null)} className="grid w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500" title="Remove your sound">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2 text-[12px] font-semibold text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-700"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />}
                  Use your own sound <span className="font-normal text-slate-400">(mp3/wav, ≤ {MAX_CUSTOM_BYTES / 1024} KB)</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            </section>

            {/* Repeat + viewing */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-slate-600">Ring</span>
                <div className="flex rounded-lg bg-slate-100 p-0.5">
                  {([1, 2, 3] as const).map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { updateSoundSettings({ repeat: n }); void preview(s.tone, s.volume, n) }}
                      className={cn('rounded-md px-2.5 py-1 text-[11px] font-bold transition', s.repeat === n ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
                    >
                      {n === 1 ? 'Once' : `${n}×`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                  <Eye className="h-3.5 w-3.5 text-slate-400" /> Ring for the chat I&apos;m viewing
                </span>
                <Switch small checked={s.whenViewing} onChange={v => updateSoundSettings({ whenViewing: v })} label="Ring for the chat I'm viewing" />
              </label>
            </section>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
            {blocked && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 ring-1 ring-amber-200">
                The browser is holding sound back. Click anywhere on this page once, then test again. Also check this tab isn&apos;t muted.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!s.enabled}
                onClick={() => void preview(s.tone, s.volume, s.repeat)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white shadow-sm shadow-emerald-600/30 transition hover:bg-emerald-700 active:scale-95 disabled:opacity-40"
              >
                <Play className="h-3 w-3 fill-current" /> Test sound
              </button>
              <p className="min-w-0 flex-1 text-[10.5px] leading-tight text-slate-400">
                For the inbox and booking chats in this browser. Nothing else changes.
              </p>
            </div>
          </div>

          <style>{`
            .wa-sound-range::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; background: transparent; }
            .wa-sound-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: -5px; height: 16px; width: 16px; border-radius: 9999px; background: #fff; border: 2px solid ${boost ? '#f59e0b' : '#10b981'}; box-shadow: 0 1px 4px rgba(15,23,42,.25); transition: transform .1s; }
            .wa-sound-range:active::-webkit-slider-thumb { transform: scale(1.15); }
            .wa-sound-range::-moz-range-track { height: 6px; border-radius: 9999px; background: transparent; }
            .wa-sound-range::-moz-range-thumb { height: 12px; width: 12px; border-radius: 9999px; background: #fff; border: 2px solid ${boost ? '#f59e0b' : '#10b981'}; }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const NORMAL_END = (100 / MAX_VOLUME) * 100

/** Filled part, then grey up to 100%, then a pale amber "boost" zone. */
function trackFill(fill: number, boost: boolean) {
  const c = boost ? '#f59e0b' : '#10b981'
  const stops = [`${c} 0%`, `${c} ${fill}%`]
  if (fill < NORMAL_END) stops.push(`#e2e8f0 ${fill}%`, `#e2e8f0 ${NORMAL_END}%`)
  stops.push(`#fde68a ${Math.max(fill, NORMAL_END)}%`, '#fde68a 100%')
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function ToneTile({ active, playing, emoji, label, hint, onClick }: { active: boolean; playing: boolean; emoji: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${hint} — click to choose and hear it`}
      className={cn(
        'group relative flex w-full items-center gap-2 overflow-hidden rounded-xl border px-2 py-1.5 text-left transition',
        active ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-500/15' : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50',
      )}
    >
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[15px] transition', active ? 'bg-white shadow-sm' : 'bg-slate-100 group-hover:bg-white')}>
        {playing ? <Equalizer /> : emoji}
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-[12px] font-bold leading-tight', active ? 'text-emerald-800' : 'text-slate-700')}>{label}</span>
        <span className="block truncate text-[10px] leading-tight text-slate-400">{hint}</span>
      </span>
    </button>
  )
}

/** Three bouncing bars while a tone is previewing. */
function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]">
      {[0, 0.15, 0.3].map(d => (
        <motion.span
          key={d}
          className="w-[3px] rounded-full bg-emerald-500"
          animate={{ height: ['30%', '100%', '45%', '85%', '30%'] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: d }}
        />
      ))}
    </span>
  )
}

function Switch({ checked, onChange, label, small }: { checked: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 rounded-full transition-colors',
        small ? 'h-5 w-9' : 'h-6 w-11',
        checked ? 'bg-emerald-500' : 'bg-slate-300',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        className={cn('absolute top-0.5 rounded-full bg-white shadow', small ? 'h-4 w-4' : 'h-5 w-5', checked ? (small ? 'left-[18px]' : 'left-[22px]') : 'left-0.5')}
      />
    </button>
  )
}
