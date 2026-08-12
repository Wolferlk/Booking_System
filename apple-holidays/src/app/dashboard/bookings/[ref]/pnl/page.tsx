'use client'

/**
 * Booking P&L page.
 *
 * This screen shows one thing: the Accounts system's **Detailed P&L** costing
 * sheet for the booking, expanded, and the tickets it produces.
 *
 * The old editable "P&L Line Items" grid, its pax-count inputs, the summary
 * cards and the linked Accounts PNL record panel were removed from this view.
 * The data behind them is untouched — no route, table or record was changed —
 * but with the grid gone the "Save P&L" action is deliberately gone too: that
 * endpoint replaces every stored line item with whatever the form holds, and an
 * empty form would have wiped live rows.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, X, Info, HardDrive, RefreshCw, Ticket, ArrowRight } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { isCreditAgent } from '@/lib/utils'
import DetailedPnlPanel from '@/components/bookings/detailed-pnl-panel'
import type { UserRole } from '@prisma/client'
import LogoSpinner from '@/components/shared/logo-spinner'

/** Roles allowed to read the Accounts costing sheet — unchanged from before. */
const COSTING_ROLES = ['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export default function PNLPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [bookingAgent, setBookingAgent] = useState<string | null>(null)
  const [isNumber, setIsNumber]     = useState<string | null>(null)
  const [cntlNumber, setCntlNumber] = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [syncingOneDrive, setSyncingOneDrive] = useState(false)
  const [syncResult, setSyncResult] = useState<{ found: boolean; message: string } | null>(null)

  const isCreditBk  = isCreditAgent(bookingAgent)
  const canSeeSheet = COSTING_ROLES.includes(role)

  // Read-only: the page only needs the booking's identifiers for the header and
  // the credit-agent notice.
  const loadMeta = useCallback(async () => {
    try {
      const res  = await fetch(`/api/bookings/${ref}/pnl`)
      const json = await res.json()
      if (json.success && json.data) {
        setBookingAgent(json.data.bookingAgent ?? null)
        setIsNumber(json.data.isNumber ?? null)
        setCntlNumber(json.data.cntlNumber ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [ref])

  useEffect(() => { loadMeta() }, [loadMeta])

  async function syncFromOneDrive() {
    setSyncingOneDrive(true)
    setSyncResult(null)
    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef: ref }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Sync failed')

      const results: { pnlsUpdated: number; bookingsCreated: number; bookingsUpdated: number; errors: number }[] =
        json.data?.results ?? []
      const pnlFound = results.some(r => r.pnlsUpdated > 0)
      const errors   = results.reduce((s, r) => s + r.errors, 0)

      if (pnlFound) {
        setSyncResult({ found: true, message: 'PNL synced from OneDrive successfully' })
        toast.success('PNL data loaded from OneDrive')
        await loadMeta()
      } else if (errors > 0) {
        setSyncResult({ found: false, message: 'Sync completed with errors — check OneDrive Monitor for details' })
        toast.error('Sync encountered errors')
      } else {
        setSyncResult({ found: false, message: 'No PNL file found in the OneDrive booking folder' })
        toast.warning('No PNL file found in OneDrive for this booking')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      setSyncResult({ found: false, message: msg })
      toast.error(msg)
    } finally {
      setSyncingOneDrive(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center h-64 pt-16">
      <LogoSpinner size={48} />
    </div>
  )

  return (
    <div>
      <Header
        title={`P&L — ${isNumber ?? ref}`}
        subtitle={[
          'Detailed P&L · Accounts costing sheet',
          isNumber && isNumber !== ref ? `Booking: ${ref}` : null,
          cntlNumber ? `CNTL: ${cntlNumber}` : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <div className="flex gap-2">
            <button
              onClick={syncFromOneDrive}
              disabled={syncingOneDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
              title="Search OneDrive for PNL file and import data"
            >
              {syncingOneDrive
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
                : <><HardDrive className="w-3.5 h-3.5" /><RefreshCw className="w-3 h-3 -ml-0.5" /> Sync from OneDrive</>
              }
            </button>
            <Link
              href={`/dashboard/bookings/${ref}/tickets`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              <Ticket className="w-3.5 h-3.5" /> Tickets <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        }
      />

      <div className="p-8 space-y-6">

        {/* OneDrive sync result banner */}
        {syncResult && (
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${syncResult.found ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <HardDrive className={`w-4 h-4 flex-shrink-0 mt-0.5 ${syncResult.found ? 'text-green-600' : 'text-amber-500'}`} />
            <p className={`text-sm font-medium ${syncResult.found ? 'text-green-800' : 'text-amber-800'}`}>
              {syncResult.message}
            </p>
            <button onClick={() => setSyncResult(null)} className="ml-auto text-slate-400 hover:text-slate-600 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Credit agent notice */}
        {isCreditBk && (
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Credit Agent — No Payment Approval Required</p>
              <p className="text-xs text-blue-600 mt-0.5">
                <strong>{bookingAgent}</strong> settles payments in bulk on the 15th and 30th of each month.
              </p>
            </div>
          </div>
        )}

        {/* The Accounts system's costing sheet for this booking, matched on the
            IS number. This is what tickets are costed from — and they are
            created from it automatically as soon as the sheet loads. */}
        {canSeeSheet ? (
          <DetailedPnlPanel bookingRef={ref} role={role} inline autoCreateTickets />
        ) : (
          <Card className="p-6">
            <p className="text-sm text-slate-600">
              The Accounts costing sheet for this booking is visible to the Booking, Accounts and Admin teams.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
