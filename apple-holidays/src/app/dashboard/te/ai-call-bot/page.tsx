'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Phone, PhoneCall, PhoneMissed, PhoneIncoming,
  Calendar, RefreshCw, Plus, Play, Pause, SkipForward,
  Trash2, Edit2, CheckCircle2, XCircle, Clock, Mic,
  ChevronDown, ChevronUp, AlertCircle, Loader2, MessageSquare,
  Volume2, Settings, User, Star, MessageCircle, Bot, Info,
  ChevronRight, Hash, BookOpen, Megaphone, Search, Send,
  Zap, BarChart2, Filter, Download, Eye, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'

// ─── Base URL ─────────────────────────────────────────────────────────────────
const TE_BASE = 'https://travel-parser-live.aahaas.com/v1/traveller-experience'

function teProxy(path: string, method = 'GET', body?: unknown, extra?: Record<string, string>) {
  const url = new URL('/api/te/proxy', location.origin)
  url.searchParams.set('path', path)
  if (extra) for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  const hasBody = body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)
  return fetch(url.toString(), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  }).then(r => r.json())
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TEService {
  id: number
  booking_ref: string
  status: 'active' | 'completed' | 'cancelled'
  customer_name?: string | null
  call_phone: string
  call_time: string
  schedule_mode: 'agenda' | 'interval'
  interval_count?: number | null
  interval_unit?: string | null
  retry_gap_min: number
  schedule?: TEScheduleItem[]
  feedback?: TEFeedback[]
}
interface TEScheduleItem {
  id: number
  service_id: number
  booking_ref: string
  call_date: string
  scheduled_at?: string | null
  day_no: number
  phase?: string | null
  day_brief?: string | null
  status: 'pending' | 'answered' | 'missed' | 'skipped' | 'done' | 'failed'
  attempts: number
  last_attempt_at?: string | null
  next_attempt_at?: string | null
  error?: string | null
}
interface TEFeedback {
  id: number
  schedule_id?: number | null
  service_id: number
  booking_ref: string
  day_no?: number | null
  call_date?: string | null
  created_at: string
  sentiment?: string | null
  highlights?: string | null
  hotel_ok?: string | null
  meals_ok?: string | null
  driver_ok?: string | null
  vehicle_ok?: string | null
  issues?: string | null
  summary?: string | null
  transcript?: TranscriptTurn[] | string | null
}
interface TranscriptTurn { role?: string; speaker?: string; text?: string; message?: string; content?: string }
interface TEJob {
  id: number; name: string; phone: string; customer_name: string
  campaign_id?: number | null; booking_ref?: string | null
  start_at: string; interval_count?: number | null; interval_unit?: string | null
  end_at?: string | null; max_runs?: number | null; next_run_at?: string | null
  last_run_at?: string | null; runs: number
  status: 'scheduled' | 'paused' | 'done' | 'cancelled'
  respect_window: boolean; last_result?: string | null
}
interface TECampaign {
  id: number; name: string; approach?: string | null; collect?: string | null
  first_message?: string | null; is_active: boolean
}
interface ChatMessage { id: string; role: 'user' | 'bot' | 'system'; text: string; ts: number; meta?: Record<string, unknown> }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  paused:    'bg-amber-100 text-amber-700 border-amber-200',
  answered:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  done:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  missed:    'bg-red-100 text-red-500 border-red-200',
  failed:    'bg-red-100 text-red-600 border-red-200',
  skipped:   'bg-slate-100 text-slate-400 border-slate-200',
  pending:   'bg-orange-50 text-orange-600 border-orange-200',
}
const SENTIMENT_EMOJI: Record<string, string> = { positive: '😊', happy: '😊', neutral: '😐', negative: '😞' }

function sbadge(s: string) {
  return `inline-flex items-center gap-0.5 border font-bold rounded-full text-[9px] px-1.5 py-0.5 ${STATUS_STYLES[s] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`
}
function fmtDate(iso: string) {
  return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
}
function fmtDT(iso: string) {
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function normaliseTranscript(raw: TranscriptTurn[] | string | null | undefined) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(t => {
    const role = (t.role ?? t.speaker ?? '').toLowerCase()
    const text = t.text ?? t.message ?? t.content ?? ''
    if (['ai','agent','bot','assistant'].includes(role)) return { speaker: 'agent' as const, text }
    if (['user','customer','human','passenger','caller'].includes(role)) return { speaker: 'customer' as const, text }
    return { speaker: 'system' as const, text }
  }).filter(l => l.text)
  return String(raw).split('\n').filter(Boolean).map(line => {
    if (/^(agent|bot|ai)\s*:/i.test(line)) return { speaker: 'agent' as const, text: line.replace(/^[^:]+:\s*/i,'') }
    if (/^(customer|user|human)\s*:/i.test(line)) return { speaker: 'customer' as const, text: line.replace(/^[^:]+:\s*/i,'') }
    return { speaker: 'system' as const, text: line }
  })
}

// ─── Transcript bubble ─────────────────────────────────────────────────────────
function TranscriptBubbles({ transcript }: { transcript: TEFeedback['transcript'] }) {
  const lines = normaliseTranscript(transcript)
  if (!lines.length) return <p className="text-xs text-slate-400 italic">No transcript</p>
  return (
    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
      {lines.map((l, i) =>
        l.speaker === 'system' ? (
          <p key={i} className="text-[10px] text-slate-400 italic text-center">{l.text}</p>
        ) : l.speaker === 'agent' ? (
          <div key={i} className="flex gap-1.5 items-start">
            <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot className="w-2.5 h-2.5 text-white" /></div>
            <div className="bg-violet-50 border border-violet-100 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[80%]"><p className="text-xs text-slate-700">{l.text}</p></div>
          </div>
        ) : (
          <div key={i} className="flex gap-1.5 items-start flex-row-reverse">
            <div className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5"><User className="w-2.5 h-2.5 text-white" /></div>
            <div className="bg-slate-800 rounded-xl rounded-tr-sm px-2.5 py-1.5 max-w-[80%]"><p className="text-xs text-white">{l.text}</p></div>
          </div>
        )
      )}
    </div>
  )
}

type Tab = 'setup' | 'jobs' | 'quickcall' | 'history' | 'chatbot'

export default function AICallBotPage() {
  const [tab, setTab] = useState<Tab>('setup')

  // ── Booking selector ─────────────────────────────────────────────────────
  const [bookingRef, setBookingRef] = useState('')
  const [bookingInput, setBookingInput] = useState('')

  // ── Services list ─────────────────────────────────────────────────────────
  const [services, setServices]     = useState<TEService[]>([])
  const [svcLoading, setSvcLoading] = useState(false)
  const [activeService, setActiveService] = useState<TEService | null>(null)
  const [svcExpanded, setSvcExpanded] = useState<number | null>(null)

  // ── Intake form ───────────────────────────────────────────────────────────
  const [intakeForm, setIntakeForm] = useState({ phone: '', mode: 'agenda' as 'agenda'|'interval', call_time: '18:00', interval_count: '10', interval_unit: 'minute' as 'minute'|'hour'|'day', retry_gap_min: '15' })
  const [intakeLoading, setIntakeLoading] = useState(false)

  // ── Add day ───────────────────────────────────────────────────────────────
  const [addDayOpen, setAddDayOpen] = useState(false)
  const [addDayForm, setAddDayForm] = useState({ call_date: '', brief: '', scheduled_at: '', day_no: '' })
  const [addDayLoading, setAddDayLoading] = useState(false)
  const [scheduleBusy, setScheduleBusy] = useState<number|null>(null)

  // ── Edit schedule item ────────────────────────────────────────────────────
  const [editItem, setEditItem] = useState<TEScheduleItem|null>(null)
  const [editItemForm, setEditItemForm] = useState({ call_date: '', day_brief: '', scheduled_at: '', status: '' })
  const [editItemLoading, setEditItemLoading] = useState(false)

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const [jobs, setJobs]             = useState<TEJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [jobForm, setJobForm]       = useState({ name: '', phone: '', customer_name: '', campaign_id: '', bookingRef: '', start_at: 'now', interval_count: '', interval_unit: '' as ''|'minute'|'hour'|'day', max_runs: '', end_at: '', respect_window: false })
  const [jobLoading, setJobLoading] = useState(false)
  const [jobBusy, setJobBusy]       = useState<number|null>(null)
  const [jobFilter, setJobFilter]   = useState<string>('all')

  // ── Campaigns ─────────────────────────────────────────────────────────────
  const [campaigns, setCampaigns]   = useState<TECampaign[]>([])
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [campaignForm, setCampaignForm] = useState({ name: '', approach: '', collect: '', first_message: '', is_active: true })
  const [campaignLoading, setCampaignLoading] = useState(false)
  const [editCampaign, setEditCampaign] = useState<TECampaign|null>(null)

  // ── Quick call ────────────────────────────────────────────────────────────
  const [quickForm, setQuickForm]   = useState({ to: '', name: '', bookingRef: '', reason: '' })
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickResult, setQuickResult] = useState<{ok:boolean;message?:string;note?:string;channel_id?:string;references_itinerary?:boolean}|null>(null)
  const [approvalLoading, setApprovalLoading] = useState(false)

  // ── History ───────────────────────────────────────────────────────────────
  const [allFeedback, setAllFeedback] = useState<TEFeedback[]>([])
  const [fbLoading, setFbLoading]    = useState(false)
  const [fbFilter, setFbFilter]      = useState({ bookingRef: '', sentiment: '', status: '' })
  const [fbExpanded, setFbExpanded]  = useState<number|null>(null)
  const [historyView, setHistoryView] = useState<'table'|'daywise'>('table')
  const [allSchedules, setAllSchedules] = useState<TEScheduleItem[]>([])

  // ── Chat bot ──────────────────────────────────────────────────────────────
  const [chatMsgs, setChatMsgs]     = useState<ChatMessage[]>([{ id: '0', role: 'bot', text: 'Hi! I\'m your AI Call Bot assistant. I can help you set up calls, check history, and compose quick calls.\n\nTry: "Setup a call for VN19662" · "Show feedback for IS48375" · "Quick call 94771234567"', ts: Date.now() }])
  const [chatInput, setChatInput]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ─────────────────────────────────────────────────────────────────────────
  // Load services list
  // ─────────────────────────────────────────────────────────────────────────
  const loadServices = useCallback(async () => {
    setSvcLoading(true)
    try {
      const res = await teProxy('services', 'GET', undefined, { limit: '100' })
      setServices(res.services ?? res.data ?? [])
    } catch { /* ignore */ } finally { setSvcLoading(false) }
  }, [])

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const res = await teProxy('jobs', 'GET', undefined, { limit: '200' })
      setJobs(res.jobs ?? res.data ?? [])
    } catch { /* ignore */ } finally { setJobsLoading(false) }
  }, [])

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await teProxy('campaigns')
      setCampaigns(res.campaigns ?? res.data ?? [])
    } catch { /* ignore */ }
  }, [])

  const loadAllFeedback = useCallback(async () => {
    setFbLoading(true)
    try {
      // fetch feedback for each active service
      const svcList = services.length ? services : []
      const results = await Promise.allSettled(
        svcList.filter(s => s.id).map(s => teProxy('feedback', 'GET', undefined, { serviceId: String(s.id) }))
      )
      const merged: TEFeedback[] = []
      results.forEach(r => { if (r.status === 'fulfilled') merged.push(...(r.value.feedback ?? r.value.data ?? [])) })
      merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setAllFeedback(merged)
      // also collect all schedule items
      const scheds: TEScheduleItem[] = []
      svcList.forEach(s => { if (s.schedule) scheds.push(...s.schedule) })
      setAllSchedules(scheds)
    } catch { /* ignore */ } finally { setFbLoading(false) }
  }, [services])

  useEffect(() => { loadServices(); loadCampaigns() }, [loadServices, loadCampaigns])
  useEffect(() => { if (tab === 'jobs') { loadJobs(); loadCampaigns() } }, [tab, loadJobs, loadCampaigns])
  useEffect(() => { if (tab === 'history' && services.length) loadAllFeedback() }, [tab, services, loadAllFeedback])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])

  // ─────────────────────────────────────────────────────────────────────────
  // Register booking
  // ─────────────────────────────────────────────────────────────────────────
  async function registerBooking() {
    if (!bookingRef.trim()) { toast.error('Enter a booking reference first'); return }
    if (!intakeForm.phone.trim()) { toast.error('Phone number is required'); return }
    setIntakeLoading(true)
    try {
      const body: Record<string, unknown> = {
        bookingRef: bookingRef.trim().toUpperCase(),
        phone: intakeForm.phone.replace(/\D/g, ''),
        schedule: {
          mode: intakeForm.mode,
          call_time: intakeForm.call_time,
          retry_gap_min: Number(intakeForm.retry_gap_min) || 15,
          ...(intakeForm.mode === 'interval' && { interval_count: Number(intakeForm.interval_count) || 10, interval_unit: intakeForm.interval_unit, start_at: 'now' }),
        },
      }
      const res = await teProxy('intake', 'POST', body)
      if (res.ok === false && !res.service) throw new Error(res.message ?? 'Registration failed')
      toast.success(`Registered — ${res.schedule_inserted ?? 0} day(s) scheduled`)
      await loadServices()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setIntakeLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Load single service
  // ─────────────────────────────────────────────────────────────────────────
  async function loadServiceDetail(ref: string) {
    try {
      const res = await teProxy(`services/${ref}`)
      const svc: TEService = res.service ?? res.data ?? null
      if (svc) {
        setActiveService(svc)
        setServices(prev => prev.map(s => s.booking_ref === ref ? { ...s, ...svc } : s))
      }
    } catch { /* ignore */ }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Schedule actions
  // ─────────────────────────────────────────────────────────────────────────
  async function callNow(id: number, ref: string) {
    setScheduleBusy(id)
    try {
      const res = await teProxy(`schedule/${id}/call`, 'POST', { force: true })
      if (res.approval_pending) toast.info(res.message ?? 'WhatsApp approval pending')
      else if (!res.ok) toast.info(res.message ?? 'Could not connect')
      else toast.success('Call placed ✓')
      await loadServiceDetail(ref)
    } catch { toast.error('Call failed') } finally { setScheduleBusy(null) }
  }

  async function skipDay(id: number, ref: string) {
    setScheduleBusy(id)
    try { await teProxy(`schedule/${id}/skip`, 'POST'); toast.success('Day skipped'); await loadServiceDetail(ref) }
    catch { toast.error('Failed to skip') } finally { setScheduleBusy(null) }
  }

  async function deleteScheduleItem(id: number, ref: string) {
    if (!confirm('Remove this day-call?')) return
    setScheduleBusy(id)
    try { await teProxy(`schedule/${id}`, 'DELETE'); toast.success('Removed'); await loadServiceDetail(ref) }
    catch { toast.error('Failed') } finally { setScheduleBusy(null) }
  }

  async function saveEditItem() {
    if (!editItem) return
    setEditItemLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (editItemForm.call_date !== editItem.call_date) body.call_date = editItemForm.call_date
      if (editItemForm.day_brief !== (editItem.day_brief ?? '')) body.day_brief = editItemForm.day_brief
      if (editItemForm.scheduled_at) body.scheduled_at = new Date(editItemForm.scheduled_at).toISOString()
      if (editItemForm.status) body.status = editItemForm.status
      if (!Object.keys(body).length) { setEditItem(null); return }
      await teProxy(`schedule/${editItem.id}`, 'PATCH', body)
      toast.success('Updated')
      setEditItem(null)
      await loadServiceDetail(editItem.booking_ref)
    } catch { toast.error('Failed') } finally { setEditItemLoading(false) }
  }

  async function addDayCall(ref: string, existingSchedule: TEScheduleItem[]) {
    if (!addDayForm.call_date) { toast.error('Select a date'); return }
    setAddDayLoading(true)
    try {
      const nextDayNo = addDayForm.day_no
        ? Number(addDayForm.day_no)
        : (existingSchedule.length > 0 ? Math.max(...existingSchedule.map(s => s.day_no)) + 1 : 1)
      const body: Record<string, unknown> = { call_date: addDayForm.call_date, day_no: nextDayNo }
      if (addDayForm.brief) body.brief = addDayForm.brief
      if (addDayForm.scheduled_at) body.scheduled_at = new Date(addDayForm.scheduled_at).toISOString()
      const res = await teProxy(`services/${ref}/schedule`, 'POST', body)
      if (res.error) throw new Error(res.error)
      if (res.ok === false) throw new Error(res.message ?? 'Failed')
      toast.success('Day-call added')
      setAddDayOpen(false)
      setAddDayForm({ call_date: '', brief: '', scheduled_at: '', day_no: '' })
      await loadServiceDetail(ref)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setAddDayLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Jobs
  // ─────────────────────────────────────────────────────────────────────────
  async function createJob() {
    if (!jobForm.name.trim()) { toast.error('Job name required'); return }
    if (!jobForm.phone.trim()) { toast.error('Phone required'); return }
    setJobLoading(true)
    try {
      const body: Record<string, unknown> = {
        name: jobForm.name.trim(), phone: jobForm.phone.replace(/\D/g,''),
        customer_name: jobForm.customer_name || 'Guest',
        start_at: jobForm.start_at || 'now',
        respect_window: jobForm.respect_window,
      }
      if (jobForm.bookingRef ?? bookingRef) body.booking_ref = (jobForm.bookingRef ?? bookingRef)
      if (jobForm.campaign_id) body.campaign_id = Number(jobForm.campaign_id)
      if (jobForm.interval_count && jobForm.interval_unit) { body.interval_count = Number(jobForm.interval_count); body.interval_unit = jobForm.interval_unit }
      if (jobForm.max_runs) body.max_runs = Number(jobForm.max_runs)
      if (jobForm.end_at) body.end_at = new Date(jobForm.end_at).toISOString()
      const res = await teProxy('jobs', 'POST', body)
      if (!res.job) throw new Error(res.message ?? 'Failed')
      toast.success(`Job "${jobForm.name}" created`)
      setNewJobOpen(false)
      setJobForm({ name: '', phone: '', customer_name: '', campaign_id: '', bookingRef: '', start_at: 'now', interval_count: '', interval_unit: '', max_runs: '', end_at: '', respect_window: false })
      await loadJobs()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setJobLoading(false) }
  }

  async function jobAction(id: number, action: string) {
    setJobBusy(id)
    try { const res = await teProxy(`jobs/${id}/${action}`, 'POST'); toast.success(res.message ?? `Job ${action}`); await loadJobs() }
    catch { toast.error(`Failed to ${action}`) } finally { setJobBusy(null) }
  }

  async function deleteJob(id: number) {
    if (!confirm('Delete job?')) return
    setJobBusy(id)
    try { await teProxy(`jobs/${id}`, 'DELETE'); toast.success('Deleted'); await loadJobs() }
    catch { toast.error('Failed') } finally { setJobBusy(null) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Campaigns
  // ─────────────────────────────────────────────────────────────────────────
  async function saveCampaign() {
    if (!campaignForm.name.trim()) { toast.error('Name required'); return }
    setCampaignLoading(true)
    try {
      const body = { name: campaignForm.name, approach: campaignForm.approach || undefined, collect: campaignForm.collect || undefined, first_message: campaignForm.first_message || undefined, is_active: campaignForm.is_active }
      if (editCampaign) { await teProxy(`campaigns/${editCampaign.id}`, 'PATCH', body); toast.success('Updated') }
      else { await teProxy('campaigns', 'POST', body); toast.success('Created') }
      setCampaignOpen(false); setEditCampaign(null)
      setCampaignForm({ name: '', approach: '', collect: '', first_message: '', is_active: true })
      await loadCampaigns()
    } catch { toast.error('Failed') } finally { setCampaignLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Quick call
  // ─────────────────────────────────────────────────────────────────────────
  async function placeQuickCall() {
    const phone = quickForm.to.replace(/\D/g,'')
    if (!phone) { toast.error('Phone required'); return }
    setQuickLoading(true); setQuickResult(null)
    try {
      const body: Record<string, unknown> = { to: phone }
      if (quickForm.name) body.name = quickForm.name
      if (quickForm.bookingRef) { body.bookingRef = quickForm.bookingRef.trim().toUpperCase(); body.booking_ref = body.bookingRef }
      if (quickForm.reason) body.reason = quickForm.reason
      const res = await teProxy('quick-call', 'POST', body)
      if (res.approval_pending) { setQuickResult({ ok: false, message: res.message ?? 'Approval pending' }); toast.info('Approval sent') }
      else if (!res.ok) { setQuickResult({ ok: false, message: res.message }); toast.info(res.message ?? 'Could not connect') }
      else { setQuickResult({ ok: true, message: res.message, note: res.note, channel_id: res.channel_id, references_itinerary: res.references_itinerary }); toast.success('Call placed') }
    } catch { toast.error('Call failed') } finally { setQuickLoading(false) }
  }

  async function sendApproval(phone: string, name?: string) {
    const p = phone.replace(/\D/g,'')
    if (!p) { toast.error('Enter phone number'); return }
    setApprovalLoading(true)
    try {
      const res = await teProxy('approval', 'POST', { to: p, name: name || 'Valued Customer' })
      if (res.already_allowed) toast.success('Already allowed ✓')
      else toast.success(res.message ?? 'Approval sent')
    } catch { toast.error('Failed') } finally { setApprovalLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI Chat Bot
  // ─────────────────────────────────────────────────────────────────────────
  function addChat(role: ChatMessage['role'], text: string, meta?: Record<string, unknown>) {
    setChatMsgs(m => [...m, { id: String(Date.now()), role, text, ts: Date.now(), meta }])
  }

  async function handleChat() {
    const input = chatInput.trim()
    if (!input) return
    setChatInput('')
    addChat('user', input)
    setChatLoading(true)
    try {
      const lower = input.toLowerCase()

      // "show feedback / history for REF"
      const refMatch = input.match(/\b([A-Z]{2}\d{4,})\b/i)
      const extractedRef = refMatch?.[1]?.toUpperCase()

      if ((lower.includes('feedback') || lower.includes('history') || lower.includes('transcript')) && extractedRef) {
        const svc = services.find(s => s.booking_ref === extractedRef)
        if (!svc) { addChat('bot', `No service found for ${extractedRef}. Register it first in the Setup tab.`); return }
        const res = await teProxy('feedback', 'GET', undefined, { serviceId: String(svc.id) })
        const fbs: TEFeedback[] = res.feedback ?? []
        if (!fbs.length) { addChat('bot', `No call feedback on record for ${extractedRef} yet.`); return }
        const summary = fbs.map(f => `• Day ${f.day_no ?? '?'} (${f.call_date ?? fmtDT(f.created_at)}): sentiment=${f.sentiment ?? 'unknown'}${f.summary ? ` — ${f.summary}` : ''}`).join('\n')
        addChat('bot', `📋 Found ${fbs.length} call record(s) for ${extractedRef}:\n\n${summary}`, { feedback: fbs })
        return
      }

      // "setup / register REF"
      if ((lower.includes('setup') || lower.includes('register') || lower.includes('add booking')) && extractedRef) {
        setBookingRef(extractedRef)
        setBookingInput(extractedRef)
        setTab('setup')
        addChat('bot', `I've selected booking ${extractedRef} and switched to the Setup tab. Fill in the phone number and click Register to start scheduling AI calls.`)
        return
      }

      // "quick call NUMBER"
      const phoneMatch = input.match(/\b(9[0-9]{10,12}|[0-9]{10,14})\b/)
      if ((lower.includes('quick call') || lower.includes('call now') || lower.includes('dial')) && phoneMatch) {
        setQuickForm(f => ({ ...f, to: phoneMatch[1], bookingRef: extractedRef ?? f.bookingRef }))
        setTab('quickcall')
        addChat('bot', `Switched to Quick Call with number ${phoneMatch[1]}${extractedRef ? ` for booking ${extractedRef}` : ''}. Confirm the details and click Place Quick Call.`)
        return
      }

      // "list / show services"
      if (lower.includes('list') || lower.includes('show all') || lower.includes('services')) {
        if (!services.length) { addChat('bot', 'No services registered yet. Use the Setup tab to register a booking.'); return }
        const txt = services.map(s => `• ${s.booking_ref} — ${s.status} · ${s.call_phone} · ${s.schedule_mode}`).join('\n')
        addChat('bot', `📋 ${services.length} registered service(s):\n\n${txt}`)
        return
      }

      // "how many pending calls"
      if (lower.includes('pending') || lower.includes('missed') || lower.includes('answered')) {
        const allSched = services.flatMap(s => s.schedule ?? [])
        const pending  = allSched.filter(s => s.status === 'pending').length
        const missed   = allSched.filter(s => s.status === 'missed' || s.status === 'failed').length
        const answered = allSched.filter(s => s.status === 'answered' || s.status === 'done').length
        addChat('bot', `📊 Across all services:\n• Pending: ${pending}\n• Answered: ${answered}\n• Missed: ${missed}`)
        return
      }

      // "create campaign NAME"
      if (lower.includes('campaign') && (lower.includes('create') || lower.includes('new'))) {
        setTab('jobs')
        addChat('bot', 'Switched to the Jobs tab. Click "New Campaign" to create a campaign that guides the AI agent\'s approach on calls.')
        return
      }

      // "help"
      if (lower.includes('help') || lower.includes('what can you do')) {
        addChat('bot', `Here's what I can help with:\n\n🔹 "Show feedback for VN19662" — view call history\n🔹 "Setup VN19662" — go to Setup tab for a booking\n🔹 "Quick call 94771234567" — launch quick call\n🔹 "List services" — see all registered bookings\n🔹 "How many pending calls" — call stats\n🔹 "Create campaign" — new call script\n🔹 "Show transcripts for IS48375" — view conversation logs`)
        return
      }

      addChat('bot', `I didn't quite understand that. Try:\n• "Show feedback for VN19662"\n• "Setup a call for IS48375"\n• "Quick call 94771234567"\n• "List services"\n• "Help"`)
    } catch {
      addChat('bot', 'Something went wrong. Please try again.')
    } finally { setChatLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────
  const filteredFeedback = allFeedback.filter(f => {
    if (fbFilter.bookingRef && !f.booking_ref.toLowerCase().includes(fbFilter.bookingRef.toLowerCase())) return false
    if (fbFilter.sentiment && f.sentiment !== fbFilter.sentiment) return false
    return true
  })

  const filteredJobs = jobFilter === 'all' ? jobs : jobs.filter(j => j.status === jobFilter)

  // ─────────────────────────────────────────────────────────────────────────
  // Service list in Setup tab — expandable rows
  // ─────────────────────────────────────────────────────────────────────────
  function ServiceRow({ svc }: { svc: TEService }) {
    const schedule = [...(svc.schedule ?? [])].sort((a, b) => a.day_no - b.day_no)
    const isOpen   = svcExpanded === svc.id
    const pending  = schedule.filter(s => s.status === 'pending').length
    const done     = schedule.filter(s => s.status === 'answered' || s.status === 'done').length
    const missed   = schedule.filter(s => s.status === 'missed' || s.status === 'failed').length

    return (
      <div className="border border-slate-200 rounded-xl overflow-hidden mb-3">
        {/* Row header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 cursor-pointer" onClick={() => { setSvcExpanded(isOpen ? null : svc.id); if (!isOpen) loadServiceDetail(svc.booking_ref) }}>
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Phone className="w-4 h-4 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-900 font-mono">{svc.booking_ref}</span>
              <span className={sbadge(svc.status)}>{svc.status.toUpperCase()}</span>
              <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{svc.schedule_mode}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
              <span className="font-mono">{svc.call_phone}</span>
              <span className="text-orange-500">{pending} pending</span>
              <span className="text-emerald-500">{done} done</span>
              {missed > 0 && <span className="text-red-400">{missed} missed</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={e => { e.stopPropagation(); setBookingRef(svc.booking_ref); setBookingInput(svc.booking_ref) }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors" title="Select this booking">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </div>

        {/* Expanded schedule table */}
        {isOpen && (
          <div className="border-t border-slate-100 bg-slate-50/50">
            {editItem && editItem.booking_ref === svc.booking_ref && (
              <div className="p-4 bg-blue-50 border-b border-blue-200 space-y-3">
                <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5"><Edit2 className="w-3.5 h-3.5" /> Edit Day {editItem.day_no}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="form-label">Date</label><input type="date" className="form-input" value={editItemForm.call_date} onChange={e => setEditItemForm(f => ({ ...f, call_date: e.target.value }))} /></div>
                  <div><label className="form-label">Call Time</label><input type="datetime-local" className="form-input" value={editItemForm.scheduled_at} onChange={e => setEditItemForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
                  <div className="col-span-2"><label className="form-label">Day Brief (bot context)</label><input className="form-input" value={editItemForm.day_brief} onChange={e => setEditItemForm(f => ({ ...f, day_brief: e.target.value }))} /></div>
                  {['skipped','missed','failed'].includes(editItem.status) && (
                    <div><label className="form-label">Reset Status</label>
                      <select className="form-select" value={editItemForm.status} onChange={e => setEditItemForm(f => ({ ...f, status: e.target.value }))}>
                        <option value="">— keep ({editItem.status}) —</option>
                        <option value="pending">Re-enable (pending)</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEditItem} disabled={editItemLoading} className="btn-primary btn btn-sm">{editItemLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}</button>
                  <button onClick={() => setEditItem(null)} className="btn-secondary btn btn-sm">Cancel</button>
                </div>
              </div>
            )}

            {schedule.length === 0 ? (
              <p className="text-xs text-slate-400 italic p-4">No scheduled days yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Day</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Attempts</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide hidden sm:table-cell">Brief</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map(item => {
                      const isToday = item.call_date === new Date().toISOString().slice(0,10)
                      return (
                        <tr key={item.id} className={`border-b border-slate-100 last:border-0 ${isToday ? 'bg-violet-50/60' : 'hover:bg-white'} transition-colors`}>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-xs font-bold ${isToday ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{item.day_no}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-slate-700">{fmtDate(item.call_date)}</div>
                            {item.scheduled_at && <div className="text-[10px] text-blue-500 flex items-center gap-0.5 mt-0.5"><Clock className="w-2.5 h-2.5" />{new Date(item.scheduled_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>}
                            {isToday && <span className="text-[9px] bg-violet-600 text-white px-1 py-0.5 rounded-full font-bold">TODAY</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={sbadge(item.status)}>{item.status.toUpperCase()}</span>
                            {item.error && <p className="text-[10px] text-red-400 mt-0.5 truncate max-w-[120px]">{item.error}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500">{item.attempts}</td>
                          <td className="px-3 py-2.5 text-slate-400 hidden sm:table-cell max-w-[160px] truncate">{item.day_brief ?? '—'}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-0.5">
                              {(item.status === 'pending' || item.status === 'missed') && (
                                <>
                                  <button disabled={scheduleBusy === item.id} onClick={() => callNow(item.id, svc.booking_ref)} title="Call now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors disabled:opacity-40">
                                    {scheduleBusy === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                                  </button>
                                  <button onClick={() => skipDay(item.id, svc.booking_ref)} title="Skip" className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-300 hover:text-slate-500 transition-colors"><SkipForward className="w-3.5 h-3.5" /></button>
                                </>
                              )}
                              <button onClick={() => { setEditItem(item); setEditItemForm({ call_date: item.call_date, day_brief: item.day_brief ?? '', scheduled_at: item.scheduled_at ? new Date(item.scheduled_at).toISOString().slice(0,16) : '', status: '' }) }} title="Edit" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={() => deleteScheduleItem(item.id, svc.booking_ref)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add extra day */}
            <div className="p-3 border-t border-slate-200">
              {!addDayOpen ? (
                <button onClick={() => setAddDayOpen(true)} className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-semibold transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Extra Day Call
                </button>
              ) : (
                <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-bold text-violet-800 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Extra Day Call</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="form-label">Date *</label><input type="date" className="form-input" value={addDayForm.call_date} onChange={e => setAddDayForm(f => ({ ...f, call_date: e.target.value }))} /></div>
                    <div>
                      <label className="form-label">Day No. <span className="font-normal text-slate-400">(auto if blank)</span></label>
                      <input type="number" min="1" className="form-input" placeholder={String(schedule.length > 0 ? Math.max(...schedule.map(s => s.day_no)) + 1 : 1)} value={addDayForm.day_no} onChange={e => setAddDayForm(f => ({ ...f, day_no: e.target.value }))} />
                    </div>
                    <div><label className="form-label">Call Time (optional)</label><input type="datetime-local" className="form-input" value={addDayForm.scheduled_at} onChange={e => setAddDayForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
                    <div><label className="form-label">Brief (bot context)</label><input className="form-input" placeholder="e.g. Extra check-in" value={addDayForm.brief} onChange={e => setAddDayForm(f => ({ ...f, brief: e.target.value }))} /></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => addDayCall(svc.booking_ref, schedule)} disabled={addDayLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60">
                      {addDayLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : <><Plus className="w-3.5 h-3.5" /> Add</>}
                    </button>
                    <button onClick={() => { setAddDayOpen(false); setAddDayForm({ call_date: '', brief: '', scheduled_at: '', day_no: '' }) }} className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-slate-950">
      <Header
        title={<span className="flex items-center gap-2"><Bot className="w-5 h-5 text-violet-400" /> AI Call Bot</span>}
        subtitle="Automated WhatsApp voice calls powered by AI · Traveller Experience"
        actions={
          <button onClick={() => { loadServices(); loadCampaigns() }} className="btn-secondary btn btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {/* ── Stats banner ── */}
      <div className="bg-gradient-to-r from-violet-900/30 via-purple-900/20 to-indigo-900/30 border-b border-violet-800/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap gap-4 items-center">
          {[
            { label: 'Services', value: services.length, color: 'text-violet-300' },
            { label: 'Active', value: services.filter(s => s.status === 'active').length, color: 'text-emerald-400' },
            { label: 'Pending Calls', value: services.flatMap(s => s.schedule ?? []).filter(s => s.status === 'pending').length, color: 'text-orange-400' },
            { label: 'Calls Done', value: services.flatMap(s => s.schedule ?? []).filter(s => s.status === 'answered' || s.status === 'done').length, color: 'text-emerald-400' },
            { label: 'Jobs', value: jobs.length, color: 'text-blue-400' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <span className={`text-lg font-black ${s.color}`}>{s.value}</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</span>
            </div>
          ))}
          <div className="ml-auto text-[10px] text-slate-500 font-mono hidden sm:block">{TE_BASE}</div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex overflow-x-auto">
          {([
            { key: 'setup',    label: 'Setup & Service',  icon: <Settings className="w-3.5 h-3.5" /> },
            { key: 'jobs',     label: 'Custom Jobs',      icon: <Megaphone className="w-3.5 h-3.5" /> },
            { key: 'quickcall',label: 'Quick Call',        icon: <Zap className="w-3.5 h-3.5" /> },
            { key: 'history',  label: 'Call History',     icon: <BarChart2 className="w-3.5 h-3.5" /> },
            { key: 'chatbot',  label: 'AI Chat Bot',      icon: <Sparkles className="w-3.5 h-3.5" /> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${tab === t.key ? 'border-violet-500 text-violet-300 bg-violet-500/5' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">

        {/* ════════════════════════════════════════════════════════════════
            TAB 1 — SETUP & SERVICE
        ═══════════════════════════════════════════════════════════════ */}
        {tab === 'setup' && (
          <div className="space-y-6">
            {/* Register new booking */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center"><PhoneIncoming className="w-4 h-4 text-violet-600" /></div>
                <div><h3 className="text-sm font-bold text-slate-900">Register Booking for AI Calls</h3><p className="text-xs text-slate-500">Attach a booking to schedule day-wise or interval calls</p></div>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="form-label">Booking Reference *</label>
                    <input className="form-input font-mono uppercase" placeholder="VN19662 · IS48375 · SG12345" value={bookingInput}
                      onChange={e => { setBookingInput(e.target.value.toUpperCase()); setBookingRef(e.target.value.toUpperCase()) }} />
                  </div>
                  <div className="flex-1">
                    <label className="form-label">Customer Phone *</label>
                    <input className="form-input font-mono" placeholder="94771234567" value={intakeForm.phone} onChange={e => setIntakeForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="form-label">Schedule Mode</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {([
                      { key: 'agenda',   icon: '📅', title: 'Agenda', desc: 'One call per trip day at set time. Retries until answered.' },
                      { key: 'interval', icon: '⏱', title: 'Interval', desc: 'Calls every N min/hours from now until answered.' },
                    ] as const).map(m => (
                      <button key={m.key} type="button" onClick={() => setIntakeForm(f => ({ ...f, mode: m.key }))}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${intakeForm.mode === m.key ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <p className={`text-xs font-bold ${intakeForm.mode === m.key ? 'text-violet-700' : 'text-slate-600'}`}>{m.icon} {m.title}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{m.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {intakeForm.mode === 'agenda' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="form-label">Daily Call Time (local)</label><input type="time" className="form-input" value={intakeForm.call_time} onChange={e => setIntakeForm(f => ({ ...f, call_time: e.target.value }))} /></div>
                    <div><label className="form-label">Retry gap if unanswered (min)</label><input type="number" className="form-input" min="5" max="120" value={intakeForm.retry_gap_min} onChange={e => setIntakeForm(f => ({ ...f, retry_gap_min: e.target.value }))} /></div>
                  </div>
                ) : (
                  <div><label className="form-label">Call every</label>
                    <div className="flex gap-2 mt-1">
                      <input type="number" className="form-input w-24" placeholder="10" min="1" value={intakeForm.interval_count} onChange={e => setIntakeForm(f => ({ ...f, interval_count: e.target.value }))} />
                      <select className="form-select flex-1" value={intakeForm.interval_unit} onChange={e => setIntakeForm(f => ({ ...f, interval_unit: e.target.value as 'minute'|'hour'|'day' }))}>
                        <option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                  <button onClick={registerBooking} disabled={intakeLoading || !bookingRef.trim() || !intakeForm.phone.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm">
                    {intakeLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</> : <><PhoneIncoming className="w-4 h-4" /> Register Booking</>}
                  </button>
                  <button onClick={() => sendApproval(intakeForm.phone)} disabled={approvalLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><MessageSquare className="w-4 h-4" /> WhatsApp Approval</>}
                  </button>
                </div>
              </div>
            </div>

            {/* Services list */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Phone className="w-4 h-4 text-violet-400" /> Registered Services ({services.length})</h3>
                <button onClick={loadServices} disabled={svcLoading} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
                  {svcLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
                </button>
              </div>

              {svcLoading && services.length === 0 ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>
              ) : services.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <Phone className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">No services registered yet</p>
                  <p className="text-slate-400 text-xs mt-1">Register a booking above to start automated AI calls</p>
                </div>
              ) : (
                services.map(svc => <ServiceRow key={svc.id} svc={svc} />)
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 2 — CUSTOM JOBS & CAMPAIGNS
        ═══════════════════════════════════════════════════════════════ */}
        {tab === 'jobs' && (
          <div className="space-y-6">
            {/* Campaigns */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center"><Megaphone className="w-4 h-4 text-violet-600" /></div>
                  <div><h3 className="text-sm font-bold text-slate-900">Campaigns</h3><p className="text-xs text-slate-500">Reusable call scripts — guide the AI agent's approach</p></div>
                </div>
                {!campaignOpen && (
                  <button onClick={() => { setEditCampaign(null); setCampaignForm({ name: '', approach: '', collect: '', first_message: '', is_active: true }); setCampaignOpen(true) }}
                    className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold">
                    <Plus className="w-3 h-3" /> New Campaign
                  </button>
                )}
              </div>

              {campaignOpen && (
                <div className="p-4 bg-violet-50 border-b border-violet-200 space-y-3">
                  <p className="text-xs font-bold text-violet-800">{editCampaign ? `Edit: ${editCampaign.name}` : 'New Campaign'}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><label className="form-label">Name *</label><input className="form-input" value={campaignForm.name} onChange={e => setCampaignForm(f => ({ ...f, name: e.target.value }))} /></div>
                    <div className="col-span-2"><label className="form-label">Approach <span className="text-slate-400 font-normal">(how the agent should open)</span></label><textarea className="form-input min-h-[60px] resize-none" value={campaignForm.approach} onChange={e => setCampaignForm(f => ({ ...f, approach: e.target.value }))} /></div>
                    <div><label className="form-label">Collect <span className="text-slate-400 font-normal">(what to gather)</span></label><textarea className="form-input min-h-[50px] resize-none" placeholder="Rating 1-10; best moment; any issues" value={campaignForm.collect} onChange={e => setCampaignForm(f => ({ ...f, collect: e.target.value }))} /></div>
                    <div><label className="form-label">Opening Line</label><input className="form-input" placeholder="Hi! This is Apple Holidays…" value={campaignForm.first_message} onChange={e => setCampaignForm(f => ({ ...f, first_message: e.target.value }))} /></div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="w-3.5 h-3.5 rounded accent-violet-600" checked={campaignForm.is_active} onChange={e => setCampaignForm(f => ({ ...f, is_active: e.target.checked }))} /><span className="text-xs text-slate-700">Active</span></label>
                  <div className="flex gap-2">
                    <button onClick={saveCampaign} disabled={campaignLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60">
                      {campaignLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editCampaign ? 'Update' : 'Create'}
                    </button>
                    <button onClick={() => { setCampaignOpen(false); setEditCampaign(null) }} className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}

              <div className="p-4">
                {campaigns.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-3 text-center">No campaigns yet — create one to guide the agent</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-slate-100">
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Name</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide hidden sm:table-cell">Approach</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Status</th>
                        <th className="text-right py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Actions</th>
                      </tr></thead>
                      <tbody>
                        {campaigns.map(c => (
                          <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-2 font-semibold text-slate-800">{c.name}</td>
                            <td className="py-2.5 px-2 text-slate-400 hidden sm:table-cell max-w-[200px] truncate">{c.approach ?? '—'}</td>
                            <td className="py-2.5 px-2">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${c.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>{c.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => { setEditCampaign(c); setCampaignForm({ name: c.name, approach: c.approach ?? '', collect: c.collect ?? '', first_message: c.first_message ?? '', is_active: c.is_active }); setCampaignOpen(true) }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors"><Edit2 className="w-3 h-3" /></button>
                                <button onClick={async () => { if (!confirm('Delete campaign?')) return; await teProxy(`campaigns/${c.id}`, 'DELETE'); await loadCampaigns() }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Jobs */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center"><PhoneCall className="w-4 h-4 text-blue-600" /></div>
                  <div><h3 className="text-sm font-bold text-slate-900">Call Jobs</h3><p className="text-xs text-slate-500">One-off or recurring calls on any schedule</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <select value={jobFilter} onChange={e => setJobFilter(e.target.value)} className="form-select text-xs py-1 h-8">
                    <option value="all">All</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="paused">Paused</option>
                    <option value="done">Done</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  {!newJobOpen && <button onClick={() => setNewJobOpen(true)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold"><Plus className="w-3 h-3" /> New Job</button>}
                </div>
              </div>

              {newJobOpen && (
                <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5 text-violet-500" /> New Call Job</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><label className="form-label">Job Name *</label><input className="form-input" placeholder="Post-arrival follow-up" value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))} /></div>
                    <div><label className="form-label">Phone *</label><input className="form-input font-mono" placeholder="94771234567" value={jobForm.phone} onChange={e => setJobForm(f => ({ ...f, phone: e.target.value }))} /></div>
                    <div><label className="form-label">Customer Name</label><input className="form-input" value={jobForm.customer_name} onChange={e => setJobForm(f => ({ ...f, customer_name: e.target.value }))} /></div>
                    <div><label className="form-label">Booking Ref (optional)</label><input className="form-input font-mono uppercase" placeholder="VN19662" value={jobForm.bookingRef} onChange={e => setJobForm(f => ({ ...f, bookingRef: e.target.value.toUpperCase() }))} /></div>
                    <div><label className="form-label">Campaign</label>
                      <select className="form-select" value={jobForm.campaign_id} onChange={e => setJobForm(f => ({ ...f, campaign_id: e.target.value }))}>
                        <option value="">— no campaign —</option>
                        {campaigns.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div><label className="form-label">Start At</label><input className="form-input" placeholder="now  or  ISO datetime" value={jobForm.start_at} onChange={e => setJobForm(f => ({ ...f, start_at: e.target.value }))} /></div>
                    <div><label className="form-label">Max Runs (blank = unlimited)</label><input type="number" className="form-input" placeholder="3" min="1" value={jobForm.max_runs} onChange={e => setJobForm(f => ({ ...f, max_runs: e.target.value }))} /></div>
                    <div><label className="form-label">End At (optional)</label><input type="datetime-local" className="form-input" value={jobForm.end_at} onChange={e => setJobForm(f => ({ ...f, end_at: e.target.value }))} /></div>
                    <div className="col-span-2"><label className="form-label">Repeat Interval (blank = one-off)</label>
                      <div className="flex gap-2">
                        <input type="number" className="form-input w-28" placeholder="5" min="1" value={jobForm.interval_count} onChange={e => setJobForm(f => ({ ...f, interval_count: e.target.value }))} />
                        <select className="form-select flex-1" value={jobForm.interval_unit} onChange={e => setJobForm(f => ({ ...f, interval_unit: e.target.value as ''|'minute'|'hour'|'day' }))}>
                          <option value="">— one-off —</option><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-span-2"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="w-3.5 h-3.5 rounded accent-violet-600" checked={jobForm.respect_window} onChange={e => setJobForm(f => ({ ...f, respect_window: e.target.checked }))} /><span className="text-xs text-slate-700">Respect call window (only dial within 9am–7pm)</span></label></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createJob} disabled={jobLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60">
                      {jobLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : <><PhoneCall className="w-3.5 h-3.5" /> Create Job</>}
                    </button>
                    <button onClick={() => setNewJobOpen(false)} className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}

              <div className="p-4">
                {jobsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-violet-400 animate-spin" /></div>
                ) : filteredJobs.length === 0 ? (
                  <div className="py-10 text-center"><PhoneCall className="w-9 h-9 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No jobs{jobFilter !== 'all' ? ` with status "${jobFilter}"` : ''}</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-slate-100">
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Name</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Phone</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Status</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide hidden md:table-cell">Cadence</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide hidden md:table-cell">Runs</th>
                        <th className="text-left py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide hidden lg:table-cell">Next Run</th>
                        <th className="text-right py-2 px-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Actions</th>
                      </tr></thead>
                      <tbody>
                        {filteredJobs.map(job => (
                          <tr key={job.id} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${jobBusy === job.id ? 'opacity-40 pointer-events-none' : ''}`}>
                            <td className="py-2.5 px-2">
                              <p className="font-semibold text-slate-800">{job.name}</p>
                              {job.booking_ref && <p className="text-[10px] text-violet-500 font-mono mt-0.5">{job.booking_ref}</p>}
                            </td>
                            <td className="py-2.5 px-2 font-mono text-slate-500">{job.phone}</td>
                            <td className="py-2.5 px-2"><span className={sbadge(job.status)}>{job.status.toUpperCase()}</span></td>
                            <td className="py-2.5 px-2 text-slate-400 hidden md:table-cell">{job.interval_count && job.interval_unit ? `Every ${job.interval_count} ${job.interval_unit}` : 'One-off'}</td>
                            <td className="py-2.5 px-2 text-slate-500 hidden md:table-cell">{job.runs}</td>
                            <td className="py-2.5 px-2 text-slate-400 hidden lg:table-cell">{job.next_run_at ? fmtDT(job.next_run_at) : '—'}</td>
                            <td className="py-2.5 px-2">
                              <div className="flex items-center justify-end gap-0.5">
                                {['scheduled','paused'].includes(job.status) && <button onClick={() => jobAction(job.id, 'run')} title="Run now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors"><Play className="w-3.5 h-3.5" /></button>}
                                {job.status === 'scheduled' && <button onClick={() => jobAction(job.id, 'pause')} title="Pause" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-300 hover:text-amber-500 transition-colors"><Pause className="w-3.5 h-3.5" /></button>}
                                {job.status === 'paused' && <button onClick={() => jobAction(job.id, 'resume')} title="Resume" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>}
                                {!['done','cancelled'].includes(job.status) && <button onClick={() => jobAction(job.id, 'cancel')} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-400 transition-colors"><XCircle className="w-3.5 h-3.5" /></button>}
                                <button onClick={() => deleteJob(job.id)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 3 — QUICK CALL
        ═══════════════════════════════════════════════════════════════ */}
        {tab === 'quickcall' && (
          <div className="max-w-xl space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center"><Zap className="w-4 h-4 text-amber-600" /></div>
                <div><h3 className="text-sm font-bold text-slate-900">Quick Call</h3><p className="text-xs text-slate-500">Place an immediate one-off call right now</p></div>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Phone to Dial *</label>
                    <input className="form-input font-mono" placeholder="94771234567" value={quickForm.to} onChange={e => setQuickForm(f => ({ ...f, to: e.target.value }))} />
                    <p className="text-[10px] text-slate-400 mt-1">No + prefix (94 = Sri Lanka · 91 = India)</p>
                  </div>
                  <div>
                    <label className="form-label">Customer Name</label>
                    <input className="form-input" value={quickForm.name} onChange={e => setQuickForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Booking Ref (optional — attaches full itinerary)</label>
                  <input className="form-input font-mono uppercase" placeholder="VN19662 · IS48375" value={quickForm.bookingRef} onChange={e => setQuickForm(f => ({ ...f, bookingRef: e.target.value.toUpperCase() }))} />
                  <p className="text-[10px] text-slate-400 mt-1">With a booking ref, the AI agent gets the full trip itinerary, hotels, and passenger list</p>
                </div>
                <div>
                  <label className="form-label">Reason for Call <span className="font-normal text-slate-400">(optional — steers the conversation)</span></label>
                  <textarea className="form-input min-h-[72px] resize-none" placeholder="e.g. Confirm airport pickup moved to 6:00 AM and check they're OK with it." value={quickForm.reason} onChange={e => setQuickForm(f => ({ ...f, reason: e.target.value }))} />
                </div>

                {/* Parameters preview */}
                <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-[11px] font-mono space-y-1">
                  <p className="text-[10px] font-sans font-bold text-violet-700 mb-1.5 flex items-center gap-1"><BookOpen className="w-3 h-3" /> POST /quick-call</p>
                  {[
                    ['to', quickForm.to.replace(/\D/g,'') || <span className="text-red-400">required</span>],
                    ['name', quickForm.name || '—'],
                    ['bookingRef', quickForm.bookingRef || '— (no trip attached)'],
                    ['reason', quickForm.reason.trim() || '— (general check-in)'],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex items-baseline gap-2">
                      <span className="text-slate-400 w-24 flex-shrink-0">{k}</span>
                      <span className="text-slate-700 truncate">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={placeQuickCall} disabled={quickLoading || !quickForm.to.replace(/\D/g,'')}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm">
                    {quickLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Dialling…</> : <><PhoneCall className="w-4 h-4" /> Place Quick Call</>}
                  </button>
                  <button onClick={() => sendApproval(quickForm.to, quickForm.name)} disabled={approvalLoading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 transition-colors">
                    {approvalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><MessageSquare className="w-4 h-4 text-green-600" /> WhatsApp Approval</>}
                  </button>
                </div>

                {quickResult && (
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${quickResult.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    {quickResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                    <div>
                      {quickResult.message && <p className={`text-xs font-semibold ${quickResult.ok ? 'text-emerald-800' : 'text-amber-800'}`}>{quickResult.message}</p>}
                      {quickResult.references_itinerary && <p className="text-[11px] text-emerald-700 mt-0.5 font-semibold">✓ Agent has the full itinerary</p>}
                      {quickResult.note && <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{quickResult.note}</p>}
                      {quickResult.channel_id && <p className="text-[10px] text-slate-400 mt-1 font-mono">channel: {quickResult.channel_id}</p>}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">Quick calls are ephemeral — no feedback row is saved. For AI-captured feedback use Setup &amp; Service (agenda/interval mode).</p>
              </div>
            </div>

            {/* Recent services for quick reference */}
            {services.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100"><p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-slate-400" /> Registered Numbers for Quick Reference</p></div>
                <div className="divide-y divide-slate-50">
                  {services.slice(0,8).map(s => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                      <span className="font-mono text-xs font-bold text-violet-700">{s.booking_ref}</span>
                      <span className="font-mono text-xs text-slate-500">{s.call_phone}</span>
                      <button onClick={() => setQuickForm(f => ({ ...f, to: s.call_phone, bookingRef: s.booking_ref }))} className="ml-auto text-xs text-violet-600 hover:text-violet-800 font-semibold">Use</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 4 — CALL HISTORY
        ═══════════════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="form-label">Filter by Booking</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input className="form-input pl-8 h-8 text-xs w-44" placeholder="VN · IS · SG…" value={fbFilter.bookingRef} onChange={e => setFbFilter(f => ({ ...f, bookingRef: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Sentiment</label>
                <select className="form-select h-8 text-xs" value={fbFilter.sentiment} onChange={e => setFbFilter(f => ({ ...f, sentiment: e.target.value }))}>
                  <option value="">All</option>
                  <option value="positive">Positive 😊</option>
                  <option value="happy">Happy 😊</option>
                  <option value="neutral">Neutral 😐</option>
                  <option value="negative">Negative 😞</option>
                </select>
              </div>
              <div>
                <label className="form-label">View</label>
                <div className="flex border border-slate-200 rounded-lg overflow-hidden h-8">
                  {(['table','daywise'] as const).map(v => (
                    <button key={v} onClick={() => setHistoryView(v)}
                      className={`px-3 text-xs font-semibold transition-colors ${historyView === v ? 'bg-violet-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                      {v === 'table' ? 'Table' : 'Day-wise'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={loadAllFeedback} disabled={fbLoading} className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 ml-auto">
                {fbLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
              </button>
            </div>

            {fbLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>
            ) : filteredFeedback.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Mic className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No call history found</p>
                <p className="text-slate-400 text-xs mt-1">Feedback from completed calls will appear here</p>
              </div>
            ) : historyView === 'table' ? (
              /* ── Table view ── */
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">{filteredFeedback.length} Call Record{filteredFeedback.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Booking</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Day</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sentiment</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide hidden md:table-cell">Hotel</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide hidden md:table-cell">Driver</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide hidden lg:table-cell">Summary</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Detail</th>
                    </tr></thead>
                    <tbody>
                      {filteredFeedback.map(fb => (
                        <>
                          <tr key={fb.id} className={`border-b border-slate-100 hover:bg-violet-50/30 transition-colors cursor-pointer ${fbExpanded === fb.id ? 'bg-violet-50/40' : ''}`} onClick={() => setFbExpanded(fbExpanded === fb.id ? null : fb.id)}>
                            <td className="px-4 py-3 font-mono font-bold text-violet-700">{fb.booking_ref}</td>
                            <td className="px-4 py-3 text-slate-500">{fb.day_no != null ? `Day ${fb.day_no}` : '—'}</td>
                            <td className="px-4 py-3 text-slate-600">{fb.call_date ? fmtDate(fb.call_date) : fmtDT(fb.created_at)}</td>
                            <td className="px-4 py-3">
                              {fb.sentiment ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <span>{SENTIMENT_EMOJI[fb.sentiment] ?? '❓'}</span>
                                  <span className="capitalize text-slate-600">{fb.sentiment}</span>
                                </span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              {fb.hotel_ok ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${fb.hotel_ok === 'good' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : fb.hotel_ok === 'bad' ? 'bg-red-50 text-red-500 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{fb.hotel_ok}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              {fb.driver_ok ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${fb.driver_ok === 'good' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : fb.driver_ok === 'bad' ? 'bg-red-50 text-red-500 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{fb.driver_ok}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-400 hidden lg:table-cell max-w-[200px] truncate">{fb.summary ?? '—'}</td>
                            <td className="px-4 py-3 text-right">
                              <button className="p-1.5 rounded-lg hover:bg-violet-100 text-slate-300 hover:text-violet-600 transition-colors">
                                {fbExpanded === fb.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                          {fbExpanded === fb.id && (
                            <tr key={`${fb.id}-detail`} className="bg-violet-50/40 border-b border-violet-100">
                              <td colSpan={8} className="px-4 py-4">
                                <div className="grid md:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    {fb.highlights && <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5"><p className="text-[10px] font-bold text-blue-500 uppercase mb-1 flex items-center gap-1"><Star className="w-2.5 h-2.5" /> Highlights</p><p className="text-xs text-slate-700 leading-relaxed">{fb.highlights}</p></div>}
                                    {fb.issues && <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5"><p className="text-[10px] font-bold text-red-500 uppercase mb-1 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> Issues</p><p className="text-xs text-slate-700 leading-relaxed">{fb.issues}</p></div>}
                                    {fb.summary && <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2.5"><p className="text-[10px] font-bold text-violet-500 uppercase mb-1">AI Summary</p><p className="text-xs text-slate-700 leading-relaxed">{fb.summary}</p></div>}
                                  </div>
                                  {fb.transcript && (
                                    <div>
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageCircle className="w-3 h-3 text-violet-400" /> Transcript</p>
                                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                                        <TranscriptBubbles transcript={fb.transcript} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* ── Day-wise view ── */
              <div className="space-y-4">
                {services.filter(s => !fbFilter.bookingRef || s.booking_ref.toLowerCase().includes(fbFilter.bookingRef.toLowerCase())).map(svc => {
                  const svcFb = filteredFeedback.filter(f => f.booking_ref === svc.booking_ref)
                  const svcSched = allSchedules.filter(s => s.booking_ref === svc.booking_ref)
                  if (!svcFb.length && !svcSched.length) return null
                  return (
                    <div key={svc.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-violet-100 flex items-center gap-3">
                        <span className="font-mono font-black text-sm text-violet-700">{svc.booking_ref}</span>
                        <span className={sbadge(svc.status)}>{svc.status.toUpperCase()}</span>
                        <span className="text-xs text-slate-500 font-mono">{svc.call_phone}</span>
                        <span className="ml-auto text-xs text-slate-400">{svcFb.length} feedback · {svcSched.length} scheduled</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {/* Show schedule rows with feedback merged */}
                        {[...svcSched].sort((a, b) => a.day_no - b.day_no).map(day => {
                          const fb = svcFb.find(f => f.day_no === day.day_no || f.schedule_id === day.id)
                          return (
                            <div key={day.id} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                              <div className="flex items-start gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black ${day.status === 'answered' || day.status === 'done' ? 'bg-emerald-100 text-emerald-600' : day.status === 'missed' ? 'bg-red-100 text-red-500' : day.status === 'pending' ? 'bg-orange-50 text-orange-500' : 'bg-slate-100 text-slate-400'}`}>
                                  {day.day_no}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-mono font-semibold text-slate-700">{fmtDate(day.call_date)}</span>
                                    <span className={sbadge(day.status)}>{day.status.toUpperCase()}</span>
                                    {fb?.sentiment && <span className="text-xs">{SENTIMENT_EMOJI[fb.sentiment] ?? ''} <span className="capitalize text-slate-500 text-[10px]">{fb.sentiment}</span></span>}
                                    {day.attempts > 0 && <span className="text-[10px] text-slate-400">{day.attempts} attempt{day.attempts !== 1 ? 's' : ''}</span>}
                                  </div>
                                  {day.day_brief && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{day.day_brief}</p>}
                                  {fb && (
                                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                      {[['Hotel', fb.hotel_ok], ['Meals', fb.meals_ok], ['Driver', fb.driver_ok], ['Vehicle', fb.vehicle_ok]].filter(([, v]) => v).map(([label, val]) => (
                                        <span key={label as string} className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold text-center ${val === 'good' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : val === 'bad' ? 'bg-red-50 text-red-500 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{label}: {val}</span>
                                      ))}
                                    </div>
                                  )}
                                  {fb?.summary && <p className="text-[11px] text-violet-600 mt-1 italic">{fb.summary}</p>}
                                </div>
                                {(day.status === 'pending' || day.status === 'missed') && (
                                  <button disabled={scheduleBusy === day.id} onClick={() => callNow(day.id, svc.booking_ref)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-bold hover:bg-violet-700 disabled:opacity-50 flex-shrink-0">
                                    {scheduleBusy === day.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><PhoneCall className="w-3 h-3" /> Call</>}
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {/* Any feedback not matched to schedule */}
                        {svcFb.filter(f => !svcSched.find(s => s.day_no === f.day_no || s.id === f.schedule_id)).map(fb => (
                          <div key={fb.id} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 text-xs font-black text-violet-600">{fb.day_no ?? '?'}</div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-mono font-semibold text-slate-700">{fb.call_date ? fmtDate(fb.call_date) : fmtDT(fb.created_at)}</span>
                                  {fb.sentiment && <span className="text-xs">{SENTIMENT_EMOJI[fb.sentiment] ?? ''} <span className="capitalize text-slate-500 text-[10px]">{fb.sentiment}</span></span>}
                                </div>
                                {fb.summary && <p className="text-[11px] text-violet-600 mt-0.5 italic">{fb.summary}</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 5 — AI CHAT BOT
        ═══════════════════════════════════════════════════════════════ */}
        {tab === 'chatbot' && (
          <div className="max-w-2xl mx-auto flex flex-col" style={{ height: 'calc(100vh - 260px)' }}>
            <div className="bg-gradient-to-r from-violet-900 to-purple-900 rounded-t-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/30 border border-violet-400/30 flex items-center justify-center">
                <Bot className="w-5 h-5 text-violet-200" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">AI Call Bot Assistant</h3>
                <p className="text-[11px] text-violet-300">Ask me about bookings, call history, or set up calls</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-300">Online</span>
              </div>
            </div>

            <div className="flex-1 bg-slate-950 border-x border-slate-800 overflow-y-auto p-4 space-y-3">
              {chatMsgs.map(msg => (
                <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'bot' && (
                    <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  {msg.role === 'system' && (
                    <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Settings className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-tr-sm'
                      : msg.role === 'system'
                      ? 'bg-slate-800 text-slate-300 rounded-tl-sm'
                      : 'bg-slate-800 text-slate-100 rounded-tl-sm'
                  }`}>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-violet-300' : 'text-slate-500'}`}>
                      {new Date(msg.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0"><Sparkles className="w-3.5 h-3.5 text-white" /></div>
                  <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                    {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick suggestions */}
            <div className="bg-slate-900 border-x border-slate-800 px-3 py-2 flex gap-1.5 overflow-x-auto">
              {[
                'Show feedback for VN19662',
                'List all services',
                'How many pending calls',
                'Quick call 94771234567',
                'Help',
              ].map(s => (
                <button key={s} onClick={() => { setChatInput(s); }}
                  className="flex-shrink-0 text-[10px] bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:border-violet-500 px-2.5 py-1 rounded-full transition-colors font-medium whitespace-nowrap">
                  {s}
                </button>
              ))}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-b-2xl p-3 flex gap-2">
              <input
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
                placeholder="Ask me anything — booking ref, call history, set up a call…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat() } }}
              />
              <button onClick={handleChat} disabled={chatLoading || !chatInput.trim()}
                className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 transition-colors flex-shrink-0">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
