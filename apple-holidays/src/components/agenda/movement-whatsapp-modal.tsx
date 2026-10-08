'use client'

/**
 * "WhatsApp this movement" dialog on the movement chart.
 *
 * Sends ONE agenda item — through the approved movement-briefing template — to
 * the driver, transport vendor, guide and/or tour vendor. Numbers come from the
 * assignment and the directories, and every one can be corrected for this send
 * (optionally saved back onto the movement). Extra numbers can be added.
 *
 * The preview is rendered with the same function the server sends with
 * (renderMovementBrief), from the SAVED movement the server returned, so what
 * the desk reads here is exactly what lands on the phone.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Send, Loader2, Plus, X, Check, CheckCheck, AlertTriangle, Clock, RefreshCw,
  FlaskConical, Car, Building2, Sparkles, Store, UserRound, ShieldCheck, Settings2, History, Pencil,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import {
  MOVEMENT_ROLE_LABEL, renderMovementBrief, bookingLabel,
  type MovementBriefInput, type MovementRole, type MovementWaConfig,
} from '@/lib/movement-whatsapp-shared'

interface Recipient {
  key: string
  role: MovementRole
  name: string
  phone: string
  originalPhone: string
  source: string
  selected: boolean
  saveToMovement: boolean
}

interface HistoryRow { id: string; phone: string; role: string; name: string; status: string; body: string | null; createdAt: string }
interface SendResult { role: MovementRole; name: string; phone: string; ok: boolean; reason?: string; redirectedTo?: string; followUpSent?: boolean }
interface TemplateStatus { name: string; status: string; mismatch?: string; error?: string }

interface Loaded {
  config: MovementWaConfig
  template: TemplateStatus
  input: MovementBriefInput
  recipients: { role: MovementRole; name: string; phone: string; source: string; selected: boolean }[]
  history: HistoryRow[]
  canSend: boolean
  testMode: { to: string } | null
}

/** The fields of the chart row the server copy is compared against. */
export interface LocalMovementSnapshot {
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  meetingTime: string
}

const ROLE_ICON: Record<MovementRole, typeof Car> = {
  driver: Car, vendor: Building2, guide: Sparkles, tourVendor: Store, other: UserRound,
}
const ROLE_TONE: Record<MovementRole, string> = {
  driver:     'bg-blue-50 text-blue-700 border-blue-200',
  vendor:     'bg-violet-50 text-violet-700 border-violet-200',
  guide:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  tourVendor: 'bg-teal-50 text-teal-700 border-teal-200',
  other:      'bg-slate-50 text-slate-700 border-slate-200',
}

const digits = (s: string) => s.replace(/\D/g, '')

function StatusTick({ status }: { status: string }) {
  if (status === 'read') return <span className="inline-flex items-center gap-0.5 text-sky-600"><CheckCheck className="w-3.5 h-3.5" />Read</span>
  if (status === 'delivered') return <span className="inline-flex items-center gap-0.5 text-slate-500"><CheckCheck className="w-3.5 h-3.5" />Delivered</span>
  if (status === 'failed') return <span className="inline-flex items-center gap-0.5 text-red-600"><AlertTriangle className="w-3.5 h-3.5" />Failed</span>
  return <span className="inline-flex items-center gap-0.5 text-slate-400"><Check className="w-3.5 h-3.5" />Sent</span>
}

function TemplatePill({ t }: { t: TemplateStatus }) {
  const map: Record<string, string> = {
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
    MISSING:  'bg-red-50 text-red-700 border-red-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    PAUSED:   'bg-orange-50 text-orange-700 border-orange-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${map[t.status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}
      title={t.error || t.mismatch || `Template ${t.name}`}>
      <ShieldCheck className="w-3 h-3" />
      {t.status === 'UNKNOWN' ? 'Template status unknown' : `Template ${t.status.toLowerCase()}`}
    </span>
  )
}

/** WhatsApp's *bold* → <strong>, newlines kept. Plain React nodes — no HTML injection. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i} className="block min-h-[1em]">
          {line.split(/(\*[^*\n]+\*)/g).map((part, j) =>
            part.startsWith('*') && part.endsWith('*') && part.length > 2
              ? <strong key={j}>{part.slice(1, -1)}</strong>
              : <Fragment key={j}>{part}</Fragment>,
          )}
        </span>
      ))}
    </>
  )
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MovementWhatsAppModal({
  bookingRef, itemId, local, isAdmin, onClose, onSent,
}: {
  bookingRef: string
  itemId: string
  /** The row as the chart currently shows it — used only to warn about unsaved edits. */
  local: LocalMovementSnapshot
  isAdmin: boolean
  onClose: () => void
  onSent: () => void
}) {
  const [data, setData]         = useState<Loaded | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [rows, setRows]         = useState<Recipient[]>([])
  const [note, setNote]         = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [sending, setSending]   = useState(false)
  const [results, setResults]   = useState<SendResult[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async (fresh = false) => {
    setError(null)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/items/${encodeURIComponent(itemId)}/whatsapp${fresh ? '?fresh=1' : ''}`)
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `Load failed (${res.status})`)
      const d = json.data as Loaded
      setData(d)
      setRows(d.recipients.map((r, i) => ({
        key: `${r.role}-${i}`, role: r.role, name: r.name, phone: r.phone, originalPhone: r.phone,
        source: r.source, selected: r.selected, saveToMovement: false,
      })))
      setPreviewKey(k => k ?? (d.recipients.length ? `${d.recipients[0].role}-0` : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this movement')
    }
  }, [bookingRef, itemId])

  useEffect(() => { void load() }, [load])

  const selected = rows.filter(r => r.selected)
  const previewRow = rows.find(r => r.key === previewKey) ?? selected[0] ?? rows[0]

  const preview = useMemo(() => {
    if (!data) return null
    return renderMovementBrief(
      data.input,
      { role: previewRow?.role ?? 'driver', name: previewRow?.name || 'Driver' },
      { config: data.config, note },
    )
  }, [data, previewRow?.role, previewRow?.name, note])

  /** Unsaved edits on the chart row — the server sends the saved version. */
  const unsaved = useMemo(() => {
    if (!data) return [] as string[]
    const i = data.input
    const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
    const diffs: string[] = []
    if (local.date && local.date.slice(0, 10) !== i.date) diffs.push('date')
    if (norm(local.location) !== norm(i.location)) diffs.push('location')
    if (norm(local.fromPoint) !== norm(i.fromPoint)) diffs.push('from')
    if (norm(local.toPoint) !== norm(i.toPoint)) diffs.push('to / activity')
    if (norm(local.details) !== norm(i.details)) diffs.push('details')
    if (norm(local.meetingTime) !== norm(i.meetingTime)) diffs.push('meeting time')
    return diffs
  }, [data, local])

  const lastByPhone = useMemo(() => {
    const m = new Map<string, HistoryRow>()
    for (const h of data?.history ?? []) if (!m.has(h.phone) && !h.body?.startsWith('📝 *Full details')) m.set(h.phone, h)
    return m
  }, [data?.history])

  const templateBlocked = !!data && !['APPROVED', 'UNKNOWN'].includes(data.template.status)
  const invalid = selected.filter(r => digits(r.phone).length < 8 || digits(r.phone).length > 15)

  function update(key: string, patch: Partial<Recipient>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addOther() {
    const key = `other-${Date.now()}`
    setRows(rs => [...rs, { key, role: 'other', name: '', phone: '', originalPhone: '', source: 'Added for this send', selected: true, saveToMovement: false }])
    setPreviewKey(key)
  }

  async function send(force = false, only?: SendResult[]) {
    const targets = only
      ? rows.filter(r => r.selected && only.some(o => digits(o.phone) === digits(r.phone)))
      : selected
    if (!targets.length) { toast.error('Tick at least one recipient'); return }
    if (!force && invalid.length) { toast.error('Fix the highlighted phone numbers first'); return }

    setSending(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/items/${encodeURIComponent(itemId)}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force,
          note: note.trim() || undefined,
          recipients: targets.map(r => ({
            role: r.role, name: r.name, phone: digits(r.phone),
            saveToMovement: r.saveToMovement && digits(r.phone) !== digits(r.originalPhone),
          })),
        }),
      })
      const raw = await res.text()
      let json: { success?: boolean; error?: string; data?: { results: SendResult[]; history: HistoryRow[] } } = {}
      if (raw) { try { json = JSON.parse(raw) } catch { /* non-JSON */ } }
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || `Send failed (${res.status})`)

      const r = json.data.results
      setResults(prev => (only && prev ? [...prev.filter(p => !r.some(x => digits(x.phone) === digits(p.phone))), ...r] : r))
      setData(d => (d ? { ...d, history: json.data!.history } : d))
      const ok = r.filter(x => x.ok).length
      const dup = r.filter(x => x.reason === 'duplicate').length
      if (ok) toast.success(`Movement sent to ${ok} recipient${ok === 1 ? '' : 's'} on WhatsApp`)
      if (dup) toast.warning(`${dup} already received this exact message recently — confirm to send again`)
      if (r.some(x => !x.ok && x.reason !== 'duplicate')) toast.error('Some messages were not sent — see the details below')
      if (ok) onSent()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const duplicates = results?.filter(r => r.reason === 'duplicate') ?? []
  const charCount = preview?.text.length ?? 0

  return (
    <Modal
      open
      onClose={onClose}
      title="WhatsApp this movement"
      size="4xl"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <p className="text-[11px] text-slate-400">
            Sent from the operations number via the approved <span className="font-mono">{data?.config.templateName ?? '…'}</span> template. Driver rates are never included.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
            {data?.canSend && (
              <Button
                size="sm"
                onClick={() => send(false)}
                loading={sending}
                disabled={sending || !selected.length || templateBlocked || !data.config.enabled}
                icon={<Send className="w-3.5 h-3.5" />}
                className="!bg-[#25D366] hover:!bg-[#1ebe5b]"
              >
                Send to {selected.length || '…'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm text-slate-700">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => load()} icon={<RefreshCw className="w-3.5 h-3.5" />}>Retry</Button>
        </div>
      ) : !data || !preview ? (
        <div className="p-10 flex items-center justify-center text-slate-400 gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading the saved movement…
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Movement header ── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 rounded-lg bg-slate-900 text-white">
              {bookingLabel(data.input.bookingRef, data.input.isNumber)}
            </span>
            <span className="text-xs text-slate-600">
              {new Date(`${data.input.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}
              {' · '}{data.input.serviceTypeLabel}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <TemplatePill t={data.template} />
              <button onClick={() => load(true)} className="text-slate-400 hover:text-slate-600" title="Re-check template status">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>

          {/* ── Blocking / caution banners ── */}
          {!data.config.enabled && (
            <Banner tone="red" icon={<AlertTriangle className="w-4 h-4" />}>
              Movement WhatsApp is switched off in Settings.
            </Banner>
          )}
          {templateBlocked && (
            <Banner tone="red" icon={<AlertTriangle className="w-4 h-4" />}>
              {data.template.status === 'MISSING'
                ? <>The template <span className="font-mono">{data.template.name}</span> is not registered on WhatsApp yet.</>
                : <>The template <span className="font-mono">{data.template.name}</span> is {data.template.status.toLowerCase()} — Meta will not deliver it until it is approved.</>}
              {isAdmin && <> <a href="/dashboard/admin/config#setting-movement-whatsapp" className="underline font-semibold inline-flex items-center gap-1"><Settings2 className="w-3 h-3" />Open Settings</a></>}
            </Banner>
          )}
          {data.template.mismatch && (
            <Banner tone="amber" icon={<AlertTriangle className="w-4 h-4" />}>{data.template.mismatch}</Banner>
          )}
          {data.testMode && (
            <Banner tone="violet" icon={<FlaskConical className="w-4 h-4" />}>
              Test mode is on — every message goes to the test number <span className="font-mono">+{data.testMode.to}</span>, not to the people below.
            </Banner>
          )}
          {unsaved.length > 0 && (
            <Banner tone="amber" icon={<Pencil className="w-4 h-4" />}>
              This movement has unsaved changes ({unsaved.join(', ')}). WhatsApp sends the <strong>saved</strong> version shown in the preview — save the chart first if the changes should go out.
            </Banner>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            {/* ── Recipients ── */}
            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Send to</p>
                <button onClick={addOther} className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add number
                </button>
              </div>

              {!rows.length && (
                <p className="text-xs text-slate-400 italic border border-dashed border-slate-200 rounded-lg px-3 py-4 text-center">
                  Nobody is allocated to this movement yet. Assign a driver first, or add a number.
                </p>
              )}

              {rows.map(r => {
                const Icon = ROLE_ICON[r.role]
                const d = digits(r.phone)
                const bad = r.selected && (d.length < 8 || d.length > 15)
                const changed = d !== digits(r.originalPhone) && !!r.originalPhone
                const last = lastByPhone.get(d)
                const result = results?.find(x => digits(x.phone) === d)
                const canSave = changed && (r.role === 'driver' || r.role === 'guide' || r.role === 'tourVendor')
                return (
                  <div
                    key={r.key}
                    onClick={() => setPreviewKey(r.key)}
                    className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                      previewRow?.key === r.key ? 'border-emerald-300 bg-emerald-50/40 ring-1 ring-emerald-200' : 'border-slate-200 hover:border-slate-300'
                    } ${!r.selected ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={e => update(r.key, { selected: e.target.checked })}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${ROLE_TONE[r.role]}`}>
                        <Icon className="w-3 h-3" />{MOVEMENT_ROLE_LABEL[r.role]}
                      </span>
                      {r.role === 'other' ? (
                        <input
                          value={r.name}
                          onChange={e => update(r.key, { name: e.target.value })}
                          onClick={e => e.stopPropagation()}
                          placeholder="Name"
                          className="flex-1 min-w-0 text-sm px-2 py-1 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                      )}
                      {r.role === 'other' && (
                        <button onClick={e => { e.stopPropagation(); setRows(rs => rs.filter(x => x.key !== r.key)) }} className="text-slate-300 hover:text-red-500">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                      <div className={`flex items-center rounded-md border ${bad ? 'border-red-300 bg-red-50' : changed ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                        <span className="pl-2 text-sm text-slate-400">+</span>
                        <input
                          value={r.phone}
                          inputMode="tel"
                          onChange={e => update(r.key, { phone: e.target.value.replace(/[^\d\s+()-]/g, '') })}
                          onClick={e => e.stopPropagation()}
                          placeholder="Country code + number"
                          className="w-44 text-sm font-mono px-1.5 py-1 bg-transparent focus:outline-none"
                        />
                      </div>
                      {changed && (
                        <button onClick={e => { e.stopPropagation(); update(r.key, { phone: r.originalPhone, saveToMovement: false }) }}
                          className="text-[11px] text-amber-700 hover:underline">
                          was +{r.originalPhone} · undo
                        </button>
                      )}
                      {!changed && <span className="text-[10px] text-slate-400">{r.source}</span>}
                      {bad && <span className="text-[11px] text-red-600">Use country code + number, 8–15 digits</span>}
                    </div>

                    {canSave && (
                      <label onClick={e => e.stopPropagation()} className="mt-2 pl-6 flex items-center gap-2 text-[11px] text-slate-600">
                        <input type="checkbox" checked={r.saveToMovement} onChange={e => update(r.key, { saveToMovement: e.target.checked })} className="accent-amber-600" />
                        Also save this number on the movement
                      </label>
                    )}

                    {(last || result) && (
                      <div className="mt-2 pl-6 flex flex-wrap items-center gap-3 text-[11px]">
                        {result && (result.ok ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <Check className="w-3.5 h-3.5" />Sent{result.redirectedTo ? ` (to test +${result.redirectedTo})` : ''}{result.followUpSent ? ' + full details' : ''}
                          </span>
                        ) : result.reason === 'duplicate' ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><Clock className="w-3.5 h-3.5" />Already sent this exact message recently</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle className="w-3.5 h-3.5" />{result.reason}</span>
                        ))}
                        {last && !result && (
                          <span className="text-slate-400 inline-flex items-center gap-1">
                            Last sent {ago(last.createdAt)} · <StatusTick status={last.status} />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {duplicates.length > 0 && data.canSend && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs text-amber-800">{duplicates.length} recipient{duplicates.length === 1 ? '' : 's'} already got this exact message.</p>
                  <Button size="sm" variant="secondary" loading={sending} onClick={() => send(true, duplicates)}>Send again anyway</Button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Note from operations <span className="normal-case font-normal text-slate-400">(optional)</span></label>
                  <span className="text-[10px] text-slate-400">{note.length}/300</span>
                </div>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 300))}
                  rows={2}
                  placeholder="e.g. Guest has a wheelchair — please bring a large vehicle."
                  className="mt-1 w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                />
              </div>

              {data.history.length > 0 && (
                <div>
                  <button onClick={() => setShowHistory(s => !s)} className="text-xs font-semibold text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
                    <History className="w-3.5 h-3.5" /> Send history ({data.history.length})
                  </button>
                  {showHistory && (
                    <ul className="mt-2 divide-y divide-slate-100 border border-slate-100 rounded-lg">
                      {data.history.map(h => (
                        <li key={h.id} className="px-3 py-2 flex items-center gap-3 text-[11px]">
                          <span className="text-slate-400 w-24 flex-shrink-0">{ago(h.createdAt)}</span>
                          <span className="font-semibold text-slate-700 truncate">{h.role} · {h.name}</span>
                          <span className="font-mono text-slate-400">+{h.phone}</span>
                          <span className="ml-auto"><StatusTick status={h.status} /></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* ── Phone preview ── */}
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                Preview {previewRow ? <span className="normal-case font-normal text-slate-400">— as {previewRow.name || MOVEMENT_ROLE_LABEL[previewRow.role]} sees it</span> : null}
              </p>
              <div className="rounded-2xl bg-[#e5ddd5] p-3 shadow-inner" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)', backgroundSize: '12px 12px' }}>
                <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-3 py-2 text-[12.5px] leading-snug text-slate-800 max-h-[420px] overflow-y-auto">
                  <WaText text={preview.text} />
                  <p className="mt-2 text-[10.5px] text-slate-400">AppleHolidays Operations</p>
                  <p className="text-right text-[10px] text-slate-400">now</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className={charCount > 1000 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>{charCount}/1024 characters</span>
                {preview.detailsTrimmed && (
                  <span className="text-amber-600" title="Meta caps a template at 1024 characters">
                    Details shortened{data.config.fullDetailFollowUp ? ' — full text follows if their chat is open' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Banner({ tone, icon, children }: { tone: 'red' | 'amber' | 'violet'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    red:    'bg-red-50 border-red-200 text-red-800',
    amber:  'bg-amber-50 border-amber-200 text-amber-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
  }[tone]
  return <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${cls}`}><span className="mt-0.5 flex-shrink-0">{icon}</span><div>{children}</div></div>
}

export interface MovementSendSummary {
  count: number
  lastAt: string
  recipients: number
  statuses: Record<string, number>
}

/** WhatsApp glyph — lucide has no brand icons. */
function WaGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43m8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.8.72.7 5.8.7 12.06c0 2 .52 3.95 1.52 5.67L.6 23.28l5.7-1.5a11.3 11.3 0 0 0 5.75 1.47h.01c6.25 0 11.34-5.09 11.35-11.34 0-3.03-1.18-5.88-3.33-8.02" />
    </svg>
  )
}

/**
 * The per-movement button: WhatsApp glyph, plus a badge once this movement has
 * been sent — blue double-tick when everyone has read it, grey when delivered,
 * red when any recipient's latest message failed.
 */
export function MovementWhatsAppButton({
  summary, disabledReason, onClick,
}: {
  summary?: MovementSendSummary
  disabledReason?: string | null
  onClick: () => void
}) {
  const s = summary
  const failed = (s?.statuses.failed ?? 0) > 0
  const allRead = !!s && !failed && (s.statuses.read ?? 0) === s.recipients
  const delivered = !!s && !failed && ((s.statuses.read ?? 0) + (s.statuses.delivered ?? 0)) === s.recipients
  const title = disabledReason
    ?? (s
      ? `WhatsApp this movement — sent to ${s.recipients} recipient${s.recipients === 1 ? '' : 's'}, last ${ago(s.lastAt)}${failed ? ' · a message FAILED' : allRead ? ' · all read' : delivered ? ' · all delivered' : ''}`
      : 'WhatsApp this movement to its driver / vendor / guide')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabledReason}
      title={title}
      className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        failed
          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-[#25D366]/40 bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20'
      }`}
    >
      <WaGlyph className="w-3.5 h-3.5" />
      {s ? (
        <span className="inline-flex items-center gap-0.5">
          {failed ? <AlertTriangle className="w-3 h-3" />
            : allRead ? <CheckCheck className="w-3.5 h-3.5 text-sky-600" />
            : delivered ? <CheckCheck className="w-3.5 h-3.5" />
            : <Check className="w-3.5 h-3.5" />}
          {s.recipients}
        </span>
      ) : 'Send'}
    </button>
  )
}
