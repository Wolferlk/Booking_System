'use client'

/**
 * Settings → Vietnam Product Sheet.
 *
 * The workbook the agenda's "Includes" picker reads its products from, and the
 * tab operator-added products are written back to. Changing the link here is
 * all it takes to move the picker onto a new sheet: press Sync and the list is
 * re-read. A product that leaves the sheet is retired, never deleted, so the
 * bookings that already include it keep reading.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Layers, Loader2, RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, CloudUpload, Save, Clock,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { DEFAULT_MANUAL_TAB, DEFAULT_PRODUCT_SHEET_URL, formatVnd, type CatalogMeta } from '@/lib/vn-includes/shared'

interface Snapshot {
  config: { sheetUrl: string; sheetTab: string; manualTab: string }
  meta: CatalogMeta | null
  installed: boolean
  counts: { active: number; manual: number; pending: number }
  manual: {
    id: string; code: string; name: string; minPriceVnd: string | number | null
    syncStatus: string | null; syncError: string | null; bookingRef: string | null
    createdByName: string | null; createdAt: string; sheetRow: number | null
  }[]
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs} h ago`
  return new Date(iso).toLocaleDateString()
}

export default function VnProductSheetCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [form, setForm] = useState({ sheetUrl: '', sheetTab: '', manualTab: '' })
  const [busy, setBusy] = useState<null | 'load' | 'save' | 'sync' | 'push'>('load')

  const apply = useCallback((data: Snapshot) => {
    setSnap(data)
    setForm({ sheetUrl: data.config.sheetUrl, sheetTab: data.config.sheetTab, manualTab: data.config.manualTab })
  }, [])

  useEffect(() => {
    fetch('/api/vn-includes/settings')
      .then(r => r.json())
      .then(json => { if (json.success) apply(json.data); else toast.error(json.error) })
      .catch(() => toast.error('Could not load the product sheet settings'))
      .finally(() => setBusy(null))
  }, [apply])

  async function call(kind: 'save' | 'sync' | 'push') {
    setBusy(kind)
    try {
      const res = await fetch('/api/vn-includes/settings', kind === 'save'
        ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: kind }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      apply(json.data)
      toast.success(json.message)
      if (kind === 'save' && snap && form.sheetUrl !== snap.config.sheetUrl) {
        toast.info('New link saved — press Sync to read its products')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
      // A failed sync still records why; refresh so the card shows it.
      fetch('/api/vn-includes/settings').then(r => r.json()).then(j => { if (j.success) apply(j.data) }).catch(() => {})
    } finally { setBusy(null) }
  }

  const dirty = snap && (
    form.sheetUrl !== snap.config.sheetUrl || form.sheetTab !== snap.config.sheetTab || form.manualTab !== snap.config.manualTab
  )
  const meta = snap?.meta

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-500" /> Vietnam Product Sheet
          <span className="text-[11px] font-normal text-slate-400">— the agenda&apos;s Includes list</span>
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-4">
        {busy === 'load' ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : !snap ? null : (
          <>
            {!snap.installed && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  The includes tables are not on this database yet. Run{' '}
                  <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-vn-agenda-includes.sh</code>{' '}
                  (additive — two new tables, nothing existing is touched), then Sync.
                </span>
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              Vietnam <b>SIC Transfer</b> and <b>Private Tour</b> movements pick what they include from this workbook.
              Each include is paid separately on the Accounts payables board. Products typed in by hand are appended to
              the <b>{snap.config.manualTab}</b> tab of the same workbook. The product tab itself is only ever read.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="form-label text-xs">Product sheet link (SharePoint / OneDrive)</span>
                <div className="flex gap-2">
                  <input className="form-input text-xs py-1.5 flex-1 min-w-0 font-mono"
                    value={form.sheetUrl} onChange={e => setForm({ ...form, sheetUrl: e.target.value })}
                    placeholder={DEFAULT_PRODUCT_SHEET_URL} />
                  {meta?.webUrl && (
                    <a href={meta.webUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </a>
                  )}
                </div>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="form-label text-xs">Product tab</span>
                  <input className="form-input text-xs py-1.5" value={form.sheetTab}
                    onChange={e => setForm({ ...form, sheetTab: e.target.value })}
                    placeholder="Auto — first tab with Code + product columns" />
                </label>
                <label className="block">
                  <span className="form-label text-xs">Manual products tab</span>
                  <input className="form-input text-xs py-1.5" value={form.manualTab}
                    onChange={e => setForm({ ...form, manualTab: e.target.value })}
                    placeholder={DEFAULT_MANUAL_TAB} />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => call('save')} disabled={!dirty || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
              <button type="button" onClick={() => call('sync')} disabled={busy !== null || Boolean(dirty) || !snap.installed}
                title={dirty ? 'Save the link first' : 'Re-read every product from the sheet'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
                {busy === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync now
              </button>
              {snap.counts.pending > 0 && (
                <button type="button" onClick={() => call('push')} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40">
                  {busy === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                  Write {snap.counts.pending} waiting product{snap.counts.pending === 1 ? '' : 's'} to the sheet
                </button>
              )}
            </div>

            {/* Last sync */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Products', value: snap.counts.active.toLocaleString() },
                { label: 'Added by hand', value: snap.counts.manual.toLocaleString() },
                { label: 'Last sync', value: ago(meta?.syncedAt) },
                { label: 'Tab read', value: meta?.tab ?? '—' },
              ].map(t => (
                <div key={t.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
                  <p className="text-sm font-semibold text-slate-800 truncate" title={t.value}>{t.value}</p>
                </div>
              ))}
            </div>
            {meta && (
              meta.error ? (
                <p className="flex items-start gap-1.5 text-xs text-red-600">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Last sync failed: {meta.error}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {meta.fileName} — {meta.rows.toLocaleString()} products read · {meta.added} new · {meta.updated} changed · {meta.retired} retired
                </p>
              )
            )}

            {/* Manual products */}
            {snap.manual.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Added by hand</p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {snap.manual.map(m => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="w-20 flex-shrink-0 font-semibold text-slate-600">{m.code}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-800" title={m.name}>{m.name}</span>
                      <span className="tabular-nums text-slate-500 whitespace-nowrap">{formatVnd(m.minPriceVnd === null ? null : Number(m.minPriceVnd))}</span>
                      <span className="hidden sm:block w-24 truncate text-slate-400" title={m.createdByName ?? ''}>{m.bookingRef ?? ''}</span>
                      {m.syncStatus === 'SYNCED' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 whitespace-nowrap" title={m.sheetRow ? `Row ${m.sheetRow}` : undefined}>
                          <CheckCircle2 className="w-3 h-3" /> On sheet
                        </span>
                      ) : m.syncStatus === 'FAILED' ? (
                        <span className="inline-flex items-center gap-1 text-red-600 whitespace-nowrap" title={m.syncError ?? ''}>
                          <AlertTriangle className="w-3 h-3" /> Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 whitespace-nowrap"><Clock className="w-3 h-3" /> Waiting</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
