'use client'

/**
 * File a proforma against one hotel — or correct one already filed.
 *
 * The form is deliberately one screen. A clerk holding a supplier's PDF has
 * every value on it in front of them; making them page through a wizard to
 * type six numbers is how invoices end up half-entered.
 *
 * Nett + tax = total is computed as you type, but the total stays editable:
 * properties round, absorb, and bundle, and the number that must be paid is
 * the one printed on the paper, not the one arithmetic prefers.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Paperclip, Upload, X } from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import { dateValue, money, type HotelSlot, type Invoice } from './proforma-ui'

const MEAL_PLANS = ['', 'RO', 'BB', 'HB', 'FB', 'AI']
const CURRENCIES = ['USD', 'LKR', 'VND', 'MYR', 'SGD', 'EUR', 'GBP', 'AED', 'THB', 'INR']
const MAX_MB = 15

export interface InvoiceFormTarget {
  /** The stay this invoice is for. Null when a hotel is being added by hand. */
  slot: HotelSlot | null
  /** Set when correcting an invoice rather than filing a new one. */
  invoice: Invoice | null
}

interface Props {
  open: boolean
  onClose: () => void
  bookingId: string
  bookingCurrency: string
  target: InvoiceFormTarget
  onSaved: () => void
}

interface FormState {
  hotelName: string
  city: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  currency: string
  amount: string
  taxAmount: string
  totalAmount: string
  checkIn: string
  checkOut: string
  nights: string
  roomType: string
  mealPlan: string
  roomCount: string
  notes: string
}

function initial(target: InvoiceFormTarget, bookingCurrency: string): FormState {
  const { slot, invoice } = target
  const n = (v: number | null | undefined) => (v == null ? '' : String(v))
  return {
    hotelName: invoice?.hotelName ?? slot?.hotelName ?? '',
    city: invoice?.city ?? slot?.city ?? '',
    invoiceNumber: invoice?.invoiceNumber ?? '',
    invoiceDate: dateValue(invoice?.invoiceDate) || new Date().toISOString().slice(0, 10),
    dueDate: dateValue(invoice?.dueDate),
    currency: invoice?.currency ?? bookingCurrency ?? 'USD',
    amount: n(invoice?.amount),
    taxAmount: n(invoice?.taxAmount),
    totalAmount: n(invoice?.totalAmount),
    checkIn: dateValue(invoice?.checkIn ?? slot?.checkIn),
    checkOut: dateValue(invoice?.checkOut ?? slot?.checkOut),
    nights: n(invoice?.nights ?? slot?.nights),
    roomType: invoice?.roomType ?? slot?.roomType ?? '',
    mealPlan: (invoice?.mealPlan ?? slot?.mealType ?? '').toUpperCase(),
    roomCount: n(invoice?.roomCount),
    notes: invoice?.notes ?? '',
  }
}

export default function InvoiceForm({ open, onClose, bookingId, bookingCurrency, target, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initial(target, bookingCurrency))
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const editing = target.invoice != null
  const addingHotel = target.slot == null && !editing

  useEffect(() => {
    if (open) {
      setForm(initial(target, bookingCurrency))
      setFile(null)
      setError(null)
    }
    // `target` is a fresh object per open; keying on `open` is what makes the
    // form reset exactly once per opening rather than on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(f => ({ ...f, [key]: value }))

  // Nett + tax, offered as the total until the user says otherwise.
  const computedTotal = useMemo(() => {
    const a = Number(form.amount.replace(/,/g, ''))
    const t = Number(form.taxAmount.replace(/,/g, ''))
    if (!Number.isFinite(a) || form.amount.trim() === '') return null
    return Math.round((a + (Number.isFinite(t) ? t : 0)) * 100) / 100
  }, [form.amount, form.taxAmount])

  const totalDiffers =
    computedTotal != null &&
    form.totalAmount.trim() !== '' &&
    Math.abs(Number(form.totalAmount.replace(/,/g, '')) - computedTotal) > 0.009

  function pickFile(f: File | null) {
    setError(null)
    if (!f) { setFile(null); return }
    if (!/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name)) {
      setError('Upload a PDF or an image of the invoice')
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_MB} MB`)
      return
    }
    setFile(f)
  }

  async function submit() {
    setError(null)

    if (!form.hotelName.trim()) { setError('Which hotel sent this invoice?'); return }
    const total = Number(form.totalAmount.replace(/,/g, ''))
    if (!form.totalAmount.trim() || !Number.isFinite(total) || total <= 0) {
      setError('Enter the invoice total'); return
    }
    if (!editing && !file) {
      setError('Attach the proforma document — a PDF or a photograph of it'); return
    }

    const fd = new FormData()
    fd.set('bookingId', bookingId)
    if (target.slot?.accommodationId) fd.set('accommodationId', target.slot.accommodationId)
    for (const [k, v] of Object.entries(form)) fd.set(k, v)
    if (file) fd.set('file', file)

    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/proforma/${target.invoice!.id}` : '/api/proforma', {
        method: editing ? 'PATCH' : 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not save the invoice')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice')
    } finally {
      setSaving(false)
    }
  }

  const title = editing
    ? `Correct invoice · ${target.invoice?.hotelName ?? ''}`
    : addingHotel
      ? 'Add a hotel and file its invoice'
      : `File a proforma · ${target.slot?.hotelName ?? ''}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            {editing
              ? 'Corrections are refused once Accounts has paid against the invoice.'
              : 'Filed as “Received”. Accounts decides when it is paid.'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'File invoice'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        {addingHotel && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            This hotel is not on the booking. Filing here records it on the invoice only —
            the booking&apos;s accommodation list is left exactly as the Booking desk wrote it.
          </div>
        )}

        {/* ── Hotel ─────────────────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Hotel" required>
            <input
              className={inputCls}
              value={form.hotelName}
              disabled={!addingHotel && !editing}
              onChange={e => set('hotelName', e.target.value)}
              placeholder="As the invoice letterhead spells it"
            />
          </Field>
          <Field label="City">
            <input className={inputCls} value={form.city} onChange={e => set('city', e.target.value)} />
          </Field>
        </section>

        {/* ── The paper ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Invoice</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Invoice no.">
              <input className={inputCls} value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} />
            </Field>
            <Field label="Invoice date">
              <input type="date" className={inputCls} value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} />
            </Field>
            <Field label="Payment due">
              <input type="date" className={inputCls} value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Currency">
              <select className={inputCls} value={form.currency} onChange={e => set('currency', e.target.value)}>
                {Array.from(new Set([form.currency, ...CURRENCIES])).filter(Boolean).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Nett">
              <input inputMode="decimal" className={cn(inputCls, 'text-right tabular-nums')} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Tax / service">
              <input inputMode="decimal" className={cn(inputCls, 'text-right tabular-nums')} value={form.taxAmount} onChange={e => set('taxAmount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Total" required>
              <input
                inputMode="decimal"
                className={cn(inputCls, 'text-right font-bold tabular-nums', totalDiffers && 'border-amber-400 bg-amber-50')}
                value={form.totalAmount}
                onChange={e => set('totalAmount', e.target.value)}
                placeholder="0.00"
              />
            </Field>
          </div>

          {computedTotal != null && (
            <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
              <span className="text-slate-500">Nett + tax = {money(computedTotal, form.currency)}</span>
              {form.totalAmount.trim() === '' ? (
                <button
                  type="button"
                  className="font-semibold text-brand-600 hover:underline"
                  onClick={() => set('totalAmount', String(computedTotal))}
                >
                  use this
                </button>
              ) : totalDiffers ? (
                <span className="font-semibold text-amber-700">— the total you typed differs; it will be used as-is</span>
              ) : null}
            </div>
          )}
        </section>

        {/* ── The stay ──────────────────────────────────────────────────── */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Field label="Check-in"><input type="date" className={inputCls} value={form.checkIn} onChange={e => set('checkIn', e.target.value)} /></Field>
          <Field label="Check-out"><input type="date" className={inputCls} value={form.checkOut} onChange={e => set('checkOut', e.target.value)} /></Field>
          <Field label="Nights"><input inputMode="numeric" className={inputCls} value={form.nights} onChange={e => set('nights', e.target.value)} /></Field>
          <Field label="Room type"><input className={inputCls} value={form.roomType} onChange={e => set('roomType', e.target.value)} /></Field>
          <Field label="Meal plan">
            <select className={inputCls} value={form.mealPlan} onChange={e => set('mealPlan', e.target.value)}>
              {MEAL_PLANS.map(m => <option key={m || 'none'} value={m}>{m || '—'}</option>)}
            </select>
          </Field>
          <Field label="Rooms"><input inputMode="numeric" className={inputCls} value={form.roomCount} onChange={e => set('roomCount', e.target.value)} /></Field>
        </section>

        {/* ── The document ──────────────────────────────────────────────── */}
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Document {editing && <span className="font-medium normal-case tracking-normal text-slate-400">— optional; uploading replaces the current one</span>}
          </h3>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => fileInput.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition',
              dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40',
            )}
          >
            {file ? (
              <>
                <FileText className="h-6 w-6 text-brand-500" />
                <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"
                  onClick={e => { e.stopPropagation(); setFile(null) }}
                >
                  <X className="h-3 w-3" /> remove
                </button>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-slate-400" />
                <p className="text-sm font-semibold text-slate-700">Drop the proforma here, or click to choose</p>
                <p className="text-[11px] text-slate-500">PDF or image · up to {MAX_MB} MB</p>
              </>
            )}
          </div>

          {editing && target.invoice?.fileUrl && !file && (
            <a
              href={target.invoice.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-600 hover:underline"
            >
              <Paperclip className="h-3 w-3" /> {target.invoice.fileName ?? 'current document'}
            </a>
          )}

          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
            onChange={e => pickFile(e.target.files?.[0] ?? null)}
          />
        </section>

        <Field label="Notes">
          <textarea
            className={cn(inputCls, 'min-h-[60px] resize-y')}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Anything Accounts should know before paying this"
          />
        </Field>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 ' +
  'disabled:bg-slate-100 disabled:text-slate-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
