'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, Play, Settings2, Clock, CheckCircle2,
  AlertTriangle, Loader2, FolderSync, RefreshCw,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Info,
  XCircle, Zap,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AutoCreateSettings {
  enabled:   boolean
  daysAhead: number
  hour:      number
  minute:    number
}

interface JobRecord {
  id:           string
  targetDate:   string
  triggeredBy:  string
  status:       string
  results:      string | null
  totalCreated: number
  totalUpdated: number
  totalErrors:  number
  durationMs:   number | null
  errorMessage: string | null
  createdAt:    string
  completedAt:  string | null
}

interface DriveResult {
  driveKey:        string
  label:           string
  scanned:         number
  bookingsCreated: number
  bookingsUpdated: number
  errors:          number
  events:          { ref: string; type: string; file: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DRIVE_COLORS: Record<string, string> = {
  VN: 'bg-red-100 text-red-700',
  SL: 'bg-green-100 text-green-700',
  SG: 'bg-blue-100 text-blue-700',
  MY: 'bg-amber-100 text-amber-700',
}

function fmtDuration(ms: number | null) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function pad2(n: number) { return String(n).padStart(2, '0') }

// ── Component ─────────────────────────────────────────────────────────────────

export default function OneDriveBookingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [settings, setSettings]             = useState<AutoCreateSettings>({ enabled: false, daysAhead: 10, hour: 6, minute: 0 })
  const [editSettings, setEditSettings]     = useState<AutoCreateSettings>({ enabled: false, daysAhead: 10, hour: 6, minute: 0 })
  const [jobs, setJobs]                     = useState<JobRecord[]>([])
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [loadingJobs, setLoadingJobs]       = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [running, setRunning]               = useState(false)
  const [expandedJob, setExpandedJob]       = useState<string | null>(null)
  const [manualDate, setManualDate]         = useState('')
  const [manualDrives, setManualDrives]     = useState<string[]>([])

  const ALL_DRIVES = ['VN', 'SL', 'SG', 'MY']

  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.replace('/login'); return }
    if (!['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
      router.replace('/dashboard')
    }
  }, [session, status, router])

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true)
    try {
      const res = await fetch('/api/admin/onedrive-booking-auto/settings')
      if (res.ok) {
        const data: AutoCreateSettings = await res.json()
        setSettings(data)
        setEditSettings(data)
      }
    } catch { /* ignore */ }
    setLoadingSettings(false)
  }, [])

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true)
    try {
      const res = await fetch('/api/admin/onedrive-booking-auto/jobs?limit=30')
      if (res.ok) setJobs(await res.json())
    } catch { /* ignore */ }
    setLoadingJobs(false)
  }, [])

  useEffect(() => { loadSettings(); loadJobs() }, [loadSettings, loadJobs])

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      const res = await fetch('/api/admin/onedrive-booking-auto/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editSettings),
      })
      if (res.ok) { setSettings(editSettings); toast.success('Settings saved') }
      else toast.error('Failed to save settings')
    } catch { toast.error('Network error') }
    setSavingSettings(false)
  }

  async function handleRunNow() {
    setRunning(true)
    toast.info('Starting auto-booking create…')
    try {
      const body: Record<string, unknown> = {}
      if (manualDate) body.targetDate = manualDate
      if (manualDrives.length > 0) body.driveKeys = manualDrives

      const res = await fetch('/api/admin/onedrive-booking-auto/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Run failed')
        setRunning(false)
        return
      }

      // Poll job status until done (avoids 60s GCP gateway timeout)
      const jobId: string = data.jobId
      let done = false
      while (!done) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const poll = await fetch(`/api/admin/onedrive-booking-auto/jobs/${jobId}`)
          if (poll.ok) {
            const job = await poll.json()
            if (job.status !== 'running') {
              done = true
              if (job.totalErrors > 0) {
                toast.warning(`Done — Created: ${job.totalCreated}, Updated: ${job.totalUpdated}, Errors: ${job.totalErrors}`)
              } else {
                toast.success(`Done — Created: ${job.totalCreated}, Updated: ${job.totalUpdated}`)
              }
              await loadJobs()
            }
          }
        } catch { /* keep polling */ }
      }
    } catch { toast.error('Network error') }
    setRunning(false)
  }

  function toggleDrive(key: string) {
    setManualDrives(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key])
  }

  function parseResults(job: JobRecord): DriveResult[] | null {
    if (!job.results) return null
    try { return JSON.parse(job.results) } catch { return null }
  }

  if (status === 'loading' || loadingSettings) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    )
  }

  const targetDatePreview = (() => {
    const d = new Date()
    d.setDate(d.getDate() + settings.daysAhead)
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  })()

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="OneDrive Auto Booking Create" subtitle="Automatically create bookings from OneDrive date folders on a daily schedule" />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* Status banner */}
        <div className={`rounded-xl border px-5 py-4 flex items-center gap-4 ${
          settings.enabled ? 'bg-green-50 border-green-200' : 'bg-gray-100 border-gray-200'
        }`}>
          {settings.enabled
            ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
            : <XCircle className="w-5 h-5 text-gray-400 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <p className={`font-semibold ${settings.enabled ? 'text-green-800' : 'text-gray-500'}`}>
              {settings.enabled ? 'Auto-Create is Active' : 'Auto-Create is Disabled'}
            </p>
            {settings.enabled && (
              <p className="text-sm text-green-700 mt-0.5">
                Runs daily at <strong>{pad2(settings.hour)}:{pad2(settings.minute)}</strong> — processes the folder for{' '}
                <strong>{targetDatePreview}</strong> ({settings.daysAhead} days ahead)
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Settings card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-brand-500" />
                <span className="font-semibold text-gray-800">Schedule Settings</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-5">

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800 text-sm">Enable Auto-Create</p>
                  <p className="text-xs text-gray-500 mt-0.5">Run daily at the scheduled time</p>
                </div>
                <button onClick={() => setEditSettings(s => ({ ...s, enabled: !s.enabled }))}>
                  {editSettings.enabled
                    ? <ToggleRight className="w-9 h-9 text-brand-600" />
                    : <ToggleLeft className="w-9 h-9 text-gray-400" />
                  }
                </button>
              </div>

              {/* Days ahead */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Days Ahead
                  <span className="ml-2 text-xs text-gray-400">(how far ahead from today to target)</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={1} max={90}
                    value={editSettings.daysAhead}
                    onChange={e => setEditSettings(s => ({ ...s, daysAhead: Number(e.target.value) }))}
                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                  <span className="text-sm text-gray-500">
                    → targets{' '}
                    {(() => {
                      const d = new Date()
                      d.setDate(d.getDate() + editSettings.daysAhead)
                      return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
                    })()}
                  </span>
                </div>
              </div>

              {/* Time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Run Time (server local time)
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Clock className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                    <select
                      value={editSettings.hour}
                      onChange={e => setEditSettings(s => ({ ...s, hour: Number(e.target.value) }))}
                      className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{pad2(h)}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-gray-500 font-medium">:</span>
                  <select
                    value={editSettings.minute}
                    onChange={e => setEditSettings(s => ({ ...s, minute: Number(e.target.value) }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                      <option key={m} value={m}>{pad2(m)}</option>
                    ))}
                  </select>
                  <span className="text-sm text-gray-500">= {pad2(editSettings.hour)}:{pad2(editSettings.minute)}</span>
                </div>
              </div>

              <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
                {savingSettings
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</>
                  : <><CheckCircle2 className="w-4 h-4 mr-2" />Save Settings</>
                }
              </Button>
            </CardBody>
          </Card>

          {/* Manual trigger card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-gray-800">Manual Trigger</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-5">

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Manually trigger a run for any date. If no date is set, uses today + days-ahead setting.
                  Leave drives empty to process all 4 drives.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Target Date Override
                  <span className="ml-2 text-xs text-gray-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={manualDate}
                  onChange={e => setManualDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Drives
                  <span className="ml-2 text-xs text-gray-400">(empty = all)</span>
                </p>
                <div className="flex gap-2 flex-wrap">
                  {ALL_DRIVES.map(k => (
                    <button
                      key={k}
                      onClick={() => toggleDrive(k)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                        manualDrives.includes(k)
                          ? `${DRIVE_COLORS[k]} border-current`
                          : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleRunNow} disabled={running} variant="primary" className="w-full">
                {running
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Running…</>
                  : <><Play className="w-4 h-4 mr-2" />Run Now</>
                }
              </Button>
            </CardBody>
          </Card>
        </div>

        {/* Job history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-brand-500" />
                <span className="font-semibold text-gray-800">Job History</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{jobs.length}</span>
              </div>
              <button onClick={loadJobs} disabled={loadingJobs} className="text-gray-400 hover:text-gray-600 transition-colors">
                <RefreshCw className={`w-4 h-4 ${loadingJobs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {loadingJobs ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12">
                <FolderSync className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No jobs run yet</p>
                <p className="text-gray-400 text-xs mt-1">Jobs will appear here after each auto or manual run</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {jobs.map(job => {
                  const driveResults = parseResults(job)
                  const isExpanded   = expandedJob === job.id
                  const isRunning    = job.status === 'running'

                  return (
                    <div key={job.id} className="hover:bg-gray-50 transition-colors">
                      <button
                        onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                        className="w-full text-left px-5 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          {isRunning
                            ? <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                            : job.totalErrors > 0
                              ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                              : <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                          }
                          <span className="font-semibold text-gray-800 text-sm w-36 shrink-0">
                            {fmtDate(job.targetDate)}
                          </span>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                              +{job.totalCreated} created
                            </span>
                            {job.totalUpdated > 0 && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                {job.totalUpdated} updated
                              </span>
                            )}
                            {job.totalErrors > 0 && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                                {job.totalErrors} errors
                              </span>
                            )}
                          </div>
                          <div className="hidden sm:flex flex-col items-end shrink-0 gap-0.5">
                            <span className="text-xs text-gray-400">{fmtDateTime(job.createdAt)}</span>
                            <span className="text-xs text-gray-400">
                              {job.triggeredBy.startsWith('manual:') ? `Manual · ${job.triggeredBy.slice(7)}` : 'Auto'}
                              {job.durationMs ? ` · ${fmtDuration(job.durationMs)}` : ''}
                            </span>
                          </div>
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                          }
                        </div>
                      </button>

                      {isExpanded && driveResults && (
                        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          {driveResults.map(r => (
                            <div key={r.driveKey} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${DRIVE_COLORS[r.driveKey] ?? 'bg-gray-200 text-gray-600'}`}>
                                  {r.driveKey}
                                </span>
                                <span className="text-xs text-gray-500 truncate">{r.label}</span>
                              </div>
                              <div className="space-y-0.5 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Scanned</span>
                                  <span className="font-medium text-gray-700">{r.scanned}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Created</span>
                                  <span className="font-medium text-green-700">{r.bookingsCreated}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Updated</span>
                                  <span className="font-medium text-blue-700">{r.bookingsUpdated}</span>
                                </div>
                                {r.errors > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500">Errors</span>
                                    <span className="font-medium text-red-600">{r.errors}</span>
                                  </div>
                                )}
                              </div>
                              {r.events.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5">
                                  {r.events.slice(0, 5).map((ev, i) => (
                                    <p key={i} className="text-xs text-gray-500 truncate">
                                      <span className="font-medium text-gray-700">{ev.ref}</span>
                                      {' · '}{ev.type}
                                    </p>
                                  ))}
                                  {r.events.length > 5 && (
                                    <p className="text-xs text-gray-400">+{r.events.length - 5} more</p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

      </main>
    </div>
  )
}
