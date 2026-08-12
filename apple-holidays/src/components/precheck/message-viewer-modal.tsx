'use client'

/**
 * WhatsApp message viewer.
 *
 * Shows either the briefing that actually went out or, for a day that has not
 * sent yet, a preview rendered from the movement as it stands right now. The
 * distinction is stated plainly at the top rather than implied — an operator
 * reading a preview and believing the driver already has it is the exact
 * failure this panel exists to prevent.
 *
 * Rendered as a WhatsApp bubble, with the platform's `*bold*` and `_italic_`
 * markers resolved, so what staff read is what the driver reads.
 */

import { useMemo } from 'react'
import { toast } from 'sonner'
import { Check, CheckCheck, Clock, Copy, MessageCircle, Send } from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface MessageViewerPayload {
  title: string
  /** The message text. */
  body: string
  /** True when this is what *will* be sent, not what was. */
  isPreview: boolean
  sentAt?: string | null
  status?: string | null
  phone?: string | null
  driverName?: string | null
  /** Why it has not sent yet — shown on previews. */
  previewNote?: string | null
}

/** Resolve WhatsApp's inline markers into real emphasis. */
function renderWhatsAppText(text: string): React.ReactNode[] {
  // Split on *bold*, _italic_ and ~strike~, keeping the delimiters.
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
  return parts.map((part, i) => {
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>
    if (/^_[^_\n]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    if (/^~[^~\n]+~$/.test(part)) return <s key={i}>{part.slice(1, -1)}</s>
    return <span key={i}>{part}</span>
  })
}

export default function MessageViewerModal({
  open, onClose, payload,
}: {
  open: boolean
  onClose: () => void
  payload: MessageViewerPayload | null
}) {
  const rendered = useMemo(
    () => (payload ? renderWhatsAppText(payload.body) : null),
    [payload],
  )
  if (!payload) return null

  const sentStamp = payload.sentAt
    ? new Date(payload.sentAt).toLocaleString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <Modal open={open} onClose={onClose} size="2xl" title={payload.title}>
      <div className="space-y-3">
        {/* Provenance — sent, or not yet */}
        <div className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs',
          payload.isPreview
            ? 'border-slate-200 bg-slate-50 text-slate-600'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800',
        )}>
          {payload.isPreview ? <Clock className="w-4 h-4 flex-shrink-0" /> : <CheckCheck className="w-4 h-4 flex-shrink-0" />}
          <span className="font-semibold">
            {payload.isPreview ? 'Preview — not sent yet' : `Delivered${sentStamp ? ` · ${sentStamp}` : ''}`}
          </span>
          {payload.isPreview && payload.previewNote && (
            <span className="text-slate-500">{payload.previewNote}</span>
          )}
          {payload.driverName && (
            <span className="ml-auto flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" />
              {payload.driverName}
              {payload.phone && <span className="font-mono opacity-70">{payload.phone}</span>}
            </span>
          )}
        </div>

        {/* The bubble */}
        <div className="rounded-xl bg-[#e8ded2] p-4">
          <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-800">
              {rendered}
            </div>
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
              {payload.isPreview ? (
                <span className="italic">not sent</span>
              ) : (
                <>
                  <span>
                    {payload.sentAt
                      ? new Date(payload.sentAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                  {payload.status === 'failed'
                    ? <span className="font-semibold text-rose-500">failed</span>
                    : payload.status === 'read'
                      ? <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
                      : <Check className="w-3.5 h-3.5" />}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => { void navigator.clipboard.writeText(payload.body); toast.success('Message copied') }}>
            Copy text
          </Button>
          {payload.phone && (
            <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5" />}
                    onClick={() => window.open(
                      `https://wa.me/${payload.phone!.replace(/[^\d]/g, '')}?text=${encodeURIComponent(payload.body)}`,
                      '_blank', 'noopener',
                    )}>
              Open in WhatsApp
            </Button>
          )}
          <span className="ml-auto text-[10px] text-slate-400">
            {payload.isPreview
              ? 'The daily briefing sends automatically on the movement date.'
              : 'Logged from the automatic daily driver briefing.'}
          </span>
        </div>
      </div>
    </Modal>
  )
}
