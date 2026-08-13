'use client'

/**
 * Settings for the D-4 last-minute alarm — the deliberate, sit-down version of
 * the mute menu inside the pop-up itself.
 *
 * Everything on this card is **per browser**, not per user and not per team,
 * and the card says so in as many words. That is not a limitation to apologise
 * for: an operator who mutes the alarm is telling us about the room they are
 * sitting in, and pushing that to the server would let one person silence a
 * booking alarm for a colleague who never agreed to it. Acknowledging is the
 * team-wide act; muting is not.
 *
 * The one thing muting never does is hide work. The header chip and its count
 * stay exactly as they were — only the interruption stops.
 *
 * State lives in `lib/last-minute-alert-prefs.ts`, which broadcasts writes, so
 * the alarm component picks these changes up immediately, in this tab and every
 * other one.
 */

import { useEffect, useState } from 'react'
import { BellOff, BellRing, Clock, Volume2, VolumeX, Zap } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  DEFAULT_PREFS, MUTE_CHOICES, isMuted, muteAlert, muteLabel, onAlertPrefsChange,
  readAlertPrefs, setAlertSound, unmuteAlert, MUTE_FOREVER,
  type LastMinuteAlertPrefs,
} from '@/lib/last-minute-alert-prefs'

export default function LastMinuteAlertSettings() {
  // Server-rendered first paint has no `localStorage`, so start from the
  // defaults and read the real values once mounted. `ready` keeps the toggles
  // from flashing the wrong state for a frame.
  const [prefs, setPrefs] = useState<LastMinuteAlertPrefs>(DEFAULT_PREFS)
  const [ready, setReady] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    const sync = () => { setPrefs(readAlertPrefs()); setReady(true) }
    sync()
    return onAlertPrefsChange(sync)
  }, [])

  // Keep the "muted for 42 more min" line honest without a reload.
  useEffect(() => {
    const iv = setInterval(() => tick(t => t + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  const muted = ready && isMuted(prefs)
  const label = muteLabel(prefs)
  const permanent = prefs.muteUntil === MUTE_FOREVER

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Zap className="w-4 h-4 text-red-500" /> Last-Minute Booking Alerts
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-4">

        <p className="text-xs text-slate-500 leading-relaxed">
          Bookings sold four days or fewer before the guest arrives (D-4) interrupt with a
          pop-up and a sound until somebody acknowledges them. You can stop the interruption
          here — <strong>on this browser only</strong>. Nobody else is affected, the header
          count never disappears, and the bookings still have to be acknowledged.
        </p>

        {/* ── Current state ── */}
        <div className={`flex items-center justify-between gap-3 p-4 rounded-xl border transition-colors ${
          muted ? 'bg-slate-50 border-slate-200' : 'bg-emerald-50 border-emerald-200'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-lg ${muted ? 'bg-slate-200' : 'bg-emerald-100'}`}>
              {muted
                ? <BellOff className="w-4 h-4 text-slate-500" />
                : <BellRing className="w-4 h-4 text-emerald-600" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {muted ? 'Alerts are muted' : 'Alerts are active'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {muted
                  ? `${label} — late bookings still appear in the header, but nothing pops up or makes a sound.`
                  : 'A pop-up interrupts as soon as a last-minute booking arrives, and again every few minutes until it is acknowledged.'}
              </p>
            </div>
          </div>
          {muted && (
            <button
              onClick={unmuteAlert}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
            >
              <BellRing className="w-3.5 h-3.5" /> Turn back on
            </button>
          )}
        </div>

        {/* ── Mute durations ── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" /> Mute the pop-up
          </p>
          <div className="flex flex-wrap gap-2">
            {MUTE_CHOICES.map(h => (
              <button
                key={h}
                onClick={() => muteAlert(h)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                <BellOff className="w-3.5 h-3.5 text-slate-400" />
                {h} hour{h === 1 ? '' : 's'}
              </button>
            ))}
            <button
              onClick={() => muteAlert()}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                permanent
                  ? 'border-rose-300 bg-rose-100 text-rose-700'
                  : 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Turn off permanently
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            A timed mute switches itself back on when it runs out. &quot;Permanently&quot; stays off
            until somebody turns it back on here — sensible for a wall display or a shared
            screen, risky for an operator&apos;s own machine.
          </p>
        </div>

        {/* ── Sound ── */}
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${prefs.soundOn ? 'bg-blue-100' : 'bg-slate-200'}`}>
              {prefs.soundOn
                ? <Volume2 className="w-4 h-4 text-blue-600" />
                : <VolumeX className="w-4 h-4 text-slate-500" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Alarm sound</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {prefs.soundOn
                  ? 'A two-tone alarm for guests arriving today or tomorrow, a softer chime further out.'
                  : 'Silent — the pop-up still interrupts, it just makes no sound.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-semibold ${prefs.soundOn ? 'text-blue-600' : 'text-slate-400'}`}>
              {prefs.soundOn ? 'ON' : 'OFF'}
            </span>
            <button
              onClick={() => setAlertSound(!prefs.soundOn)}
              aria-label={prefs.soundOn ? 'Turn the alarm sound off' : 'Turn the alarm sound on'}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                prefs.soundOn ? 'bg-blue-500' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                prefs.soundOn ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>

      </CardBody>
    </Card>
  )
}
