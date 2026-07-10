'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Zap, RefreshCw, CheckCircle, AlertCircle, Clock, Loader2,
  PlayCircle, Power, Inbox, ExternalLink, Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'

// ── Types (mirror src/lib/tq-auto-scheduler.ts) ────────────────────────────────
interface CreatedBooking { ref: string; country: string; isNew: boolean }

interface AutoAlert {
  id: string
  at: string
  mailbox: string
  checked: number
  processed: number
  createdCount: number
  updatedCount: number
  errors: number
  byCountry: Record<string, number>
  bookings: CreatedBooking[]
}

interface AutoStatus {
  enabled: boolean
  mailbox: string | null
  running: boolean
  lastRunAt: string | null
  lastResult: string | null
}

// ── Country badge colours ──────────────────────────────────────────────────────
const COUNTRY_STYLE: Record<string, string> = {
  VN:   'bg-red-100 text-red-700 border-red-200',
  SL:   'bg-amber-100 text-amber-700 border-amber-200',
  SG:   'bg-blue-100 text-blue-700 border-blue-200',
  MY:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  SGMY: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  '?':  'bg-slate-100 text-slate-600 border-slate-200',
}

const COUNTRY_LABEL: Record<string, string> = {
  VN: 'Vietnam', SL: 'Sri Lanka', SG: 'Singapore', MY: 'Malaysia', SGMY: 'Singapore/Malaysia', '?': 'Unknown',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function TqAutoAlertsView() {
  const router = useRouter()
  const [status, setStatus]   = useState<AutoStatus | null>(null)
  const [alerts, setAlerts]   = useState<AutoAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<'toggle' | 'run' | null>(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/mail/auto-alerts')
      const json = await res.json()
      if (json.success) {
        setStatus(json.data.status as AutoStatus)
        setAlerts(json.data.alerts as AutoAlert[])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Refresh every 30s so the tab reflects backend runs without a manual reload.
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const toggle = async () => {
    if (!status) return
    setBusy('toggle')
    try {
      await fetch('/api/mail/auto-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: status.enabled ? 'disable' : 'enable' }),
      })
      await load()
    } finally { setBusy(null) }
  }

  const runNow = async () => {
    setBusy('run')
    try {
      await fetch('/api/mail/auto-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      })
      await load()
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading auto-processed alerts…
      </div>
    )
  }

  const totalNew = alerts.reduce((s, a) => s + a.createdCount, 0)

  return (
    <div className="space-y-4">
      {/* ── Control bar ─────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${status?.enabled ? 'bg-green-100' : 'bg-slate-100'}`}>
              <Zap className={`w-5 h-5 ${status?.enabled ? 'text-green-600' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Auto-Processing Scheduler</p>
              <p className="text-xs text-slate-500">
                {status?.mailbox ?? 'no mailbox configured'} · every 5 min · backend
              </p>
            </div>
            <span className={`ml-2 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
              status?.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              {status?.enabled ? (status?.running ? 'Running…' : 'Active') : 'Paused'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={runNow} disabled={busy !== null || !status?.enabled}>
              {busy === 'run'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PlayCircle className="w-3.5 h-3.5" />}
              Check now
            </Button>
            <Button variant={status?.enabled ? 'outline' : 'primary'} size="sm" onClick={toggle} disabled={busy !== null}>
              {busy === 'toggle'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Power className="w-3.5 h-3.5" />}
              {status?.enabled ? 'Pause' : 'Enable'}
            </Button>
            <button onClick={load} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {status?.lastRunAt && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            Last checked {timeAgo(status.lastRunAt)}
            {status.lastResult && <span className="text-slate-400">· {status.lastResult}</span>}
          </div>
        )}
      </Card>

      {/* ── Summary tiles ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'New bookings (recent)', value: totalNew, icon: <Sparkles className="w-4 h-4 text-indigo-500" /> },
          { label: 'Alert batches',         value: alerts.length, icon: <Inbox className="w-4 h-4 text-blue-500" /> },
          { label: 'Errors (recent)',       value: alerts.reduce((s, a) => s + a.errors, 0), icon: <AlertCircle className="w-4 h-4 text-red-500" /> },
          { label: 'Updated (recent)',      value: alerts.reduce((s, a) => s + a.updatedCount, 0), icon: <CheckCircle className="w-4 h-4 text-teal-500" /> },
        ].map((t, i) => (
          <Card key={i} className="p-3">
            <div className="flex items-center gap-2 mb-1">{t.icon}
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t.label}</span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{t.value}</p>
          </Card>
        ))}
      </div>

      {/* ── Alert feed ──────────────────────────────────────────────────────── */}
      {alerts.length === 0 ? (
        <Card className="p-10 text-center text-slate-400">
          <Inbox className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No new bookings processed yet</p>
          <p className="text-xs mt-1">Alerts appear here automatically when the scheduler creates bookings from new mail.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <Card key={alert.id} className="p-4 border-l-4 border-l-green-400">
              <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      Created {alert.createdCount} new booking{alert.createdCount === 1 ? '' : 's'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(alert.at).toLocaleString()} · {timeAgo(alert.at)}
                    </p>
                  </div>
                </div>
                {/* Country badges: VN-5, SL-10, MY-2 … */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(alert.byCountry).map(([c, n]) => (
                    <span key={c}
                      title={COUNTRY_LABEL[c] ?? c}
                      className={`text-xs font-bold px-2.5 py-1 rounded-full border ${COUNTRY_STYLE[c] ?? COUNTRY_STYLE['?']}`}>
                      {c}-{n}
                    </span>
                  ))}
                </div>
              </div>

              {/* Per-booking refs (clickable) */}
              <div className="flex flex-wrap gap-1.5">
                {alert.bookings.map(b => (
                  <button key={b.ref}
                    onClick={() => router.push(`/dashboard/bookings/${encodeURIComponent(b.ref)}`)}
                    className="group inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200">
                    <span className={`w-1.5 h-1.5 rounded-full ${(COUNTRY_STYLE[b.country] ?? '').split(' ')[0]}`} />
                    {b.ref}
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                  </button>
                ))}
              </div>

              {(alert.errors > 0 || alert.updatedCount > 0) && (
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                  <span>checked {alert.checked}</span>
                  {alert.updatedCount > 0 && <span>· {alert.updatedCount} updated</span>}
                  {alert.errors > 0 && <span className="text-red-500">· {alert.errors} error{alert.errors === 1 ? '' : 's'}</span>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
