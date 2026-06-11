'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Mail, RefreshCw, Zap, CheckCircle, AlertCircle, Loader2, ExternalLink, Clock, FileText } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface EmailItem {
  uid: number
  subject: string
  from: string
  date: string
  type: 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN'
  rawBody: string
  parsed: null
}

interface ProcessResult {
  bookingRef: string
  bookingId: string
  isNew: boolean
  pnlLines: number
  agendaItems: number
  status: string
}

export default function MailInboxPage() {
  const router = useRouter()
  const [emails, setEmails] = useState<EmailItem[]>([])
  const [fetching, setFetching] = useState(false)
  const [processing, setProcessing] = useState<number | null>(null)
  const [results, setResults] = useState<Map<number, { success: boolean; data?: ProcessResult; error?: string }>>(new Map())
  const [autoProcess, setAutoProcess] = useState(false)
  const [processingAll, setProcessingAll] = useState(false)

  async function fetchEmails() {
    setFetching(true)
    setEmails([])
    setResults(new Map())
    try {
      const res  = await fetch('/api/mail/fetch?limit=20')
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setEmails(json.data)
      toast.success(`Loaded ${json.data.length} emails from inbox`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to mailbox')
    } finally {
      setFetching(false)
    }
  }

  async function processEmail(email: EmailItem) {
    setProcessing(email.uid)
    try {
      const res  = await fetch('/api/mail/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawBody:   email.rawBody,
          subject:   email.subject,
          emailType: email.type === 'PNL' ? 'PNL' : 'TOUR_CONFIRMATION',
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      setResults(m => new Map(m).set(email.uid, { success: true, data: json.data }))
      toast.success(`${json.message}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Processing failed'
      setResults(m => new Map(m).set(email.uid, { success: false, error: msg }))
      toast.error(msg)
    } finally {
      setProcessing(null)
    }
  }

  async function processAll() {
    const eligible = emails.filter(e => e.type !== 'UNKNOWN' && !results.has(e.uid))
    if (!eligible.length) { toast.info('No eligible emails to process'); return }

    setProcessingAll(true)
    for (const email of eligible) {
      await processEmail(email)
    }
    setProcessingAll(false)
    toast.success('All emails processed')
  }

  const typeColor = (t: string) =>
    t === 'TOUR_CONFIRMATION' ? 'blue' : t === 'PNL' ? 'green' : ('gray' as const)

  const typeLabel = (t: string) =>
    t === 'TOUR_CONFIRMATION' ? 'Tour Confirmation' : t === 'PNL' ? 'P&L' : 'Unknown'

  return (
    <div>
      <Header
        title="Mail Inbox"
        subtitle={`confirm.booking@aahaas.com — ${emails.length} email${emails.length !== 1 ? 's' : ''} loaded`}
        actions={
          <div className="flex gap-2 items-center">
            {emails.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                loading={processingAll}
                icon={<Zap className="w-4 h-4" />}
                onClick={processAll}
              >
                Process All
              </Button>
            )}
            <Button
              size="sm"
              loading={fetching}
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={fetchEmails}
            >
              {fetching ? 'Connecting…' : 'Load Inbox'}
            </Button>
          </div>
        }
      />

      <div className="p-8 max-w-4xl space-y-4">

        {/* Info banner */}
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Automated Booking Pipeline</p>
              <p className="text-xs text-blue-600 mt-1">
                Each email is classified as <strong>Tour Confirmation</strong> or <strong>P&L</strong>.
                Processing an email automatically: extracts booking details → creates booking → generates P&L + tickets → generates movement chart → sets status to <strong>Travel Experience Review</strong>.
              </p>
            </div>
          </div>
        </Card>

        {/* Auto-process toggle */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Auto-process on load</p>
              <p className="text-xs text-slate-500 mt-0.5">Automatically start processing all eligible emails after loading inbox</p>
            </div>
            <button
              onClick={() => setAutoProcess(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoProcess ? 'bg-brand-600' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoProcess ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </Card>

        {/* Empty state */}
        {!fetching && emails.length === 0 && (
          <Card className="p-12 text-center">
            <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No emails loaded</p>
            <p className="text-slate-400 text-sm mt-1">Click "Load Inbox" to connect and fetch emails</p>
          </Card>
        )}

        {/* Email list */}
        {emails.map(email => {
          const result = results.get(email.uid)
          const isProcessing = processing === email.uid

          return (
            <Card key={email.uid} className={`overflow-hidden transition-all ${result?.success ? 'border-green-200' : result?.error ? 'border-red-200' : ''}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge color={typeColor(email.type)}>{typeLabel(email.type)}</Badge>
                      {result?.success && <Badge color="green"><CheckCircle className="w-3 h-3 mr-1" />Processed</Badge>}
                      {result?.error && <Badge color="red"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 truncate">{email.subject || '(no subject)'}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{email.from}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(email.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {result?.success && result.data && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                        onClick={() => router.push(`/dashboard/bookings/${result.data!.bookingRef}`)}
                      >
                        {result.data.bookingRef}
                      </Button>
                    )}
                    {!result && email.type !== 'UNKNOWN' && (
                      <Button
                        size="sm"
                        loading={isProcessing}
                        icon={isProcessing ? undefined : <Zap className="w-3.5 h-3.5" />}
                        onClick={() => processEmail(email)}
                        disabled={processingAll}
                      >
                        {isProcessing ? 'Processing…' : 'Process'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Result details */}
                {result?.success && result.data && (
                  <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-4 gap-3">
                    {[
                      { label: 'Booking Ref', value: result.data.bookingRef },
                      { label: 'Status', value: result.data.isNew ? 'New booking' : 'Updated existing' },
                      { label: 'P&L Lines', value: String(result.data.pnlLines) },
                      { label: 'Chart Items', value: String(result.data.agendaItems) },
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">{item.label}</p>
                        <p className="text-sm font-semibold text-slate-800">{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {result?.error && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-red-600 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {result.error}
                  </div>
                )}

                {/* Body preview */}
                {!result && (
                  <details className="mt-3">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> Preview email body
                    </summary>
                    <pre className="mt-2 text-[10px] text-slate-500 bg-slate-50 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                      {email.rawBody.slice(0, 1000)}{email.rawBody.length > 1000 ? '…' : ''}
                    </pre>
                  </details>
                )}
              </div>
            </Card>
          )
        })}

        {fetching && (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            <span className="text-sm text-slate-500">Connecting to confirm.booking@aahaas.com…</span>
          </div>
        )}
      </div>
    </div>
  )
}
