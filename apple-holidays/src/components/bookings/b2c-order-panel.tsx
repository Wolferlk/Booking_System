'use client'

/**
 * The Aahaas store's own view of a B2C booking — the figures AahaasFlow shows
 * on its order page, inside OPS:
 *
 *   · order value / product total / paid / balance in the currency the customer
 *     paid in, with the base-currency equivalent and the order-day rate
 *   · how the order was placed (AI WhatsApp, AI Voice, …)
 *   · the guest's real email — where the e-ticket went, not the desk login's
 *   · the invoice, to open or download
 *
 * Everything is read live from the store (read-only) by
 * `/api/bookings/[ref]/b2c-order`; nothing here edits the booking.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeftRight, Download, ExternalLink, FileText, Globe, Laptop, Loader2, Mail, MessageCircle,
  Mic, Phone, RefreshCw, Smartphone, Store, Briefcase, HelpCircle, AlertTriangle, Ticket,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { readApiResponse, cn } from '@/lib/utils'
import type { B2cOrderMoney, Amount } from '@/lib/b2c-order-money'
import FlightTicketDialog from './flight-ticket-dialog'
import { htmlToPdfDownload } from '@/lib/html-document-pdf'

interface OrderPayload extends B2cOrderMoney {
  guest: { email: string | null; phone: string | null; opsEmail: string | null; corrected: boolean; repaired?: string[] }
  invoice: { number: string; viewUrl: string; pdfUrl: string; htmlDownloadUrl: string }
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  whatsapp: MessageCircle, call: Mic, travel_quote_gpt: MessageCircle, web: Laptop, app: Smartphone,
  facebook: Globe, instagram: Globe, b2b_portal: Briefcase, unrecorded: HelpCircle,
}

const CHANNEL_TONE: Record<string, string> = {
  whatsapp: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  call: 'bg-violet-50 text-violet-700 border-violet-200',
  travel_quote_gpt: 'bg-sky-50 text-sky-700 border-sky-200',
  web: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  app: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  unrecorded: 'bg-slate-100 text-slate-600 border-slate-200',
}

function fmt(n: number | null | undefined, cur: string | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const v = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return cur ? `${cur} ${v}` : v
}

function MoneyTile({ label, amount, cur, base, note, tone }: {
  label: string; amount: Amount; cur: string | null; base: string | null; note?: string | null; tone?: string
}) {
  const showBase = base && cur && base !== cur
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className={cn('text-lg font-bold mt-1 tabular-nums', tone ?? 'text-slate-900')}>{note ?? fmt(amount.order, cur)}</p>
      {showBase && (
        <p className="text-xs text-slate-500 tabular-nums mt-0.5">
          {note ? `${fmt(amount.order, cur)} · ` : ''}≈ {fmt(amount.base, base)}
        </p>
      )}
    </div>
  )
}

export default function B2cOrderPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<OrderPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [ticketsOpen, setTicketsOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await readApiResponse<OrderPayload>(await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-order`))
      if (json.success && json.data) {
        setData(json.data)
        // The booking took the guest's contact just now — re-pull it so the
        // page's contact fields (and a later Save) don't hold the old value.
        if (json.data.guest.repaired?.length) window.dispatchEvent(new Event('ops-ai:mutated'))
      }
      else setError(json.error || 'Could not read the order from the Aahaas store')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  const downloadPdf = async () => {
    if (!data) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const res = await fetch(data.invoice.pdfUrl)
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) {
        // No PDF engine on this server (Amplify): draw the same invoice page
        // into a PDF here in the browser instead of failing.
        const page = await fetch(data.invoice.viewUrl)
        if (!page.ok) {
          const json = await readApiResponse(res)
          throw new Error(json.error || `PDF failed (${res.status})`)
        }
        await htmlToPdfDownload(await page.text(), `${data.invoice.number}.pdf`)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${data.invoice.number}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setPdfError((e as Error).message)
    } finally {
      setPdfBusy(false)
    }
  }

  const ChannelIcon = data ? CHANNEL_ICON[data.channel] ?? Store : Store
  const hasFlight = Boolean(data && (data.pnrs.length > 0 || data.lines.some((l) => l.category === 'Flight' && !l.cancelled)))

  return (
    <section data-nav="Aahaas Order" data-nav-icon="pnl">
      <Card>
        <CardHeader
          action={
            <div className="flex items-center gap-2">
              {hasFlight && (
                <button onClick={() => setTicketsOpen(true)} className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 flex items-center gap-1.5"
                  title="Printed tickets for the guest — A4, double-sided, three a sheet">
                  <Ticket className="w-3.5 h-3.5" /> Print tickets
                </button>
              )}
              <button onClick={load} disabled={loading} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1" title="Re-read from the Aahaas store">
                <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
              </button>
              {data && (
                <a href={data.aahaasFlowUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                  AahaasFlow <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          }
        >
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
            <Store className="w-4 h-4 text-slate-400" /> Aahaas Order
            {data && <span className="font-mono text-slate-500">#{data.orderId}</span>}
            {data && (
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', CHANNEL_TONE[data.channel] ?? 'bg-teal-50 text-teal-700 border-teal-200')}
                title="How the order was created">
                <ChannelIcon className="w-3 h-3" /> {data.channelLabel}
              </span>
            )}
            {data && (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
                data.settled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {data.settled ? 'Paid' : 'Balance due'}
              </span>
            )}
          </h3>
        </CardHeader>
        <CardBody>
          {loading && !data && (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Reading the order from the Aahaas store…</div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MoneyTile label="Order value" amount={data.orderValue} cur={data.orderCurrency} base={data.baseCurrency} />
                <MoneyTile label="Product total" amount={data.productTotal} cur={data.orderCurrency} base={data.baseCurrency} />
                <MoneyTile label="Paid" amount={data.paid} cur={data.orderCurrency} base={data.baseCurrency} tone="text-emerald-700" />
                <MoneyTile label="Balance" amount={data.balance} cur={data.orderCurrency} base={data.baseCurrency}
                  note={data.settled ? 'Settled' : null} tone={data.settled ? 'text-emerald-700' : 'text-amber-700'} />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
                {data.rateLabel ? (
                  <span className="flex items-center gap-1.5" title="The Aahaas store's own rate, fixed when the order was placed (base_paid_rate). OPS P&L figures are in the base currency.">
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400" />
                    Order-day rate <b className="text-slate-800 tabular-nums">{data.rateLabel}</b>
                  </span>
                ) : data.orderCurrency && (
                  <span>All amounts in {data.orderCurrency}</span>
                )}
                {data.discount.order !== null && data.discount.order > 0.005 && (
                  <span>Discount <b className="text-slate-800">{fmt(data.discount.order, data.orderCurrency)}</b></span>
                )}
                {data.payCategory && <span>Paid via <b className="text-slate-800">{data.payCategory}</b></span>}
                {data.pnrs.length > 0 && <span>PNR <b className="font-mono text-slate-800">{data.pnrs.join(', ')}</b></span>}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Guest contact</p>
                  {data.guest.email
                    ? <a href={`mailto:${data.guest.email}`} className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline break-all"><Mail className="w-3.5 h-3.5 shrink-0" />{data.guest.email}</a>
                    : <p className="text-sm text-slate-400">No guest email on the order</p>}
                  {data.guest.phone && (
                    <a href={`tel:${data.guest.phone}`} className="flex items-center gap-1.5 text-sm text-slate-700 mt-1"><Phone className="w-3.5 h-3.5 shrink-0" />{data.guest.phone}</a>
                  )}
                  {!!data.guest.repaired?.length && (
                    <p className="text-[11px] text-emerald-700 mt-1.5">
                      Booking updated with the guest&apos;s e-ticket contact — the agenda print, WhatsApp and AI calls now use it.
                    </p>
                  )}
                  {data.guest.corrected && (
                    <p className="text-[11px] text-amber-700 mt-1.5">
                      This booking still holds <span className="font-mono">{data.guest.opsEmail}</span> (the desk login).
                      Use <b>Update Booking</b> to correct it.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Invoice</p>
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-slate-400" /> {data.invoice.number}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <a href={data.invoice.viewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                      <ExternalLink className="w-3.5 h-3.5" /> View
                    </a>
                    <button onClick={downloadPdf} disabled={pdfBusy} className="btn btn-primary btn-sm">
                      {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                    </button>
                    <a href={data.invoice.htmlDownloadUrl} className="btn btn-secondary btn-sm" title="Download the invoice page">
                      <Download className="w-3.5 h-3.5" /> HTML
                    </a>
                  </div>
                  {pdfError && <p className="text-[11px] text-red-600 mt-1.5">{pdfError}</p>}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
      {hasFlight && <FlightTicketDialog bookingRef={bookingRef} open={ticketsOpen} onClose={() => setTicketsOpen(false)} />}
    </section>
  )
}
