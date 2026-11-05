'use client'

/**
 * "Waiting for approval" on /dashboard/ground/drivers — independent drivers who
 * registered themselves (Aahaas app or the /register/driver link). Approve lets
 * them sign in to the app; Decline keeps them switched off. Drivers a vehicle
 * vendor adds never appear here — they need no approval.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Car, CheckCircle2, Clock, Globe, Loader2, Mail, MessageCircle, Smartphone, User, X } from 'lucide-react'
import type { OperationCountry } from '@prisma/client'
import { Card } from '@/components/ui/card'
import { CountryFlag } from '@/components/ui/country-flag'
import { countryLabel } from '@/lib/country-detection'
import { formatDate } from '@/lib/utils'

interface Signup {
  id: string
  driverId: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  country: OperationCountry | null
  photoUrl: string | null
  source: 'APP' | 'WEB'
  vehicle: { id: string; type: string; plateNo: string; brand: string | null; model: string | null; capacity: number } | null
  submittedAt: string
}

export default function DriverSignupsPanel({ country, canDecide, onChanged, onPending, refreshKey }: {
  country: string
  canDecide: boolean
  /** Changes whenever the page reloads its drivers — e.g. after one is switched on in the edit form. */
  refreshKey?: unknown
  /** Reload the driver list after a decision. */
  onChanged: () => void
  /** Driver ids still waiting, so the list below can label them. */
  onPending?: (driverIds: Set<string>) => void
}) {
  const [items, setItems] = useState<Signup[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (country && country !== 'ALL') params.set('country', country)
      const res = await fetch(`/api/ground/driver-signups?${params}`)
      const data = await res.json()
      if (data.success) setItems(data.data.items)
    } catch {
      // The driver list below still works; the panel just stays hidden.
    }
  }, [country])

  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => { onPending?.(new Set(items.map(i => i.driverId))) }, [items, onPending])

  async function decide(s: Signup, action: 'approve' | 'decline') {
    if (action === 'approve' && !confirm(`Approve ${s.name}? They can sign in to the Aahaas app straight away.`)) return
    setBusyId(s.id)
    try {
      const res = await fetch(`/api/ground/driver-signups/${s.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'decline' ? reason.trim() : undefined }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(action === 'approve' ? `${s.name} approved — they can sign in now` : `${s.name}'s registration declined`)
      setDeclining(null); setReason('')
      setItems(prev => prev.filter(x => x.id !== s.id))
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not save the decision')
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!items.length) return null

  return (
    <Card className="border-amber-200 overflow-hidden">
      <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
        <Clock className="w-4 h-4 text-amber-600" />
        <p className="text-sm font-bold text-amber-900">Waiting for approval ({items.length})</p>
        <p className="text-xs text-amber-700 hidden sm:block">
          · Independent drivers who registered themselves. Approve to let them sign in to the Aahaas app.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map(s => {
          const wa = s.phone.replace(/\D/g, '')
          const busy = busyId === s.id
          return (
            <div key={s.id} className="p-4 space-y-3">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-amber-100 flex items-center justify-center">
                  {s.photoUrl
                    ? <img src={s.photoUrl} alt={s.name} className="w-full h-full object-cover" />
                    : <User className="w-5 h-5 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900">{s.name}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Pending approval</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 flex items-center gap-1">
                      {s.source === 'APP' ? <><Smartphone className="w-2.5 h-2.5" /> Aahaas app</> : <><Globe className="w-2.5 h-2.5" /> Registration link</>}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {wa.length >= 9 ? (
                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-emerald-600">
                        <MessageCircle className="w-3 h-3" />{s.phone}
                      </a>
                    ) : <span>{s.phone}</span>}
                    {s.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{s.email}</span>}
                    {s.country && (
                      <span className="flex items-center gap-1"><CountryFlag country={s.country} className="w-4 h-3" />{countryLabel(s.country)}</span>
                    )}
                    {s.licenseNo && <span>Licence {s.licenseNo}</span>}
                    <span>Registered {formatDate(s.submittedAt, 'dd MMM yyyy, HH:mm')}</span>
                  </div>
                  <div className="text-xs text-slate-600 flex items-center gap-1">
                    <Car className="w-3 h-3 text-slate-400" />
                    {s.vehicle
                      ? <span><span className="font-mono font-semibold">{s.vehicle.plateNo}</span> · {s.vehicle.type} · {s.vehicle.capacity} seats{s.vehicle.brand || s.vehicle.model ? ` · ${[s.vehicle.brand, s.vehicle.model].filter(Boolean).join(' ')}` : ''}</span>
                      : <span className="text-slate-400">No vehicle given</span>}
                  </div>
                </div>
                {canDecide && declining !== s.id && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => decide(s, 'approve')} disabled={busy}
                      className="btn btn-sm flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
                    </button>
                    <button onClick={() => { setDeclining(s.id); setReason('') }} disabled={busy} className="btn-secondary btn btn-sm">
                      Decline
                    </button>
                  </div>
                )}
              </div>
              {canDecide && declining === s.id && (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center pl-[60px]">
                  <input value={reason} onChange={e => setReason(e.target.value)} autoFocus maxLength={500}
                    placeholder="Reason (the driver sees this) — optional"
                    className="form-input flex-1 text-sm" />
                  <div className="flex gap-2">
                    <button onClick={() => decide(s, 'decline')} disabled={busy}
                      className="btn-danger btn btn-sm flex items-center gap-1.5 disabled:opacity-60">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Decline
                    </button>
                    <button onClick={() => setDeclining(null)} disabled={busy} className="btn-secondary btn btn-sm">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
