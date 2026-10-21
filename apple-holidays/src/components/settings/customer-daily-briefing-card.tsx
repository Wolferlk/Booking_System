'use client'

/**
 * Customer daily trip details — the default time guests get the WhatsApp with
 * their day's plan, and the master on/off switch.
 *
 * Writes the same rows lib/customer-whatsapp-automation.ts reads (that module
 * pulls in prisma, so the keys are repeated here). The time is the guest's
 * local time; a booking's own "Own time" / "Off" override still wins. The
 * scheduler re-reads the row every 5 minutes, so no restart is needed.
 */

import { Clock, Loader2, MessageCircle } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

const KEY_TIME    = 'auto_whatsapp_daily_briefing_time'
const KEY_ENABLED = 'auto_whatsapp_daily_briefing_enabled'
const FALLBACK_TIME = '18:00'
const PRESETS = ['07:00', '08:00', '17:00', '18:00', '19:00', '20:00']

interface Props {
  settings: Record<string, string | undefined>
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

export default function CustomerDailyBriefingCard({ settings, saving, onSave }: Props) {
  const time    = settings[KEY_TIME] || FALLBACK_TIME
  const enabled = settings[KEY_ENABLED] !== 'false'   // default ON
  const sameDay = Number(time.slice(0, 2)) < 12
  const busyTime = saving === KEY_TIME

  const saveTime = (v: string) => {
    if (!/^\d{2}:\d{2}$/.test(v) || v === time) return
    void onSave(KEY_TIME, v)
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-slate-400" /> Customer Daily Trip Details
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-5">
        <p className="text-xs text-slate-500 leading-relaxed">
          Guests mid-trip get a WhatsApp with their plan every day. This is the default send time for
          every booking, in the guest&apos;s local time (Ho Chi Minh for Vietnam, Colombo for Sri Lanka…).
          A booking set to its own time or to Off on the booking page keeps that.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-800">Automatic daily send</p>
            <p className="text-xs text-slate-400">When off, daily details only go out when sent manually.</p>
          </div>
          <button
            disabled={saving === KEY_ENABLED}
            onClick={() => onSave(KEY_ENABLED, enabled ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
            aria-label="Toggle automatic daily send"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label htmlFor="daily-briefing-time" className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-400" /> Default send time
            </label>
            <input
              id="daily-briefing-time"
              type="time"
              key={time}
              defaultValue={time}
              disabled={busyTime}
              onBlur={e => saveTime(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm tabular-nums disabled:opacity-50"
            />
            {busyTime && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                disabled={busyTime}
                onClick={() => saveTime(p)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors disabled:opacity-50 ${
                  p === time
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            At {time} guests get {sameDay ? "that same day's" : "the next day's"} plan.
            Before 12:00 sends the same day&apos;s plan; 12:00 or later sends tomorrow&apos;s.
          </p>
        </div>
      </CardBody>
    </Card>
  )
}
