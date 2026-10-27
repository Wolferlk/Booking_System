'use client'

/**
 * Data Protection — the switches behind lib/data-protection.ts.
 *
 * One JSON row (`data_protection_policy`), so each toggle saves the whole
 * policy. Everything ships ON; turning a switch off restores the old
 * behaviour for that one thing without a deploy.
 */

import { useState } from 'react'
import {
  ShieldCheck, Lock, FileSpreadsheet, History, Plane, ArrowRight, Loader2, Activity, FileText, Trash2, Plus,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import {
  DATA_PROTECTION_KEY, parseDataProtectionPolicy, type DataProtectionPolicy,
} from '@/lib/data-protection'

interface Props {
  settings: Record<string, string | undefined>
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

const ROWS: {
  key: keyof DataProtectionPolicy
  icon: React.ElementType
  title: string
  on: string
  off: string
}[] = [
  {
    key: 'keepManualFlights',
    icon: ShieldCheck,
    title: 'Keep hand-entered flights on TC re-sync',
    on: 'A OneDrive sync or TC amendment only replaces the flights the previous TC import wrote. Flights a file handler or the ops desk added or edited stay exactly as they are.',
    off: 'Old behaviour — every re-sync deletes all flights and rebuilds them from the TC document.',
  },
  {
    key: 'bookingLocks',
    icon: Lock,
    title: 'Allow per-booking locks',
    on: 'Padlocks on the Flights, Hotels and Passengers cards. A locked section is skipped by re-syncs and version switches; hand edits still work.',
    off: 'Padlocks are hidden and existing locks are ignored (they are kept, and come back if you turn this on again).',
  },
  {
    key: 'pnlSyncPnlOnly',
    icon: FileSpreadsheet,
    title: 'PNL page sync reads the PNL only',
    on: '"Sync from OneDrive" on the PNL page reads the PNL file and nothing else.',
    off: 'Old behaviour — the PNL page sync also re-imports the TC (passengers, flights, hotels).',
  },
  {
    key: 'flightRestore',
    icon: History,
    title: 'Restore flights from history',
    on: 'The Flights card shows "Restore" — pick flights an older version of the booking had and bring them back. Additive only.',
    off: 'The Restore button and its API are switched off.',
  },
]

interface ActivityRow {
  id: string
  at: string
  action: string
  user: string | null
  bookingRef: string | null
  summary: string
}

const ACTION_TONE: Record<string, string> = {
  FLIGHTS_PROTECTED:        'bg-emerald-50 text-emerald-700 border-emerald-100',
  FLIGHTS_RESTORED:         'bg-violet-50 text-violet-700 border-violet-100',
  BOOKING_SECTION_LOCKED:   'bg-amber-50 text-amber-700 border-amber-100',
  BOOKING_SECTION_UNLOCKED: 'bg-slate-50 text-slate-600 border-slate-200',
}
const ACTION_LABEL: Record<string, string> = {
  FLIGHTS_PROTECTED:        'Kept',
  FLIGHTS_RESTORED:         'Restored',
  BOOKING_SECTION_LOCKED:   'Locked',
  BOOKING_SECTION_UNLOCKED: 'Unlocked',
}

/** The "what a re-sync does now" picture: three kinds of flight, before → after. */
function ResyncPreview({ keep }: { keep: boolean }) {
  const rows = [
    { label: 'Typed in by file handler', icon: Plus,     after: keep ? 'kept' : 'deleted' },
    { label: 'From TC, edited here',     icon: Plane,    after: keep ? 'kept' : 'deleted' },
    { label: 'From TC, untouched',       icon: FileText, after: 'updated from new TC' },
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">What a TC re-sync does to each flight</p>
      <div className="space-y-1.5">
        {rows.map(r => {
          const bad = r.after === 'deleted'
          return (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <r.icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="flex-1 text-slate-600">{r.label}</span>
              <ArrowRight className="w-3 h-3 text-slate-300" />
              <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded border text-[11px] ${
                bad ? 'bg-rose-50 text-rose-700 border-rose-100'
                  : r.after === 'kept' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}>
                {bad ? <Trash2 className="w-3 h-3" /> : r.after === 'kept' ? <ShieldCheck className="w-3 h-3" /> : null}
                {r.after}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DataProtectionCard({ settings, saving, onSave }: Props) {
  const policy = parseDataProtectionPolicy(settings[DATA_PROTECTION_KEY])
  const busy = saving === DATA_PROTECTION_KEY
  const [activity, setActivity] = useState<ActivityRow[] | null>(null)
  const [loadingActivity, setLoadingActivity] = useState(false)

  function toggle(key: keyof DataProtectionPolicy) {
    onSave(DATA_PROTECTION_KEY, JSON.stringify({ ...policy, [key]: !policy[key] }))
  }

  async function loadActivity() {
    setLoadingActivity(true)
    try {
      const res = await fetch('/api/admin/data-protection/activity')
      const json = await res.json()
      setActivity(json.success ? json.data.rows : [])
    } catch {
      setActivity([])
    } finally {
      setLoadingActivity(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Data Protection — Flights &amp; Re-sync
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          Stops a OneDrive / TC re-sync from wiping details people fixed by hand — most of all the flights
          file handlers add after the TC is out. Each switch can be turned off on its own to go back to the old behaviour.
        </p>

        <ResyncPreview keep={policy.keepManualFlights} />

        <div>
          {ROWS.map(r => {
            const on = policy[r.key]
            return (
              <div key={r.key} className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <r.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${on ? 'text-emerald-500' : 'text-slate-300'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{r.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{on ? r.on : r.off}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggle(r.key)}
                  disabled={busy}
                  aria-pressed={on}
                  aria-label={r.title}
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${on ? 'translate-x-6' : 'translate-x-1'}`} />
                  {busy && <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-3 h-3 animate-spin text-white" /></span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="pt-1">
          {activity === null ? (
            <button
              onClick={loadActivity}
              disabled={loadingActivity}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {loadingActivity ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              Show what it protected in the last 30 days
            </button>
          ) : activity.length === 0 ? (
            <p className="text-xs text-slate-400">Nothing kept, locked or restored in the last 30 days.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Last 30 days</p>
              {activity.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-xs py-1 border-b border-slate-50 last:border-0">
                  <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${ACTION_TONE[a.action] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                    {ACTION_LABEL[a.action] ?? a.action}
                  </span>
                  {a.bookingRef && (
                    <a href={`/dashboard/bookings/${a.bookingRef}`} className="font-mono font-semibold text-brand-600 hover:underline flex-shrink-0">
                      {a.bookingRef}
                    </a>
                  )}
                  <span className="flex-1 min-w-0 truncate text-slate-600" title={a.summary}>{a.summary}</span>
                  <span className="flex-shrink-0 text-[10px] text-slate-400">{a.user ? `${a.user} · ` : ''}{formatDateTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
