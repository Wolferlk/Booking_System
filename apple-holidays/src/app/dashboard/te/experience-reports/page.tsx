'use client'

/**
 * Experience Report Centre.
 *
 * The end-of-trip report that goes to the agent — every one ever prepared, the
 * ones held back because the client had a bad experience, and the mail exactly
 * as it was sent.
 *
 * Held reports sort to the top and get their own lane at the head of the page,
 * because a held report is the only thing here with someone waiting on it.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, CheckCircle2, FileText, Hand, Inbox, Loader2, Mail,
  PenLine, Plus, RefreshCw, Search, Settings2, Sparkles, X,
} from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'
import Modal from '@/components/ui/modal'
import ReportDetail from '@/components/te/experience-reports/report-detail'
import SettingsPanel from '@/components/te/experience-reports/settings-panel'
import {
  ChannelChips, ClientMailChip, Empty, fmtDate, fmtRelative, RiskPill, StatusPill,
} from '@/components/te/experience-reports/shared'
import type {
  ExperienceReportSettings, ExperienceReportSummary, ReportStatus,
} from '@/lib/te/experience-report/types'

const STATUS_TABS: { key: ReportStatus | 'all'; label: string }[] = [
  { key: 'held', label: 'Needs attention' },
  { key: 'pending', label: 'Awaiting write-up' },
  { key: 'draft', label: 'To review' },
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'Everything' },
]

interface ListResponse {
  items: ExperienceReportSummary[]
  total: number
  counts: Record<string, number>
  settings: ExperienceReportSettings
}

// ─── Build dialog ─────────────────────────────────────────────────────────────

function BuildDialog({ open, onClose, onBuilt }: {
  open: boolean
  onClose: () => void
  onBuilt: (id: string) => void
}) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const bookingRef = ref.trim().toUpperCase()
    if (!bookingRef) { toast.error('Enter a booking reference.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/te/experience-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Report built')
      setRef('')
      onBuilt(json.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Build an experience report" size="lg">
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-slate-500">
          Pulls together everything we have for one finished trip — the follow-up calls, the guest&apos;s feedback form
          and any notes from the desk — grades it, and writes the report. It is not sent until you send it.
        </p>

        <div>
          <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            Booking reference
          </label>
          <input
            autoFocus
            value={ref}
            onChange={e => setRef(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            placeholder="VN40553"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Build report
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ReportRow({ item, onOpen }: { item: ExperienceReportSummary; onOpen: () => void }) {
  const held = item.status === 'held'
  const pending = item.status === 'pending'
  return (
    <button
      onClick={onOpen}
      className={`group flex w-full items-center gap-4 border-l-4 px-5 py-4 text-left transition hover:bg-slate-50 ${
        held ? 'border-rose-400 bg-rose-50/30'
        : pending ? 'border-violet-300 bg-violet-50/30'
        : 'border-transparent'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-extrabold tracking-tight text-slate-900">{item.bookingRef}</span>
          <StatusPill status={item.status} />
          {item.riskLevel !== 'none' && <RiskPill level={item.riskLevel} score={item.riskScore} />}
          {item.triggerSource === 'auto' && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">auto</span>
          )}
        </div>

        <p className="mt-1 truncate text-[13.5px] font-semibold text-slate-700">
          {item.clientName ?? 'Guest'}
          {item.agentName && <span className="font-normal text-slate-400"> · {item.agentName}</span>}
        </p>

        {item.headline && (
          <p className="mt-0.5 truncate text-[12px] italic text-slate-400">{item.headline}</p>
        )}

        {held && item.holdReason && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold leading-relaxed text-rose-600">
            <Hand className="mt-0.5 h-3 w-3 shrink-0" />
            {item.holdReason}
          </p>
        )}

        {pending && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold leading-relaxed text-violet-600">
            <PenLine className="mt-0.5 h-3 w-3 shrink-0" />
            No call and no feedback form — waiting for the Experience team to write this one.
          </p>
        )}
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-[12px] font-semibold text-slate-600">
          {fmtDate(item.arrivalDate)} → {fmtDate(item.departureDate)}
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <ClientMailChip sentAt={item.clientMailSentAt} />
          <ChannelChips channels={item.sources} />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {item.status === 'sent'
            ? `Sent ${fmtRelative(item.sentAt)}`
            : `Built ${fmtRelative(item.createdAt)}`}
        </p>
      </div>
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ExperienceReportsPage() {
  const router = useRouter()
  const params = useSearchParams()

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<ReportStatus | 'all'>('held')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [openId, setOpenId] = useState<string | null>(params.get('report'))
  const [showBuild, setShowBuild] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ status, limit: '100' })
      if (debounced) q.set('search', debounced)
      const res = await fetch(`/api/te/experience-reports?${q}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load reports')
    } finally {
      setLoading(false)
    }
  }, [status, debounced])

  useEffect(() => { void load() }, [load])

  // Keep the open report in the URL, so an escalation mail can link straight to it.
  useEffect(() => {
    const current = params.get('report')
    if (openId === current) return
    const next = new URLSearchParams(Array.from(params.entries()))
    if (openId) next.set('report', openId)
    else next.delete('report')
    router.replace(`/dashboard/te/experience-reports${next.toString() ? `?${next}` : ''}`, { scroll: false })
  }, [openId, params, router])

  // Memoised so the tile list below is not rebuilt on every render — the
  // `?? {}` fallback would otherwise be a fresh object each time.
  const counts = useMemo(() => data?.counts ?? {}, [data])
  const heldCount = counts.held ?? 0
  const pendingCount = counts.pending ?? 0

  const tiles = useMemo(() => ([
    { label: 'Held for review', value: heldCount, icon: Hand, tone: 'text-rose-600', ring: 'ring-rose-200 bg-rose-50' },
    { label: 'Awaiting write-up', value: pendingCount, icon: PenLine, tone: 'text-violet-600', ring: 'ring-violet-200 bg-violet-50' },
    { label: 'Waiting to send', value: counts.draft ?? 0, icon: FileText, tone: 'text-amber-600', ring: 'ring-amber-200 bg-amber-50' },
    { label: 'Sent to agents', value: counts.sent ?? 0, icon: CheckCircle2, tone: 'text-emerald-600', ring: 'ring-emerald-200 bg-emerald-50' },
    { label: 'Failed to send', value: counts.failed ?? 0, icon: AlertTriangle, tone: 'text-orange-600', ring: 'ring-orange-200 bg-orange-50' },
  ]), [counts, heldCount, pendingCount])

  return (
    <>
      <Header
        title="Experience Reports"
        subtitle="One report per trip, at the end of the trip — and the ones we stopped before they reached the agent"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Settings"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowBuild(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-violet-700"
            >
              <Plus className="h-4 w-4" />
              Build report
            </button>
          </div>
        }
      />

      <div className="px-4 py-6 sm:px-8">

        {/* Held lane — the only thing on this page with someone waiting */}
        {heldCount > 0 && status !== 'held' && (
          <button
            onClick={() => setStatus('held')}
            className="mb-5 flex w-full items-center gap-3 rounded-2xl border-2 border-rose-200 bg-rose-50 px-5 py-4 text-left transition hover:bg-rose-100"
          >
            <Hand className="h-5 w-5 shrink-0 text-rose-600" strokeWidth={2.4} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-rose-900">
                {heldCount} report{heldCount === 1 ? '' : 's'} held — {heldCount === 1 ? 'a client' : 'clients'} had a bad experience
              </p>
              <p className="text-[12.5px] text-rose-600">
                {heldCount === 1 ? 'This agent has' : 'These agents have'} not been told. Review and decide what happens next.
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-bold text-rose-600">Review →</span>
          </button>
        )}

        {/* Awaiting write-up lane — nothing was heard from these travellers */}
        {pendingCount > 0 && status !== 'pending' && (
          <button
            onClick={() => setStatus('pending')}
            className="mb-5 flex w-full items-center gap-3 rounded-2xl border-2 border-violet-200 bg-violet-50 px-5 py-4 text-left transition hover:bg-violet-100"
          >
            <PenLine className="h-5 w-5 shrink-0 text-violet-600" strokeWidth={2.4} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-violet-900">
                {pendingCount} finished trip{pendingCount === 1 ? '' : 's'} with no call and no feedback form
              </p>
              <p className="text-[12.5px] text-violet-600">
                Nothing was sent automatically. Write the summary and these can go to their agents.
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-bold text-violet-600">Write them →</span>
          </button>
        )}

        {/* Tiles */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {tiles.map(tile => {
            const Icon = tile.icon
            return (
              <div key={tile.label} className={`rounded-2xl p-4 ring-1 ${tile.ring}`}>
                <Icon className={`h-4 w-4 ${tile.tone}`} />
                <p className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{tile.value}</p>
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{tile.label}</p>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {STATUS_TABS.map(tab => {
              const active = status === tab.key
              const n = counts[tab.key] ?? (tab.key === 'all' ? counts.all : 0)
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatus(tab.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition ${
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                  {!!n && (
                    <span className={`rounded-full px-1.5 text-[10px] ${
                      tab.key === 'held' && n > 0 ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-600'
                    }`}>
                      {n}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Booking, client, agent or email"
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-8 text-[13px] text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {loading && !data ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : !data?.items.length ? (
            <div className="p-6">
              <Empty
                icon={status === 'held' ? CheckCircle2 : status === 'pending' ? PenLine : Inbox}
                title={
                  status === 'held' ? 'Nothing is held right now.'
                  : status === 'pending' ? 'Nothing is waiting to be written up.'
                  : debounced ? 'No reports match that search.'
                  : 'No reports here yet.'
                }
                hint={
                  status === 'held'
                    ? 'Every trip we have reported on went well enough to reach the agent.'
                    : status === 'pending'
                    ? 'Every finished trip had either a call or a feedback form behind it.'
                    : 'Reports appear once a trip ends and feedback has been collected. Use Build report to make one now.'
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.items.map(item => (
                <ReportRow key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
              ))}
            </div>
          )}
        </div>

        {!!data?.items.length && (
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-400">
            <Mail className="h-3 w-3" />
            Showing {data.items.length} of {data.total}. Transcripts are kept out of every agent mail — open a report to read them.
          </p>
        )}
      </div>

      {openId && (
        <ReportDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}

      <BuildDialog
        open={showBuild}
        onClose={() => setShowBuild(false)}
        onBuilt={id => { setShowBuild(false); setOpenId(id); void load() }}
      />

      {data?.settings && (
        <SettingsPanel
          open={showSettings}
          settings={data.settings}
          onClose={() => setShowSettings(false)}
          onSaved={next => setData(d => (d ? { ...d, settings: next } : d))}
        />
      )}
    </>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>}>
      <ExperienceReportsPage />
    </Suspense>
  )
}
