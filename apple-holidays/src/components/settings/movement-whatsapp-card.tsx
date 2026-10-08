'use client'

/**
 * Settings → Movement WhatsApp Briefing.
 *
 * Controls the WhatsApp button on every movement of the movement chart: whether
 * it shows, which approved template it sends, who is ticked by default, what is
 * shared, and the duplicate guard. One JSON row (`movement_whatsapp_config`),
 * kept as a draft and saved in one go — same pattern as the airport pickup card.
 *
 * The preview uses the very function the send uses, against a sample movement.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  MessageCircle, Save, RotateCcw, Loader2, ShieldCheck, Send, RefreshCw, Car, Building2, Sparkles, Store,
  Users, Phone, FileText, Clock,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  DEFAULT_MOVEMENT_WA_CONFIG, MOVEMENT_BRIEF_BODY, MOVEMENT_ROLE_LABEL, MOVEMENT_WA_CONFIG_KEY,
  parseMovementWaConfig, renderMovementBrief,
  type MovementBriefInput, type MovementRole, type MovementWaConfig,
} from '@/lib/movement-whatsapp-shared'

interface Props {
  settings: { movement_whatsapp_config?: string }
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

const SAMPLE: MovementBriefInput = {
  bookingRef: 'MY-20931', isNumber: 'IS48305', date: '2026-10-08',
  meetingTime: '07:00', timeFrom: null, timeTo: null,
  serviceTypeLabel: 'Private Transfer', location: 'Kuala Lumpur',
  fromPoint: 'KUL Airport', toPoint: 'FURAMA BUKIT BINTANG ( Enroute 30 mins stop at Putrajaya )',
  details: 'Private airport transfer from KUL Airport to FURAMA BUKIT BINTANG. ✈ Flight AK 38 | COK → KUL | Dep: 10:40 PM | Arr: 5:30 AM. Driver will be waiting at the arrivals hall holding a name board. Private air-conditioned car, journey approx. 45 minutes. Driver assists with luggage. Enroute 30 mins stop at Putrajaya for sightseeing.',
  mealPlan: null, isLeisure: false, isHotelOnly: false,
  leadPassenger: 'Mr. Harre', paxAdults: 2, paxChildren: 1, paxInfants: 0, guestContact: '+91 77158 05191',
  crew: {
    driverName: 'SURESH', driverPhone: '+60 16 229 7143', vehicleType: 'Car', vehiclePlate: 'WXY 1234',
    vendorName: 'KL Star Transport', guideName: 'Aina', guidePhone: '+60 12 555 0101',
    tourVendorName: null, tourVendorPhone: null,
  },
}

const ROLES: { key: Exclude<MovementRole, 'other'>; icon: typeof Car }[] = [
  { key: 'driver', icon: Car }, { key: 'vendor', icon: Building2 }, { key: 'guide', icon: Sparkles }, { key: 'tourVendor', icon: Store },
]
const GUARD_PRESETS = [0, 15, 30, 60, 120]

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export default function MovementWhatsAppCard({ settings, saving, onSave }: Props) {
  const stored = useMemo(() => parseMovementWaConfig(settings.movement_whatsapp_config), [settings.movement_whatsapp_config])
  const [draft, setDraft] = useState<MovementWaConfig>(stored)
  useEffect(() => setDraft(stored), [stored])

  const [status, setStatus] = useState<{ status: string; mismatch?: string; error?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [previewRole, setPreviewRole] = useState<Exclude<MovementRole, 'other'>>('driver')
  const [showBody, setShowBody] = useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_MOVEMENT_WA_CONFIG)
  const set = <K extends keyof MovementWaConfig>(k: K, v: MovementWaConfig[K]) => setDraft(d => ({ ...d, [k]: v }))

  const checkStatus = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/whatsapp/templates/bootstrap-movement')
      const json = await res.json()
      if (json.success) setStatus(json.data.status)
      else setStatus({ status: 'UNKNOWN', error: json.error })
    } catch (e) {
      setStatus({ status: 'UNKNOWN', error: e instanceof Error ? e.message : 'Check failed' })
    } finally { setChecking(false) }
  }, [])

  // Status belongs to the SAVED template name — re-check whenever that changes.
  useEffect(() => { void checkStatus() }, [checkStatus, stored.templateName, stored.lang])

  async function register() {
    if (dirty) { toast.error('Save your changes first — the template is registered under the saved name'); return }
    setRegistering(true)
    try {
      const res = await fetch('/api/whatsapp/templates/bootstrap-movement', { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message || 'Template submitted to Meta')
      setStatus(json.data.status)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Registration failed')
    } finally { setRegistering(false) }
  }

  const preview = renderMovementBrief(SAMPLE, {
    role: previewRole, name: previewRole === 'driver' ? 'SURESH' : previewRole === 'vendor' ? 'KL Star Transport' : previewRole === 'guide' ? 'Aina' : 'Batu Caves Tours',
  }, { config: draft })

  const st = status?.status ?? '…'
  const stTone = st === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : st === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : st === 'MISSING' || st === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-slate-50 text-slate-500 border-slate-200'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#25D366]/15 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-[#128C7E]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Movement WhatsApp Briefing</h3>
              <p className="text-xs text-slate-500">The WhatsApp button on each movement — sends that one movement to its driver, vendor, guide and tour vendor.</p>
            </div>
          </div>
          <Toggle on={draft.enabled} onChange={v => set('enabled', v)} />
        </div>
      </CardHeader>
      <CardBody>
        <div className={`grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 ${draft.enabled ? '' : 'opacity-60'}`}>
          <div>
            {/* Template */}
            <div className="rounded-xl border border-slate-200 p-3 mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-800">Approved template</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${stTone}`} title={status?.error || status?.mismatch || ''}>
                  {checking ? 'checking…' : st.toLowerCase()}
                </span>
                <button onClick={checkStatus} className="text-slate-400 hover:text-slate-600" title="Re-check with Meta"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={draft.templateName}
                  onChange={e => set('templateName', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  className="flex-1 min-w-[220px] text-sm font-mono px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                <input
                  value={draft.lang}
                  onChange={e => set('lang', e.target.value.trim())}
                  className="w-20 text-sm font-mono px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  title="Template language code"
                />
                {(st === 'MISSING' || st === 'REJECTED') && (
                  <button onClick={register} disabled={registering}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#25D366] text-white hover:bg-[#1ebe5b] disabled:opacity-60">
                    {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Register with Meta
                  </button>
                )}
              </div>
              {status?.mismatch && <p className="mt-2 text-xs text-amber-700">{status.mismatch}</p>}
              {status?.error && <p className="mt-2 text-xs text-slate-500">{status.error}</p>}
              <p className="mt-2 text-[11px] text-slate-500">
                UTILITY template with 8 body variables. Meta review usually takes minutes, sometimes up to 24 h; the button stays disabled on the chart until it is approved.{' '}
                <button onClick={() => setShowBody(s => !s)} className="text-emerald-700 font-semibold hover:underline">{showBody ? 'Hide' : 'Show'} body</button>
              </p>
              {showBody && (
                <pre className="mt-2 text-[11px] whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded-lg p-2 text-slate-600">{MOVEMENT_BRIEF_BODY}</pre>
              )}
            </div>

            {/* Default recipients */}
            <Row icon={<Users className="w-4 h-4" />} title="Ticked by default" hint="Who is pre-selected when the dialog opens. The desk can still tick or untick anyone.">
              <div className="flex flex-wrap justify-end gap-1.5 max-w-[320px]">
                {ROLES.map(({ key, icon: Icon }) => {
                  const on = draft.defaultRoles[key]
                  return (
                    <button key={key} type="button"
                      onClick={() => set('defaultRoles', { ...draft.defaultRoles, [key]: !on })}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}>
                      <Icon className="w-3 h-3" />{MOVEMENT_ROLE_LABEL[key]}
                    </button>
                  )
                })}
              </div>
            </Row>

            <Row icon={<Phone className="w-4 h-4" />} title="Share crew contacts" hint="Driver sees the guide's number, guide sees the driver's, vendor sees both. Rates are never shared.">
              <Toggle on={draft.shareCrewContacts} onChange={v => set('shareCrewContacts', v)} />
            </Row>
            <Row icon={<Users className="w-4 h-4" />} title="Share guest contact number" hint="Adds the guest's WhatsApp/phone to the Guests line, so the driver can reach them at pickup.">
              <Toggle on={draft.shareGuestContact} onChange={v => set('shareGuestContact', v)} />
            </Row>
            <Row icon={<FileText className="w-4 h-4" />} title="Send full details when shortened" hint="A template caps at 1024 characters. If the details are cut and the recipient's chat is open (last 24 h), the full text follows.">
              <Toggle on={draft.fullDetailFollowUp} onChange={v => set('fullDetailFollowUp', v)} />
            </Row>
            <Row icon={<Clock className="w-4 h-4" />} title="Duplicate guard" hint="Re-sending the identical message to the same number within this window asks for confirmation.">
              <div className="flex gap-1">
                {GUARD_PRESETS.map(p => (
                  <button key={p} type="button" onClick={() => set('duplicateGuardMin', p)}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold ${draft.duplicateGuardMin === p ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {p === 0 ? 'Off' : p < 60 ? `${p}m` : `${p / 60}h`}
                  </button>
                ))}
              </div>
            </Row>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" disabled={isDefault} onClick={() => setDraft(DEFAULT_MOVEMENT_WA_CONFIG)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Defaults
              </button>
              <button type="button" disabled={!dirty || saving === MOVEMENT_WA_CONFIG_KEY}
                onClick={() => onSave(MOVEMENT_WA_CONFIG_KEY, JSON.stringify(draft))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40">
                {saving === MOVEMENT_WA_CONFIG_KEY ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          </div>

          {/* Live preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p>
              <div className="flex gap-1">
                {ROLES.map(({ key, icon: Icon }) => (
                  <button key={key} onClick={() => setPreviewRole(key)} title={MOVEMENT_ROLE_LABEL[key]}
                    className={`w-7 h-7 rounded-md flex items-center justify-center ${previewRole === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-[#e5ddd5] p-3">
              <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-3 py-2 text-[12px] leading-snug text-slate-800 whitespace-pre-wrap max-h-[440px] overflow-y-auto">
                {preview.text.replace(/\*([^*\n]+)\*/g, '$1')}
                <p className="mt-2 text-[10.5px] text-slate-400">AppleHolidays Operations</p>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{preview.text.length}/1024 characters · sample movement</p>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
