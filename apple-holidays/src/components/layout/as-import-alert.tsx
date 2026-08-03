'use client'

/**
 * AppleSystem import failure alert — the in-app half of `lib/as-import-alerts.ts`.
 *
 * A failed 6 AM import used to be invisible unless someone opened the run-history
 * tab, so a whole day of confirmations could silently go missing. This pops a
 * modal at the first staff member to reach the dashboard after a failure (and at
 * anyone already signed in, within a few minutes) so it gets picked up the same
 * morning.
 *
 * Acknowledging is a team-wide action: it clears the alert for everyone, because
 * the point is that *someone* handles it, not that everyone reads it. "Later"
 * only silences it for the current browser session.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Check, Loader2, Mail, MailWarning, X } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'

interface AsImportAlert {
  id: string
  at: string
  lastAt: string
  occurrences: number
  severity: 'error' | 'warning'
  title: string
  message: string
  jobMode?: 'auto' | 'manual'
  dateFrom?: string
  dateTo?: string
  totalFound?: number
  totalCreated?: number
  totalErrors?: number
  emailed: boolean
}

/** Alert ids already shown in this tab, so navigation doesn't re-pop the modal. */
const SEEN_KEY = 'as_import_alert_seen_ids'
const POLL_MS = 5 * 60 * 1000

function readSeen(): string[] {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function markSeen(ids: string[]): void {
  try {
    const merged = readSeen()
    for (const id of ids) if (!merged.includes(id)) merged.push(id)
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(merged.slice(-50)))
  } catch {
    /* private mode — worst case the modal shows again on the next navigation */
  }
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AsImportAlert() {
  const { status } = useSession()
  const router = useRouter()
  const [alerts, setAlerts] = useState<AsImportAlert[]>([])
  const [open, setOpen] = useState(false)
  const [acking, setAcking] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/as-bookings-v2/alerts')
      const json = await readApiResponse<{ alerts: AsImportAlert[] }>(res)
      const rows = json.success ? json.data?.alerts ?? [] : []
      if (rows.length === 0) return

      // Only interrupt for alerts this tab hasn't already shown.
      const seen = readSeen()
      const fresh = rows.filter((a) => !seen.includes(a.id))
      if (fresh.length === 0) return

      setAlerts(rows)
      setOpen(true)
      markSeen(fresh.map((a) => a.id))
    } catch {
      /* never let a health check break the dashboard */
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [status, load])

  const acknowledge = useCallback(async () => {
    setAcking(true)
    try {
      await fetch('/api/as-bookings-v2/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      setOpen(false)
    } catch {
      setOpen(false)
    } finally {
      setAcking(false)
    }
  }, [])

  const primary = alerts[0]
  if (!primary) return null

  const isError = primary.severity === 'error'
  const rest = alerts.slice(1)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="as-import-alert-title"
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className={`px-6 py-5 ${isError ? 'bg-rose-600' : 'bg-amber-500'}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                    AppleSystem booking import
                  </p>
                  <h2 id="as-import-alert-title" className="text-white font-bold text-lg leading-tight mt-0.5">
                    {primary.title}
                  </h2>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">{primary.message}</p>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                <div>
                  <div className="text-slate-400">When</div>
                  <div className="font-semibold text-slate-700">{fmt(primary.lastAt ?? primary.at)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Import</div>
                  <div className="font-semibold text-slate-700">
                    {primary.jobMode === 'auto' ? 'Daily auto-import' : 'Manual run'}
                  </div>
                </div>
                {primary.dateFrom && (
                  <div>
                    <div className="text-slate-400">Date window</div>
                    <div className="font-semibold text-slate-700 font-mono">
                      {primary.dateFrom === primary.dateTo ? primary.dateFrom : `${primary.dateFrom} → ${primary.dateTo}`}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-slate-400">Bookings created</div>
                  <div className="font-semibold text-slate-700">{primary.totalCreated ?? 0}</div>
                </div>
                {primary.occurrences > 1 && (
                  <div>
                    <div className="text-slate-400">Occurrences</div>
                    <div className="font-semibold text-slate-700">{primary.occurrences}×</div>
                  </div>
                )}
              </div>

              {/* Whether IT already knows */}
              <p className={`flex items-start gap-1.5 text-[11px] ${primary.emailed ? 'text-emerald-600' : 'text-amber-600'}`}>
                {primary.emailed ? <Mail className="w-3.5 h-3.5 shrink-0 mt-px" /> : <MailWarning className="w-3.5 h-3.5 shrink-0 mt-px" />}
                {primary.emailed
                  ? 'The IT team has been notified by email.'
                  : 'The IT notification email could not be sent — please tell the IT team directly.'}
              </p>

              {rest.length > 0 && (
                <div className="border-t border-slate-100 pt-3 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    {rest.length} other open alert{rest.length === 1 ? '' : 's'}
                  </p>
                  {rest.slice(0, 3).map((a) => (
                    <p key={a.id} className="text-[11px] text-slate-500 truncate">
                      <span className={a.severity === 'error' ? 'text-rose-500' : 'text-amber-500'}>•</span> {a.title}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-between">
              <button
                onClick={() => setOpen(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-2 text-left sm:text-center"
              >
                Later
              </button>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => { setOpen(false); router.push('/dashboard/new-as-booking') }}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Open import page <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={acknowledge}
                  disabled={acking}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-60"
                >
                  {acking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Acknowledge
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
