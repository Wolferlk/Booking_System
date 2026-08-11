'use client'

/**
 * Detailed P&L panel.
 *
 * Shows the Accounts system's costing sheet for this booking inside the Booking
 * system: the same Hotels / Attraction / Tour Transfers / Transport / Meals /
 * Others tables, built from the same stored Apple System payload by a port of
 * the same code (see src/lib/detailed-pnl). The two systems are linked on the
 * IS number, compared with spaces stripped — "VN41054" here is "VN 41054"
 * there.
 *
 * The sheet arrives as HTML because the renderer is a port of the Accounts
 * app's own HTML builder; rendering it verbatim is what keeps the two screens
 * from drifting. It is server-built from database values and escaped at every
 * interpolation (render.ts::esc), and no user input reaches it.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, X, Table2, Ticket, Maximize2 } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DETAILED_PNL_CSS } from '@/lib/detailed-pnl/styles'
import type { UserRole } from '@prisma/client'

interface Totals {
  hotels: number; products: number; transfers: number
  transport: number; meals: number; others: number
  grand: number; cost: number; profit: number; margin: number
}

interface LineCounts {
  hotels: number; products: number; transfers: number
  transport: number; meals: number; others: number
}

interface Source {
  matchedBy: string
  recordId: number
  isNumber: string | null
  quotationNo: string | null
  referenceId: string | null
  revision: number | null
  countryCode: string | null
  approvalStatus: string | null
}

type Payload =
  | { available: true; html: string; totals: Totals; currency: string; lineCounts: LineCounts; source: Source }
  | { available: false; reason: string; message: string }

interface Props {
  bookingRef: string
  role: UserRole
  /** Called after tickets are created, so the page can refresh its ticket list. */
  onTicketsCreated?: () => void
}

const money = (n: number, cur: string) =>
  `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SECTIONS: Array<[keyof Totals & keyof LineCounts, string, string]> = [
  ['hotels',    'Hotels',         '#2a78d6'],
  ['products',  'Attraction',     '#008300'],
  ['transfers', 'Tour Transfers', '#e87ba4'],
  ['transport', 'Transport',      '#eda100'],
  ['meals',     'Meals',          '#1baf7a'],
  ['others',    'Others',         '#eb6834'],
]

export default function DetailedPnlPanel({ bookingRef, role, onTicketsCreated }: Props) {
  const [data, setData]       = useState<Payload | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [creating, setCreating] = useState(false)

  const canCreateTickets = ['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/detailed-pnl`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Failed to load the Detailed P&L')
      setData(json.data as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the Detailed P&L')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  // Escape closes the full-screen sheet, and the page behind it must not scroll
  // while it is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  async function createTickets() {
    if (!canCreateTickets) return
    setCreating(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ext-pnl/create-tickets`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const { created, skipped } = json.data as { created: number; skipped: number }
      if (created > 0) toast.success(`${created} ticket${created !== 1 ? 's' : ''} created from the Detailed P&L`)
      else             toast.info(`Every costing line already has a ticket (${skipped} skipped)`)
      onTicketsCreated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets')
    } finally {
      setCreating(false)
    }
  }

  const available = data?.available === true
  const totalLines = available
    ? Object.values((data as Extract<Payload, { available: true }>).lineCounts).reduce((a, b) => a + b, 0)
    : 0

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DETAILED_PNL_CSS }} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Table2 className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-slate-900">Detailed P&amp;L</h3>
              <span className="text-xs text-slate-500">Accounts costing sheet</span>
              {available && (
                <Badge color="blue">
                  {(data as Extract<Payload, { available: true }>).source.isNumber ?? '—'}
                  {(data as Extract<Payload, { available: true }>).source.revision != null
                    ? ` · rev ${(data as Extract<Payload, { available: true }>).source.revision}` : ''}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </Button>
              {available && (
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Maximize2 className="w-3.5 h-3.5" /> View costing sheet
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardBody>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading the Accounts P&amp;L…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && !error && data && !available && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {(data as Extract<Payload, { available: false }>).message}
            </div>
          )}

          {!loading && !error && available && (() => {
            const d = data as Extract<Payload, { available: true }>
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {SECTIONS.map(([key, label, colour]) => (
                    <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: colour }} />
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{label}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-900 mt-1 font-mono">
                        {money(d.totals[key], d.currency)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {d.lineCounts[key]} line{d.lineCounts[key] === 1 ? '' : 's'}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-900 px-4 py-3">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Total Tour Cost</p>
                      <p className="text-lg font-bold text-white font-mono">{money(d.totals.grand, d.currency)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Without Markup</p>
                      <p className="text-sm font-semibold text-slate-200 font-mono">{money(d.totals.cost, d.currency)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Profit</p>
                      <p className={`text-sm font-bold font-mono ${d.totals.profit < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {money(d.totals.profit, d.currency)} · {d.totals.margin.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {canCreateTickets && (
                    <Button size="sm" onClick={createTickets} disabled={creating}>
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ticket className="w-3.5 h-3.5" />}
                      Create tickets ({totalLines} lines)
                    </Button>
                  )}
                </div>
              </div>
            )
          })()}
        </CardBody>
      </Card>

      {open && available && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[1400px] max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Table2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  Detailed P&amp;L — {(data as Extract<Payload, { available: true }>).source.isNumber ?? bookingRef}
                </h2>
                <span className="text-xs text-slate-400 hidden sm:inline">
                  matched on {(data as Extract<Payload, { available: true }>).source.matchedBy.replace(/_/g, ' ')}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div
                className="dtp-root"
                dangerouslySetInnerHTML={{ __html: (data as Extract<Payload, { available: true }>).html }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
