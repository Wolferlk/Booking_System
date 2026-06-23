'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ShieldAlert, Trash2, Loader2, Eye, EyeOff,
  AlertTriangle, Lock, CheckCircle2, FlaskConical, Users, Zap,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ─── Confirmation steps ───────────────────────────────────────────────────────

const CONFIRM_PHRASE = 'DELETE ALL'
const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'
const DEFAULT_TEST_WHATSAPP = '94778231121'

export default function DangerZonePage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Guard — redirect non-super-admins
  useEffect(() => {
    if (status === 'loading') return
    if (!session || !['SUPER_ADMIN','ULTRA_SUPER_ADMIN'].includes(session.user.role)) router.replace('/dashboard')
  }, [session, status, router])

  // ── Booking count ────────────────────────────────────────────────────────
  const [bookingCount, setBookingCount] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/bookings?limit=1')
      .then(r => r.json())
      .then(json => {
        if (json.success && typeof json.data?.total === 'number') {
          setBookingCount(json.data.total)
        }
      })
      .catch(() => {})
  }, [])

  const [settings, setSettings] = useState<Record<string, string>>({})
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [savingSetting, setSavingSetting] = useState<string | null>(null)
  const [criticalPassword, setCriticalPassword] = useState('')
  const [showCriticalPassword, setShowCriticalPassword] = useState(false)
  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(json => {
        if (json.success) setSettings(json.data ?? {})
      })
      .catch(() => {})
      .finally(() => setSettingsLoading(false))
  }, [])

  // ── Delete modal state ───────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [confirm, setConfirm]     = useState('')
  const [deleting, setDeleting]   = useState(false)
  const [done, setDone]           = useState(false)

  const canSubmit =
    password.trim().length > 0 &&
    confirm.trim() === CONFIRM_PHRASE &&
    !deleting

  function openModal() {
    setPassword('')
    setConfirm('')
    setShowPw(false)
    setDone(false)
    setShowModal(true)
  }

  async function saveProtectedSetting(key: string, value: string) {
    if (!criticalPassword.trim()) {
      toast.error('Enter the critical operations password first')
      return
    }
    setSavingSetting(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, password: criticalPassword }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to save setting')
      setSettings(prev => ({ ...prev, [key]: value }))
      toast.success('Danger setting updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update setting')
    } finally {
      setSavingSetting(null)
    }
  }

  async function handleDelete() {
    if (!canSubmit) return
    setDeleting(true)
    try {
      const res  = await fetch('/api/admin/danger/delete-all-bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Delete failed')
      setDone(true)
      setBookingCount(0)
      toast.success(json.message ?? 'All bookings deleted')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setDeleting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!session || !['SUPER_ADMIN','ULTRA_SUPER_ADMIN'].includes(session.user.role)) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="Danger Zone" subtitle="Irreversible system operations — Admin & Ultra Super Admin" />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* ── Warning banner ── */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-800 text-sm">Critical Operations Area</p>
            <p className="text-xs text-red-600 mt-0.5">
              Actions on this page are <strong>permanent and cannot be undone</strong>.
              A critical operations password is required for every action.
              All operations are logged in the audit trail.
            </p>
          </div>
        </div>

      {/* ── Protected mail settings ── */}
        <Card className="border-2 border-amber-200 overflow-hidden">
          <div className="bg-amber-500 px-5 py-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">Danger Settings</span>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-700">
              Use the same critical operations password here before switching any dangerous mail mode.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                <Lock className="w-3 h-3 inline mr-1" />
                Critical Operations Password
              </label>
              <div className="relative">
                <input
                  type={showCriticalPassword ? 'text' : 'password'}
                  value={criticalPassword}
                  onChange={e => setCriticalPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-colors"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowCriticalPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCriticalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3 min-w-0">
                  {settings.use_test_data === 'true'
                    ? <FlaskConical className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    : <Users className="w-5 h-5 text-green-500 flex-shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {settings.use_test_data === 'true' ? 'Test Data Mode On' : 'Test Data Mode Off'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Routes customer mail to test addresses only.
                    </p>
                  </div>
                </div>
                <button
                  disabled={savingSetting === 'use_test_data' || !criticalPassword.trim()}
                  onClick={() => saveProtectedSetting('use_test_data', settings.use_test_data === 'true' ? 'false' : 'true')}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                    settings.use_test_data === 'true' ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                >
                  {savingSetting === 'use_test_data' && (
                    <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                  )}
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings.use_test_data === 'true' ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3 min-w-0">
                  <Zap className={`w-5 h-5 flex-shrink-0 ${settings.less_credit_mode === 'true' ? 'text-amber-500' : 'text-slate-400'}`} />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {settings.less_credit_mode === 'true' ? 'Less Credit Mode On' : 'Less Credit Mode Off'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Only recent inbox mail is auto-processed to save credits.
                    </p>
                  </div>
                </div>
                <button
                  disabled={savingSetting === 'less_credit_mode' || !criticalPassword.trim()}
                  onClick={() => saveProtectedSetting('less_credit_mode', settings.less_credit_mode === 'true' ? 'false' : 'true')}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                    settings.less_credit_mode === 'true' ? 'bg-amber-500' : 'bg-slate-300'
                  }`}
                >
                  {savingSetting === 'less_credit_mode' && (
                    <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                  )}
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings.less_credit_mode === 'true' ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">
                Current Values
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-amber-800">
                <div className="rounded-md bg-white/70 px-3 py-2 border border-amber-100">
                  <span className="block font-semibold">Test Email 1</span>
                  <span className="font-mono">{settings.test_email_1 ?? DEFAULT_TEST_EMAIL_1}</span>
                </div>
                <div className="rounded-md bg-white/70 px-3 py-2 border border-amber-100">
                  <span className="block font-semibold">Test Email 2</span>
                  <span className="font-mono">{settings.test_email_2 ?? DEFAULT_TEST_EMAIL_2}</span>
                </div>
                <div className="rounded-md bg-white/70 px-3 py-2 border border-amber-100">
                  <span className="block font-semibold">Test WhatsApp</span>
                  <span className="font-mono">{settings.test_whatsapp ?? DEFAULT_TEST_WHATSAPP}</span>
                </div>
              </div>
            </div>

            {settingsLoading && (
              <p className="text-xs text-slate-400">Loading protected settings…</p>
            )}
          </div>
        </Card>

      {/* ── Delete all bookings card ── */}
      <Card className="border-2 border-red-200 overflow-hidden">
        <div className="bg-red-600 px-5 py-3 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">Delete All Bookings</span>
          </div>

          <div className="p-5">
            <p className="text-sm text-slate-700 leading-relaxed mb-4">
              Permanently deletes <strong>every booking</strong> in the system along with all
              associated data — passengers, flights, accommodations, P&amp;L records, agenda,
              tickets, payments, change requests, and status history.
              This action is <span className="text-red-600 font-semibold">irreversible</span>.
            </p>

            {/* Booking count */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 mb-5">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-slate-700">
                Current bookings in system:{' '}
                <strong className="text-slate-900">
                  {bookingCount === null ? '…' : bookingCount.toLocaleString()}
                </strong>
              </span>
            </div>

            <button
              onClick={openModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 active:scale-95 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Delete All Bookings
            </button>
          </div>
        </Card>

      </div>

      {/* ── Confirmation modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

            {done ? (
              /* ── Success state ── */
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">All Bookings Deleted</h3>
                <p className="text-slate-500 text-sm mb-6">
                  The database has been cleared. The action has been recorded in the audit log.
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              /* ── Confirmation form ── */
              <>
                {/* Modal header */}
                <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Confirm: Delete All Bookings</h3>
                    <p className="text-red-200 text-xs">This cannot be undone</p>
                  </div>
                </div>

                <div className="p-6 space-y-4">

                  {/* Warning */}
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <strong>Warning:</strong> You are about to permanently delete{' '}
                    <strong>{bookingCount !== null ? bookingCount.toLocaleString() : 'all'} booking{bookingCount !== 1 ? 's' : ''}</strong> and
                    all related records. This action is logged under your account.
                  </div>

                  {/* Critical password */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      <Lock className="w-3 h-3 inline mr-1" />
                      Critical Operations Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-colors"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirmation phrase */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Type <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-red-600">{CONFIRM_PHRASE}</span> to confirm
                    </label>
                    <input
                      type="text"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      className={`w-full px-3 py-2.5 text-sm rounded-lg border transition-colors focus:outline-none focus:ring-2 ${
                        confirm && confirm !== CONFIRM_PHRASE
                          ? 'border-red-300 focus:ring-red-200'
                          : confirm === CONFIRM_PHRASE
                            ? 'border-green-300 focus:ring-green-200'
                            : 'border-slate-200 focus:ring-slate-200'
                      }`}
                    />
                    {confirm && confirm !== CONFIRM_PHRASE && (
                      <p className="text-[11px] text-red-500 mt-1">
                        Must be exactly: {CONFIRM_PHRASE}
                      </p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowModal(false)}
                      disabled={deleting}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={!canSubmit}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
                    >
                      {deleting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Deleting…
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          Delete All
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
