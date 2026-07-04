'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Phone, PhoneCall, PhoneIncoming, PhoneMissed,
  Calendar, RefreshCw, Plus, Play, Pause,
  SkipForward, Trash2, Edit2, CheckCircle2,
  XCircle, Clock, Mic, ChevronDown, ChevronUp,
  AlertCircle, Loader2, MessageSquare, Volume2, Settings,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TEConfig {
  configured: boolean
  outbound_configured: boolean
  call_window: { start: number; end: number }
  default_call_time: string
  max_retries: number
  retry_gap_min: number
}

interface TEService {
  id: number
  booking_ref: string
  status: 'active' | 'completed' | 'cancelled'
  call_phone: string
  call_time: string
  schedule_mode: 'agenda' | 'interval'
  interval_count?: number | null
  interval_unit?: string | null
  interval_start_at?: string | null
  retry_gap_min: number
  schedule?: TEScheduleItem[]
  feedback?: TEFeedback[]
}

interface TEScheduleItem {
  id: number
  service_id: number
  call_date: string
  scheduled_at?: string | null
  day_no: number
  day_brief?: string | null
  status: 'pending' | 'done' | 'skipped' | 'failed'
  attempts: number
  last_called_at?: string | null
  last_result?: string | null
  conversation_id?: string | null
}

interface TEFeedback {
  id: number
  schedule_id?: number | null
  service_id: number
  captured: Record<string, unknown>[]
  transcript?: string | null
  created_at: string
  call_date?: string | null
  rating?: number | null
}

interface TEJob {
  id: number
  name: string
  phone: string
  customer_name: string
  campaign_id?: number | null
  booking_ref?: string | null
  start_at: string
  interval_count?: number | null
  interval_unit?: string | null
  end_at?: string | null
  max_runs?: number | null
  next_run_at?: string | null
  last_run_at?: string | null
  runs: number
  status: 'scheduled' | 'paused' | 'done' | 'cancelled'
  respect_window: boolean
  last_result?: string | null
  conversation_id?: string | null
  context?: { captured?: unknown[] }
}

interface Props {
  bookingRef: string
  booking: {
    contactWhatsapp?: string | null
    contactPhone?: string | null
    passengers?: { isLead: boolean; name: string; contact?: string | null }[]
  }
}

// ─── API helper ───────────────────────────────────────────────────────────────

function teProxy(path: string, method = 'GET', body?: unknown, extra?: Record<string, string>) {
  const url = new URL('/api/te/proxy', location.origin)
  url.searchParams.set('path', path)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  }
  const hasBody = body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)
  return fetch(url.toString(), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  }).then(r => r.json())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusChip(s: string) {
  const map: Record<string, string> = {
    active:    'bg-emerald-100 text-emerald-700',
    completed: 'bg-slate-100 text-slate-500',
    cancelled: 'bg-red-100 text-red-600',
    scheduled: 'bg-blue-100 text-blue-700',
    paused:    'bg-amber-100 text-amber-700',
    done:      'bg-emerald-100 text-emerald-700',
    failed:    'bg-red-100 text-red-600',
    skipped:   'bg-slate-100 text-slate-400',
    pending:   'bg-orange-50 text-orange-600 border border-orange-100',
  }
  return map[s] ?? 'bg-slate-100 text-slate-500'
}

function fmtDate(iso: string) {
  return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Schedule Row ─────────────────────────────────────────────────────────────

function ScheduleRow({ item, busy, onCallNow, onSkip, onDelete, onEdit }: {
  item: TEScheduleItem
  busy: boolean
  onCallNow: () => void
  onSkip: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  const icon = {
    done:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
    skipped: <SkipForward className="w-3.5 h-3.5 text-slate-400" />,
    failed:  <PhoneMissed className="w-3.5 h-3.5 text-red-400" />,
    pending: <Clock className="w-3.5 h-3.5 text-orange-400" />,
  }[item.status] ?? <Clock className="w-3.5 h-3.5 text-slate-300" />

  return (
    <div className={`flex items-center gap-2 py-2.5 border-b border-slate-100 last:border-0 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
      <span className="text-[10px] font-bold text-slate-400 w-7 text-right flex-shrink-0 font-mono">D{item.day_no}</span>
      <span className="text-xs font-mono text-slate-600 w-[5.5rem] flex-shrink-0">{fmtDate(item.call_date)}</span>
      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusChip(item.status)}`}>
        {icon}
        {item.status.toUpperCase()}
      </span>
      <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">{item.day_brief || <span className="italic text-slate-300">no brief</span>}</span>
      {item.attempts > 0 && (
        <span className="text-[10px] text-slate-400 flex-shrink-0">{item.attempts}×</span>
      )}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {item.status === 'pending' && (
          <>
            <button onClick={onCallNow} title="Call now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors">
              <PhoneCall className="w-3.5 h-3.5" />
            </button>
            <button onClick={onSkip} title="Skip" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-300 hover:text-slate-600 transition-colors">
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {item.status === 'skipped' && (
          <button onClick={onEdit} title="Re-enable" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onEdit} title="Edit" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-300 hover:text-slate-600 transition-colors">
          <Edit2 className="w-3 h-3" />
        </button>
        <button onClick={onDelete} title="Remove" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Job Row ─────────────────────────────────────────────────────────────────

function JobRow({ job, busy, onRun, onPause, onResume, onCancel, onDelete }: {
  job: TEJob
  busy: boolean
  onRun: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const cadence = job.interval_count && job.interval_unit
    ? `Every ${job.interval_count} ${job.interval_unit}`
    : 'One-off'

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 transition-opacity ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 truncate">{job.name}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusChip(job.status)}`}>
            {job.status.toUpperCase()}
          </span>
          <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium">{cadence}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" /> {job.phone}</span>
          <span>{job.runs} run{job.runs !== 1 ? 's' : ''}</span>
          {job.next_run_at && job.status === 'scheduled' && (
            <span className="flex items-center gap-1 text-blue-500"><Clock className="w-2.5 h-2.5" /> {fmtDateTime(job.next_run_at)}</span>
          )}
          {job.last_result && <span className="text-slate-500 italic">{job.last_result}</span>}
        </div>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {['scheduled', 'paused'].includes(job.status) && (
          <button onClick={onRun} title="Run now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors">
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        {job.status === 'scheduled' && (
          <button onClick={onPause} title="Pause" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-300 hover:text-amber-600 transition-colors">
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}
        {job.status === 'paused' && (
          <button onClick={onResume} title="Resume" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        {!['done', 'cancelled'].includes(job.status) && (
          <button onClick={onCancel} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors">
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onDelete} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Feedback Card ────────────────────────────────────────────────────────────

function FeedbackCard({ fb }: { fb: TEFeedback }) {
  const [open, setOpen] = useState(false)
  const hasData       = (fb.captured?.length ?? 0) > 0
  const hasTranscript = !!fb.transcript

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <Mic className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        <span className="text-xs font-semibold text-slate-700 flex-1">
          Call — {fmtDateTime(fb.created_at)}
        </span>
        {fb.rating != null && (
          <span className="text-xs font-bold text-amber-600">★ {fb.rating}</span>
        )}
        {hasData && (
          <span className="text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full font-bold">
            {fb.captured.length} captured
          </span>
        )}
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white">
          {hasData && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Captured Data</p>
              <div className="space-y-2">
                {fb.captured.map((item, i) => (
                  <div key={i} className="text-xs text-slate-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{JSON.stringify(item, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasTranscript && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Transcript</p>
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 max-h-56 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{fb.transcript}</pre>
              </div>
            </div>
          )}
          {!hasData && !hasTranscript && (
            <p className="text-xs text-slate-400 italic py-1">No data captured from this call</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'schedule' | 'jobs' | 'feedback'

export default function TravellerExperiencePanel({ bookingRef, booking }: Props) {
  const [tab, setTab]         = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [service, setService] = useState<TEService | null>(null)
  const [config, setConfig]   = useState<TEConfig | null>(null)
  const [jobs, setJobs]       = useState<TEJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)

  const defaultPhone = (
    booking.contactWhatsapp ??
    booking.contactPhone ??
    booking.passengers?.find(p => p.isLead)?.contact ??
    ''
  ) as string

  const leadName = (booking.passengers?.find(p => p.isLead)?.name ?? '') as string

  // ── Register / intake form ────────────────────────────────────────────────
  const [intakeForm, setIntakeForm] = useState({
    phone: defaultPhone,
    mode: 'agenda' as 'agenda' | 'interval',
    call_time: '18:00',
    interval_count: '10',
    interval_unit: 'minute' as 'minute' | 'hour' | 'day',
    retry_gap_min: '15',
  })
  const [intakeLoading, setIntakeLoading] = useState(false)

  // ── Edit service form ─────────────────────────────────────────────────────
  const [editOpen, setEditOpen]   = useState(false)
  const [editForm, setEditForm]   = useState({
    phone: defaultPhone, call_time: '18:00',
    mode: 'agenda' as 'agenda' | 'interval',
    interval_count: '10', interval_unit: 'minute' as 'minute' | 'hour' | 'day',
    retry_gap_min: '15',
  })
  const [editLoading, setEditLoading] = useState(false)

  // ── Schedule state ────────────────────────────────────────────────────────
  const [scheduleBusy, setScheduleBusy] = useState<number | null>(null)
  const [addDayOpen, setAddDayOpen]     = useState(false)
  const [addDayForm, setAddDayForm]     = useState({ call_date: '', brief: '', scheduled_at: '' })
  const [addDayLoading, setAddDayLoading] = useState(false)
  const [editItem, setEditItem]           = useState<TEScheduleItem | null>(null)
  const [editItemForm, setEditItemForm]   = useState({ call_date: '', day_brief: '', scheduled_at: '', status: '' })
  const [editItemLoading, setEditItemLoading] = useState(false)

  // ── Job state ──────────────────────────────────────────────────────────────
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [jobForm, setJobForm]       = useState({
    name: '', phone: defaultPhone, customer_name: leadName,
    start_at: 'now', interval_count: '', interval_unit: '' as '' | 'minute' | 'hour' | 'day',
    max_runs: '', respect_window: false,
  })
  const [jobLoading, setJobLoading] = useState(false)
  const [jobBusy, setJobBusy]       = useState<number | null>(null)

  // ── Approval / test ───────────────────────────────────────────────────────
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [testLoading, setTestLoading]         = useState(false)

  // ── Load service + config ─────────────────────────────────────────────────
  const loadService = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [svc, cfg] = await Promise.allSettled([
        teProxy(`services/${bookingRef}`),
        teProxy('config'),
      ])
      if (svc.status === 'fulfilled') {
        const d = svc.value
        setService(d?.service ?? d?.data ?? null)
      }
      if (cfg.status === 'fulfilled') {
        setConfig(cfg.value ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { loadService() }, [loadService])

  // ── Load jobs when tab opens ──────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const res = await teProxy('jobs', 'GET', undefined, { limit: '200' })
      const all: TEJob[] = res.jobs ?? res.data ?? []
      setJobs(all.filter(j =>
        j.booking_ref === bookingRef ||
        (j.name ?? '').includes(bookingRef)
      ))
    } catch { /* ignore */ } finally {
      setJobsLoading(false)
    }
  }, [bookingRef])

  useEffect(() => {
    if (tab === 'jobs') loadJobs()
  }, [tab, loadJobs])

  // ── Register ──────────────────────────────────────────────────────────────
  async function registerBooking() {
    setIntakeLoading(true)
    try {
      const body: Record<string, unknown> = {
        bookingRef,
        ...(intakeForm.phone ? { phone: intakeForm.phone.replace(/\D/g, '') } : {}),
        schedule: {
          mode: intakeForm.mode,
          call_time: intakeForm.call_time,
          retry_gap_min: Number(intakeForm.retry_gap_min),
          ...(intakeForm.mode === 'interval' ? {
            interval_count: Number(intakeForm.interval_count),
            interval_unit: intakeForm.interval_unit,
            start_at: 'now',
          } : {}),
        },
      }
      const res = await teProxy('intake', 'POST', body)
      if (res.ok === false && !res.service) throw new Error(res.message ?? 'Registration failed')
      toast.success('Booking registered for AI calls')
      await loadService()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register')
    } finally { setIntakeLoading(false) }
  }

  // ── Edit service ──────────────────────────────────────────────────────────
  function openEdit() {
    if (!service) return
    setEditForm({
      phone:          service.call_phone ?? '',
      call_time:      service.call_time ?? '18:00',
      mode:           service.schedule_mode ?? 'agenda',
      interval_count: String(service.interval_count ?? 10),
      interval_unit:  (service.interval_unit ?? 'minute') as 'minute' | 'hour' | 'day',
      retry_gap_min:  String(service.retry_gap_min ?? 15),
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    setEditLoading(true)
    try {
      const res = await teProxy(`services/${bookingRef}`, 'PATCH', {
        phone: editForm.phone.replace(/\D/g, '') || undefined,
        call_time: editForm.call_time,
        mode: editForm.mode,
        retry_gap_min: Number(editForm.retry_gap_min),
        ...(editForm.mode === 'interval' ? {
          interval_count: Number(editForm.interval_count),
          interval_unit: editForm.interval_unit,
          start_at: 'now',
        } : {}),
      })
      if (!res.service && !res.ok) throw new Error(res.message ?? 'Update failed')
      toast.success('Settings updated')
      setEditOpen(false)
      await loadService()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally { setEditLoading(false) }
  }

  // ── Status toggle ─────────────────────────────────────────────────────────
  async function updateStatus(status: string) {
    try {
      await teProxy(`services/${bookingRef}/status`, 'PATCH', { status })
      toast.success(`Status set to ${status}`)
      await loadService()
    } catch { toast.error('Failed to update status') }
  }

  // ── Schedule actions ──────────────────────────────────────────────────────
  async function callNow(id: number) {
    setScheduleBusy(id)
    try {
      const res = await teProxy(`schedule/${id}/call`, 'POST', { force: true })
      toast[res.ok === false ? 'warning' : 'success'](res.message ?? 'Call placed')
      await loadService()
    } catch { toast.error('Call failed') } finally { setScheduleBusy(null) }
  }

  async function skipDay(id: number) {
    setScheduleBusy(id)
    try {
      await teProxy(`schedule/${id}/skip`, 'POST')
      toast.success('Day skipped')
      await loadService()
    } catch { toast.error('Failed to skip') } finally { setScheduleBusy(null) }
  }

  async function deleteScheduleItem(id: number) {
    if (!confirm('Remove this day-call from the schedule?')) return
    setScheduleBusy(id)
    try {
      await teProxy(`schedule/${id}`, 'DELETE')
      toast.success('Day-call removed')
      await loadService()
    } catch { toast.error('Failed to remove') } finally { setScheduleBusy(null) }
  }

  function openEditItem(item: TEScheduleItem) {
    setEditItem(item)
    setEditItemForm({
      call_date:    item.call_date,
      day_brief:    item.day_brief ?? '',
      scheduled_at: item.scheduled_at ?? '',
      status:       '',
    })
  }

  async function saveEditItem() {
    if (!editItem) return
    setEditItemLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (editItemForm.call_date)    body.call_date    = editItemForm.call_date
      if (editItemForm.day_brief)    body.day_brief    = editItemForm.day_brief
      if (editItemForm.scheduled_at) body.scheduled_at = new Date(editItemForm.scheduled_at).toISOString()
      if (editItemForm.status)       body.status       = editItemForm.status
      await teProxy(`schedule/${editItem.id}`, 'PATCH', body)
      toast.success('Schedule updated')
      setEditItem(null)
      await loadService()
    } catch { toast.error('Failed to update') } finally { setEditItemLoading(false) }
  }

  async function addDayCall() {
    if (!addDayForm.call_date) { toast.error('Select a date'); return }
    setAddDayLoading(true)
    try {
      const body: Record<string, unknown> = { call_date: addDayForm.call_date }
      if (addDayForm.brief)        body.brief        = addDayForm.brief
      if (addDayForm.scheduled_at) body.scheduled_at = new Date(addDayForm.scheduled_at).toISOString()
      const res = await teProxy(`services/${bookingRef}/schedule`, 'POST', body)
      if (!res.schedule && res.ok === false) throw new Error(res.message ?? 'Failed')
      toast.success('Day-call added')
      setAddDayOpen(false)
      setAddDayForm({ call_date: '', brief: '', scheduled_at: '' })
      await loadService()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add day-call')
    } finally { setAddDayLoading(false) }
  }

  // ── Approval + test call ──────────────────────────────────────────────────
  async function sendApproval() {
    const phone = (service?.call_phone || intakeForm.phone).replace(/\D/g, '')
    if (!phone) { toast.error('No phone number set'); return }
    setApprovalLoading(true)
    try {
      const res = await teProxy('approval', 'POST', { to: phone, name: leadName || 'Guest' })
      toast.success(res.message ?? 'WhatsApp approval request sent')
    } catch { toast.error('Failed to send approval') } finally { setApprovalLoading(false) }
  }

  async function sendTestCall() {
    const phone = (service?.call_phone || intakeForm.phone).replace(/\D/g, '')
    if (!phone) { toast.error('No phone number set'); return }
    setTestLoading(true)
    try {
      const res = await teProxy('test-call', 'POST', { to: phone, name: leadName || 'Guest' })
      toast.success(res.message ?? 'Test call placed')
    } catch { toast.error('Failed to place test call') } finally { setTestLoading(false) }
  }

  // ── Job actions ───────────────────────────────────────────────────────────
  async function createJob() {
    if (!jobForm.name.trim()) { toast.error('Job name required'); return }
    if (!jobForm.phone.trim()) { toast.error('Phone required'); return }
    setJobLoading(true)
    try {
      const body: Record<string, unknown> = {
        name:          jobForm.name,
        phone:         jobForm.phone.replace(/\D/g, ''),
        customer_name: jobForm.customer_name || 'Guest',
        booking_ref:   bookingRef,
        start_at:      jobForm.start_at || 'now',
        respect_window: jobForm.respect_window,
      }
      if (jobForm.interval_count && jobForm.interval_unit) {
        body.interval_count = Number(jobForm.interval_count)
        body.interval_unit  = jobForm.interval_unit
      }
      if (jobForm.max_runs) body.max_runs = Number(jobForm.max_runs)
      const res = await teProxy('jobs', 'POST', body)
      if (!res.job) throw new Error(res.message ?? 'Failed to create job')
      toast.success('Call job created')
      setNewJobOpen(false)
      setJobForm({ name: '', phone: defaultPhone, customer_name: leadName, start_at: 'now', interval_count: '', interval_unit: '', max_runs: '', respect_window: false })
      await loadJobs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create job')
    } finally { setJobLoading(false) }
  }

  async function jobAction(id: number, action: 'run' | 'pause' | 'resume' | 'cancel') {
    setJobBusy(id)
    try {
      const res = await teProxy(`jobs/${id}/${action}`, 'POST')
      toast.success(res.message ?? `Job ${action === 'run' ? 'dialling' : action + 'd'}`)
      await loadJobs()
    } catch { toast.error(`Failed to ${action} job`) } finally { setJobBusy(null) }
  }

  async function deleteJob(id: number) {
    if (!confirm('Delete this call job?')) return
    setJobBusy(id)
    try {
      await teProxy(`jobs/${id}`, 'DELETE')
      toast.success('Job deleted')
      await loadJobs()
    } catch { toast.error('Failed to delete') } finally { setJobBusy(null) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const schedule = service?.schedule ?? []
  const feedback = service?.feedback ?? []
  const registered = service !== null

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Card className="overflow-hidden">

      {/* ── Header ── */}
      <CardHeader className="bg-gradient-to-r from-violet-50 to-purple-50 border-b border-violet-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0">
            <Volume2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">AI Voice Calls</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Traveller Experience · {bookingRef}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
          ) : registered ? (
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${statusChip(service!.status)}`}>
              {service!.status.toUpperCase()}
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
              NOT REGISTERED
            </span>
          )}
          <button
            onClick={() => { loadService(); if (tab === 'jobs') loadJobs() }}
            className="p-1.5 rounded-lg hover:bg-violet-100 text-violet-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </CardHeader>

      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-100 bg-white overflow-x-auto">
        {(['overview', 'schedule', 'jobs', 'feedback'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold capitalize whitespace-nowrap transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-violet-500 text-violet-700 bg-violet-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t === 'overview' ? 'Setup & Service' : t === 'schedule' ? 'Call Schedule' : t === 'jobs' ? 'Custom Jobs' : 'Feedback'}
            {t === 'schedule' && schedule.length > 0 && (
              <span className="ml-1.5 bg-violet-100 text-violet-700 text-[9px] px-1 py-0.5 rounded-full font-bold">
                {schedule.length}
              </span>
            )}
            {t === 'feedback' && feedback.length > 0 && (
              <span className="ml-1.5 bg-emerald-100 text-emerald-700 text-[9px] px-1 py-0.5 rounded-full font-bold">
                {feedback.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <CardBody className="py-5">

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            <span className="text-sm text-slate-400">Loading…</span>
          </div>
        ) : (

        // ══════════════════════════════════════════════════════
        // TAB: SETUP & SERVICE
        // ══════════════════════════════════════════════════════
        tab === 'overview' ? (
          <div className="space-y-5">

            {/* ── Not registered ── */}
            {!registered && (
              <>
                <div className="flex items-start gap-3 px-3 py-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    This booking is not registered for AI calls yet. Fill in the details below to set up automated customer check-in calls.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="form-label">Phone to call *</label>
                    <input
                      className="form-input font-mono"
                      placeholder="94771234567 (country code, no +)"
                      value={intakeForm.phone}
                      onChange={e => setIntakeForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="form-label">Schedule Mode</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {(['agenda', 'interval'] as const).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setIntakeForm(f => ({ ...f, mode: m }))}
                          className={`p-3 rounded-xl border-2 text-left transition-all ${
                            intakeForm.mode === m ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <p className={`text-xs font-bold uppercase ${intakeForm.mode === m ? 'text-violet-700' : 'text-slate-500'}`}>
                            {m === 'agenda' ? '📅 Agenda' : '⏱ Interval'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                            {m === 'agenda' ? 'One call per trip day at a set time' : 'Calls every N minutes/hours/days until answered'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {intakeForm.mode === 'agenda' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="form-label">Daily Call Time (local)</label>
                        <input type="time" className="form-input" value={intakeForm.call_time}
                          onChange={e => setIntakeForm(f => ({ ...f, call_time: e.target.value }))} />
                      </div>
                      <div>
                        <label className="form-label">Retry gap (min)</label>
                        <input type="number" className="form-input" min="5" value={intakeForm.retry_gap_min}
                          onChange={e => setIntakeForm(f => ({ ...f, retry_gap_min: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  {intakeForm.mode === 'interval' && (
                    <div>
                      <label className="form-label">Call every</label>
                      <div className="flex gap-2 mt-1">
                        <input type="number" className="form-input w-24" placeholder="10" min="1"
                          value={intakeForm.interval_count}
                          onChange={e => setIntakeForm(f => ({ ...f, interval_count: e.target.value }))} />
                        <select className="form-select flex-1" value={intakeForm.interval_unit}
                          onChange={e => setIntakeForm(f => ({ ...f, interval_unit: e.target.value as 'minute' | 'hour' | 'day' }))}>
                          <option value="minute">Minutes</option>
                          <option value="hour">Hours</option>
                          <option value="day">Days</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button onClick={registerBooking} disabled={intakeLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                    {intakeLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Registering…</>
                      : <><PhoneIncoming className="w-3.5 h-3.5" /> Register for AI Calls</>}
                  </button>
                  <button onClick={sendApproval} disabled={approvalLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                      : <><MessageSquare className="w-3.5 h-3.5" /> WhatsApp Approval</>}
                  </button>
                  <button onClick={sendTestCall} disabled={testLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 transition-colors">
                    {testLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Calling…</>
                      : <><Phone className="w-3.5 h-3.5" /> Test Call</>}
                  </button>
                </div>
              </>
            )}

            {/* ── Registered — service info ── */}
            {registered && !editOpen && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Call Phone</p>
                    <p className="text-sm font-mono font-semibold text-slate-800">{service!.call_phone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Mode</p>
                    <p className="text-sm font-semibold text-slate-800 capitalize">{service!.schedule_mode}</p>
                  </div>
                  {service!.schedule_mode === 'agenda' ? (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Call Time</p>
                      <p className="text-sm font-semibold text-slate-800">{service!.call_time || '18:00'}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Interval</p>
                      <p className="text-sm font-semibold text-slate-800">
                        Every {service!.interval_count} {service!.interval_unit}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Retry Gap</p>
                    <p className="text-sm font-semibold text-slate-800">{service!.retry_gap_min} min</p>
                  </div>
                </div>

                {config && (
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-50">
                    <span>Call window: {config.call_window?.start}:00–{config.call_window?.end}:00 local</span>
                    <span>·</span>
                    <span>Max retries: {config.max_retries}</span>
                    <span>·</span>
                    <span>System retry gap: {config.retry_gap_min} min</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={openEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors">
                    <Settings className="w-3.5 h-3.5" /> Edit Settings
                  </button>

                  {service!.status === 'active' ? (
                    <button onClick={() => updateStatus('cancelled')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors border border-red-100">
                      <XCircle className="w-3.5 h-3.5" /> Cancel Service
                    </button>
                  ) : (
                    <button onClick={() => updateStatus('active')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-xs font-semibold hover:bg-emerald-100 transition-colors border border-emerald-100">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Reactivate
                    </button>
                  )}

                  <button onClick={sendApproval} disabled={approvalLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                      : <><MessageSquare className="w-3.5 h-3.5" /> WhatsApp Approval</>}
                  </button>

                  <button onClick={sendTestCall} disabled={testLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-60 transition-colors">
                    {testLoading
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Calling…</>
                      : <><Phone className="w-3.5 h-3.5" /> Test Call</>}
                  </button>
                </div>
              </>
            )}

            {/* ── Edit service form ── */}
            {registered && editOpen && (
              <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-bold text-slate-700">Edit Call Settings</p>
                <div>
                  <label className="form-label">Phone</label>
                  <input className="form-input font-mono" value={editForm.phone}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Mode</label>
                  <select className="form-select" value={editForm.mode}
                    onChange={e => setEditForm(f => ({ ...f, mode: e.target.value as 'agenda' | 'interval' }))}>
                    <option value="agenda">Agenda — one call per trip day</option>
                    <option value="interval">Interval — every N…</option>
                  </select>
                </div>
                {editForm.mode === 'agenda' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Call Time (local)</label>
                      <input type="time" className="form-input" value={editForm.call_time}
                        onChange={e => setEditForm(f => ({ ...f, call_time: e.target.value }))} />
                    </div>
                    <div>
                      <label className="form-label">Retry gap (min)</label>
                      <input type="number" className="form-input" min="5" value={editForm.retry_gap_min}
                        onChange={e => setEditForm(f => ({ ...f, retry_gap_min: e.target.value }))} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="form-label">Call every</label>
                    <div className="flex gap-2 mt-1">
                      <input type="number" className="form-input w-24" min="1" value={editForm.interval_count}
                        onChange={e => setEditForm(f => ({ ...f, interval_count: e.target.value }))} />
                      <select className="form-select flex-1" value={editForm.interval_unit}
                        onChange={e => setEditForm(f => ({ ...f, interval_unit: e.target.value as 'minute' | 'hour' | 'day' }))}>
                        <option value="minute">Minutes</option>
                        <option value="hour">Hours</option>
                        <option value="day">Days</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button onClick={saveEdit} disabled={editLoading}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                    {editLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditOpen(false)}
                    className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

        // ══════════════════════════════════════════════════════
        // TAB: CALL SCHEDULE
        // ══════════════════════════════════════════════════════
        ) : tab === 'schedule' ? (
          <div className="space-y-4">
            {!registered ? (
              <div className="py-10 text-center">
                <Phone className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">Register the booking first</p>
                <p className="text-xs text-slate-300 mt-1">The call schedule is created automatically from the trip agenda</p>
              </div>
            ) : (
              <>
                {/* Inline edit form for a schedule item */}
                {editItem && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                    <p className="text-xs font-bold text-blue-800">Edit Day {editItem.day_no} — {fmtDate(editItem.call_date)}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="form-label">Date</label>
                        <input type="date" className="form-input" value={editItemForm.call_date}
                          onChange={e => setEditItemForm(f => ({ ...f, call_date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="form-label">Exact Call Time (optional)</label>
                        <input type="datetime-local" className="form-input" value={editItemForm.scheduled_at}
                          onChange={e => setEditItemForm(f => ({ ...f, scheduled_at: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <label className="form-label">Day Brief</label>
                        <input className="form-input" placeholder="e.g. Kandy — Temple of the Tooth"
                          value={editItemForm.day_brief}
                          onChange={e => setEditItemForm(f => ({ ...f, day_brief: e.target.value }))} />
                      </div>
                      {editItem.status === 'skipped' && (
                        <div>
                          <label className="form-label">Re-enable</label>
                          <select className="form-select" value={editItemForm.status}
                            onChange={e => setEditItemForm(f => ({ ...f, status: e.target.value }))}>
                            <option value="">— keep skipped —</option>
                            <option value="pending">Set to pending (re-enable)</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEditItem} disabled={editItemLoading}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors">
                        {editItemLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save'}
                      </button>
                      <button onClick={() => setEditItem(null)}
                        className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Schedule items */}
                {schedule.length === 0 ? (
                  <div className="py-8 text-center">
                    <Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">No schedule items</p>
                  </div>
                ) : (
                  <div>
                    {schedule.map(item => (
                      <ScheduleRow
                        key={item.id}
                        item={item}
                        busy={scheduleBusy === item.id}
                        onCallNow={() => callNow(item.id)}
                        onSkip={() => skipDay(item.id)}
                        onDelete={() => deleteScheduleItem(item.id)}
                        onEdit={() => openEditItem(item)}
                      />
                    ))}
                    {scheduleBusy !== null && (
                      <p className="text-xs text-violet-500 flex items-center gap-1.5 py-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…
                      </p>
                    )}
                  </div>
                )}

                {/* Add day-call */}
                {!addDayOpen ? (
                  <button onClick={() => setAddDayOpen(true)}
                    className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-semibold transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add Day Call
                  </button>
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <p className="text-xs font-bold text-slate-700">Add Day Call</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="form-label">Date *</label>
                        <input type="date" className="form-input" value={addDayForm.call_date}
                          onChange={e => setAddDayForm(f => ({ ...f, call_date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="form-label">Exact Call Time (optional)</label>
                        <input type="datetime-local" className="form-input" value={addDayForm.scheduled_at}
                          onChange={e => setAddDayForm(f => ({ ...f, scheduled_at: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <label className="form-label">Brief</label>
                        <input className="form-input" placeholder="e.g. Extra check-in" value={addDayForm.brief}
                          onChange={e => setAddDayForm(f => ({ ...f, brief: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addDayCall} disabled={addDayLoading}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                        {addDayLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : <><Plus className="w-3.5 h-3.5" /> Add</>}
                      </button>
                      <button onClick={() => { setAddDayOpen(false); setAddDayForm({ call_date: '', brief: '', scheduled_at: '' }) }}
                        className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        // ══════════════════════════════════════════════════════
        // TAB: CUSTOM JOBS
        // ══════════════════════════════════════════════════════
        ) : tab === 'jobs' ? (
          <div className="space-y-4">
            {/* New job form */}
            {newJobOpen && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <p className="text-xs font-bold text-slate-700">New Call Job</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="form-label">Job Name *</label>
                    <input className="form-input" placeholder="e.g. Post-arrival follow-up"
                      value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Phone *</label>
                    <input className="form-input font-mono" placeholder="94771234567"
                      value={jobForm.phone} onChange={e => setJobForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Customer Name</label>
                    <input className="form-input" value={jobForm.customer_name}
                      onChange={e => setJobForm(f => ({ ...f, customer_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Start At</label>
                    <input className="form-input" placeholder="now or ISO datetime"
                      value={jobForm.start_at} onChange={e => setJobForm(f => ({ ...f, start_at: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Max Runs (optional)</label>
                    <input type="number" className="form-input" placeholder="unlimited if blank" min="1"
                      value={jobForm.max_runs} onChange={e => setJobForm(f => ({ ...f, max_runs: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="form-label">Repeat Interval (leave blank for one-off call)</label>
                    <div className="flex gap-2">
                      <input type="number" className="form-input w-28" placeholder="e.g. 5" min="1"
                        value={jobForm.interval_count}
                        onChange={e => setJobForm(f => ({ ...f, interval_count: e.target.value }))} />
                      <select className="form-select flex-1" value={jobForm.interval_unit}
                        onChange={e => setJobForm(f => ({ ...f, interval_unit: e.target.value as '' | 'minute' | 'hour' | 'day' }))}>
                        <option value="">— one-off —</option>
                        <option value="minute">Minutes</option>
                        <option value="hour">Hours</option>
                        <option value="day">Days</option>
                      </select>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                      <input type="checkbox" className="rounded accent-violet-600"
                        checked={jobForm.respect_window}
                        onChange={e => setJobForm(f => ({ ...f, respect_window: e.target.checked }))} />
                      Respect call window (only dial within allowed hours)
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createJob} disabled={jobLoading}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                    {jobLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : <><PhoneCall className="w-3.5 h-3.5" /> Create Job</>}
                  </button>
                  <button onClick={() => setNewJobOpen(false)}
                    className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Jobs list */}
            {jobsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                <span className="text-xs text-slate-400">Loading jobs…</span>
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-10 text-center">
                <PhoneCall className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400 font-medium">No custom call jobs</p>
                <p className="text-xs text-slate-300 mt-1">Create one-off or recurring calls outside the trip schedule</p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map(job => (
                  <JobRow
                    key={job.id}
                    job={job}
                    busy={jobBusy === job.id}
                    onRun={() => jobAction(job.id, 'run')}
                    onPause={() => jobAction(job.id, 'pause')}
                    onResume={() => jobAction(job.id, 'resume')}
                    onCancel={() => jobAction(job.id, 'cancel')}
                    onDelete={() => deleteJob(job.id)}
                  />
                ))}
              </div>
            )}

            {!newJobOpen && (
              <button onClick={() => setNewJobOpen(true)}
                className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-semibold transition-colors">
                <Plus className="w-3.5 h-3.5" /> New Call Job
              </button>
            )}
          </div>

        // ══════════════════════════════════════════════════════
        // TAB: FEEDBACK
        // ══════════════════════════════════════════════════════
        ) : (
          <div className="space-y-3">
            {!registered ? (
              <div className="py-10 text-center">
                <Mic className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">No calls made yet</p>
              </div>
            ) : feedback.length === 0 ? (
              <div className="py-10 text-center">
                <Mic className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">No feedback yet</p>
                <p className="text-xs text-slate-300 mt-1">Call transcripts and captured data will appear here after AI calls complete</p>
              </div>
            ) : (
              <div className="space-y-2">
                {feedback.map(fb => <FeedbackCard key={fb.id} fb={fb} />)}
              </div>
            )}
          </div>
        )
        )}
      </CardBody>
    </Card>
  )
}
