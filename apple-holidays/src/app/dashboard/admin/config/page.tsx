'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Settings, FlaskConical, Users, Loader2, Mail, MessageCircle, Zap } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'
const DEFAULT_TEST_WHATSAPP = '94778231121'

interface Settings {
  use_test_data?: string
  test_email_1?: string
  test_email_2?: string
  test_whatsapp?: string
  less_credit_mode?: string
}

export default function ConfigPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (!session || session.user.role !== 'SUPER_ADMIN') router.replace('/dashboard')
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

  async function saveSetting(key: string, value: string) {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
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

  const useTestData = settings.use_test_data === 'true'
  const lessCreditMode = settings.less_credit_mode === 'true'
  const testEmail1  = settings.test_email_1  ?? DEFAULT_TEST_EMAIL_1
  const testEmail2  = settings.test_email_2  ?? DEFAULT_TEST_EMAIL_2
  const testWa      = settings.test_whatsapp ?? DEFAULT_TEST_WHATSAPP

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

        {/* Less Credit Mode */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-slate-400" /> Mail Inbox Credit Saver
            </h3>
          </CardHeader>
          <CardBody className="p-5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {lessCreditMode ? 'Less Credit Mode On' : 'Less Credit Mode Off'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lessCreditMode
                    ? 'Only emails from the last 15 minutes are auto-processed. Older emails stay in the inbox with a manual Process button.'
                    : 'All new inbox emails are auto-processed as they arrive.'}
                </p>
              </div>
              <button
                disabled={saving === 'less_credit_mode'}
                onClick={() => saveSetting('less_credit_mode', lessCreditMode ? 'false' : 'true')}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                  lessCreditMode ? 'bg-amber-500' : 'bg-slate-300'
                }`}
              >
                {saving === 'less_credit_mode' && (
                  <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                )}
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    lessCreditMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
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

      </div>
    </div>
  )
}
