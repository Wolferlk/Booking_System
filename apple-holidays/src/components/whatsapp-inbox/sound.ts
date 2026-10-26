'use client'

import { useSyncExternalStore } from 'react'

/**
 * New-message sound for the WhatsApp inbox (/dashboard/whatsapp) and the
 * booking-page mini chat. One set of preferences per browser, shared by both
 * surfaces and kept in step across open tabs.
 *
 * Tones are synthesised with WebAudio so there is nothing to ship; a desk can
 * also upload its own short clip. Everything runs through one volume stage and
 * a limiter, so "Boost" can push well past the old chime without clipping.
 * The internal team chat (components/chat) has its own sound and is untouched.
 */

export type ToneId = 'pop' | 'chime' | 'marimba' | 'harp' | 'bubble' | 'dingdong' | 'bell' | 'alert' | 'custom'

export interface SoundSettings {
  enabled: boolean
  tone: ToneId
  /** 0–150. Above 100 is "Boost": more gain, held in check by the limiter. */
  volume: number
  repeat: 1 | 2 | 3
  /** Also ring for messages in the chat that's open and in view. */
  whenViewing: boolean
}

export interface CustomTone { name: string; dataUrl: string }

const SETTINGS_KEY = 'wa-sound:v1'
const CUSTOM_KEY = 'wa-sound:custom'
const LAST_KEY = 'wa-sound:last'
/** The inbox's old on/off flag — carried over the first time. */
const LEGACY_KEY = 'wa-inbox:sound'
/** Alerts closer together than this (in any tab) collapse into one. */
const THROTTLE_MS = 3000
export const MAX_VOLUME = 150
export const MAX_CUSTOM_BYTES = 500 * 1024

export const DEFAULT_SOUND: SoundSettings = {
  enabled: true, tone: 'pop', volume: 80, repeat: 1, whenViewing: false,
}

/* ── tones ──────────────────────────────────────────────────────────────── */

interface Voice {
  /** Start (s), frequency (Hz), decay length (s). */
  t: number; f: number; d: number
  type?: OscillatorType
  g?: number
  /** Glide the pitch to this frequency over the first 40% of the note. */
  slideTo?: number
  /** Extra partials as [frequency ratio, relative gain, decay factor]. */
  partials?: [number, number, number][]
}

export const TONES: { id: Exclude<ToneId, 'custom'>; label: string; hint: string; emoji: string; voices: Voice[] }[] = [
  {
    id: 'pop', label: 'Pop', hint: 'Short and crisp', emoji: '💧',
    voices: [
      { t: 0, f: 480, slideTo: 1050, d: 0.14, g: 1 },
      { t: 0.085, f: 1050, d: 0.22, type: 'triangle', g: 0.7 },
    ],
  },
  {
    id: 'chime', label: 'Chime', hint: 'Two-note classic', emoji: '🔔',
    voices: [
      { t: 0, f: 880, d: 0.5, g: 0.9, partials: [[2, 0.25, 0.6]] },
      { t: 0.13, f: 1320, d: 0.7, g: 0.9, partials: [[2, 0.2, 0.6]] },
    ],
  },
  {
    id: 'marimba', label: 'Marimba', hint: 'Warm three-note', emoji: '🎵',
    voices: [1047, 1319, 1568].map((f, i) => ({ t: i * 0.09, f, d: 0.4, g: 0.9, partials: [[4, 0.18, 0.3]] as [number, number, number][] })),
  },
  {
    id: 'harp', label: 'Harp', hint: 'Rising arpeggio', emoji: '🪕',
    voices: [523, 659, 784, 1047].map((f, i) => ({ t: i * 0.07, f, d: 0.75, type: 'triangle' as OscillatorType, g: 0.75 })),
  },
  {
    id: 'bubble', label: 'Bubble', hint: 'Playful triple blip', emoji: '💬',
    voices: [400, 500, 620].map((f, i) => ({ t: i * 0.1, f, slideTo: f * 2.1, d: 0.11, g: 1 })),
  },
  {
    id: 'dingdong', label: 'Ding-dong', hint: 'Reception bell', emoji: '🚪',
    voices: [
      { t: 0, f: 659, d: 0.95, g: 1, partials: [[2, 0.3, 0.7], [3, 0.1, 0.5]] },
      { t: 0.38, f: 523, d: 1.2, g: 1, partials: [[2, 0.3, 0.7], [3, 0.1, 0.5]] },
    ],
  },
  {
    id: 'bell', label: 'Desk bell', hint: 'Bright, long ring', emoji: '🛎️',
    voices: [{ t: 0, f: 1180, d: 1.5, g: 0.9, partials: [[2.76, 0.5, 0.6], [5.4, 0.25, 0.35], [8.93, 0.12, 0.2]] }],
  },
  {
    id: 'alert', label: 'Urgent', hint: 'For a noisy office', emoji: '🚨',
    voices: [0, 0.17, 0.34].map(t => ({ t, f: 988, d: 0.13, type: 'square' as OscillatorType, g: 0.55, partials: [[1.5, 0.5, 1]] as [number, number, number][] })),
  },
]

export function toneLabel(id: ToneId, custom: CustomTone | null): string {
  if (id === 'custom') return custom?.name ?? 'Your sound'
  return TONES.find(t => t.id === id)?.label ?? 'Pop'
}

/* ── preferences store ──────────────────────────────────────────────────── */

const isBrowser = typeof window !== 'undefined'
let settings: SoundSettings = DEFAULT_SOUND
let custom: CustomTone | null = null
let loaded = false
const listeners = new Set<() => void>()

function clampSettings(raw: Partial<SoundSettings>): SoundSettings {
  const s = { ...DEFAULT_SOUND, ...raw }
  return {
    enabled: !!s.enabled,
    tone: (s.tone === 'custom' || TONES.some(t => t.id === s.tone)) ? s.tone : DEFAULT_SOUND.tone,
    volume: Math.max(0, Math.min(MAX_VOLUME, Math.round(Number(s.volume) || 0))),
    repeat: ([1, 2, 3] as const).includes(s.repeat) ? s.repeat : 1,
    whenViewing: !!s.whenViewing,
  }
}

function load() {
  if (!isBrowser) return
  loaded = true
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      settings = clampSettings(JSON.parse(raw))
    } else {
      // First run: respect a desk that had switched the old inbox sound off.
      const legacy = window.localStorage.getItem(LEGACY_KEY)
      settings = { ...DEFAULT_SOUND, enabled: legacy === null ? true : legacy === 'true', tone: legacy === 'true' ? 'chime' : DEFAULT_SOUND.tone }
    }
  } catch { settings = DEFAULT_SOUND }
  try {
    const rawCustom = window.localStorage.getItem(CUSTOM_KEY)
    custom = rawCustom ? (JSON.parse(rawCustom) as CustomTone) : null
  } catch { custom = null }
  if (settings.tone === 'custom' && !custom) settings = { ...settings, tone: DEFAULT_SOUND.tone }
}

function emit() { listeners.forEach(l => l()) }

function ensureLoaded() { if (!loaded) load() }

if (isBrowser) {
  // Another tab changed the sound — follow it.
  window.addEventListener('storage', e => {
    if (e.key === SETTINGS_KEY || e.key === CUSTOM_KEY) {
      load()
      if (e.key === CUSTOM_KEY) decodedCustom = null
      emit()
    }
  })
}

export function getSoundSettings(): SoundSettings { ensureLoaded(); return settings }
export function getCustomTone(): CustomTone | null { ensureLoaded(); return custom }

export function updateSoundSettings(patch: Partial<SoundSettings>) {
  ensureLoaded()
  settings = clampSettings({ ...settings, ...patch })
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
  emit()
}

/** Throws with a readable message when the clip can't be stored. */
export function setCustomTone(tone: CustomTone | null) {
  ensureLoaded()
  try {
    if (tone) window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(tone))
    else window.localStorage.removeItem(CUSTOM_KEY)
  } catch {
    throw new Error('This browser has no room left to store the sound — try a shorter clip.')
  }
  custom = tone
  decodedCustom = null
  if (!tone && settings.tone === 'custom') updateSoundSettings({ tone: DEFAULT_SOUND.tone })
  else emit()
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

/** Live preferences; the server render sees the defaults. */
export function useSoundSettings(): [SoundSettings, CustomTone | null] {
  const s = useSyncExternalStore(subscribe, getSoundSettings, () => DEFAULT_SOUND)
  const c = useSyncExternalStore(subscribe, getCustomTone, () => null)
  return [s, c]
}

/* ── audio engine ───────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null
let limiter: DynamicsCompressorNode | null = null
let decodedCustom: { src: string; buffer: AudioBuffer } | null = null

function audio(): AudioContext | null {
  if (!isBrowser) return null
  if (!ctx) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
      // A brick-wall limiter so Boost gets louder rather than distorted.
      limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.12
      // Headroom for the limiter's few-ms overshoot on fast attacks.
      const trim = ctx.createGain()
      trim.gain.value = 0.84
      limiter.connect(trim).connect(ctx.destination)
    } catch { ctx = null; return null }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Browsers only let a page make sound after the user has interacted with it.
// Warm the context up on the first click or key so the first alert isn't lost.
if (isBrowser) {
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** True while the browser is still holding sound back (no click on the page yet). */
export function isAudioBlocked(): boolean {
  return !ctx || ctx.state !== 'running'
}

/** Perceived-loudness curve: 30% ≈ the old chime, 80% ≈ +13 dB, 150% leans on the limiter. */
function volumeGain(volume: number) {
  const v = volume / 100
  return 1.9 * v * v
}

function playVoice(ac: AudioContext, out: AudioNode, at: number, v: Voice) {
  const parts: [number, number, number][] = [[1, 1, 1], ...(v.partials ?? [])]
  for (const [ratio, rel, decay] of parts) {
    const osc = ac.createOscillator()
    const env = ac.createGain()
    const start = at + v.t
    const len = Math.max(0.05, v.d * decay)
    const peak = Math.max(0.0002, (v.g ?? 1) * rel)
    osc.type = v.type ?? 'sine'
    osc.frequency.setValueAtTime(v.f * ratio, start)
    if (v.slideTo) osc.frequency.exponentialRampToValueAtTime(v.slideTo * ratio, start + v.d * 0.4)
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(peak, start + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, start + len)
    osc.connect(env).connect(out)
    osc.start(start)
    osc.stop(start + len + 0.05)
  }
}

function toneLength(voices: Voice[]) {
  return voices.reduce((m, v) => Math.max(m, v.t + v.d), 0)
}

async function customBuffer(ac: AudioContext): Promise<AudioBuffer | null> {
  const c = getCustomTone()
  if (!c) return null
  if (decodedCustom?.src === c.dataUrl) return decodedCustom.buffer
  try {
    const bytes = await fetch(c.dataUrl).then(r => r.arrayBuffer())
    const buffer = await ac.decodeAudioData(bytes)
    decodedCustom = { src: c.dataUrl, buffer }
    return buffer
  } catch { return null }
}

/** Plays `tone` at `volume`, `repeat` times. Resolves once it has been scheduled. */
export async function playTone(tone: ToneId, volume: number, repeat: number = 1): Promise<boolean> {
  const ac = audio()
  if (!ac || !limiter || volume <= 0) return false
  const out = ac.createGain()
  out.gain.value = volumeGain(volume)
  out.connect(limiter)

  let length = 0
  let schedule: (at: number) => void
  if (tone === 'custom') {
    const buffer = await customBuffer(ac)
    if (!buffer) return playTone(DEFAULT_SOUND.tone, volume, repeat)
    // Uploaded clips are capped at 4 s so a song can't hijack the desk.
    length = Math.min(buffer.duration, 4)
    schedule = at => {
      const src = ac.createBufferSource()
      src.buffer = buffer
      src.connect(out)
      src.start(at, 0, length)
    }
  } else {
    const def = TONES.find(t => t.id === tone) ?? TONES[0]
    length = toneLength(def.voices)
    schedule = at => def.voices.forEach(v => playVoice(ac, out, at, v))
  }

  const t0 = ac.currentTime + 0.02
  const gap = 0.28
  for (let i = 0; i < Math.max(1, Math.min(3, repeat)); i++) schedule(t0 + i * (length + gap))
  const total = repeat * (length + gap) + 0.5
  setTimeout(() => out.disconnect(), total * 1000)
  return ac.state === 'running'
}

/**
 * Ring for a new inbound message, honouring the desk's preferences.
 * `viewing` means the message landed in the chat the user is looking at.
 * Several tabs (inbox + booking chats) may see the same message; only the
 * first to ring within a few seconds does.
 */
export function playMessageAlert(opts: { viewing?: boolean } = {}) {
  const s = getSoundSettings()
  if (!s.enabled || s.volume <= 0) return
  if (opts.viewing && !s.whenViewing) return
  try {
    const now = Date.now()
    const last = Number(window.localStorage.getItem(LAST_KEY) ?? 0)
    if (now - last < THROTTLE_MS) return
    window.localStorage.setItem(LAST_KEY, String(now))
  } catch { /* storage unavailable — ring anyway */ }
  void playTone(s.tone, s.volume, s.repeat)
}
