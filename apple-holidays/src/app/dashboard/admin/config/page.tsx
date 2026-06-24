'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Settings, FlaskConical, Users, Loader2, Mail, MessageCircle, ShieldAlert, HardDrive, Zap, Power, Lock, Eye, EyeOff, BrainCircuit, FileSearch, Tags, FolderSync, TrendingUp, Bot, BarChart3, Database, RefreshCw, CheckCircle2 } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import AiUsageMonitor from '@/components/settings/ai-usage-monitor'

const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'
const DEFAULT_TEST_WHATSAPP = '94778231121'

interface Settings {
  use_test_data?: string
  test_email_1?: string
  test_email_2?: string
  test_whatsapp?: string
  less_credit_mode?: string
  auto_mail_enabled?: string
  auto_onedrive_enabled?: string
  // AI Token Controls
  ai_auto_agenda_generate?: string
  ai_pnl_auto_extract?: string
  ai_pnl_auto_classify?: string
  onedrive_new_files_only?: string
}

function AIToggleRow({
  icon, label, description, tokenNote, enabled, saving, locked, color, invertColor, onToggle,
}: {
  icon: React.ReactNode
  label: string
  description: string
  tokenNote: string
  enabled: boolean
  saving: boolean
  locked: boolean
  color: 'purple' | 'blue' | 'indigo' | 'teal'
  invertColor?: boolean
  onToggle: () => void
}) {
  const colorMap = {
    purple: { on: 'bg-purple-500', off: 'bg-slate-300', badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: 'text-purple-500' },
    blue:   { on: 'bg-blue-500',   off: 'bg-slate-300', badge: 'bg-blue-100 text-blue-700 border-blue-200',     icon: 'text-blue-500'   },
    indigo: { on: 'bg-indigo-500', off: 'bg-slate-300', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: 'text-indigo-500' },
    teal:   { on: 'bg-teal-500',   off: 'bg-slate-300', badge: 'bg-teal-100 text-teal-700 border-teal-200',     icon: 'text-teal-500'   },
  }
  const c = colorMap[color]
  // For "New Files Only" toggle, ON means saving, so color shows green when enabled
  const isActive = invertColor ? enabled : enabled
  const bgColor  = isActive ? c.on : c.off

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 flex-1">
        <div className={`mt-0.5 flex-shrink-0 ${c.icon}`}>{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{label}</p>
            {!enabled && (
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${c.badge}`}>
                {invertColor ? 'Active — saving tokens' : 'OFF — saving tokens'}
              </span>
            )}
            {enabled && !invertColor && (
              <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                AI Active
              </span>
            )}
            {!enabled && invertColor && (
              <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                Sync All
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
          <p className="text-xs text-emerald-600 font-medium mt-1">💡 {tokenNote}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={saving || locked}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400 disabled:opacity-40 disabled:cursor-not-allowed ${bgColor}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
        {saving && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-3 h-3 animate-spin text-white" />
          </span>
        )}
      </button>
    </div>
  )
}

export default function ConfigPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [criticalPassword, setCriticalPassword] = useState('')
  const [showCriticalPassword, setShowCriticalPassword] = useState(false)

  const [extPnlSyncing, setExtPnlSyncing] = useState(false)
  const [extPnlResult, setExtPnlResult]   = useState<{ total: number; linked: number; refreshed: number; skipped: number; errors: number } | null>(null)

  async function syncAllExtPnl() {
    setExtPnlSyncing(true)
    setExtPnlResult(null)
    try {
      const res  = await fetch('/api/admin/ext-pnl/sync-all', { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setExtPnlResult(json.data)
      toast.success(`Accounts PNL sync complete — ${json.data.linked} new links, ${json.data.refreshed} refreshed`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setExtPnlSyncing(false)
    }
  }

  useEffect(() => {
    if (status === 'loading') return
    if (!session || !['SUPER_ADMIN','ULTRA_SUPER_ADMIN'].includes(session.user.role)) router.replace('/dashboard')
  }, [session, status, router])

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(json => {
        if (json.success) setSettings(json.data ?? {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function saveSetting(key: string, value: string, password?: string) {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, password }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSettings(prev => ({ ...prev, [key]: value }))
      toast.success('Setting saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(null)
    }
  }

  async function saveProtectedSetting(key: string, value: string) {
    if (!criticalPassword.trim()) {
      toast.error('Enter the critical services password first')
      return
    }
    await saveSetting(key, value, criticalPassword)
  }

  const useTestData       = settings.use_test_data === 'true'
  const testEmail1        = settings.test_email_1  ?? DEFAULT_TEST_EMAIL_1
  const testEmail2        = settings.test_email_2  ?? DEFAULT_TEST_EMAIL_2
  const testWa            = settings.test_whatsapp ?? DEFAULT_TEST_WHATSAPP
  // Default ON — only false when explicitly set to 'false'
  const autoMailEnabled       = settings.auto_mail_enabled     !== 'false'
  const autoOnedriveEnabled   = settings.auto_onedrive_enabled !== 'false'
  // AI Token Control settings — default ON, except onedrive_new_files_only (default OFF)
  const aiAgendaEnabled     = settings.ai_auto_agenda_generate !== 'false'
  const aiPnlExtractEnabled = settings.ai_pnl_auto_extract     !== 'false'
  const aiPnlClassifyEnabled= settings.ai_pnl_auto_classify    !== 'false'
  const onedriveNewOnly     = settings.onedrive_new_files_only === 'true'

  // Token savings estimate (tokens/month, rough)
  const savedTokens =
    (!aiAgendaEnabled     ? 4_500_000 : 0) +
    (!aiPnlExtractEnabled ? 918_750   : 0) +
    (!aiPnlClassifyEnabled? 552_500   : 0) +
    (onedriveNewOnly      ? 2_000_000 : 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <Header title="Settings" subtitle="System configuration" />

      <div className="p-8 space-y-6 max-w-3xl">

        {/* Data Mode Toggle */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" /> Mail &amp; WhatsApp Mode
            </h3>
          </CardHeader>
          <CardBody className="p-5 space-y-5">

            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3">
                {useTestData
                  ? <FlaskConical className="w-5 h-5 text-amber-500" />
                  : <Users className="w-5 h-5 text-green-500" />
                }
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {useTestData ? 'Test Data Mode' : 'Real Customer Data Mode'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {useTestData
                      ? 'Emails & WhatsApp go to test addresses only — real customers are not contacted.'
                      : 'Emails & WhatsApp go directly to the real customer and agent addresses.'}
                  </p>
                </div>
              </div>
              <button
                disabled={saving === 'use_test_data'}
                onClick={() => saveSetting('use_test_data', useTestData ? 'false' : 'true')}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                  useTestData ? 'bg-amber-500' : 'bg-green-500'
                }`}
              >
                {saving === 'use_test_data' && (
                  <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                )}
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    useTestData ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {useTestData && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                  Test Addresses (active)
                </p>

                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    {[
                      { label: 'Test Email 1', key: 'test_email_1', value: testEmail1 },
                      { label: 'Test Email 2', key: 'test_email_2', value: testEmail2 },
                    ].map(item => (
                      <div key={item.key} className="flex items-center gap-2">
                        <span className="text-xs text-amber-600 w-24 flex-shrink-0">{item.label}</span>
                        <input
                          type="email"
                          defaultValue={item.value}
                          onBlur={e => {
                            if (e.target.value !== item.value) {
                              saveSetting(item.key, e.target.value)
                            }
                          }}
                          className="flex-1 px-2 py-1 text-xs border border-amber-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <MessageCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-amber-600 w-24 flex-shrink-0">Test WhatsApp</span>
                    <input
                      type="text"
                      defaultValue={testWa}
                      onBlur={e => {
                        if (e.target.value !== testWa) {
                          saveSetting('test_whatsapp', e.target.value)
                        }
                      }}
                      className="flex-1 px-2 py-1 text-xs border border-amber-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                </div>
              </div>
            )}

            {!useTestData && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-xs text-green-700">
                  <strong>Live mode:</strong> All mail &amp; WhatsApp messages will be delivered to the actual customer and agent contact details extracted from each booking.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Automation Settings ── */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-brand-500" /> Automation Settings
            </h3>
          </CardHeader>
          <CardBody className="p-5 space-y-4">

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Critical Services Password
              </p>
              <div className="relative">
                <input
                  type={showCriticalPassword ? 'text' : 'password'}
                  value={criticalPassword}
                  onChange={e => setCriticalPassword(e.target.value)}
                  placeholder="Enter password to change automation settings"
                  className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-colors bg-white"
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
              <p className="text-xs text-amber-700/80">
                Use the same password from <code className="font-mono">CRITICAL_SERVICES_PASSWORD</code> to change automation toggles.
              </p>
            </div>

            {/* Auto Mail */}
            <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${autoMailEnabled ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${autoMailEnabled ? 'bg-green-100' : 'bg-slate-100'}`}>
                  <Mail className={`w-4 h-4 ${autoMailEnabled ? 'text-green-600' : 'text-slate-400'}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Auto Mail Processing</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {autoMailEnabled
                      ? 'System is automatically reading inbox emails and creating bookings every 5 min.'
                      : 'Mail processing is paused — emails will not be read or processed.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-semibold ${autoMailEnabled ? 'text-green-600' : 'text-slate-400'}`}>
                  {autoMailEnabled ? 'ON' : 'OFF'}
                </span>
                <button
                  disabled={saving === 'auto_mail_enabled' || !criticalPassword.trim()}
                  onClick={() => saveProtectedSetting('auto_mail_enabled', autoMailEnabled ? 'false' : 'true')}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${autoMailEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  {saving === 'auto_mail_enabled' && (
                    <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                  )}
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${autoMailEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {/* Auto OneDrive */}
            <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${autoOnedriveEnabled ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${autoOnedriveEnabled ? 'bg-blue-100' : 'bg-slate-100'}`}>
                  <HardDrive className={`w-4 h-4 ${autoOnedriveEnabled ? 'text-blue-600' : 'text-slate-400'}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Auto OneDrive Poll &amp; Processing</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {autoOnedriveEnabled
                      ? 'Auto-poll is ACTIVE — OneDrive is scanned every 10 min and new TC/PNL files auto-create bookings.'
                      : 'Auto-poll is PAUSED — OneDrive will not be scanned automatically. Manual sync still works.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-semibold ${autoOnedriveEnabled ? 'text-blue-600' : 'text-slate-400'}`}>
                  {autoOnedriveEnabled ? 'ON' : 'OFF'}
                </span>
                <button
                  disabled={saving === 'auto_onedrive_enabled' || !criticalPassword.trim()}
                  onClick={() => saveProtectedSetting('auto_onedrive_enabled', autoOnedriveEnabled ? 'false' : 'true')}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${autoOnedriveEnabled ? 'bg-blue-500' : 'bg-slate-300'}`}
                >
                  {saving === 'auto_onedrive_enabled' && (
                    <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                  )}
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${autoOnedriveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-slate-400 pt-1">
              <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <p>Turning off automation does not affect manual scans or the admin OneDrive monitor page — only the automatic scheduled processing is paused.</p>
            </div>

          </CardBody>
        </Card>

        {/* ── AI Token Controls ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-500" /> AI Token Controls
              </h3>
              {savedTokens > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  <TrendingUp className="w-3 h-3" />
                  ~{(savedTokens / 1_000_000).toFixed(1)}M tokens/mo saved
                </span>
              )}
            </div>
          </CardHeader>
          <CardBody className="p-5 space-y-4">

            <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3 text-xs text-purple-700 flex items-start gap-2">
              <BrainCircuit className="w-4 h-4 flex-shrink-0 mt-0.5 text-purple-500" />
              <span>
                These toggles control which automatic AI (GPT-4o) calls run in the background.
                Turning off a setting <strong>does not break anything</strong> — it just skips that AI step to save costs.
              </span>
            </div>

            {/* Inline password field so saves work without scrolling */}
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="relative flex-1">
                <input
                  type={showCriticalPassword ? 'text' : 'password'}
                  placeholder="Critical services password required to change these"
                  value={criticalPassword}
                  onChange={e => setCriticalPassword(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 pr-8"
                />
                <button
                  onClick={() => setShowCriticalPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCriticalPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              {criticalPassword.trim() && (
                <span className="text-xs text-emerald-600 font-medium flex-shrink-0">Unlocked</span>
              )}
            </div>

            {/* AI Auto Agenda Generate */}
            <AIToggleRow
              icon={<BrainCircuit className="w-4 h-4" />}
              label="Auto-Generate Agenda"
              description={aiAgendaEnabled
                ? 'GPT-4o generates a full movement chart for every new booking from email — ~7,500 tokens per email.'
                : 'Agenda generation is OFF — only a skeleton agenda is created. Manually generate from the booking page.'}
              tokenNote="~7,500 tokens saved per TC email"
              enabled={aiAgendaEnabled}
              saving={saving === 'ai_auto_agenda_generate'}
              locked={!criticalPassword.trim()}
              color="purple"
              onToggle={() => saveProtectedSetting('ai_auto_agenda_generate', aiAgendaEnabled ? 'false' : 'true')}
            />

            {/* AI PNL Extraction */}
            <AIToggleRow
              icon={<FileSearch className="w-4 h-4" />}
              label="PNL from Mails &amp; Files"
              description={aiPnlExtractEnabled
                ? 'PNL is read automatically from incoming emails and OneDrive files (PDF/Word/Excel). Turn OFF to use only Account DB PNL.'
                : 'PNL extraction from emails and OneDrive files is OFF — only Account DB PNL is used (no AI cost for PNL).'}
              tokenNote="Stops all automatic PNL from mails and OneDrive — use Account DB instead"
              enabled={aiPnlExtractEnabled}
              saving={saving === 'ai_pnl_auto_extract'}
              locked={!criticalPassword.trim()}
              color="blue"
              onToggle={() => saveProtectedSetting('ai_pnl_auto_extract', aiPnlExtractEnabled ? 'false' : 'true')}
            />

            {/* AI PNL Classify */}
            <AIToggleRow
              icon={<Tags className="w-4 h-4" />}
              label="AI PNL Category Classify"
              description={aiPnlClassifyEnabled
                ? 'GPT-4o-mini classifies each PNL line into a category (Hotel, Transport, etc.) — ~650 tokens per booking.'
                : 'AI classification is OFF — keyword-based fallback is used instead (free, slightly less accurate).'}
              tokenNote="~650 tokens saved per PNL classification"
              enabled={aiPnlClassifyEnabled}
              saving={saving === 'ai_pnl_auto_classify'}
              locked={!criticalPassword.trim()}
              color="indigo"
              onToggle={() => saveProtectedSetting('ai_pnl_auto_classify', aiPnlClassifyEnabled ? 'false' : 'true')}
            />

            {/* OneDrive New Files Only */}
            <AIToggleRow
              icon={<FolderSync className="w-4 h-4" />}
              label="OneDrive: New Files Only"
              description={onedriveNewOnly
                ? 'Only newly created/updated files are processed — folders already fully processed are skipped. Saves tokens and time on each sync.'
                : 'Every sync re-checks all folders, including ones already processed. Useful for re-processing but costs more tokens.'}
              tokenNote="~2M+ tokens saved per month by skipping re-processed folders"
              enabled={onedriveNewOnly}
              saving={saving === 'onedrive_new_files_only'}
              locked={!criticalPassword.trim()}
              color="teal"
              onToggle={() => saveProtectedSetting('onedrive_new_files_only', onedriveNewOnly ? 'false' : 'true')}
              invertColor
            />

            <div className="flex items-start gap-2 text-xs text-slate-400 pt-1 border-t border-slate-100">
              <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <p>
                Manual processing (e.g., &quot;Process File&quot; button in Drive Bookings, or manual agenda generation) is always available regardless of these settings.
                These only affect <strong>automatic background processing</strong>.
              </p>
            </div>

          </CardBody>
        </Card>

        <Card className="border-2 border-red-200 bg-red-50/30">
          <CardHeader>
            <h3 className="text-sm font-semibold text-red-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" /> Danger Zone Notice
            </h3>
          </CardHeader>
          <CardBody className="p-5">
            <p className="text-sm text-red-800">
              Risky switches like Test Data Mode and Less Credit Mode are now protected in the
              <strong> Danger Zone</strong> page. Open the danger area to change them with the critical password.
            </p>
          </CardBody>
        </Card>

        {/* Reference info */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-slate-400" /> How Test Mode Works
            </h3>
          </CardHeader>
          <CardBody className="p-5">
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex gap-2"><Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>Send Email:</strong> Redirects To &amp; CC to test email addresses — the booking confirmation PDF is still generated from real booking data.</span></li>
              <li className="flex gap-2"><MessageCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>WhatsApp:</strong> Pre-fills the number with the test WhatsApp number instead of the customer&apos;s number.</span></li>
              <li className="flex gap-2"><Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>Real mode:</strong> Uses the actual agent email, contact email, and customer WhatsApp extracted from each booking.</span></li>
            </ul>
          </CardBody>
        </Card>

        {/* ── OpenAI Usage Monitor ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-500" /> OpenAI Token Usage
              </h3>
              <span className="text-xs text-slate-400">Live statistics from the database</span>
            </div>
          </CardHeader>
          <CardBody className="p-5">
            <AiUsageMonitor />
          </CardBody>
        </Card>

        {/* Accounts PNL Sync */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500" /> Accounts PNL Database Sync
            </h3>
          </CardHeader>
          <CardBody className="p-5 space-y-4">
            <p className="text-sm text-slate-600">
              Scans all bookings and attempts to auto-link each one to a matching record in the Accounts
              team&apos;s <code className="bg-slate-100 px-1 rounded text-xs">invoice_processor</code> database.
              Matching is tried in order: IS Number → Tour Ref → Invoice Number. Already-linked bookings
              get their cached snapshot refreshed.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={syncAllExtPnl}
                disabled={extPnlSyncing}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {extPnlSyncing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing all bookings…</>
                  : <><RefreshCw className="w-4 h-4" /> Sync All Bookings with Accounts PNL</>}
              </button>
            </div>

            {extPnlResult && (
              <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-800 space-y-0.5">
                  <p className="font-semibold">Sync complete — {extPnlResult.total} bookings processed</p>
                  <p>
                    <span className="font-medium">{extPnlResult.linked}</span> newly linked ·{' '}
                    <span className="font-medium">{extPnlResult.refreshed}</span> refreshed ·{' '}
                    <span className="font-medium">{extPnlResult.skipped}</span> no match ·{' '}
                    <span className={extPnlResult.errors > 0 ? 'text-red-700 font-semibold' : ''}>
                      {extPnlResult.errors} errors
                    </span>
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

      </div>
    </div>
  )
}
