'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  FolderOpen, RefreshCw, CheckCircle, AlertCircle, Loader2,
  Clock, FileText, TrendingUp, Trash2, ChevronRight, Activity,
  RotateCcw, HardDrive, Search, ExternalLink, Link2, Calendar,
  MapPin, Zap, X, Sunrise,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveEvent {
  id:           string
  driveType:    string
  itemName:     string
  itemPath:     string
  webUrl?:      string | null
  eventType:    string
  bookingRef?:  string | null
  status:       string
  errorMessage?: string | null
  processedAt?: string | null
  createdAt:    string
}

interface DeltaToken {
  driveKey:  string
  token:     string
  updatedAt: string
}

interface StatGroup {
  driveType: string
  eventType: string
  status:    string
  _count:    { _all: number }
}

interface ScanResult {
  driveKey:        string
  label:           string
  scanned:         number
  bookingsCreated: number
  bookingsUpdated: number
  pnlsUpdated:     number
  errors:          number
  events:          { ref: string; type: string; file: string }[]
}

interface DriveConfig {
  key:     string
  label:   string
  country: string
}

interface DriveAccessResult {
  driveKey: string
  label: string
  rootPath: string
  ok: boolean
  driveId?: string
  folderCount?: number
  sampleFolders?: string[]
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, React.ReactNode> = {
  FOLDER_DETECTED: <FolderOpen className="w-3.5 h-3.5 text-blue-500" />,
  TC_PROCESSED:    <FileText className="w-3.5 h-3.5 text-green-500" />,
  PNL_PROCESSED:   <TrendingUp className="w-3.5 h-3.5 text-purple-500" />,
  FILE_DETECTED:   <FileText className="w-3.5 h-3.5 text-slate-400" />,
  ERROR:           <AlertCircle className="w-3.5 h-3.5 text-red-500" />,
  SKIPPED:         <Clock className="w-3.5 h-3.5 text-amber-400" />,
}

const STATUS_COLORS: Record<string, string> = {
  PROCESSED: 'bg-green-100 text-green-700',
  ERROR:     'bg-red-100 text-red-700',
  PENDING:   'bg-amber-100 text-amber-700',
  SKIPPED:   'bg-slate-100 text-slate-500',
}

const DRIVE_COLORS: Record<string, { badge: string; bg: string; border: string; text: string }> = {
  VN: { badge: 'bg-red-100 text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700' },
  SL: { badge: 'bg-green-100 text-green-700', bg: 'bg-green-50', border: 'border-green-200',  text: 'text-green-700' },
  SG: { badge: 'bg-blue-100 text-blue-700',  bg: 'bg-blue-50',  border: 'border-blue-200',   text: 'text-blue-700' },
  MY: { badge: 'bg-amber-100 text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200',  text: 'text-amber-700' },
}

function dc(key: string) {
  return DRIVE_COLORS[key] ?? { badge: 'bg-slate-100 text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600' }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// today & 30-days-ago as YYYY-MM-DD
function todayISO()  { return new Date().toISOString().slice(0, 10) }
function monthAgoISO() {
  const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OneDriveMonitorPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()

  // ── data state ──
  const [events, setEvents]         = useState<DriveEvent[]>([])
  const [stats, setStats]           = useState<StatGroup[]>([])
  const [tokens, setTokens]         = useState<DeltaToken[]>([])
  const [drives, setDrives]         = useState<DriveConfig[]>([])
  const [access, setAccess]         = useState<DriveAccessResult[]>([])
  const [loading, setLoading]       = useState(true)
  const [lastScan, setLastScan]     = useState<ScanResult[] | null>(null)
  const [checkingAccess, setCheckingAccess] = useState(false)

  // ── filter state (event log) ──
  const [logSearch, setLogSearch]   = useState('')
  const [logDrive, setLogDrive]     = useState('')
  const [logStatus, setLogStatus]   = useState('')

  // ── scan panel state ──
  const [syncing, setSyncing]           = useState(false)
  const [autoRefresh, setAutoRefresh]   = useState(false)
  const [todaySyncing, setTodaySyncing] = useState<Record<string, boolean>>({})

  // Country (drive) selection
  const [selectedDrives, setSelectedDrives] = useState<string[]>([])

  // Scan mode: 'delta' | 'daterange' | 'bookingref'
  const [scanMode, setScanMode]     = useState<'delta' | 'daterange' | 'bookingref'>('delta')

  // Date range
  const [dateFrom, setDateFrom]     = useState(monthAgoISO)
  const [dateTo, setDateTo]         = useState(todayISO)

  // Booking ref
  const [refInput, setRefInput]     = useState('')

  // ── auth guard ──
  useEffect(() => {
    if (authStatus === 'loading') return
    if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
      router.replace('/dashboard')
    }
  }, [session, authStatus, router])

  // ── load event log + drive config ──
  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (logDrive)  params.set('driveKey', logDrive)
      if (logStatus) params.set('status',   logStatus)
      params.set('limit', '500')

      const [evRes, cfgRes, acRes] = await Promise.all([
        fetch(`/api/onedrive/events?${params}`),
        fetch('/api/onedrive/sync'),
        fetch('/api/onedrive/access'),
      ])
      const evJson  = await evRes.json()
      const cfgJson = await cfgRes.json()
      const acJson  = await acRes.json()

      if (evJson.success) {
        setEvents(evJson.data.events)
        setStats(evJson.data.stats)
        setTokens(evJson.data.deltaTokens)
      }
      if (cfgJson.success) {
        setDrives(cfgJson.data.drives)
        // default: all drives selected
        setSelectedDrives(prev => prev.length ? prev : cfgJson.data.drives.map((d: DriveConfig) => d.key))
      }
      if (acJson.success) {
        setAccess(acJson.data.results ?? [])
      }
    } catch { /* ignore */ }
    finally  { setLoading(false) }
  }, [logDrive, logStatus])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadData, 15_000)
    return () => clearInterval(id)
  }, [autoRefresh, loadData])

  // ── scan handler ──
  async function runScan() {
    if (syncing) return
    setSyncing(true)
    try {
      const body: Record<string, unknown> = {
        driveKeys: selectedDrives.length ? selectedDrives : undefined,
      }

      if (scanMode === 'daterange') {
        if (!dateFrom || !dateTo) { toast.error('Please set a date range'); return }
        body.dateFrom = dateFrom
        body.dateTo   = dateTo
      } else if (scanMode === 'bookingref') {
        const ref = refInput.trim().toUpperCase()
        if (!ref) { toast.error('Please enter a booking ref'); return }
        body.bookingRef = ref
      }

      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      const results: ScanResult[] = json.data.results ?? []
      setLastScan(results)

      if (scanMode === 'bookingref') {
        const found = results.some(r => r.bookingsCreated + r.bookingsUpdated + r.pnlsUpdated > 0)
        toast[found ? 'success' : 'warning'](json.message)
      } else {
        const t = json.data.total
        toast.success(`Scan complete: ${t.bookingsCreated} created, ${t.bookingsUpdated} updated, ${t.pnlsUpdated} PNLs${t.errors ? ` · ${t.errors} errors` : ''}`)
      }
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setSyncing(false)
    }
  }

  async function resetToken(driveKey?: string) {
    if (!confirm(`Reset delta token for ${driveKey ?? 'ALL drives'}? Next delta sync will do a full scan.`)) return
    try {
      const res  = await fetch('/api/onedrive/events', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(driveKey ? { driveKey } : {}),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    }
  }

  async function runTodayOnwards(driveKey: string) {
    if (todaySyncing[driveKey]) return
    setTodaySyncing(prev => ({ ...prev, [driveKey]: true }))
    try {
      const today   = new Date().toISOString().slice(0, 10)
      const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ driveKeys: [driveKey], dateFrom: today, dateTo: oneYear }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const t = json.data.total
      setLastScan(json.data.results ?? [])
      toast.success(
        `${driveKey} — Today onwards: ${t.bookingsCreated} created, ${t.bookingsUpdated} updated, ${t.pnlsUpdated} PNLs${t.errors ? ` · ${t.errors} errors` : ''}`,
      )
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${driveKey} scan failed`)
    } finally {
      setTodaySyncing(prev => ({ ...prev, [driveKey]: false }))
    }
  }

  function toggleDrive(key: string) {
    setSelectedDrives(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    )
  }

  async function refreshAccessChecks() {
    if (checkingAccess) return
    setCheckingAccess(true)
    try {
      const res = await fetch('/api/onedrive/access')
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Access check failed')
      setAccess(json.data.results ?? [])
      toast.success('OneDrive access check complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Access check failed')
    } finally {
      setCheckingAccess(false)
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    )
  }

  // Drive summary stats
  const driveStats: Record<string, { tc: number; pnl: number; folders: number; errors: number }> = {}
  for (const s of stats) {
    if (!driveStats[s.driveType]) driveStats[s.driveType] = { tc: 0, pnl: 0, folders: 0, errors: 0 }
    if (s.eventType === 'TC_PROCESSED'    && s.status === 'PROCESSED') driveStats[s.driveType].tc      += s._count._all
    if (s.eventType === 'PNL_PROCESSED'   && s.status === 'PROCESSED') driveStats[s.driveType].pnl     += s._count._all
    if (s.eventType === 'FOLDER_DETECTED' && s.status === 'PROCESSED') driveStats[s.driveType].folders += s._count._all
    if (s.status === 'ERROR') driveStats[s.driveType].errors += s._count._all
  }

  const filteredEvents = events.filter(e => {
    if (logSearch) {
      const q = logSearch.toLowerCase()
      if (!e.bookingRef?.toLowerCase().includes(q) && !e.itemName.toLowerCase().includes(q) && !e.driveType.toLowerCase().includes(q)) return false
    }
    return true
  })

  const scanModeLabel = scanMode === 'delta' ? 'Delta Sync' : scanMode === 'daterange' ? 'Date Range Scan' : 'Find & Process Booking'

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="OneDrive Access"
        subtitle="View and test access across all configured user drives"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${autoRefresh ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Activity className="w-3.5 h-3.5" />
              {autoRefresh ? 'Auto-refresh ON (15s)' : 'Auto-refresh'}
            </button>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadData}>
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={checkingAccess}
              icon={<CheckCircle className="w-3.5 h-3.5" />}
              onClick={refreshAccessChecks}
            >
              Test Access
            </Button>
          </div>
          <a
            href="/dashboard/admin"
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <ChevronRight className="w-3 h-3 rotate-180" /> Back to Admin
          </a>
        </div>

        {/* ── Drive stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {drives.map(d => {
            const ds  = driveStats[d.key] ?? { tc: 0, pnl: 0, folders: 0, errors: 0 }
            const tok = tokens.find(t => t.driveKey === d.key)
            const ac  = access.find(a => a.driveKey === d.key)
            const col = dc(d.key)
            return (
              <Card key={d.key} className={`border ${col.border}`}>
                <CardBody className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`inline-flex text-xs font-bold px-2 py-0.5 rounded-full ${col.badge}`}>{d.key}</span>
                      <p className="text-sm font-semibold text-slate-800 mt-1 leading-tight">{d.label}</p>
                    </div>
                    {ds.errors > 0 && (
                      <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">{ds.errors} err</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="bg-white border border-slate-100 rounded-lg py-1.5">
                      <p className="text-base font-bold text-slate-900">{ds.folders}</p>
                      <p className="text-xs text-slate-400">Folders</p>
                    </div>
                    <div className="bg-green-50 border border-green-100 rounded-lg py-1.5">
                      <p className="text-base font-bold text-green-700">{ds.tc}</p>
                      <p className="text-xs text-green-500">TCs</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-100 rounded-lg py-1.5">
                      <p className="text-base font-bold text-purple-700">{ds.pnl}</p>
                      <p className="text-xs text-purple-500">PNLs</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    {tok ? `Synced ${fmtDate(tok.updatedAt)}` : <span className="text-amber-500">No delta token</span>}
                  </p>
                  <div className={`text-xs rounded-lg border px-2.5 py-2 ${ac ? (ac.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700') : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    {ac ? (
                      ac.ok ? (
                        <div className="space-y-1">
                          <div className="font-semibold">Access OK</div>
                          <div className="text-[11px] opacity-80">
                            {ac.rootPath} · {ac.folderCount ?? 0} items
                          </div>
                          {ac.sampleFolders && ac.sampleFolders.length > 0 && (
                            <div className="text-[11px] truncate opacity-80">
                              {ac.sampleFolders.join(', ')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-semibold">Access failed</div>
                          <div className="text-[11px] opacity-80 truncate">{ac.error}</div>
                        </div>
                      )
                    ) : (
                      'Access check not run yet'
                    )}
                  </div>
                  <button
                    onClick={() => runTodayOnwards(d.key)}
                    disabled={!!todaySyncing[d.key]}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-1.5 border transition-colors disabled:opacity-50 ${col.bg} ${col.border} ${col.text}`}
                    title={`Scan ${d.label} from today onwards`}
                  >
                    {todaySyncing[d.key]
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Processing…</>
                      : <><Zap className="w-3 h-3" /> Today Onwards</>
                    }
                  </button>
                  <button
                    onClick={() => resetToken(d.key)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-slate-400 hover:text-red-500 border border-slate-200 rounded-lg py-1 transition-colors"
                    title="Reset delta token"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset token
                  </button>
                </CardBody>
              </Card>
            )
          })}
        </div>

        {/* ── Today's Changes (Last 24 Hours) ── */}
        {(() => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000
          const recent = events.filter(e => new Date(e.createdAt).getTime() >= cutoff)

          // per-drive summary
          const byDrive: Record<string, { tc: number; pnl: number; folders: number; errors: number; other: number }> = {}
          for (const e of recent) {
            if (!byDrive[e.driveType]) byDrive[e.driveType] = { tc: 0, pnl: 0, folders: 0, errors: 0, other: 0 }
            if (e.eventType === 'TC_PROCESSED')    byDrive[e.driveType].tc      += 1
            else if (e.eventType === 'PNL_PROCESSED')  byDrive[e.driveType].pnl     += 1
            else if (e.eventType === 'FOLDER_DETECTED') byDrive[e.driveType].folders += 1
            else if (e.status === 'ERROR')          byDrive[e.driveType].errors  += 1
            else                                    byDrive[e.driveType].other   += 1
          }

          const totalTC      = recent.filter(e => e.eventType === 'TC_PROCESSED').length
          const totalPNL     = recent.filter(e => e.eventType === 'PNL_PROCESSED').length
          const totalFolders = recent.filter(e => e.eventType === 'FOLDER_DETECTED').length
          const totalErrors  = recent.filter(e => e.status === 'ERROR').length

          return (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Sunrise className="w-4 h-4 text-amber-500" />
                    Today&rsquo;s Changes
                    <span className="text-xs font-normal text-slate-400">— last 24 hours</span>
                  </h3>
                  <span className="text-xs text-slate-400">{recent.length} event{recent.length !== 1 ? 's' : ''}</span>
                </div>
              </CardHeader>

              {recent.length === 0 ? (
                <CardBody className="p-6 text-center">
                  <Activity className="w-6 h-6 mx-auto mb-2 text-slate-200" />
                  <p className="text-sm text-slate-400">No activity in the last 24 hours</p>
                </CardBody>
              ) : (
                <CardBody className="p-4 space-y-4">

                  {/* Totals row */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'TCs',     val: totalTC,      bg: 'bg-green-50',  border: 'border-green-100',  text: 'text-green-700',  sub: 'text-green-500'  },
                      { label: 'PNLs',    val: totalPNL,     bg: 'bg-purple-50', border: 'border-purple-100', text: 'text-purple-700', sub: 'text-purple-400' },
                      { label: 'Folders', val: totalFolders, bg: 'bg-blue-50',   border: 'border-blue-100',   text: 'text-blue-700',   sub: 'text-blue-400'   },
                      { label: 'Errors',  val: totalErrors,  bg: totalErrors > 0 ? 'bg-red-50'   : 'bg-slate-50',   border: totalErrors > 0 ? 'border-red-200'   : 'border-slate-100',   text: totalErrors > 0 ? 'text-red-700'   : 'text-slate-400', sub: totalErrors > 0 ? 'text-red-400' : 'text-slate-300' },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl border ${s.bg} ${s.border} py-2.5 text-center`}>
                        <p className={`text-xl font-bold ${s.text}`}>{s.val}</p>
                        <p className={`text-xs ${s.sub}`}>{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Per-drive chips */}
                  {Object.keys(byDrive).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(byDrive).map(([key, ds]) => {
                        const col = dc(key)
                        return (
                          <div key={key} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${col.bg} ${col.border}`}>
                            <span className={`font-bold ${col.text}`}>{key}</span>
                            {ds.tc      > 0 && <span className="text-green-700 font-medium">{ds.tc} TC</span>}
                            {ds.pnl     > 0 && <span className="text-purple-700 font-medium">{ds.pnl} PNL</span>}
                            {ds.folders > 0 && <span className="text-blue-700 font-medium">{ds.folders} folder{ds.folders !== 1 ? 's' : ''}</span>}
                            {ds.errors  > 0 && <span className="text-red-600 font-semibold">{ds.errors} err</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Event timeline */}
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    <div className="bg-slate-50 border-b border-slate-100 px-3 py-1.5">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Activity Timeline</p>
                    </div>
                    <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                      {recent.slice(0, 50).map(ev => (
                        <div key={ev.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-xs">
                          <span className="flex-shrink-0">
                            {EVENT_ICONS[ev.eventType] ?? <FileText className="w-3.5 h-3.5 text-slate-400" />}
                          </span>
                          <span className={`flex-shrink-0 font-bold px-1.5 py-0.5 rounded-full ${dc(ev.driveType).badge}`}>{ev.driveType}</span>
                          <span className="min-w-0 flex-1 font-medium text-slate-700 truncate">{ev.itemName}</span>
                          {ev.bookingRef && (
                            <a
                              href={`/dashboard/bookings/${ev.bookingRef}`}
                              target="_blank"
                              className="flex-shrink-0 flex items-center gap-0.5 text-brand-600 hover:text-brand-700 font-semibold"
                            >
                              {ev.bookingRef}<ChevronRight className="w-3 h-3" />
                            </a>
                          )}
                          {ev.webUrl && (
                            <a href={ev.webUrl} target="_blank" rel="noreferrer" className="flex-shrink-0 text-slate-400 hover:text-brand-500">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full ${STATUS_COLORS[ev.status] ?? 'bg-slate-100 text-slate-500'}`}>{ev.status}</span>
                          <span className="flex-shrink-0 text-slate-400 whitespace-nowrap">{fmtDate(ev.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </CardBody>
              )}
            </Card>
          )
        })()}

        {/* ── Scan Control Panel ── */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-brand-500" /> Scan Control
            </h3>
          </CardHeader>
          <CardBody className="p-5 space-y-5">

            {/* Country (drive) selector */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Select Country</p>
              <div className="flex flex-wrap gap-2">
                {drives.map(d => {
                  const col     = dc(d.key)
                  const active  = selectedDrives.includes(d.key)
                  return (
                    <button
                      key={d.key}
                      onClick={() => toggleDrive(d.key)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        active
                          ? `${col.bg} ${col.border} ${col.text} shadow-sm`
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-current' : 'bg-slate-300'}`} />
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{d.key}</span>
                      <span className="text-xs opacity-70">{d.country === 'VIETNAM' ? 'Vietnam' : d.country === 'SRILANKA' ? 'Sri Lanka' : d.country}</span>
                    </button>
                  )
                })}
                {selectedDrives.length === 0 && (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Select at least one country
                  </p>
                )}
              </div>
            </div>

            {/* Scan mode tabs */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Scan Mode</p>
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
                {(['delta', 'daterange', 'bookingref'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      scanMode === mode ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {mode === 'delta'      && <><RefreshCw className="w-3 h-3 inline mr-1" />Delta Sync</>}
                    {mode === 'daterange'  && <><Calendar  className="w-3 h-3 inline mr-1" />Date Range</>}
                    {mode === 'bookingref' && <><Search    className="w-3 h-3 inline mr-1" />Find Booking</>}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode-specific inputs */}
            {scanMode === 'delta' && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
                <p className="font-medium">Delta Sync</p>
                <p className="text-xs mt-1 text-blue-500">Fetches only new/changed files since the last sync. Fast and incremental. Use this for routine monitoring.</p>
              </div>
            )}

            {scanMode === 'daterange' && (
              <div className="space-y-3">
                <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-xs text-purple-700">
                  Directly walks Year → Month folder tree for the selected date range. Use for backfills or re-processing a period.
                </div>
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  <div>
                    <label className="form-label">From date</label>
                    <div className="relative">
                      <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="date"
                        className="form-input pl-8 text-sm"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">To date</label>
                    <div className="relative">
                      <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="date"
                        className="form-input pl-8 text-sm"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {scanMode === 'bookingref' && (
              <div className="space-y-3 max-w-sm">
                <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-700">
                  Searches the drive for a specific booking folder (e.g. VN19018) and processes its TC and PNL files.
                </div>
                <div>
                  <label className="form-label">Booking Reference</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        className="form-input pl-8 uppercase text-sm"
                        placeholder="e.g. VN19018"
                        value={refInput}
                        onChange={e => setRefInput(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && runScan()}
                      />
                    </div>
                    {refInput && (
                      <button onClick={() => setRefInput('')} className="text-slate-400 hover:text-slate-600 px-2">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Run button */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={runScan}
                disabled={syncing || selectedDrives.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-sm"
              >
                {syncing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                ) : (
                  <><Zap className="w-4 h-4" /> Run {scanModeLabel}</>
                )}
              </button>
              {selectedDrives.length > 0 && (
                <p className="text-xs text-slate-400">
                  {selectedDrives.join(', ')} · {scanModeLabel}
                  {scanMode === 'daterange' && dateFrom && dateTo && ` · ${dateFrom} → ${dateTo}`}
                  {scanMode === 'bookingref' && refInput && ` · ${refInput}`}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── Last scan results ── */}
        {lastScan && lastScan.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" /> Last Scan Results
                </h3>
                <button onClick={() => setLastScan(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-50">
                {lastScan.map(r => (
                  <div key={r.driveKey} className="px-4 py-3">
                    <div className="flex items-center gap-3 text-sm mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${dc(r.driveKey).badge}`}>{r.driveKey}</span>
                      <span className="text-slate-600 font-medium">{r.label}</span>
                      <span className="ml-auto flex gap-4 text-xs">
                        <span className="text-slate-400">{r.scanned} scanned</span>
                        {r.bookingsCreated > 0 && <span className="text-green-600 font-semibold">+{r.bookingsCreated} created</span>}
                        {r.bookingsUpdated > 0 && <span className="text-blue-600 font-semibold">{r.bookingsUpdated} updated</span>}
                        {r.pnlsUpdated     > 0 && <span className="text-purple-600 font-semibold">{r.pnlsUpdated} PNLs</span>}
                        {r.errors          > 0 && <span className="text-red-600 font-semibold">{r.errors} errors</span>}
                      </span>
                    </div>
                    {r.events.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {r.events.map((ev, i) => (
                          <span key={i} className={`text-xs px-2 py-0.5 rounded-full border ${ev.type === 'TC' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-purple-50 border-purple-200 text-purple-700'}`}>
                            {ev.ref} · {ev.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── Event Log ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" /> Event Log
                <span className="text-xs font-normal text-slate-400">({filteredEvents.length})</span>
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-brand-400 w-44"
                    placeholder="Search ref or file…"
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                  />
                </div>
                <select value={logDrive}  onChange={e => { setLogDrive(e.target.value);  loadData() }} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">All drives</option>
                  {drives.map(d => <option key={d.key} value={d.key}>{d.key}</option>)}
                </select>
                <select value={logStatus} onChange={e => { setLogStatus(e.target.value); loadData() }} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">All statuses</option>
                  <option value="PROCESSED">Processed</option>
                  <option value="ERROR">Errors</option>
                  <option value="PENDING">Pending</option>
                </select>
                <button
                  onClick={() => resetToken()}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1.5 transition-colors"
                  title="Reset all delta tokens"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Reset all tokens
                </button>
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {filteredEvents.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                <HardDrive className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No events yet. Run a scan to start monitoring.
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {filteredEvents.slice(0, 200).map(ev => (
                  <div key={ev.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 transition-colors text-xs">
                    <span className="flex-shrink-0 w-4 flex items-center">
                      {EVENT_ICONS[ev.eventType] ?? <FileText className="w-3.5 h-3.5 text-slate-400" />}
                    </span>
                    <span className={`flex-shrink-0 font-bold px-1.5 py-0.5 rounded-full ${dc(ev.driveType).badge}`}>{ev.driveType}</span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full ${STATUS_COLORS[ev.status] ?? 'bg-slate-100 text-slate-500'}`}>{ev.status}</span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-700 truncate">{ev.itemName}</span>
                        {ev.bookingRef && (
                          <a href={`/dashboard/bookings/${ev.bookingRef}`} target="_blank"
                            className="flex items-center gap-0.5 text-brand-600 hover:text-brand-700 font-semibold flex-shrink-0">
                            {ev.bookingRef}<ChevronRight className="w-3 h-3" />
                          </a>
                        )}
                        {ev.webUrl && (
                          <a href={ev.webUrl} target="_blank" rel="noreferrer"
                            className="text-slate-400 hover:text-brand-500 flex-shrink-0" title="Open in OneDrive">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {ev.errorMessage && <p className="text-red-500 truncate mt-0.5">{ev.errorMessage}</p>}
                    </div>

                    <span className="flex-shrink-0 text-slate-400">{fmtDate(ev.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Delta tokens ── */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-slate-400" /> Delta Sync Tokens
            </h3>
          </CardHeader>
          <CardBody className="p-0">
            {tokens.length === 0 ? (
              <p className="text-xs text-slate-400 px-4 py-3">No tokens stored — first delta sync will establish them.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {tokens.map(t => (
                  <div key={t.driveKey} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <span className={`font-bold px-2 py-0.5 rounded-full ${dc(t.driveKey).badge}`}>{t.driveKey}</span>
                    <span className="text-slate-400 font-mono truncate flex-1">{t.token.slice(0, 80)}…</span>
                    <span className="text-slate-400 flex-shrink-0">{fmtDate(t.updatedAt)}</span>
                    <button onClick={() => resetToken(t.driveKey)} className="text-slate-400 hover:text-red-500 transition-colors" title="Reset">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

      </main>
    </div>
  )
}
