'use client'

/**
 * Global notification bell — surfaces TRAVELLER EXPERIENCE alerts (things a
 * customer said on an AI call that ops must act on: "the booking is not good",
 * a change request, didn't get home safely, a low rating) on EVERY dashboard
 * page, not just the AI Call Bot tab.
 *
 * Polls the TE alerts feed (via the authenticated /api/te/proxy) once a minute,
 * shows a red badge with the open count, and pops a panel listing each alert
 * nicely: severity, booking + customer, what's wrong, and the customer's own
 * words. Acknowledge works inline; "View all" deep-links to the AI Call Bot
 * page's Alerts tab (?tab=alerts).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCircle2, ExternalLink, Loader2, Quote, ShieldAlert } from 'lucide-react'

interface TEAlert {
  id: number
  booking_ref?: string | null
  customer_name?: string | null
  call_kind?: string | null
  category?: string | null
  severity?: 'low' | 'medium' | 'high' | string | null
  title?: string | null
  details?: string | null
  customer_quote?: string | null
  status?: string | null
  at?: string | null
  created_at?: string | null
}

const SEVERITY: Record<string, { dot: string; chip: string; label: string }> = {
  high:   { dot: 'bg-red-500',    chip: 'bg-red-50 text-red-600 border-red-200',       label: 'HIGH' },
  medium: { dot: 'bg-orange-400', chip: 'bg-orange-50 text-orange-600 border-orange-200', label: 'MEDIUM' },
  low:    { dot: 'bg-yellow-400', chip: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'LOW' },
}
const KIND_LABEL: Record<string, string> = {
  check_in: 'On-tour check-in', reconfirm: 'Reconfirmation', post_tour: 'Post-tour', campaign: 'Custom call',
}
const CATEGORY_LABEL: Record<string, string> = {
  complaint: 'Complaint', change_request: 'Change request', safety: 'Safety', low_rating: 'Low rating',
}

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationsBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<TEAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [ackBusy, setAckBusy] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (spin = false) => {
    if (spin) setLoading(true)
    try {
      const url = new URL('/api/te/proxy', location.origin)
      url.searchParams.set('path', 'alerts')
      url.searchParams.set('status', 'open')
      const res = await fetch(url.toString()).then(r => r.json())
      const rows: TEAlert[] = res.alerts ?? []
      const sev = (a: TEAlert) => (a.severity === 'high' ? 3 : a.severity === 'medium' ? 2 : 1)
      const ts = (a: TEAlert) => new Date(a.at ?? a.created_at ?? 0).getTime()
      rows.sort((a, b) => sev(b) - sev(a) || ts(b) - ts(a))
      setAlerts(rows)
    } catch { /* keep the last known state — the bell must never break the header */ }
    finally { if (spin) setLoading(false) }
  }, [])

  // Poll once a minute so the badge is live on every dashboard page.
  useEffect(() => {
    load()
    const iv = setInterval(() => load(), 60_000)
    return () => clearInterval(iv)
  }, [load])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function acknowledge(id: number) {
    setAckBusy(id)
    try {
      const url = new URL('/api/te/proxy', location.origin)
      url.searchParams.set('path', `alerts/${id}`)
      await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ack' }),
      })
      setAlerts(a => a.filter(x => x.id !== id))
    } catch { /* leave it in the list */ }
    finally { setAckBusy(null) }
  }

  const count = alerts.length
  const hasHigh = alerts.some(a => a.severity === 'high')

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) load(true) }}
        className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        aria-label={count ? `${count} open traveller alerts` : 'Notifications'}
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${hasHigh ? 'bg-red-500 animate-pulse' : 'bg-orange-500'}`}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[92vw] max-w-[400px] rounded-2xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              <p className="text-sm font-bold text-slate-900">Traveller alerts</p>
              {count > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">{count} open</span>}
            </div>
            <button
              onClick={() => { setOpen(false); router.push('/dashboard/te/ai-call-bot?tab=alerts') }}
              className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800"
            >
              View all <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          {/* Alert list */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-50">
            {loading && alerts.length === 0 ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
            ) : alerts.length === 0 ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">All quiet — no open alerts from calls</p>
              </div>
            ) : (
              alerts.map(a => {
                const sev = SEVERITY[a.severity ?? 'medium'] ?? SEVERITY.medium
                return (
                  <div key={a.id} className="px-4 py-3 hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{a.title ?? CATEGORY_LABEL[a.category ?? ''] ?? 'Alert'}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${sev.chip}`}>{sev.label}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {a.booking_ref && <span className="font-mono font-semibold text-slate-600">{a.booking_ref}</span>}
                          {a.customer_name && <> · {a.customer_name}</>}
                          {(a.call_kind || a.category) && <> · {KIND_LABEL[a.call_kind ?? ''] ?? a.call_kind}{a.category ? ` · ${CATEGORY_LABEL[a.category] ?? a.category}` : ''}</>}
                          {(a.at || a.created_at) && <> · {timeAgo(a.at ?? a.created_at)}</>}
                        </p>
                        {a.details && <p className="text-[11px] text-slate-600 leading-snug line-clamp-2">{a.details}</p>}
                        {a.customer_quote && (
                          <p className="text-[11px] text-slate-500 italic flex items-start gap-1 leading-snug">
                            <Quote className="w-3 h-3 mt-0.5 shrink-0 text-slate-300" />
                            <span className="line-clamp-2">&ldquo;{a.customer_quote}&rdquo;</span>
                          </p>
                        )}
                        <div className="pt-0.5">
                          <button
                            disabled={ackBusy === a.id}
                            onClick={() => acknowledge(a.id)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          >
                            {ackBusy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Acknowledge
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
