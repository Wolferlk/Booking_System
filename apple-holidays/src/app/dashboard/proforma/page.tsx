'use client'

/**
 * Proforma Invoice.
 *
 * One screen, one motion: type the control or IS number off the invoice in your
 * hand → the booking opens with its hotels laid out → drop the PDF on the right
 * hotel and type what it says. A hotel the booking never listed gets added on
 * the invoice, not on the booking.
 *
 * The right-hand column of every filed invoice is Accounts' answer, read live
 * from their database. It is the whole reason this screen exists rather than an
 * email: the person who chased the invoice can see, without asking, that the
 * property has been paid.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BedDouble, Building2, CalendarDays, CheckCircle2, Clock3, FileText,
  Loader2, Paperclip, Pencil, Plus, ReceiptText, Search, Trash2, Users,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import InvoiceForm, { type InvoiceFormTarget } from '@/components/proforma/invoice-form'
import {
  MissingFileChip, PaperChip, SettlementChip, Stat,
  day, dayShort, money,
  type BookingHeader, type HotelSlot, type Invoice,
} from '@/components/proforma/proforma-ui'

interface BookingHit {
  id: string
  bookingRef: string
  isNumber: string | null
  agent: string | null
  status: string
  operationCountry: string | null
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  leadGuest: string | null
  tourDestination: string | null
}

interface BookingView {
  booking: BookingHeader
  hotels: HotelSlot[]
  invoices: Invoice[]
  canManage: boolean
}

export default function ProformaInvoicePage() {
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [recent, setRecent] = useState<Invoice[]>([])
  const [hits, setHits] = useState<BookingHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [view, setView] = useState<BookingView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<InvoiceFormTarget | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // The landing board makes the Accounts hand-off visible before a booking is
  // opened. It also gives the page a useful starting point when there is no
  // search in progress.
  useEffect(() => {
    fetch('/api/proforma?take=30')
      .then(res => res.json())
      .then(json => { if (json.success) setRecent(json.data.invoices ?? []) })
      .catch(() => { /* the booking lookup remains usable if Accounts is down */ })
  }, [])

  const openBooking = useCallback(async (ref: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/proforma/booking/${encodeURIComponent(ref)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not open that booking')
      setView(json.data)
      setHits(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that booking')
    } finally {
      setLoading(false)
    }
  }, [])

  const reload = useCallback(async () => {
    if (view) await openBooking(view.booking.id)
  }, [view, openBooking])

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    const q = query.trim()
    if (q.length < 3) { setError('Type at least 3 characters of a control or IS number'); return }

    setSearching(true)
    setError(null)
    setView(null)
    try {
      const res = await fetch(`/api/proforma/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Search failed')
      const found: BookingHit[] = json.data.bookings
      if (found.length === 0) {
        setHits([])
      } else if (found.length === 1) {
        await openBooking(found[0].id)
      } else {
        setHits(found)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function voidInvoice(inv: Invoice) {
    const reason = window.prompt(`Void invoice ${inv.invoiceNumber ?? ''} from ${inv.hotelName ?? 'this hotel'}?\n\nGive a reason — it stays on the record.`)
    if (reason === null) return
    setBusyId(inv.id)
    setError(null)
    try {
      const res = await fetch(`/api/proforma/${inv.id}?reason=${encodeURIComponent(reason || 'Voided')}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not void the invoice')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void the invoice')
    } finally {
      setBusyId(null)
    }
  }

  const totals = useMemo(() => {
    const live = (view?.invoices ?? []).filter(i => i.status !== 'VOID')
    const paid = live.filter(i => i.settlement?.status === 'paid')
    const byCurrency = new Map<string, number>()
    for (const i of live) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + (i.totalAmount ?? 0))
    return {
      count: live.length,
      paidCount: paid.length,
      hotels: view?.hotels.filter(h => !h.ownArrangement).length ?? 0,
      covered: view?.hotels.filter(h => !h.ownArrangement && h.invoices.some(i => i.status !== 'VOID')).length ?? 0,
      byCurrency: Array.from(byCurrency.entries()),
    }
  }, [view])

  return (
    <div className="space-y-5 p-5">
      {/* ── Hero + lookup ─────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-800 px-6 py-6 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-violet-400/20 blur-2xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-violet-200">
            <ReceiptText className="h-3.5 w-3.5" /> Proforma Invoice
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Hotel invoices, filed against the booking</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-indigo-100">
            Find the booking by its control or IS number, then file each property&apos;s proforma
            against the hotel it belongs to. Accounts pays it from their side — and this screen
            tells you when they have.
          </p>

          <form onSubmit={search} className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-200" />
              <input
                ref={searchInput}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="472160CNTL  ·  IS 48525"
                className="w-full rounded-xl border border-white/25 bg-white/10 py-2.5 pl-9 pr-3 text-sm font-semibold text-white placeholder:text-indigo-200/70 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
            <Button type="submit" size="md" loading={searching} className="!bg-white !text-indigo-800 hover:!bg-indigo-100">
              Find booking
            </Button>
            {!view && (
              <Button
                type="button"
                size="md"
                variant="ghost"
                className="!border !border-white/30 !text-white hover:!bg-white/15"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => searchInput.current?.focus()}
              >
                Add new proforma invoice
              </Button>
            )}
            {view && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="!text-white hover:!bg-white/15"
                icon={<ArrowLeft className="h-4 w-4" />}
                onClick={() => { setView(null); setHits(null); setQuery('') }}
              >
                New search
              </Button>
            )}
          </form>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {!view && !hits && !loading && (
        <RecentInvoices invoices={recent} onOpen={openBooking} onAdd={() => searchInput.current?.focus()} />
      )}

      {/* ── Several matches ───────────────────────────────────────────── */}
      {hits && hits.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-700">No booking answers to “{query}”</p>
          <p className="mt-1 text-xs text-slate-500">Check the reference, or try just the digits.</p>
        </div>
      )}

      {hits && hits.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            {hits.length} bookings match — pick one
          </div>
          <ul className="divide-y divide-slate-100">
            {hits.map(h => (
              <li key={h.id}>
                <button
                  onClick={() => openBooking(h.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-indigo-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-mono text-sm font-bold text-slate-900">
                      {h.bookingRef}
                      {h.isNumber && <span className="text-slate-400">· {h.isNumber}</span>}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {h.leadGuest ?? 'Guest not named'} · {h.agent ?? 'no agent'} · {h.tourDestination ?? h.operationCountry ?? '—'}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div className="font-semibold text-slate-700">{dayShort(h.arrivalDate)} → {dayShort(h.departureDate)}</div>
                    <div>{h.paxAdults + h.paxChildren} pax</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The booking ───────────────────────────────────────────────── */}
      {view && !loading && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-slate-900 px-2 py-1 font-mono text-sm font-bold text-white">
                    {view.booking.bookingRef}
                  </span>
                  {view.booking.isNumber && (
                    <span className="rounded-lg bg-indigo-50 px-2 py-1 font-mono text-sm font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                      {view.booking.isNumber}
                    </span>
                  )}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    {view.booking.status.replace(/_/g, ' ')}
                  </span>
                  {view.booking.operationCountry && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-700 ring-1 ring-inset ring-teal-200">
                      {view.booking.operationCountry.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 text-lg font-extrabold text-slate-900">
                  {view.booking.leadGuest ?? view.booking.dealName ?? 'Unnamed booking'}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{day(view.booking.arrivalDate)} → {day(view.booking.departureDate)}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{view.booking.paxAdults} adults{view.booking.paxChildren > 0 && ` · ${view.booking.paxChildren} children`}</span>
                  {view.booking.agent && <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{view.booking.agent}</span>}
                </div>
              </div>

              {view.canManage && (
                <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setForm({ slot: null, invoice: null })}>
                  Hotel not listed
                </Button>
              )}
            </div>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Hotels on booking" value={totals.hotels} sub={`${totals.covered} with an invoice`} tone="indigo" />
              <Stat label="Proformas filed" value={totals.count} sub={totals.count === 0 ? 'nothing filed yet' : 'across all hotels'} />
              <Stat label="Payable done" value={totals.paidCount} sub="confirmed by Accounts" tone="teal" />
              <Stat
                label="Invoiced value"
                tone="amber"
                value={
                  totals.byCurrency.length === 0
                    ? '—'
                    : totals.byCurrency.map(([c, v]) => money(v, c)).join('  ·  ')
                }
                sub="excludes voided invoices"
              />
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            {view.hotels.map(slot => (
              <HotelCard
                key={slot.key}
                slot={slot}
                canManage={view.canManage}
                busyId={busyId}
                onFile={() => setForm({ slot, invoice: null })}
                onEdit={inv => setForm({ slot, invoice: inv })}
                onVoid={voidInvoice}
              />
            ))}

            {view.hotels.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center">
                <BedDouble className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">This booking lists no hotels</p>
                <p className="mt-1 text-xs text-slate-500">
                  Use “Hotel not listed” to file an invoice against a property anyway.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {view && form && (
        <InvoiceForm
          open
          onClose={() => setForm(null)}
          bookingId={view.booking.id}
          bookingCurrency={view.booking.currency}
          target={form}
          onSaved={reload}
        />
      )}
    </div>
  )
}

function RecentInvoices({
  invoices, onOpen, onAdd,
}: { invoices: Invoice[]; onOpen: (ref: string) => void; onAdd: () => void }) {
  const live = invoices.filter(i => i.status !== 'VOID')
  const pending = live.filter(i => !i.settlement?.hasReceipt).length
  const approved = live.filter(i => i.settlement?.hasReceipt).length

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Proforma work queue</p>
          <h2 className="mt-1 text-lg font-extrabold text-slate-900">Accounts settlement status</h2>
          <p className="mt-1 text-xs text-slate-500">Pending means Accounts is reviewing or settling it. Approved means Accounts uploaded the payment receipt.</p>
        </div>
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100">
          <Plus className="h-3.5 w-3.5" /> Add new proforma invoice
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <Clock3 className="h-5 w-5 text-amber-600" />
          <div><div className="text-lg font-extrabold text-amber-900">{pending}</div><div className="text-[11px] font-semibold text-amber-700">Pending Proforma Invoice Settlement</div></div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div><div className="text-lg font-extrabold text-emerald-900">{approved}</div><div className="text-[11px] font-semibold text-emerald-700">Approved · receipt uploaded</div></div>
        </div>
      </div>

      {live.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Recently filed</div>
          <ul className="divide-y divide-slate-100">
            {live.map(inv => (
              <li key={inv.id}>
                <button onClick={() => inv.bookingRef && onOpen(inv.bookingRef)} disabled={!inv.bookingRef} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-indigo-50/50 disabled:cursor-default">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-800">{inv.bookingRef ?? 'Unlinked booking'}</span>
                      <span className="truncate text-xs font-semibold text-slate-700">{inv.hotelName ?? 'Hotel not named'}</span>
                      <SettlementChip settlement={inv.settlement} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{inv.invoiceNumber ?? 'No invoice number'} · {money(inv.totalAmount, inv.currency)} · filed {dayShort(inv.createdAt)}</div>
                  </div>
                  {inv.settlement?.hasReceipt && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-700">No proforma invoices filed yet</p>
          <p className="mt-1 text-xs text-slate-500">Search for a booking above to add the first one.</p>
        </div>
      )}
    </section>
  )
}

function HotelCard({
  slot, canManage, busyId, onFile, onEdit, onVoid,
}: {
  slot: HotelSlot
  canManage: boolean
  busyId: string | null
  onFile: () => void
  onEdit: (inv: Invoice) => void
  onVoid: (inv: Invoice) => void
}) {
  const live = slot.invoices.filter(i => i.status !== 'VOID')
  const allPaid = live.length > 0 && live.every(i => i.settlement?.status === 'paid')

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-white shadow-sm transition',
        allPaid ? 'border-teal-300 ring-1 ring-teal-100' : 'border-slate-200',
      )}
    >
      <div className={cn('flex items-start justify-between gap-3 border-b px-4 py-3',
        allPaid ? 'border-teal-100 bg-teal-50/50' : 'border-slate-100 bg-slate-50/60')}>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-sm font-bold text-slate-900">
            <BedDouble className="h-4 w-4 shrink-0 text-slate-400" />
            {slot.hotelName}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {slot.city && <span>{slot.city}</span>}
            {slot.checkIn && <span>{dayShort(slot.checkIn)} → {dayShort(slot.checkOut)}</span>}
            {slot.nights != null && <span>{slot.nights} night{slot.nights === 1 ? '' : 's'}</span>}
            {slot.mealType && <span className="font-semibold">{slot.mealType}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {slot.addedByUser && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                Added — not on the booking
              </span>
            )}
            {slot.ownArrangement && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-inset ring-slate-200">
                Client&apos;s own arrangement
              </span>
            )}
          </div>
        </div>

        {canManage && (
          <Button size="sm" variant={live.length === 0 ? 'primary' : 'secondary'} icon={<Plus className="h-3.5 w-3.5" />} onClick={onFile}>
            Proforma
          </Button>
        )}
      </div>

      {slot.invoices.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <FileText className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-1.5 text-xs text-slate-500">
            {slot.ownArrangement
              ? 'Own arrangement — no invoice expected'
              : 'No proforma filed for this hotel yet'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {slot.invoices.map(inv => (
            <li key={inv.id} className={cn('px-4 py-3', inv.status === 'VOID' && 'opacity-55')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-slate-800">
                      {inv.invoiceNumber ?? 'no invoice no.'}
                    </span>
                    <PaperChip status={inv.status} />
                    {inv.status !== 'VOID' && <SettlementChip settlement={inv.settlement} />}
                    {!inv.fileUrl && <MissingFileChip />}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>Invoiced {day(inv.invoiceDate)}</span>
                    {inv.dueDate && <span>Due {day(inv.dueDate)}</span>}
                    {inv.roomCount != null && <span>{inv.roomCount} room{inv.roomCount === 1 ? '' : 's'}</span>}
                    {inv.roomType && <span>{inv.roomType}</span>}
                  </div>

                  {inv.settlement?.status === 'paid' && (
                    <p className="mt-1.5 rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800">
                      Paid {money(inv.settlement.paidAmount, inv.settlement.currency ?? inv.currency)} on {day(inv.settlement.paidAt)}
                      {inv.settlement.reference && <span className="font-normal"> · ref {inv.settlement.reference}</span>}
                      {inv.settlement.paidBy && <span className="font-normal"> · {inv.settlement.paidBy}</span>}
                    </p>
                  )}
                  {inv.settlement?.status === 'rejected' && inv.settlement.note && (
                    <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-800">
                      Accounts returned this: {inv.settlement.note}
                    </p>
                  )}
                  {inv.notes && <p className="mt-1 text-[11px] italic text-slate-500">{inv.notes}</p>}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-sm font-extrabold tabular-nums text-slate-900">
                    {money(inv.totalAmount, inv.currency)}
                  </div>
                  {inv.taxAmount != null && inv.taxAmount > 0 && (
                    <div className="text-[10px] text-slate-400">incl. tax {money(inv.taxAmount, inv.currency)}</div>
                  )}
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    {inv.fileUrl && (
                      <a href={inv.fileUrl} target="_blank" rel="noreferrer" title={inv.fileName ?? 'Open document'}
                        className="text-slate-400 transition hover:text-brand-600">
                        <Paperclip className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {canManage && inv.status !== 'VOID' && inv.settlement?.status !== 'paid' && (
                      <>
                        <button title="Correct" onClick={() => onEdit(inv)} className="text-slate-400 transition hover:text-brand-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Void"
                          disabled={busyId === inv.id}
                          onClick={() => onVoid(inv)}
                          className="text-slate-400 transition hover:text-red-600 disabled:opacity-40"
                        >
                          {busyId === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
