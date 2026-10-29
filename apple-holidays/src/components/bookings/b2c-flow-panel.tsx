'use client'

/**
 * AahaasFlow, on the B2C booking page — what the order desk sees at
 * ai.aahaas.com/aahaasFlow/#/b2c/order/<id>, without leaving OPS:
 *
 *   · the order journey — booked → customer notified → vouchers → suppliers →
 *     payment → operations → travel, with where it is waiting now
 *   · every product: photos, status lane, service date, money, supplier,
 *     stay / pax details and its fulfilment checklist
 *   · the documents — invoice, supplier vouchers, customer confirmation and
 *     (profit roles) the P&L statement — to view, print or save as PDF
 *   · the order's profit & loss (profit roles only)
 *
 * Read-only: everything comes from `/api/bookings/[ref]/b2c-flow`, which reads
 * Flow with a GET-only key. Acting on the order stays in AahaasFlow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BedDouble, Building2, CalendarDays, Check, ChevronDown, ChevronRight, CircleDollarSign,
  Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Mail, MapPin, Phone, Plane, Printer,
  RefreshCw, Route, ShieldCheck, Ticket, Truck, Users, X, Bell, Send, ShoppingBag, ClipboardCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { cn, readApiResponse } from '@/lib/utils'
import { frameToPdf, htmlToPdfDownload, stripDocumentChrome } from '@/lib/html-document-pdf'

// ─── Shapes (as Flow answers them; everything optional — Flow is upstream) ────

interface FlowStep { key: string; state: string; value?: string | null; hint?: string | null; owner?: string | null; link?: string | null }
interface FlowTrack {
  steps: FlowStep[]
  next?: { text: string; tone: string; owner?: string | null } | null
  health?: 'ok' | 'bad' | 'wait' | string
}
interface FlowLine {
  checkoutId: number | string
  category?: string | null
  title?: string | null
  image?: string | null
  images?: string[]
  serviceDate?: string | null
  currency?: string | null
  totalAmount?: number | null
  paidAmount?: number | null
  balanceAmount?: number | null
  status?: string | null
  supplierStatus?: string | null
  amended?: boolean
  traveller?: { reconfirmationDate?: string | null; deliveryStatus?: string | null }
  cancel?: { role?: string | null; reason?: string | null } | null
  supplier?: { name?: string | null; company?: string | null; email?: string | null; phone?: string | null } | null
  details?: {
    location?: string | null; city?: string | null; stars?: number | null; description?: string | null
    checkIn?: string | null; checkOut?: string | null; nights?: number | null; rooms?: number | null
    roomTypes?: string[]; adults?: number | null; children?: number | null; roomCategory?: string | null
    mealPlan?: string | null; inclusions?: string[]; cancellation?: string | null; provider?: string | null
  }
}
interface FlowCheck {
  checkout_id: number | string
  type_label?: string | null
  voucher_applies?: boolean
  voucher?: { status?: string; at?: string | null; by?: string | null } | null
  reconfirm?: { status?: string; at?: string | null; by?: string | null } | null
  reconfirm_days_before?: number
}
interface FlowOrder {
  order?: { currency?: string | null; total?: number | null; paid?: number | null; balance?: number | null; payment_state?: string | null; stage?: string | null; pay_category?: string | null; payment_type?: string | null; booked_at?: string | null }
  customer?: { name?: string | null; email?: string | null; phone?: string | null }
  lead?: { name?: string | null; email?: string | null; phone?: string | null } | null
  lines?: FlowLine[]
  checklist?: { available?: boolean; lines?: FlowCheck[] }
}
interface FlowDocs {
  invoice?: { number?: string }
  vouchers?: { line_id: number; number?: string; product?: string | null; supplier?: string | null; cancelled?: boolean }[]
  flights?: number
}
interface FlowPnl {
  totals?: { revenue_usd?: number | null; cost_usd?: number | null; profit_usd?: number | null; margin_pct?: number | null; known_lines?: number; lines?: number }
  profit_basis?: string | null
  lines?: { line_id: number; product?: string | null; category?: string | null; vendor?: string | null; revenue_usd?: number | null; cost_usd?: number | null; profit_usd?: number | null; margin_pct?: number | null; basis?: string | null; cancelled?: boolean }[]
}
type Part<T> = { data: T | null; error: string | null } | null
interface Payload {
  connected: boolean
  orderId: number
  canProfit: boolean
  order?: Part<FlowOrder>
  track?: Part<FlowTrack | null>
  documents?: Part<FlowDocs>
  pnl?: Part<FlowPnl>
}

type DocKind = 'invoice' | 'vouchers' | 'voucher' | 'pnl' | 'confirmation' | 'supplier'
interface OpenDoc { kind: DocKind; line?: string; title: string; number: string; pdf?: boolean }

// ─── Presentation ─────────────────────────────────────────────────────────────

const STEP_META: Record<string, { label: string; icon: typeof Check }> = {
  booked: { label: 'Booked', icon: ShoppingBag },
  customer: { label: 'Customer notified', icon: Mail },
  vouchers: { label: 'Vouchers sent', icon: Send },
  suppliers: { label: 'Suppliers confirmed', icon: ShieldCheck },
  payment: { label: 'Payment', icon: CircleDollarSign },
  ops: { label: 'Operations', icon: Truck },
  travel: { label: 'Travel', icon: Plane },
  pnr: { label: 'PNR', icon: Plane },
  ticket: { label: 'Ticketed', icon: Ticket },
}

const STEP_TONE: Record<string, { node: string; text: string; word: string }> = {
  done: { node: 'bg-emerald-500 border-emerald-500 text-white', text: 'text-emerald-700', word: 'Done' },
  partial: { node: 'bg-sky-50 border-sky-400 text-sky-600', text: 'text-sky-700', word: 'In progress' },
  todo: { node: 'bg-white border-slate-300 text-slate-400', text: 'text-slate-600', word: 'Not yet' },
  ours: { node: 'bg-amber-50 border-amber-400 text-amber-600', text: 'text-amber-700', word: 'Needs us' },
  bad: { node: 'bg-rose-50 border-rose-500 text-rose-600 ring-4 ring-rose-100', text: 'text-rose-700', word: 'Act now' },
  unknown: { node: 'bg-slate-50 border-dashed border-slate-300 text-slate-400', text: 'text-slate-500', word: 'Unknown' },
  na: { node: 'bg-slate-50 border-slate-200 text-slate-300', text: 'text-slate-400', word: 'Not needed' },
}

const HEALTH: Record<string, [string, string]> = {
  ok: ['On track', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  bad: ['Needs attention', 'bg-rose-50 text-rose-700 border-rose-200'],
}

const BASIS: Record<string, [string, string]> = {
  cost: ['Costed', 'bg-emerald-50 text-emerald-700'],
  pass_through: ['Pass-through', 'bg-amber-50 text-amber-700'],
  no_cost: ['Cost missing', 'bg-rose-50 text-rose-700'],
  no_data: ['Not costed yet', 'bg-rose-50 text-rose-700'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'],
  amended: ['Amended', 'bg-slate-100 text-slate-500'],
}

const PROFIT_NOTE: Record<string, string> = {
  partial: 'Some services have no cost on file — profit and margin cover the costed ones only.',
  unknown: 'No service has a cost on file yet, so profit cannot be stated.',
  margin_ledger: 'No service is costed; profit is the margin recorded when the order was confirmed.',
}

function money(v: number | null | undefined, cur?: string | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return cur ? `${cur} ${s}` : s
}

function usd(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function day(iso?: string | null) {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

/** "in 3 days" / "today" / "14 days ago" — the desk reads urgency, not dates. */
function relative(iso?: string | null) {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000)
  if (n === 0) return { text: 'today', tone: 'text-amber-600' }
  if (n === 1) return { text: 'tomorrow', tone: 'text-amber-600' }
  if (n > 0) return { text: `in ${n} days`, tone: n <= 3 ? 'text-amber-600' : 'text-slate-500' }
  return { text: `${-n} day${n === -1 ? '' : 's'} ago`, tone: 'text-slate-400' }
}

/** A product's four lanes: Ordered → Accepted → Supplier confirmed → Delivered. */
function laneOf(l: FlowLine) {
  const status = l.status ?? ''
  const cancelled = status === 'Cancel'
  const accepted = ['Approved', 'Completed'].includes(status)
  const confirmed = ['Confirmed', 'Completed'].includes(l.supplierStatus ?? '')
  const delivered = status === 'Completed' || l.traveller?.deliveryStatus === 'Delivered'
  return { cancelled, steps: [
    { label: 'Ordered', done: true },
    { label: 'Accepted', done: accepted },
    { label: 'Supplier confirmed', done: confirmed },
    { label: 'Delivered', done: delivered },
  ] }
}

const docUrl = (ref: string, kind: DocKind, line?: string, download = false) =>
  `/api/bookings/${encodeURIComponent(ref)}/b2c-flow/doc?kind=${kind}${line ? `&line=${line}` : ''}${download ? '&download=1' : ''}`

async function fetchDocText(ref: string, kind: DocKind, line?: string): Promise<string> {
  const res = await fetch(docUrl(ref, kind, line))
  if (!res.ok) {
    const json = await readApiResponse(res)
    throw new Error(json.error || `Could not open the document (${res.status})`)
  }
  return res.text()
}

/** A relayed PDF — refused unless it really is one (a blob runs on our origin). */
async function fetchPdf(ref: string, doc: OpenDoc): Promise<Blob> {
  const res = await fetch(docUrl(ref, doc.kind, doc.line))
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) {
    const json = await readApiResponse(res)
    throw new Error(json.error || `Could not open the document (${res.status})`)
  }
  return new Blob([await res.arrayBuffer()], { type: 'application/pdf' })
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function B2cFlowPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<OpenDoc | null>(null)
  const [busyPdf, setBusyPdf] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await readApiResponse<Payload>(await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-flow`))
      if (json.success && json.data) setData(json.data)
      else setError(json.error || 'Could not read the order from AahaasFlow')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  /** Save a document as PDF — HTML ones are drawn in the browser; PDFs come as they are. */
  const savePdf = useCallback(async (doc: OpenDoc) => {
    const key = `${doc.kind}:${doc.line ?? ''}`
    setBusyPdf(key)
    try {
      if (doc.pdf) saveBlob(await fetchPdf(bookingRef, doc), `${doc.number}.pdf`)
      else await htmlToPdfDownload(await fetchDocText(bookingRef, doc.kind, doc.line), `${doc.number}.pdf`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyPdf(null)
    }
  }, [bookingRef])

  const order = data?.order?.data ?? null
  const track = data?.track?.data ?? null
  const docs = data?.documents?.data ?? null
  const pnl = data?.pnl?.data ?? null
  const orderId = data?.orderId
  const checks = useMemo(
    () => new Map((order?.checklist?.lines ?? []).map((c) => [String(c.checkout_id), c])),
    [order],
  )
  const flowUrl = orderId ? `https://ai.aahaas.com/aahaasFlow/#/b2c/order/${orderId}` : null

  return (
    <section data-nav="AahaasFlow" data-nav-icon="pnl">
      <Card>
        <CardHeader
          action={
            <div className="flex items-center gap-3">
              <button onClick={load} disabled={loading} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1" title="Read the order again from AahaasFlow">
                <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
              </button>
              {flowUrl && (
                <a href={flowUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                  Open in AahaasFlow <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          }
        >
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
            <Route className="w-4 h-4 text-slate-400" /> AahaasFlow
            {orderId && <span className="font-mono text-slate-500">#{orderId}</span>}
            {track?.health && HEALTH[track.health] && (
              <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', HEALTH[track.health][1])}>{HEALTH[track.health][0]}</span>
            )}
            {order?.order?.payment_state && (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
                order.order.payment_state === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {order.order.payment_state.replace(/_/g, ' ')}
              </span>
            )}
          </h3>
        </CardHeader>
        <CardBody>
          {loading && !data && (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Reading the order from AahaasFlow…</div>
          )}
          {error && <Problem text={error} />}
          {data && !data.connected && (
            <Problem text="AahaasFlow is not connected to OPS yet — set AAHAAS_FLOW_SERVICE_KEY here and the same value as OPS_FLOW_SERVICE_KEY on the AahaasFlow server." />
          )}

          {data?.connected && (
            <div className="space-y-6">
              <Journey track={track} error={data.track?.error ?? null} loading={loading && !track} />

              <Documents
                docs={docs}
                error={data.documents?.error ?? null}
                orderId={data.orderId}
                canProfit={data.canProfit}
                busy={busyPdf}
                onView={setOpen}
                onPdf={savePdf}
              />

              {data.canProfit && <ProfitLoss pnl={pnl} error={data.pnl?.error ?? null} />}

              <div>
                <SectionTitle icon={ShoppingBag} title="Products" hint={order?.lines ? `${order.lines.length} on this order · from the Aahaas store` : undefined} />
                {data.order?.error && <Problem text={data.order.error} />}
                <div className="space-y-4">
                  {(order?.lines ?? []).map((l) => (
                    <ProductCard
                      key={String(l.checkoutId)}
                      line={l}
                      check={checks.get(String(l.checkoutId)) ?? null}
                      busy={busyPdf}
                      onView={setOpen}
                      onPdf={savePdf}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {open && (
        <DocViewer
          bookingRef={bookingRef}
          doc={open}
          onClose={() => setOpen(null)}
          onPdf={savePdf}
          busy={busyPdf === `${open.kind}:${open.line ?? ''}`}
        />
      )}
    </section>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Problem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {text}
    </div>
  )
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Check; title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-slate-400" /> {title}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

/** Seven steps on one rail; the rail fills behind each done step and "Now" marks where it waits. */
function Journey({ track, error, loading }: { track: FlowTrack | null; error: string | null; loading: boolean }) {
  const steps = track?.steps ?? []
  const now = steps.findIndex((s) => !['done', 'na', 'unknown'].includes(s.state))
  return (
    <div>
      <SectionTitle icon={Route} title="Order journey" hint="Every step read from its own source" />
      {error && <Problem text={error} />}
      {loading && <div className="h-24 rounded-xl bg-slate-50 animate-pulse" />}
      {track && (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white px-3 pt-4 pb-3">
          <ol className="flex overflow-x-auto pb-1" aria-label="Order progress">
            {steps.map((s, i) => {
              const meta = STEP_META[s.key] ?? { label: s.key, icon: Check }
              const tone = STEP_TONE[s.state] ?? STEP_TONE.unknown
              const Icon = s.state === 'done' ? Check : meta.icon
              const last = i === steps.length - 1
              return (
                <li key={s.key} className="relative flex-1 min-w-[112px] flex flex-col items-center text-center px-1"
                  title={`${meta.label}: ${s.value ?? ''} — ${tone.word}${s.owner ? ` (${s.owner})` : ''}`}>
                  {!last && (
                    <span className={cn('absolute top-[17px] left-1/2 w-full h-0.5', s.state === 'done' ? 'bg-emerald-400' : 'bg-slate-200')} aria-hidden />
                  )}
                  <span className={cn('relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center', tone.node)}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="mt-2 text-[10px] uppercase tracking-wide font-semibold text-slate-500 flex items-center gap-1">
                    {meta.label}
                    {i === now && <em className="not-italic rounded bg-slate-900 text-white px-1 text-[9px]">NOW</em>}
                  </span>
                  <span className={cn('text-sm font-bold mt-0.5', tone.text)}>{s.value ?? '—'}</span>
                  {s.hint && <span className="text-[10.5px] text-slate-500 leading-snug mt-0.5 line-clamp-3">{s.hint}</span>}
                  {s.owner && <span className="text-[10px] font-semibold text-brand-600 mt-1">{s.owner}</span>}
                </li>
              )
            })}
          </ol>
          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5 text-xs">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Next</span>
            {track.next ? (
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
                track.next.tone === 'bad' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200')}>
                <ChevronRight className="w-3 h-3" /> {track.next.text}
                {track.next.owner && <b className="ml-1 font-semibold">{track.next.owner}</b>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                <Check className="w-3 h-3" /> Nothing waiting
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Documents({ docs, error, orderId, canProfit, busy, onView, onPdf }: {
  docs: FlowDocs | null; error: string | null; orderId: number; canProfit: boolean; busy: string | null
  onView: (d: OpenDoc) => void; onPdf: (d: OpenDoc) => void
}) {
  const liveVouchers = (docs?.vouchers ?? []).filter((v) => !v.cancelled)
  const items: { doc: OpenDoc; icon: typeof Check; tone: string; subtitle: string }[] = [
    {
      doc: { kind: 'invoice', title: 'Invoice', number: docs?.invoice?.number ?? `INV-${orderId}` },
      icon: FileText, tone: 'bg-sky-50 text-sky-600', subtitle: `${docs?.invoice?.number ?? `INV-${orderId}`} · selling prices only`,
    },
    ...(liveVouchers.length > 0 ? [{
      doc: { kind: 'vouchers' as const, title: 'Supplier vouchers', number: `Vouchers-${orderId}` },
      icon: Ticket, tone: 'bg-violet-50 text-violet-600',
      subtitle: `${liveVouchers.length} service${liveVouchers.length === 1 ? '' : 's'} · one page each, at the supplier rate`,
    }] : []),
    {
      doc: { kind: 'confirmation', title: 'Customer confirmation', number: `AHCNF_${orderId}`, pdf: true },
      icon: ClipboardCheck, tone: 'bg-emerald-50 text-emerald-600', subtitle: `AHCNF_${orderId}.pdf — the copy the agency received`,
    },
    ...(canProfit ? [{
      doc: { kind: 'pnl' as const, title: 'Profit & Loss statement', number: `PNL-${orderId}` },
      icon: CircleDollarSign, tone: 'bg-amber-50 text-amber-600', subtitle: 'Internal · revenue, cost and margin per service',
    }] : []),
  ]
  return (
    <div>
      <SectionTitle icon={FileText} title="Documents" hint="View, print or save as PDF" />
      {error && <Problem text={error} />}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {items.map(({ doc, icon: Icon, tone, subtitle }) => {
          const key = `${doc.kind}:`
          return (
            <div key={doc.kind} className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-2 hover:border-slate-300 hover:shadow-sm transition">
              <div className="flex items-start gap-2.5">
                <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone)}><Icon className="w-4 h-4" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
                  <p className="text-[11px] text-slate-500 leading-snug">{subtitle}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-auto">
                <button onClick={() => onView(doc)} className="btn btn-secondary btn-sm flex-1 justify-center">
                  <ExternalLink className="w-3.5 h-3.5" /> View
                </button>
                <button onClick={() => onPdf(doc)} disabled={busy === key} className="btn btn-primary btn-sm flex-1 justify-center">
                  {busy === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {docs && (docs.flights ?? 0) > 0 && liveVouchers.length === 0 && (
        <p className="text-[11px] text-slate-500 mt-2">Flights only — ticketed, so there is no supplier voucher.</p>
      )}
    </div>
  )
}

function ProfitLoss({ pnl, error }: { pnl: FlowPnl | null; error: string | null }) {
  const [open, setOpen] = useState(false)
  const t = pnl?.totals
  const tiles: [string, string, string?][] = t ? [
    ['Revenue', usd(t.revenue_usd)],
    ['Cost', usd(t.cost_usd)],
    ['Gross profit', usd(t.profit_usd), (t.profit_usd ?? 0) < 0 ? 'text-rose-600' : (t.profit_usd ?? 0) > 0 ? 'text-emerald-700' : undefined],
    ['Margin', t.margin_pct === null || t.margin_pct === undefined ? '—' : `${t.margin_pct}%`],
    ['Costed', `${t.known_lines ?? 0}/${t.lines ?? 0}`],
  ] : []
  return (
    <div>
      <SectionTitle icon={CircleDollarSign} title="Profit & loss" hint="AahaasFlow · USD at the order-day rate" />
      {error && <Problem text={error} />}
      {t && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-slate-100 bg-slate-50/60">
            {tiles.map(([label, value, tone]) => (
              <div key={label} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
                <p className={cn('text-lg font-bold tabular-nums text-slate-900', tone)}>{value}</p>
              </div>
            ))}
          </div>
          {pnl?.profit_basis && PROFIT_NOTE[pnl.profit_basis] && (
            <p className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-t border-amber-100">{PROFIT_NOTE[pnl.profit_basis]}</p>
          )}
          {(pnl?.lines?.length ?? 0) > 0 && (
            <>
              <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-slate-50 border-t border-slate-100 flex items-center gap-1">
                <ChevronDown className={cn('w-3.5 h-3.5 transition', !open && '-rotate-90')} /> Per service ({pnl!.lines!.length})
              </button>
              {open && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="text-left px-4 py-2">Service</th>
                        <th className="text-left px-2 py-2">Supplier</th>
                        <th className="text-right px-2 py-2">Revenue</th>
                        <th className="text-right px-2 py-2">Cost</th>
                        <th className="text-right px-2 py-2">Profit</th>
                        <th className="text-right px-2 py-2">Margin</th>
                        <th className="text-left px-4 py-2">Basis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pnl!.lines!.map((l) => {
                        const b = BASIS[l.basis ?? ''] ?? [l.basis ?? '—', 'bg-slate-100 text-slate-500']
                        return (
                          <tr key={l.line_id} className={cn(l.cancelled && 'text-slate-400 line-through decoration-slate-300')}>
                            <td className="px-4 py-2"><span className="font-medium text-slate-800">{l.product ?? `Line ${l.line_id}`}</span>{l.category && <span className="text-slate-400"> · {l.category}</span>}</td>
                            <td className="px-2 py-2 text-slate-600">{l.vendor ?? '—'}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{usd(l.revenue_usd)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{usd(l.cost_usd)}</td>
                            <td className={cn('px-2 py-2 text-right tabular-nums font-semibold', (l.profit_usd ?? 0) < 0 && 'text-rose-600')}>{usd(l.profit_usd)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{l.margin_pct === null || l.margin_pct === undefined ? '—' : `${l.margin_pct}%`}</td>
                            <td className="px-4 py-2"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold no-underline', b[1])}>{b[0]}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ProductCard({ line: l, check, busy, onView, onPdf }: {
  line: FlowLine; check: FlowCheck | null; busy: string | null
  onView: (d: OpenDoc) => void; onPdf: (d: OpenDoc) => void
}) {
  const images = (l.images?.length ? l.images : l.image ? [l.image] : []).filter(Boolean)
  const [shown, setShown] = useState(0)
  const [more, setMore] = useState(false)
  const lane = laneOf(l)
  const when = relative(l.serviceDate)
  const d = l.details ?? {}
  const id = String(l.checkoutId)
  const facts: [typeof Check, string, string | null | undefined][] = [
    [CalendarDays, 'Check-in', day(d.checkIn)],
    [CalendarDays, 'Check-out', day(d.checkOut)],
    [BedDouble, 'Nights', d.nights ? String(d.nights) : null],
    [BedDouble, 'Rooms', [d.rooms ? `${d.rooms}` : null, d.roomCategory || d.roomTypes?.join(', ')].filter(Boolean).join(' · ') || null],
    [Users, 'Guests', [d.adults ? `${d.adults} adult${d.adults === 1 ? '' : 's'}` : null, d.children ? `${d.children} child${d.children === 1 ? '' : 'ren'}` : null].filter(Boolean).join(', ') || null],
    [ShieldCheck, 'Meal plan', d.mealPlan],
    [Building2, 'Provider', d.provider],
  ].filter((f) => f[2]) as [typeof Check, string, string][]
  const voucherDoc: OpenDoc = { kind: 'voucher', line: id, title: 'Supplier voucher', number: `Voucher-${id}` }
  const supplierPdf: OpenDoc = { kind: 'supplier', line: id, title: 'Supplier voucher (supplier portal)', number: `Voucher-${id}`, pdf: true }
  const flight = /flight/i.test(l.category ?? '') || check?.voucher_applies === false

  return (
    <article className={cn('rounded-2xl border bg-white overflow-hidden', lane.cancelled ? 'border-rose-200 opacity-80' : 'border-slate-200')}>
      <div className="grid md:grid-cols-[minmax(0,300px)_1fr]">
        {/* Gallery */}
        <div className="bg-slate-100 relative">
          {images.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={images[shown]} alt={l.title ?? 'Product'} className="w-full h-52 md:h-full max-h-72 object-cover" loading="lazy" />
              <span className="absolute top-2 left-2 rounded-full bg-black/60 text-white text-[10px] font-semibold px-2 py-0.5 flex items-center gap-1">
                {flight ? <Plane className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />} {l.category ?? 'Product'}
              </span>
              {images.length > 1 && (
                <>
                  <span className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-[10px] font-semibold px-2 py-0.5">{shown + 1} / {images.length}</span>
                  <div className="absolute bottom-2 left-2 right-2 flex gap-1.5 overflow-x-auto">
                    {images.slice(0, 6).map((src, i) => (
                      <button key={src + i} onClick={() => setShown(i)} aria-label={`Photo ${i + 1}`}
                        className={cn('w-12 h-9 rounded-md overflow-hidden border-2 shrink-0', i === shown ? 'border-white' : 'border-transparent opacity-75 hover:opacity-100')}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="h-40 md:h-full flex flex-col items-center justify-center text-slate-400 gap-1">
              {flight ? <Plane className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
              <span className="text-[11px]">{l.category ?? 'Product'}</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="p-4 space-y-3 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{l.category}{check?.type_label && check.type_label !== l.category ? ` · ${check.type_label}` : ''}</p>
              <h4 className={cn('text-base font-bold text-slate-900 leading-snug', lane.cancelled && 'line-through')}>{l.title}</h4>
              {(d.location || d.city) && (
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0 text-rose-400" /> {[d.location, d.city].filter(Boolean).join(', ')}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Service date</p>
              <p className="text-sm font-semibold text-slate-900">{day(l.serviceDate) ?? 'No date'}</p>
              {when && <p className={cn('text-[11px] font-medium', when.tone)}>{when.text}</p>}
            </div>
          </div>

          {/* Lane */}
          {lane.cancelled ? (
            <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs text-rose-700">
              {l.amended ? 'Amended — moved to the booking’s next version.' : 'Cancelled'}
              {l.cancel?.reason ? ` — ${l.cancel.reason}` : ''}{l.cancel?.role ? ` (by ${l.cancel.role})` : ''}
            </p>
          ) : (
            <ol className="flex items-center">
              {lane.steps.map((s, i) => {
                const current = !s.done && (i === 0 || lane.steps[i - 1].done)
                return (
                  <li key={s.label} className="flex-1 flex items-center last:flex-none">
                    <span className="flex flex-col items-center">
                      <span className={cn('w-3.5 h-3.5 rounded-full border-2',
                        s.done ? 'bg-sky-500 border-sky-500' : current ? 'bg-white border-rose-500 ring-4 ring-rose-100' : 'bg-white border-slate-300')} />
                      <span className={cn('text-[10px] mt-1 whitespace-nowrap', s.done ? 'text-slate-700' : current ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{s.label}</span>
                    </span>
                    {i < lane.steps.length - 1 && <span className={cn('flex-1 h-0.5 mx-1 -mt-4', lane.steps[i + 1].done ? 'bg-sky-400' : 'bg-slate-200')} />}
                  </li>
                )
              })}
            </ol>
          )}

          {/* Money */}
          <div className="grid grid-cols-3 rounded-xl border border-slate-200 divide-x divide-slate-100">
            {([
              ['Product total', money(l.totalAmount, l.currency), undefined],
              ['Paid', money(l.paidAmount, l.currency), undefined],
              ['Balance', (l.balanceAmount ?? 0) <= 0.005 && l.balanceAmount !== null ? 'Settled' : money(l.balanceAmount, l.currency),
                (l.balanceAmount ?? 0) <= 0.005 ? 'text-emerald-700' : 'text-amber-700'],
            ] as [string, string, string | undefined][]).map(([label, value, tone]) => (
              <div key={label} className="px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
                <p className={cn('text-sm font-bold tabular-nums text-slate-900', tone)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            {/* Supplier */}
            {l.supplier && (
              <div className="rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5 flex items-center gap-1"><Building2 className="w-3 h-3" /> Supplier</p>
                <p className="text-sm font-semibold text-slate-900">{l.supplier.company || l.supplier.name}</p>
                <div className="flex flex-wrap gap-x-3 text-xs text-slate-600">
                  {l.supplier.email && <a href={`mailto:${l.supplier.email}`} className="flex items-center gap-1 hover:text-brand-600"><Mail className="w-3 h-3" /> {l.supplier.email}</a>}
                  {l.supplier.phone && <a href={`tel:${l.supplier.phone}`} className="flex items-center gap-1 hover:text-brand-600"><Phone className="w-3 h-3" /> {l.supplier.phone}</a>}
                </div>
              </div>
            )}

            {/* Fulfilment checklist (read-only) */}
            {check && !lane.cancelled && (
              <div className="rounded-xl border border-slate-200 px-3 py-2 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> Fulfilment</p>
                <CheckRow
                  ok={['Approved', 'Completed'].includes(l.status ?? '')}
                  label="Accepted"
                  detail={['Approved', 'Completed'].includes(l.status ?? '') ? 'Accepted in the store' : '“Customer ordered” — nobody has accepted it yet'}
                />
                {check.voucher_applies !== false && (
                  <CheckRow
                    ok={['sent', 'by_hand'].includes(check.voucher?.status ?? '')}
                    label="Supplier voucher"
                    detail={check.voucher?.status
                      ? `${check.voucher.status.replace('_', ' ')}${check.voucher.at ? ` · ${day(check.voucher.at)}` : ''}${check.voucher.by ? ` · ${check.voucher.by}` : ''}`
                      : 'Not sent yet'}
                  />
                )}
                <CheckRow
                  ok={['confirmed', 'done'].includes(check.reconfirm?.status ?? '')}
                  label="Reconfirmation"
                  detail={check.reconfirm?.status
                    ? `${check.reconfirm.status}${check.reconfirm.at ? ` · ${day(check.reconfirm.at)}` : ''}`
                    : l.serviceDate && check.reconfirm_days_before !== undefined
                      ? `Due ${day(shiftDay(l.serviceDate, -check.reconfirm_days_before))} (${check.reconfirm_days_before} day${check.reconfirm_days_before === 1 ? '' : 's'} before)`
                      : 'Not yet'}
                />
              </div>
            )}
          </div>

          {/* Stay facts + more */}
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {facts.map(([Icon, label, value]) => (
                <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                  <Icon className="w-3 h-3 text-slate-400" /> <span className="text-slate-400">{label}</span> {value}
                </span>
              ))}
            </div>
          )}
          {(d.description || d.inclusions?.length || d.cancellation) && (
            <div>
              <button onClick={() => setMore((v) => !v)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <ChevronDown className={cn('w-3.5 h-3.5 transition', !more && '-rotate-90')} /> About this product
              </button>
              {more && (
                <div className="mt-2 space-y-2 text-xs text-slate-600">
                  {d.description && <p className="whitespace-pre-line leading-relaxed">{d.description}</p>}
                  {(d.inclusions?.length ?? 0) > 0 && (
                    <p><b className="text-slate-700">Includes:</b> {d.inclusions!.join(' · ')}</p>
                  )}
                  {d.cancellation && <p><b className="text-slate-700">Cancellation:</b> {d.cancellation}</p>}
                </div>
              )}
            </div>
          )}

          {/* This product's documents */}
          {!lane.cancelled && !flight && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold pt-2">Voucher</span>
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => onView(voucherDoc)} className="btn btn-secondary btn-sm"><ExternalLink className="w-3.5 h-3.5" /> View</button>
                <button onClick={() => onPdf(voucherDoc)} disabled={busy === `voucher:${id}`} className="btn btn-secondary btn-sm">
                  {busy === `voucher:${id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                </button>
                <button onClick={() => onView(supplierPdf)} className="btn btn-secondary btn-sm" title="The voucher as the supplier holds it, from the supplier portal">
                  <Building2 className="w-3.5 h-3.5" /> Supplier copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={cn('mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0', ok ? 'bg-emerald-500 text-white' : 'border-2 border-amber-400 bg-white')}>
        {ok ? <Check className="w-3 h-3" /> : <Bell className="w-2.5 h-2.5 text-amber-500" />}
      </span>
      <span><b className="text-slate-800">{label}</b> <span className="text-slate-500">— {detail}</span></span>
    </div>
  )
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The document, full screen. HTML is shown in a sandboxed frame — no script
 * runs in it; same-origin only so this page can print it and draw it to PDF.
 * PDFs (customer confirmation, supplier copy) are shown as the browser's own
 * PDF view — the route only ever relays a real PDF.
 */
function DocViewer({ bookingRef, doc, onClose, onPdf, busy }: {
  bookingRef: string; doc: OpenDoc; onClose: () => void; onPdf: (d: OpenDoc) => void; busy: boolean
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  // The parent passes a fresh arrow each render; held here so the document is
  // not fetched again every time the page behind re-renders.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    let alive = true
    let blobUrl: string | null = null
    const go = async () => {
      try {
        if (doc.pdf) {
          blobUrl = URL.createObjectURL(await fetchPdf(bookingRef, doc))
          if (alive) setPdfUrl(blobUrl)
        } else {
          const text = await fetchDocText(bookingRef, doc.kind, doc.line)
          if (alive) setHtml(stripDocumentChrome(text))
        }
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    go()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 1_000)
    }
  }, [bookingRef, doc])

  // From the open viewer the PDF is drawn from what is on screen — no second fetch.
  const download = async () => {
    if (doc.pdf || !frame.current) return onPdf(doc)
    setMaking(true)
    try { await frameToPdf(frame.current, `${doc.number}.pdf`) }
    catch (e) { toast.error((e as Error).message) }
    finally { setMaking(false) }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label={doc.title}>
      <header className="flex items-center gap-3 bg-white px-4 py-2.5 border-b border-slate-200">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{doc.title}</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{doc.number}</p>
        </div>
        <div className="flex-1" />
        <button onClick={download} disabled={(!html && !pdfUrl) || making || busy} className="btn btn-primary btn-sm">
          {making || busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {making ? 'Making PDF…' : 'Download PDF'}
        </button>
        {html && (
          <button onClick={() => frame.current?.contentWindow?.print()} className="btn btn-secondary btn-sm"><Printer className="w-3.5 h-3.5" /> Print</button>
        )}
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close"><X className="w-4 h-4" /></button>
      </header>
      <div className="flex-1 overflow-hidden">
        {error && <div className="max-w-lg mx-auto mt-10"><Problem text={error} /></div>}
        {!error && !html && !pdfUrl && (
          <div className="h-full flex items-center justify-center gap-2 text-white/80 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Preparing the document…</div>
        )}
        {html && (
          <iframe ref={frame} title={doc.title} sandbox="allow-same-origin allow-modals" srcDoc={html} className="w-full h-full bg-[#e9edf2] border-0" />
        )}
        {pdfUrl && <iframe title={doc.title} src={pdfUrl} className="w-full h-full bg-white border-0" />}
      </div>
    </div>
  )
}
