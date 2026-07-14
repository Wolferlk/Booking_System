'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Filter, Trash2, Loader2, Eye, EyeOff, Lock, ShieldAlert,
  Search, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// Mirrors prisma BookingStatus / OperationCountry enums.
const STATUSES = [
  'DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED',
  'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS',
  'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS', 'TICKETS_ISSUED', 'QC2_PASS',
  'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE', 'COMPLETED', 'CANCELLED', 'AMENDED',
] as const

const COUNTRIES = [
  'ALL', 'VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA',
] as const

const CONFIRM_PHRASE = 'DELETE'

type Filters = {
  arrivalFrom: string
  arrivalTo: string
  departureFrom: string
  departureTo: string
  createdFrom: string
  createdTo: string
  statuses: string[]
  operationCountry: string
  refContains: string
}

const EMPTY_FILTERS: Filters = {
  arrivalFrom: '', arrivalTo: '', departureFrom: '', departureTo: '',
  createdFrom: '', createdTo: '', statuses: [], operationCountry: '', refContains: '',
}

type SampleRow = {
  bookingRef: string
  status: string
  operationCountry: string | null
  arrivalDate: string
  departureDate: string
  createdAt: string
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function hasAnyFilter(f: Filters) {
  return Boolean(
    f.arrivalFrom || f.arrivalTo || f.departureFrom || f.departureTo ||
    f.createdFrom || f.createdTo || f.statuses.length || f.operationCountry ||
    f.refContains.trim(),
  )
}

export default function BookingsCleanupPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'loading') return
    if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
      router.replace('/dashboard')
    }
  }, [session, status, router])

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters(prev => ({ ...prev, [k]: v }))

  const toggleStatus = (s: string) =>
    setFilters(prev => ({
      ...prev,
      statuses: prev.statuses.includes(s)
        ? prev.statuses.filter(x => x !== s)
        : [...prev.statuses, s],
    }))

  // ── Preview ────────────────────────────────────────────────────────────────
  const [previewing, setPreviewing] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [sample, setSample] = useState<SampleRow[]>([])

  async function runPreview() {
    if (!hasAnyFilter(filters)) {
      toast.error('Set at least one filter first')
      return
    }
    setPreviewing(true)
    try {
      const res = await fetch('/api/admin/danger/filtered-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', filters }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Preview failed')
      setCount(json.data.count)
      setSample(json.data.sample ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // Re-preview resets whenever filters change materially.
  function resetPreview() {
    setCount(null)
    setSample([])
  }

  // ── Delete modal ───────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [done, setDone] = useState(false)

  const canSubmit = password.trim().length > 0 && confirm.trim() === CONFIRM_PHRASE && !deleting

  function openModal() {
    setPassword(''); setConfirm(''); setShowPw(false); setDone(false); setShowModal(true)
  }

  async function handleDelete() {
    if (!canSubmit) return
    setDeleting(true)
    try {
      const res = await fetch('/api/admin/danger/filtered-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'delete', filters, password }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Delete failed')
      setDone(true)
      toast.success(json.message ?? 'Bookings deleted')
      resetPreview()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return null

  const dateField = (label: string, from: keyof Filters, to: keyof Filters) => (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filters[from] as string}
          onChange={e => { set(from, e.target.value); resetPreview() }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
        <span className="text-slate-400 text-xs">to</span>
        <input
          type="date"
          value={filters[to] as string}
          onChange={e => { set(to, e.target.value); resetPreview() }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="Bookings Cleanup" subtitle="Filter and bulk-delete bookings — Super Admin only" />

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Warning banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-800 text-sm">Permanent Deletion Tool</p>
            <p className="text-xs text-red-600 mt-0.5">
              Deleting removes matched bookings and <strong>all related records</strong> (passengers,
              P&amp;L, agenda, tickets, payments, history). This is <strong>irreversible</strong> and
              requires the critical services password. Always preview before deleting.
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card className="overflow-hidden">
          <div className="bg-slate-800 px-5 py-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">Filters</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {dateField('Arrival date', 'arrivalFrom', 'arrivalTo')}
              {dateField('Departure date', 'departureFrom', 'departureTo')}
              {dateField('Created date', 'createdFrom', 'createdTo')}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Operation country</label>
                <select
                  value={filters.operationCountry}
                  onChange={e => { set('operationCountry', e.target.value); resetPreview() }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
                >
                  <option value="">Any country</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' & ')}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Booking ref contains</label>
              <input
                type="text"
                value={filters.refContains}
                onChange={e => { set('refContains', e.target.value); resetPreview() }}
                placeholder="e.g. VN, IS2025…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Status (any of)</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map(s => {
                  const active = filters.statuses.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { toggleStatus(s); resetPreview() }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        active
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={runPreview}
                disabled={previewing || !hasAnyFilter(filters)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Preview matches
              </button>
              <button
                onClick={() => { setFilters(EMPTY_FILTERS); resetPreview() }}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </Card>

        {/* Results */}
        {count !== null && (
          <Card className="overflow-hidden border-2 border-red-100">
            <div className="p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm text-slate-700">
                    <strong className="text-slate-900">{count.toLocaleString()}</strong> booking{count !== 1 ? 's' : ''} match
                    {sample.length < count && <span className="text-slate-400"> (showing first {sample.length})</span>}
                  </span>
                </div>
                <button
                  onClick={openModal}
                  disabled={count === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {count.toLocaleString()}
                </button>
              </div>

              {sample.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Ref</th>
                        <th className="text-left font-semibold px-3 py-2">Status</th>
                        <th className="text-left font-semibold px-3 py-2">Country</th>
                        <th className="text-left font-semibold px-3 py-2">Arrival</th>
                        <th className="text-left font-semibold px-3 py-2">Departure</th>
                        <th className="text-left font-semibold px-3 py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sample.map(r => (
                        <tr key={r.bookingRef} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-800">{r.bookingRef}</td>
                          <td className="px-3 py-2 text-slate-600">{r.status}</td>
                          <td className="px-3 py-2 text-slate-600">{r.operationCountry ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{fmt(r.arrivalDate)}</td>
                          <td className="px-3 py-2 text-slate-600">{fmt(r.departureDate)}</td>
                          <td className="px-3 py-2 text-slate-600">{fmt(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {done ? (
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">Bookings Deleted</h3>
                <p className="text-slate-500 text-sm mb-6">
                  Matched bookings were permanently removed. The action is recorded in the audit log.
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Confirm Deletion</h3>
                    <p className="text-red-200 text-xs">This cannot be undone</p>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <strong>Warning:</strong> You are about to permanently delete{' '}
                    <strong>{count?.toLocaleString()} booking{count !== 1 ? 's' : ''}</strong> matching your
                    filters and all related records. This action is logged under your account.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      <Lock className="w-3 h-3 inline mr-1" />
                      Critical Services Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-colors"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Type <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-red-600">{CONFIRM_PHRASE}</span> to confirm
                    </label>
                    <input
                      type="text"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      className={`w-full px-3 py-2.5 text-sm rounded-lg border transition-colors focus:outline-none focus:ring-2 ${
                        confirm && confirm !== CONFIRM_PHRASE
                          ? 'border-red-300 focus:ring-red-200'
                          : confirm === CONFIRM_PHRASE
                            ? 'border-green-300 focus:ring-green-200'
                            : 'border-slate-200 focus:ring-slate-200'
                      }`}
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowModal(false)}
                      disabled={deleting}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={!canSubmit}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
                    >
                      {deleting ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</>
                      ) : (
                        <><Trash2 className="w-4 h-4" /> Delete</>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
