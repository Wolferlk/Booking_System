'use client'

/**
 * Detailed P&L panel.
 *
 * Shows the Accounts system's costing sheet for this booking inside the Booking
 * system: the same Hotels / Attraction / Tour Transfers / Transport / Meals /
 * Others tables, built from the same stored Apple System payload by a port of
 * the same code (see src/lib/detailed-pnl). The two systems are linked on the
 * IS number, compared with spaces stripped — "VN41054" here is "VN 41054"
 * there.
 *
 * The sheet arrives as HTML because the renderer is a port of the Accounts
 * app's own HTML builder; rendering it verbatim is what keeps the two screens
 * from drifting. It is server-built from database values and escaped at every
 * interpolation (render.ts::esc), and no user input reaches it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Loader2, RefreshCw, X, Table2, Ticket, Maximize2,
  ChevronDown, ChevronRight, CheckCircle2, ArrowRight, Sparkles,
  Download, FileSpreadsheet, Printer, FileCode2,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DETAILED_PNL_CSS } from '@/lib/detailed-pnl/styles'
import type { UserRole } from '@prisma/client'

interface Totals {
  hotels: number; products: number; transfers: number
  transport: number; meals: number; others: number
  grand: number; cost: number; profit: number; margin: number
}

interface LineCounts {
  hotels: number; products: number; transfers: number
  transport: number; meals: number; others: number
}

interface Source {
  matchedBy: string
  recordId: number
  isNumber: string | null
  quotationNo: string | null
  referenceId: string | null
  revision: number | null
  countryCode: string | null
  approvalStatus: string | null
}

type Payload =
  | { available: true; html: string; totals: Totals; currency: string; lineCounts: LineCounts; source: Source }
  | { available: false; reason: string; message: string }

interface Props {
  bookingRef: string
  role: UserRole
  /** Render the costing sheet expanded inside the card, not only in the modal. */
  inline?: boolean
  /**
   * Create tickets for costing lines that have none as soon as the sheet loads.
   * Purely additive: the endpoint skips lines that already have a ticket and
   * never modifies a ticket that has left DRAFT.
   */
  autoCreateTickets?: boolean
  /** Called after tickets are created, so the page can refresh its ticket list. */
  onTicketsCreated?: () => void
  /**
   * Called on every load with whether the Accounts costing sheet was found, so
   * the page can offer a manual P&L upload when it wasn't. `null` while the
   * answer is still unknown (loading, or the read failed).
   */
  onAvailability?: (available: boolean | null) => void
}

const money = (n: number, cur: string) =>
  `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SECTIONS: Array<[keyof Totals & keyof LineCounts, string, string]> = [
  ['hotels',    'Hotels',         '#2a78d6'],
  ['products',  'Attraction',     '#008300'],
  ['transfers', 'Tour Transfers', '#e87ba4'],
  ['transport', 'Transport',      '#eda100'],
  ['meals',     'Meals',          '#1baf7a'],
  ['others',    'Others',         '#eb6834'],
]

export default function DetailedPnlPanel({
  bookingRef, role, inline = false, autoCreateTickets = false, onTicketsCreated, onAvailability,
}: Props) {
  const [data, setData]       = useState<Payload | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [creating, setCreating] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(inline)
  const [autoRunning, setAutoRunning] = useState(false)
  const [lastSync, setLastSync] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const downloadRef = useRef<HTMLDivElement | null>(null)

  // Auto-create fires once per booking, never on every re-render or refresh.
  const autoRan = useRef<string | null>(null)

  const canCreateTickets = ['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/detailed-pnl`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Failed to load the Detailed P&L')
      setData(json.data as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the Detailed P&L')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  // Informational only — how many tickets the booking already carries.
  const loadTicketCount = useCallback(async () => {
    try {
      const res  = await fetch(`/api/tickets?bookingRef=${bookingRef}`)
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setTicketCount(json.data.length)
    } catch { /* best effort */ }
  }, [bookingRef])

  useEffect(() => { load(); loadTicketCount() }, [load, loadTicketCount])

  // Escape closes the full-screen sheet, and the page behind it must not scroll
  // while it is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  // The download menu closes on an outside click or Escape, like any menu.
  useEffect(() => {
    if (!downloadOpen) return
    const onDown = (e: MouseEvent) => {
      if (!downloadRef.current?.contains(e.target as Node)) setDownloadOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDownloadOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [downloadOpen])

  /**
   * One call path for every ticket creation on this panel — the manual button,
   * the re-sync button and the automatic run on load. `resync` refreshes DRAFT
   * tickets from the latest costing; without it only missing lines are created.
   */
  const runCreate = useCallback(async (opts: { resync?: boolean; silent?: boolean } = {}) => {
    const { resync = false, silent = false } = opts
    const res  = await fetch(
      `/api/bookings/${bookingRef}/ext-pnl/create-tickets${resync ? '?resync=true' : ''}`,
      { method: 'POST' },
    )
    // A crashed route answers with an empty body, and res.json() then throws
    // "Unexpected end of JSON input" — which tells whoever is looking at the
    // page nothing at all. Read the text first and report the status instead.
    const text = await res.text()
    let json: { success?: boolean; error?: string; message?: string; data?: unknown }
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`Ticket creation failed on the server (HTTP ${res.status}).`)
    }
    if (!json.success) throw new Error(json.error || `Failed to create tickets (HTTP ${res.status})`)
    const result = json.data as { created: number; updated: number; skipped: number }
    setLastSync(result)
    if (result.created > 0 || result.updated > 0) {
      await loadTicketCount()
      onTicketsCreated?.()
      if (!silent) toast.success(json.message ?? `${result.created} ticket${result.created !== 1 ? 's' : ''} created`)
    } else if (!silent) {
      toast.info(`Every costing line already has a ticket (${result.skipped} skipped)`)
    }
    return result
  }, [bookingRef, loadTicketCount, onTicketsCreated])

  async function createTickets() {
    if (!canCreateTickets) return
    setCreating(true)
    try { await runCreate() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to create tickets') }
    finally { setCreating(false) }
  }

  async function resyncTickets() {
    if (!canCreateTickets) return
    setResyncing(true)
    try { await runCreate({ resync: true }) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Re-sync failed') }
    finally { setResyncing(false) }
  }

  /* ---------------------------------------------------------------- download

     The sheet is already a finished, self-contained block of HTML built from
     the Accounts payload, so every download here is that same markup — no
     second renderer to keep in step with the screen. */

  /** File name stem: the IS number when the sheet has one, else the booking. */
  const downloadName = useCallback(() => {
    const d = data?.available === true ? data : null
    const id = (d?.source.isNumber ?? bookingRef).replace(/\s+/g, '')
    const rev = d?.source.revision != null ? `-rev${d.source.revision}` : ''
    return `Detailed-PNL-${id}${rev}`
  }, [data, bookingRef])

  /** The costing sheet as a standalone HTML document, styles included. */
  const standaloneHtml = useCallback(() => {
    const d = data?.available === true ? data : null
    if (!d) return ''
    const title = `Detailed P&L — ${d.source.isNumber ?? bookingRef}`
    return `<!doctype html><html><head><meta charset="utf-8">`
      + `<title>${title}</title>`
      + `<style>${DETAILED_PNL_CSS}`
      + `body{margin:0;padding:24px;background:#fff;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}`
      + `@page{size:A4 landscape;margin:10mm}`
      + `@media print{body{padding:0}.dt-scroll{overflow:visible}}`
      + `</style></head><body><div class="dtp-root">${d.html}</div></body></html>`
  }, [data, bookingRef])

  function saveBlob(content: BlobPart, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked on the next tick — Safari cancels the download if it goes sooner.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function downloadHtml() {
    setDownloadOpen(false)
    const html = standaloneHtml()
    if (!html) return
    saveBlob(html, `${downloadName()}.html`, 'text/html;charset=utf-8')
  }

  /**
   * PDF is the browser's own "Save as PDF" over a print window holding the same
   * standalone document. No server round trip, and what prints is what is on
   * screen.
   */
  function downloadPdf() {
    setDownloadOpen(false)
    const html = standaloneHtml()
    if (!html) return
    const w = window.open('', '_blank')
    if (!w) {
      toast.error('Allow pop-ups for this site to print or save the sheet as PDF')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    // Give the styles a tick to apply before the print dialog takes its snapshot.
    w.onload = () => { w.focus(); w.print() }
    setTimeout(() => { try { w.focus(); w.print() } catch { /* already printed */ } }, 600)
  }

  /**
   * Excel gets one worksheet per section of the sheet, read off the rendered
   * tables. SheetJS reads from a live DOM node, so the markup is mounted
   * off-screen for the length of the export and then removed.
   */
  async function downloadExcel() {
    setDownloadOpen(false)
    const d = data?.available === true ? data : null
    if (!d) return
    setDownloading(true)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px'
    host.innerHTML = d.html
    document.body.appendChild(host)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      // Summary first: the totals the panel shows above the sheet.
      const summary: (string | number)[][] = [
        ['Detailed P&L', d.source.isNumber ?? bookingRef],
        ['Booking', bookingRef],
        ['Quotation No', d.source.quotationNo ?? ''],
        ['Revision', d.source.revision ?? ''],
        ['Currency', d.currency],
        [],
        ['Section', 'Lines', `Total (${d.currency})`],
        ...SECTIONS.map(([key, label]) => [label, d.lineCounts[key], d.totals[key]] as (string | number)[]),
        [],
        ['Total Tour Cost', '', d.totals.grand],
        ['Without Markup', '', d.totals.cost],
        ['Profit', `${d.totals.margin.toFixed(1)}%`, d.totals.profit],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')

      // One sheet per section table, named after the section heading.
      const used = new Set(['Summary'])
      host.querySelectorAll<HTMLElement>('.dt-block').forEach((block, i) => {
        const table = block.querySelector('table')
        if (!table) return
        const raw = (block.querySelector('.dt-block-head .t')?.textContent ?? `Section ${i + 1}`).trim()
        // Excel sheet names: 31 chars, no []:*?/\, and unique in the workbook.
        let name = (raw.replace(/[\\/?*[\]:]/g, ' ').trim() || `Section ${i + 1}`).slice(0, 28)
        let n = 2
        while (used.has(name)) name = `${name.slice(0, 26)} ${n++}`
        used.add(name)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(table), name)
      })

      XLSX.writeFile(wb, `${downloadName()}.xlsx`)
      toast.success('Detailed P&L downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Excel export failed')
    } finally {
      host.remove()
      setDownloading(false)
    }
  }

  const available = data?.available === true

  // Report the outcome upwards. A failed read is not "no sheet" — it stays
  // `null` so the page does not offer a manual upload over a DB outage.
  useEffect(() => {
    if (loading) return
    onAvailability?.(error || !data ? null : available)
  }, [loading, error, data, available, onAvailability])

  // Tickets are created from the costing sheet the moment it is on screen.
  useEffect(() => {
    if (!autoCreateTickets || !available || !canCreateTickets) return
    if (autoRan.current === bookingRef) return
    autoRan.current = bookingRef
    setAutoRunning(true)
    runCreate({ silent: true })
      .then(r => {
        if (r.created > 0) {
          toast.success(`${r.created} ticket${r.created !== 1 ? 's' : ''} auto-created from the Detailed P&L`)
        }
      })
      .catch(err => toast.error(err instanceof Error ? err.message : 'Auto ticket creation failed'))
      .finally(() => setAutoRunning(false))
  }, [autoCreateTickets, available, canCreateTickets, bookingRef, runCreate])
  const totalLines = available
    ? Object.values((data as Extract<Payload, { available: true }>).lineCounts).reduce((a, b) => a + b, 0)
    : 0

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DETAILED_PNL_CSS }} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Table2 className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-slate-900">Detailed P&amp;L</h3>
              <span className="text-xs text-slate-500">Accounts costing sheet</span>
              {available && (
                <Badge color="blue">
                  {(data as Extract<Payload, { available: true }>).source.isNumber ?? '—'}
                  {(data as Extract<Payload, { available: true }>).source.revision != null
                    ? ` · rev ${(data as Extract<Payload, { available: true }>).source.revision}` : ''}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </Button>
              {available && (
                <>
                  <div className="relative" ref={downloadRef}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDownloadOpen(o => !o)}
                      disabled={downloading}
                      aria-haspopup="menu"
                      aria-expanded={downloadOpen}
                    >
                      {downloading
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                      Download
                      <ChevronDown className="w-3 h-3 -mr-0.5" />
                    </Button>
                    {downloadOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1"
                      >
                        <button
                          role="menuitem"
                          onClick={downloadExcel}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                          Excel (.xlsx)
                          <span className="ml-auto text-[10px] font-normal text-slate-400">1 tab per section</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={downloadPdf}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Printer className="w-3.5 h-3.5 text-rose-600" />
                          PDF / Print
                          <span className="ml-auto text-[10px] font-normal text-slate-400">via print dialog</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={downloadHtml}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-indigo-600" />
                          HTML sheet
                          <span className="ml-auto text-[10px] font-normal text-slate-400">offline copy</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setSheetOpen(o => !o)}>
                    {sheetOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {sheetOpen ? 'Collapse sheet' : 'Expand sheet'}
                  </Button>
                  <Button size="sm" onClick={() => setOpen(true)}>
                    <Maximize2 className="w-3.5 h-3.5" /> Full screen
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardBody>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading the Accounts P&amp;L…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && !error && data && !available && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {(data as Extract<Payload, { available: false }>).message}
            </div>
          )}

          {!loading && !error && available && (() => {
            const d = data as Extract<Payload, { available: true }>
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {SECTIONS.map(([key, label, colour]) => (
                    <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: colour }} />
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{label}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-900 mt-1 font-mono">
                        {money(d.totals[key], d.currency)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {d.lineCounts[key]} line{d.lineCounts[key] === 1 ? '' : 's'}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-900 px-4 py-3">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Total Tour Cost</p>
                      <p className="text-lg font-bold text-white font-mono">{money(d.totals.grand, d.currency)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Without Markup</p>
                      <p className="text-sm font-semibold text-slate-200 font-mono">{money(d.totals.cost, d.currency)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-200">Profit</p>
                      <p className={`text-sm font-bold font-mono ${d.totals.profit < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {money(d.totals.profit, d.currency)} · {d.totals.margin.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {canCreateTickets && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={resyncTickets} disabled={resyncing || creating}>
                        {resyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Re-sync drafts
                      </Button>
                      <Button size="sm" onClick={createTickets} disabled={creating || resyncing}>
                        {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ticket className="w-3.5 h-3.5" />}
                        Create tickets ({totalLines} lines)
                      </Button>
                    </div>
                  )}
                </div>

                {/* What this sheet has already turned into, on the tickets page */}
                {canCreateTickets && (
                  <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm text-slate-700 min-w-0">
                      {autoRunning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                          <span>Creating tickets from this costing sheet…</span>
                        </>
                      ) : lastSync ? (
                        <>
                          {lastSync.created > 0
                            ? <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                            : <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                          <span className="truncate">
                            {lastSync.created > 0
                              ? `${lastSync.created} ticket${lastSync.created !== 1 ? 's' : ''} created from this sheet`
                              : 'Every costing line already has a ticket'}
                            {lastSync.updated > 0 && ` · ${lastSync.updated} draft${lastSync.updated !== 1 ? 's' : ''} updated`}
                            {lastSync.skipped > 0 && ` · ${lastSync.skipped} skipped`}
                          </span>
                        </>
                      ) : (
                        <>
                          <Ticket className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>{totalLines} purchasable line{totalLines === 1 ? '' : 's'} on this sheet</span>
                        </>
                      )}
                      {ticketCount != null && (
                        <Badge color="blue">{ticketCount} ticket{ticketCount === 1 ? '' : 's'} on booking</Badge>
                      )}
                    </div>
                    <Link
                      href={`/dashboard/bookings/${bookingRef}/tickets`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                    >
                      Open tickets <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}

                {/* The costing sheet itself, expanded in place */}
                {sheetOpen && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
                      <span className="text-xs font-semibold text-slate-600">
                        Costing sheet · matched on {d.source.matchedBy.replace(/_/g, ' ')}
                      </span>
                      <button
                        onClick={() => setOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                      >
                        <Maximize2 className="w-3.5 h-3.5" /> Full screen
                      </button>
                    </div>
                    <div className="overflow-x-auto px-4 py-3">
                      <div className="dtp-root" dangerouslySetInnerHTML={{ __html: d.html }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </CardBody>
      </Card>

      {open && available && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[1400px] max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Table2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  Detailed P&amp;L — {(data as Extract<Payload, { available: true }>).source.isNumber ?? bookingRef}
                </h2>
                <span className="text-xs text-slate-400 hidden sm:inline">
                  matched on {(data as Extract<Payload, { available: true }>).source.matchedBy.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="secondary" size="sm" onClick={downloadExcel} disabled={downloading}>
                  {downloading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileSpreadsheet className="w-3.5 h-3.5" />}
                  Excel
                </Button>
                <Button variant="secondary" size="sm" onClick={downloadPdf}>
                  <Printer className="w-3.5 h-3.5" /> PDF
                </Button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div
                className="dtp-root"
                dangerouslySetInnerHTML={{ __html: (data as Extract<Payload, { available: true }>).html }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
