'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Mail, RefreshCw, Zap, CheckCircle, AlertCircle, Loader2,
  ExternalLink, Clock, Paperclip, Eye,
  ChevronUp, FolderOpen, WifiOff, Wifi,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProcessedEmail } from '@/lib/mail-processor'

interface SubStatus { active: boolean; id: string | null; expiry: string | null }

interface ProcessResult {
  bookingRef: string
  bookingId: string
  isNew: boolean
  pnlLines: number
  agendaItems: number
  status: string
}

const TYPE_COLOR = { TOUR_CONFIRMATION: 'blue', PNL: 'green', UNKNOWN: 'gray' } as const
const TYPE_LABEL = { TOUR_CONFIRMATION: 'Tour Confirmation', PNL: 'P&L', UNKNOWN: 'Unknown' }

export default function MailInboxPage() {
  const router  = useRouter()
  const [emails, setEmails]           = useState<ProcessedEmail[]>([])
  const [fetching, setFetching]       = useState(false)
  const [processing, setProcessing]   = useState<number | null>(null)
  const [processingAll, setProcessingAll] = useState(false)
  const [results, setResults]         = useState<Map<number, { success: boolean; data?: ProcessResult; error?: string }>>(new Map())
  const [expandedUid, setExpandedUid] = useState<number | null>(null)
  const [limit,  setLimit]            = useState(50)
  const [folder, setFolder]           = useState<'all' | 'inbox'>('all')
  const [subStatus, setSubStatus] = useState<SubStatus | null>(null)

  useEffect(() => {
    fetch('/api/mail/subscribe')
      .then(r => r.json())
      .then(j => { if (j.success) setSubStatus(j.data) })
      .catch(() => {})
  }, [])

  async function fetchEmails() {
    setFetching(true)
    setEmails([])
    setResults(new Map())
    try {
      const res  = await fetch(`/api/mail/fetch?limit=${limit}&folder=${folder}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setEmails(json.data)
      toast.success(`Loaded ${json.data.length} emails`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setFetching(false)
    }
  }

  async function processEmail(email: ProcessedEmail) {
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
      toast.success(json.message)
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
    for (const email of eligible) await processEmail(email)
    setProcessingAll(false)
    toast.success('All emails processed')
  }

  const unread = emails.filter(e => !e.isRead).length

  return (
    <div>
      <Header
        title="Mail Inbox"
        subtitle={`confirm.booking@aahaas.com — ${emails.length} emails${unread > 0 ? ` · ${unread} unread` : ''}`}
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            {/* Folder selector */}
            <select
              value={folder}
              onChange={e => setFolder(e.target.value as 'all' | 'inbox')}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700"
            >
              <option value="all">All Folders</option>
              <option value="inbox">Inbox Only</option>
            </select>
            {/* Limit selector */}
            <select
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700"
            >
              <option value={20}>20 emails</option>
              <option value={50}>50 emails</option>
              <option value={100}>100 emails</option>
              <option value={200}>200 emails</option>
              <option value={500}>500 emails</option>
            </select>
            {emails.length > 0 && (
              <Button
                variant="secondary" size="sm" loading={processingAll}
                icon={<Zap className="w-4 h-4" />} onClick={processAll}
              >
                Process All
              </Button>
            )}
            <Button
              size="sm" loading={fetching}
              icon={<RefreshCw className="w-4 h-4" />} onClick={fetchEmails}
            >
              {fetching ? 'Loading…' : 'Load Emails'}
            </Button>
          </div>
        }
      />

      <div className="p-6 max-w-5xl space-y-3">

        {/* Auto-process webhook status */}
        <Card className={`p-4 border ${subStatus?.active ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {subStatus?.active
                ? <Wifi className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                : <WifiOff className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              }
              <div>
                <p className={`text-sm font-semibold ${subStatus?.active ? 'text-green-800' : 'text-amber-800'}`}>
                  {subStatus?.active ? 'Auto-Process Active' : 'Auto-Process Not Enabled'}
                </p>
                <p className={`text-xs mt-0.5 ${subStatus?.active ? 'text-green-600' : 'text-amber-600'}`}>
                  {subStatus?.active
                    ? `New emails are processed automatically as they arrive. Webhook expires ${subStatus.expiry ? new Date(subStatus.expiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`
                    : 'Enable webhook to automatically create bookings when emails arrive — no manual processing needed.'
                  }
                </p>
              </div>
            </div>
            {!subStatus?.active && (
              <span className="text-xs text-amber-600 font-medium">Auto-activates on deploy</span>
            )}
          </div>
        </Card>

        {/* Info */}
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Microsoft Graph — Full Mail Access</p>
              <p className="text-xs text-blue-600 mt-1">
                Reads all folders including Inbox, Sent, Focused, and sub-folders.
                Tour Confirmation and P&amp;L emails are auto-detected. Click an email to preview the full body before processing.
              </p>
            </div>
          </div>
        </Card>

        {/* Stats bar */}
        {emails.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total',             value: emails.length,                                      color: 'text-slate-700' },
              { label: 'Tour Confirmations', value: emails.filter(e => e.type === 'TOUR_CONFIRMATION').length, color: 'text-blue-600' },
              { label: 'P&L',               value: emails.filter(e => e.type === 'PNL').length,         color: 'text-green-600' },
              { label: 'Processed',          value: Array.from(results.values()).filter(r => r.success).length, color: 'text-brand-600' },
            ].map(s => (
              <Card key={s.label} className="p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!fetching && emails.length === 0 && (
          <Card className="p-12 text-center">
            <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No emails loaded</p>
            <p className="text-slate-400 text-sm mt-1">Select folder and limit, then click "Load Emails"</p>
          </Card>
        )}

        {/* Email list */}
        {emails.map(email => {
          const result      = results.get(email.uid)
          const isProcessing = processing === email.uid
          const isExpanded  = expandedUid === email.uid

          return (
            <Card
              key={email.uid}
              className={`overflow-hidden transition-all ${
                result?.success ? 'border-green-200' :
                result?.error   ? 'border-red-200' :
                !email.isRead   ? 'border-brand-200 bg-brand-50/30' : ''
              }`}
            >
              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <Badge color={TYPE_COLOR[email.type]}>{TYPE_LABEL[email.type]}</Badge>
                      {email.folder && (
                        <Badge color="gray">
                          <FolderOpen className="w-3 h-3 mr-1" />{email.folder}
                        </Badge>
                      )}
                      {!email.isRead && <Badge color="indigo">Unread</Badge>}
                      {email.hasAttachments && (
                        <Badge color="amber"><Paperclip className="w-3 h-3 mr-1" />Attachment</Badge>
                      )}
                      {email.importance === 'high' && <Badge color="red">High Priority</Badge>}
                      {result?.success && <Badge color="green"><CheckCircle className="w-3 h-3 mr-1" />Processed</Badge>}
                      {result?.error   && <Badge color="red"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>}
                    </div>

                    <p className={`text-sm truncate ${!email.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {email.subject || '(no subject)'}
                    </p>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                      <span className="font-medium text-slate-600">{email.fromName || email.from}</span>
                      {email.fromName && <span>{email.from}</span>}
                      {email.to.length > 0 && <span>→ {email.to.slice(0, 2).join(', ')}{email.to.length > 2 ? ` +${email.to.length - 2}` : ''}</span>}
                      <span className="flex items-center gap-1 ml-auto">
                        <Clock className="w-3 h-3" />
                        {new Date(email.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setExpandedUid(isExpanded ? null : email.uid)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title={isExpanded ? 'Collapse' : 'Preview body'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    {result?.success && result.data && (
                      <Button
                        size="sm" variant="secondary"
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                        onClick={() => router.push(`/dashboard/bookings/${result.data!.bookingRef}`)}
                      >
                        {result.data.bookingRef}
                      </Button>
                    )}
                    {!result && email.type !== 'UNKNOWN' && (
                      <Button
                        size="sm" loading={isProcessing}
                        icon={isProcessing ? undefined : <Zap className="w-3.5 h-3.5" />}
                        onClick={() => processEmail(email)}
                        disabled={processingAll}
                      >
                        {isProcessing ? 'Processing…' : 'Process'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded body preview */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    {email.cc.length > 0 && (
                      <p className="text-xs text-slate-400 mb-2">CC: {email.cc.join(', ')}</p>
                    )}
                    <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-100">
                      {email.rawBody || '(empty body)'}
                    </pre>
                  </div>
                )}

                {/* Process result */}
                {result?.success && result.data && (
                  <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-4 gap-3">
                    {[
                      { label: 'Booking Ref', value: result.data.bookingRef },
                      { label: 'Status',       value: result.data.isNew ? 'New booking' : 'Updated' },
                      { label: 'P&L Lines',    value: String(result.data.pnlLines) },
                      { label: 'Chart Items',  value: String(result.data.agendaItems) },
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
              </div>
            </Card>
          )
        })}

        {fetching && (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            <span className="text-sm text-slate-500">Connecting to Microsoft Graph…</span>
          </div>
        )}
      </div>
    </div>
  )
}
