'use client'

/**
 * "Replace all" card for the 30 Sundays placeholder file handler.
 *
 * Bookings from the 30 Sundays feed arrive with `fileHandler` = "30sundays
 * Aahaas". The quotation tool records the real handler against the same IS
 * number, so this card counts the bookings still holding the placeholder and
 * lets an admin swap every one of them in a single pass.
 *
 * The same sweep runs automatically ten minutes after a booking is created, so
 * this button is for catching up history — or for the impatient.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, RefreshCw, UserCheck } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

interface Status {
  placeholder: string
  pending: number
  configured: boolean
  schema: string | null
}

interface SweepResult {
  scanned: number
  replaced: number
  noMatch: number
  errors: number
  changes: { bookingRef: string; from: string | null; to: string }[]
}

export default function FileHandlerResolveSettings() {
  const [status, setStatus]   = useState<Status | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult]   = useState<SweepResult | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const json = await fetch('/api/admin/file-handler-resolve').then(r => r.json())
      if (json.success) setStatus(json.data)
    } catch { /* non-critical — the button still works */ }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  async function replaceAll() {
    setRunning(true)
    setResult(null)
    try {
      const res  = await fetch('/api/admin/file-handler-resolve', { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setResult(json.data)
      toast.success(
        json.data.replaced > 0
          ? `${json.data.replaced} file handler${json.data.replaced === 1 ? '' : 's'} replaced`
          : 'Nothing to replace — no matching quote rows yet',
      )
      await loadStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-blue-500" /> File Handler — 30 Sundays Placeholder
          </h3>
          {status && (
            <span className="text-xs text-slate-400">
              {status.pending} booking{status.pending === 1 ? '' : 's'} pending
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-5 space-y-4">
        <p className="text-sm text-slate-600">
          Finds every booking whose File Handler is{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">{status?.placeholder ?? '30sundays Aahaas'}</code>{' '}
          and replaces it with the real handler recorded against the same IS number in{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">{status?.schema ?? 'apple_quote_ai'}</code>.
          The quote database is only ever read. Bookings whose handler someone has already
          set by hand are left alone, and so are IS numbers the quote table has no real name for
          yet. This also runs automatically ten minutes after a booking is created.
        </p>

        {status && !status.configured && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            The quote database is not configured on this server — set <code>DB_HOST</code> /{' '}
            <code>DB_USERNAME</code> (or the <code>QUOTE_AI_DB_*</code> overrides).
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={replaceAll}
            disabled={running || (status ? !status.configured : false)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {running
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Replacing…</>
              : <><RefreshCw className="w-4 h-4" /> Find &amp; Replace All File Handlers</>}
          </button>
        </div>

        {result && (
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900 space-y-1">
              <p className="font-semibold">Done — {result.scanned} booking{result.scanned === 1 ? '' : 's'} checked</p>
              <p>
                <span className="font-medium">{result.replaced}</span> replaced ·{' '}
                <span className="font-medium">{result.noMatch}</span> no real name in the quote table ·{' '}
                <span className={result.errors > 0 ? 'text-red-700 font-semibold' : ''}>{result.errors} errors</span>
              </p>
              {result.changes.length > 0 && (
                <ul className="pt-1 space-y-0.5 text-xs max-h-48 overflow-y-auto">
                  {result.changes.map(c => (
                    <li key={c.bookingRef}>
                      <span className="font-mono font-semibold">{c.bookingRef}</span>{' '}
                      <span className="text-blue-700">{c.from ?? '—'} → {c.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
