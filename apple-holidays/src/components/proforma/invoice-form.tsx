'use client'

/**
 * File a proforma against one hotel — or correct one already filed.
 *
 * ---- Upload first ----
 *
 * The document is the top of the form now, not the bottom, because it is the
 * only thing a clerk should have to provide. Dropping the PDF reads it — the
 * invoice number, the dates, the figures and the bank account at the foot of
 * the page — and fills the form in. What used to be nine fields typed off a
 * page held in the other hand is now a check and a press.
 *
 * The fields all stay editable, and every one the reader filled is marked as
 * such. That is the whole safety model: the machine proposes, the clerk
 * disposes, and what is filed is what was on screen when they pressed File. A
 * misread figure costs a correction in an open form; nothing is stored until
 * then. When a document cannot be read at all — a scan with no text layer —
 * the form says so and behaves exactly as it did before.
 *
 * Nett + tax = total is computed as you type, but the total stays editable:
 * properties round, absorb, and bundle, and the number that must be paid is
 * the one printed on the paper, not the one arithmetic prefers.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Building2, FileText, Paperclip, Sparkles, Upload, X } from 'lucide-react'
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
  // The beneficiary account printed on the invoice. Filed with it so Accounts
  // does not read the same PDF a second time by eye before paying.
  bankAccountName: string
  bankName: string
  bankBranch: string
  bankAccountNumber: string
  bankSwift: string
  bankIban: string
  bankCurrency: string
  bankAddress: string
}

/** Which fields the reader filled, so the form can say so. */
type AutoFilled = Partial<Record<keyof FormState, true>>

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
    bankAccountName: invoice?.bank?.accountName ?? '',
    bankName: invoice?.bank?.bankName ?? '',
    bankBranch: invoice?.bank?.branch ?? '',
    bankAccountNumber: invoice?.bank?.accountNumber ?? '',
    bankSwift: invoice?.bank?.swift ?? '',
    bankIban: invoice?.bank?.iban ?? '',
    bankCurrency: invoice?.bank?.currency ?? '',
    bankAddress: invoice?.bank?.address ?? '',
  }
}

export default function InvoiceForm({ open, onClose, bookingId, bookingCurrency, target, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initial(target, bookingCurrency))
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // ── The reading pass ──────────────────────────────────────────────
  // `reading` drives the dropzone's own state rather than a blocking
  // overlay: the clerk can start on the hotel name while the model
  // works, and anything they typed is kept — the merge below only
  // fills fields that are still empty.
  const [reading, setReading] = useState(false)
  const [auto, setAuto] = useState<AutoFilled>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [confidence, setConfidence] = useState<number | null>(null)
  const [readNote, setReadNote] = useState<string | null>(null)
  /** The model's whole answer, filed alongside the invoice for audit. */
  const [rawExtract, setRawExtract] = useState<string | null>(null)

  const editing = target.invoice != null
  const addingHotel = target.slot == null && !editing

  useEffect(() => {
    if (open) {
      setForm(initial(target, bookingCurrency))
      setFile(null)
      setError(null)
      setAuto({}); setWarnings([]); setConfidence(null); setReadNote(null); setRawExtract(null)
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
    void read(f)
  }

  /**
   * Hand the document to the reader and merge what comes back.
   *
   * Two rules, and they are the whole contract with the clerk:
   *
   *   - a field they have already filled is never overwritten. They were
   *     looking at the paper when they typed it.
   *   - a failure is not an error. The note explains what happened and the
   *     form stays exactly as usable as it was before this existed.
   */
  async function read(f: File) {
    setReading(true)
    setReadNote(null); setWarnings([]); setConfidence(null)

    try {
      const fd = new FormData()
      fd.set('file', f)
      const res = await fetch('/api/proforma/extract', { method: 'POST', body: fd })
      const json = await res.json()

      if (!json.success) throw new Error(json.error ?? 'The invoice could not be read')
      const x = json.extraction as Record<string, unknown> | null

      if (!x) { setReadNote(json.reason ?? 'The invoice could not be read automatically.'); return }

      setRawExtract(JSON.stringify(x).slice(0, 20_000))
      setConfidence(typeof x.confidence === 'number' ? x.confidence : null)
      setWarnings(Array.isArray(x.warnings) ? (x.warnings as string[]) : [])

      const bank = (x.bank ?? {}) as Record<string, unknown>
      const str = (v: unknown) => (v == null ? '' : String(v))

      // extraction field → form field. Kept explicit rather than clever: the
      // two shapes are allowed to drift, and a silent mis-mapping here would
      // put a tax figure in a total.
      const mapped: Partial<FormState> = {
        hotelName: str(x.hotelName),
        city: str(x.city),
        invoiceNumber: str(x.invoiceNumber),
        invoiceDate: str(x.invoiceDate),
        dueDate: str(x.dueDate),
        currency: str(x.currency),
        amount: str(x.amount),
        taxAmount: str(x.taxAmount),
        totalAmount: str(x.totalAmount),
        checkIn: str(x.checkIn),
        checkOut: str(x.checkOut),
        nights: str(x.nights),
        roomType: str(x.roomType),
        mealPlan: str(x.mealPlan).toUpperCase(),
        roomCount: str(x.roomCount),
        bankAccountName: str(bank.accountName),
        bankName: str(bank.bankName),
        bankBranch: str(bank.branch),
        bankAccountNumber: str(bank.accountNumber),
        bankSwift: str(bank.swift),
        bankIban: str(bank.iban),
        bankCurrency: str(bank.currency),
        bankAddress: str(bank.address),
      }

      const filled: AutoFilled = {}
      setForm(prev => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(mapped) as [keyof FormState, string][]) {
          if (!v) continue
          // `invoiceDate` and the stay dates are pre-seeded from today and from
          // the booking, so "already filled" would block every one of them.
          // The invoice's own reading wins for those; everything else defers
          // to whatever the clerk has typed.
          const seeded = k === 'invoiceDate' || k === 'checkIn' || k === 'checkOut'
            || k === 'nights' || k === 'currency' || k === 'mealPlan' || k === 'roomType'
            || k === 'hotelName' || k === 'city'
          const empty = String(prev[k] ?? '').trim() === ''
          const fromSeed = seeded && String(prev[k] ?? '') === String(initial(target, bookingCurrency)[k] ?? '')
          if (!empty && !fromSeed) continue
          if (k === 'hotelName' && !addingHotel && !editing) continue  // the stay names it
          next[k] = v
          filled[k] = true
        }
        return next
      })
      setAuto(filled)

      if (Object.keys(filled).length === 0) {
        setReadNote('The document was read, but everything on it was already filled in.')
      }
    } catch (e) {
      setReadNote(e instanceof Error ? e.message : 'The invoice could not be read automatically.')
    } finally {
      setReading(false)
    }
  }

  /** Small marker on a field the reader filled. */
  const autoMark = (k: keyof FormState) =>
    auto[k] ? <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-bold text-brand-600" title="Read from the uploaded document"><Sparkles className="h-2.5 w-2.5" />auto</span> : null

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
    // The model's own answer, filed for audit beside what the clerk confirmed.
    if (rawExtract) fd.set('aiExtract', rawExtract)

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

        {/* ── The document, first ────────────────────────────────────────
             It is the top of the form because it is the only thing the
             clerk should have to provide: dropping it fills everything
             below. See the file header. */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Sparkles className="h-3 w-3 text-brand-500" />
            The invoice
            {editing && <span className="font-medium normal-case tracking-normal text-slate-400">— optional; uploading replaces the current one and re-reads it</span>}
          </h3>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => { if (!reading) fileInput.current?.click() }}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition',
              reading
                ? 'cursor-wait border-brand-400 bg-brand-50/70'
                : dragging
                  ? 'cursor-pointer border-brand-400 bg-brand-50'
                  : 'cursor-pointer border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40',
            )}
          >
            {reading ? (
              <>
                <Sparkles className="h-6 w-6 animate-pulse text-brand-500" />
                <p className="text-sm font-semibold text-brand-700">Reading the invoice&hellip;</p>
                <p className="text-[11px] text-brand-600">{file?.name}</p>
                {/* An indeterminate bar — the read takes a few seconds and a
                    still dropzone reads as a hung one. */}
                <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-brand-100">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-500" />
                </div>
              </>
            ) : file ? (
              <>
                <FileText className="h-6 w-6 text-brand-500" />
                <p className="text-sm font-semibold text-slate-800">{file.name}</p>
                <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline"
                    onClick={e => { e.stopPropagation(); void read(file) }}
                  >
                    <Sparkles className="h-3 w-3" /> read it again
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"
                    onClick={e => { e.stopPropagation(); setFile(null); setAuto({}); setWarnings([]); setConfidence(null); setReadNote(null); setRawExtract(null) }}
                  >
                    <X className="h-3 w-3" /> remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-slate-400" />
                <p className="text-sm font-semibold text-slate-700">Drop the proforma here, or click to choose</p>
                <p className="text-[11px] text-slate-500">
                  PDF or image &middot; up to {MAX_MB} MB &middot; the figures and bank details below are filled in from it
                </p>
              </>
            )}
          </div>

          {/* What the reading pass has to say for itself. */}
          {!reading && confidence != null && (
            <div className={cn(
              'mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]',
              confidence >= 0.6
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-300 bg-amber-50 text-amber-800',
            )}>
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {confidence >= 0.6
                  ? <>Read and filled in below. <b>Check every figure against the paper</b> before filing.</>
                  : <>This document was hard to read ({Math.round(confidence * 100)}% confidence). <b>Check every field.</b></>}
              </span>
            </div>
          )}

          {!reading && readNote && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>{readNote}</span>
            </div>
          )}

          {!reading && warnings.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

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
            <Field label={<>Invoice no.{autoMark('invoiceNumber')}</>}>
              <input className={cn(inputCls, auto.invoiceNumber && autoCls)} value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} />
            </Field>
            <Field label={<>Invoice date{autoMark('invoiceDate')}</>}>
              <input type="date" className={cn(inputCls, auto.invoiceDate && autoCls)} value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} />
            </Field>
            <Field label={<>Payment due{autoMark('dueDate')}</>}>
              <input type="date" className={cn(inputCls, auto.dueDate && autoCls)} value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label={<>Currency{autoMark('currency')}</>}>
              <select className={cn(inputCls, auto.currency && autoCls)} value={form.currency} onChange={e => set('currency', e.target.value)}>
                {Array.from(new Set([form.currency, ...CURRENCIES])).filter(Boolean).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={<>Nett{autoMark('amount')}</>}>
              <input inputMode="decimal" className={cn(inputCls, 'text-right tabular-nums', auto.amount && autoCls)} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label={<>Tax / service{autoMark('taxAmount')}</>}>
              <input inputMode="decimal" className={cn(inputCls, 'text-right tabular-nums', auto.taxAmount && autoCls)} value={form.taxAmount} onChange={e => set('taxAmount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label={<>Total{autoMark('totalAmount')}</>} required>
              <input
                inputMode="decimal"
                className={cn(inputCls, 'text-right font-bold tabular-nums', auto.totalAmount && autoCls, totalDiffers && 'border-amber-400 bg-amber-50')}
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

        {/* ── Where the property wants paying ───────────────────────────
             Filed with the invoice so Accounts never has to read the same
             PDF a second time by eye to find the account — the step that
             produces wrong-account transfers. Shown, not hidden behind a
             disclosure, because a clerk who cannot see it cannot check it. */}
        <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Building2 className="h-3 w-3" /> Bank details on the invoice
            <span className="ml-auto font-medium normal-case tracking-normal text-slate-400">
              what Accounts will pay to &mdash; check it against the paper
            </span>
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={<>Account name{autoMark('bankAccountName')}</>}>
              <input className={cn(inputCls, auto.bankAccountName && autoCls)} value={form.bankAccountName} onChange={e => set('bankAccountName', e.target.value)} placeholder="Beneficiary as printed" />
            </Field>
            <Field label={<>Account number{autoMark('bankAccountNumber')}</>}>
              <input className={cn(inputCls, 'font-mono tabular-nums', auto.bankAccountNumber && autoCls)} value={form.bankAccountNumber} onChange={e => set('bankAccountNumber', e.target.value)} placeholder="Exactly as printed" />
            </Field>
            <Field label={<>Bank{autoMark('bankName')}</>}>
              <input className={cn(inputCls, auto.bankName && autoCls)} value={form.bankName} onChange={e => set('bankName', e.target.value)} />
            </Field>
            <Field label={<>Branch{autoMark('bankBranch')}</>}>
              <input className={cn(inputCls, auto.bankBranch && autoCls)} value={form.bankBranch} onChange={e => set('bankBranch', e.target.value)} />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label={<>SWIFT / BIC{autoMark('bankSwift')}</>}>
              <input className={cn(inputCls, 'font-mono uppercase', auto.bankSwift && autoCls)} value={form.bankSwift} onChange={e => set('bankSwift', e.target.value.toUpperCase())} />
            </Field>
            <Field label={<>IBAN{autoMark('bankIban')}</>}>
              <input className={cn(inputCls, 'font-mono uppercase', auto.bankIban && autoCls)} value={form.bankIban} onChange={e => set('bankIban', e.target.value.toUpperCase())} />
            </Field>
            <Field label={<>Account currency{autoMark('bankCurrency')}</>}>
              <select className={cn(inputCls, auto.bankCurrency && autoCls)} value={form.bankCurrency} onChange={e => set('bankCurrency', e.target.value)}>
                {Array.from(new Set(['', form.bankCurrency, ...CURRENCIES])).filter(c => c !== undefined).map(c => (
                  <option key={c || 'none'} value={c}>{c || '—'}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-3">
            <Field label={<>Bank address{autoMark('bankAddress')}</>}>
              <input className={cn(inputCls, auto.bankAddress && autoCls)} value={form.bankAddress} onChange={e => set('bankAddress', e.target.value)} />
            </Field>
          </div>

          {form.bankCurrency && form.currency && form.bankCurrency !== form.currency && (
            <p className="mt-2 text-[11px] text-amber-700">
              The invoice is in {form.currency} but the account is held in {form.bankCurrency} —
              Accounts will convert at the rate on the day.
            </p>
          )}
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

/** A field the reader filled: tinted until the clerk touches it. */
const autoCls = 'border-brand-300 bg-brand-50/50'

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 ' +
  'disabled:bg-slate-100 disabled:text-slate-500'

function Field({ label, required, children }: { label: React.ReactNode; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
