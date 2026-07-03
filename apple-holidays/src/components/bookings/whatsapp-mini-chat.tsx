'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageCircle, X, Minus, Send, Phone, Edit2,
  Check, Loader2, ChevronDown, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

interface WaMessage {
  id: string
  direction: 'outbound' | 'inbound'
  body: string
  senderName: string | null
  status: string
  createdAt: string
}

interface Props {
  bookingRef: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any
}

type PanelState = 'closed' | 'open' | 'minimized'

const POLL_INTERVAL_OPEN = 3000  // 3 s when panel is open (real-time feel)
const POLL_INTERVAL_MIN  = 8000  // 8 s when minimized

export default function WhatsAppMiniChat({ bookingRef, booking }: Props) {
  const [panel, setPanel]             = useState<PanelState>('closed')
  const [phone, setPhone]             = useState('')
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneInput, setPhoneInput]   = useState('')
  const [message, setMessage]         = useState('')
  const [sending, setSending]         = useState(false)
  const [messages, setMessages]       = useState<WaMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [unread, setUnread]           = useState(0)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevCountRef = useRef(0)

  const resolvedPhone =
    booking?.contactWhatsapp ||
    booking?.contactPhone    ||
    booking?.agentWhatsapp   ||
    booking?.agentPhone      ||
    ''

  // ── fetch history ──────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingHistory(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/whatsapp/messages`)
      const json = await res.json()
      if (json.success) {
        const incoming: WaMessage[] = json.data
        setMessages(incoming)

        const inboundCount = incoming.filter(m => m.direction === 'inbound').length
        if (quiet) {
          const diff = inboundCount - prevCountRef.current
          if (diff > 0) {
            if (panel === 'minimized') setUnread(u => u + diff)
            else toast.info(`${diff} new message${diff > 1 ? 's' : ''} from client`, { duration: 3000 })
          }
        }
        prevCountRef.current = inboundCount
      }
    } finally {
      if (!quiet) setLoadingHistory(false)
    }
  }, [bookingRef, panel])

  // ── polling ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (panel === 'open' || panel === 'minimized') {
      fetchMessages()
      const interval = panel === 'open' ? POLL_INTERVAL_OPEN : POLL_INTERVAL_MIN
      pollRef.current = setInterval(() => fetchMessages(true), interval)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [panel, fetchMessages])

  // ── auto-scroll to bottom ──────────────────────────────────────────────
  useEffect(() => {
    if (panel === 'open') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, panel])

  // ── open panel ────────────────────────────────────────────────────────
  function open() {
    setPanel('open')
    setUnread(0)
    if (!phone) {
      setPhone(resolvedPhone)
      if (!resolvedPhone) setEditingPhone(true)
    }
  }

  // ── send ──────────────────────────────────────────────────────────────
  async function send() {
    const target = phone.trim()
    if (!target)         { toast.error('Enter a phone number'); return }
    if (!message.trim()) { toast.error('Enter a message');      return }
    setSending(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/whatsapp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        target.replace(/\D/g, ''),
          name:      (booking?.passengers ?? [])[0]?.name ?? 'Guest',
          message:   message.trim(),
          attachPdf: false,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Sent!')
      setMessage('')
      await fetchMessages()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  function confirmPhone() {
    if (phoneInput.trim()) setPhone(phoneInput.trim())
    setEditingPhone(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
    }
  }

  // ── FAB ───────────────────────────────────────────────────────────────
  const fab = (
    <button
      onClick={() => {
        if (panel === 'closed')     open()
        else if (panel === 'minimized') { setUnread(0); setPanel('open') }
        else setPanel('minimized')
      }}
      className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 shadow-xl flex items-center justify-center transition-all active:scale-95 relative"
      title="WhatsApp chat"
    >
      <MessageCircle className="w-7 h-7 text-white" />
      {(panel === 'closed' || panel === 'minimized') && unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold px-1">
          {unread}
        </span>
      )}
    </button>
  )

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">

      {/* ── Full chat panel ─────────────────────────────────────────── */}
      {panel === 'open' && (
        <div className="w-[340px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
             style={{ height: 520 }}>

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-green-600 text-white flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold leading-tight">WhatsApp</p>
                <span className="flex items-center gap-1 text-[10px] text-green-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse inline-block" />
                  Live
                </span>
              </div>
              <p className="text-[11px] text-green-100 truncate font-mono">{bookingRef}</p>
            </div>
            <button
              onClick={() => fetchMessages()}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setPanel('minimized')} className="p-1 hover:bg-white/20 rounded-lg" title="Minimize">
              <Minus className="w-4 h-4" />
            </button>
            <button onClick={() => setPanel('closed')} className="p-1 hover:bg-white/20 rounded-lg" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Phone selector */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex-shrink-0">
            {editingPhone ? (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <input
                  autoFocus
                  type="tel"
                  className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
                  placeholder="e.g. 94771234567"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmPhone()}
                />
                <button onClick={confirmPhone} className="text-green-600 hover:text-green-700 flex-shrink-0">
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="flex-1 text-xs text-slate-700 font-mono truncate">
                  {phone || <span className="text-slate-400 not-italic font-sans">No number — click edit</span>}
                </span>
                <button
                  onClick={() => { setPhoneInput(phone); setEditingPhone(true) }}
                  className="text-slate-400 hover:text-green-600 flex-shrink-0"
                  title="Change number"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Quick-pick chips */}
            {!editingPhone && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {([
                  { label: 'Client WA',  val: booking?.contactWhatsapp },
                  { label: 'Client Ph',  val: booking?.contactPhone    },
                  { label: 'Agent WA',   val: booking?.agentWhatsapp   },
                  { label: 'Agent Ph',   val: booking?.agentPhone      },
                ] as { label: string; val: string | null | undefined }[])
                  .filter(x => x.val)
                  .map(x => (
                    <button
                      key={x.label}
                      onClick={() => setPhone(x.val as string)}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                        phone === x.val
                          ? 'bg-green-100 border-green-400 text-green-700 font-semibold'
                          : 'border-slate-200 text-slate-500 hover:border-green-300 hover:text-green-700'
                      }`}
                    >
                      {x.label}: {(x.val as string).slice(-5)}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#ece5dd]">
            {loadingHistory && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
              </div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 py-8">
                <MessageCircle className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">No messages yet.</p>
                <p className="text-[11px] mt-0.5">Send the first message below.</p>
              </div>
            )}

            {messages.map((msg) => {
              const isOut = msg.direction === 'outbound'
              const time  = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const date  = new Date(msg.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })
              return (
                <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
                      isOut
                        ? 'bg-[#dcf8c6] rounded-br-sm'
                        : 'bg-white rounded-bl-sm'
                    }`}
                  >
                    {/* sender label */}
                    {msg.senderName && (
                      <p className={`text-[10px] font-semibold mb-0.5 ${isOut ? 'text-green-700' : 'text-blue-600'}`}>
                        {msg.senderName}
                      </p>
                    )}
                    {/* body */}
                    <p className="text-xs text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
                      {msg.body}
                    </p>
                    {/* timestamp */}
                    <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-green-600' : 'text-slate-400'}`}>
                      {date} {time}
                      {isOut && (
                        <span className="ml-1">
                          {msg.status === 'sent' ? '✓' : msg.status === 'failed' ? '✗' : '✓✓'}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}

            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 bg-white border-t border-slate-100 px-3 py-2 flex items-end gap-2">
            <textarea
              className="flex-1 resize-none text-xs text-slate-800 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-green-400 placeholder-slate-400 leading-relaxed"
              rows={2}
              placeholder="Type a message… (Ctrl+Enter to send)"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={send}
              disabled={sending || !phone.trim() || !message.trim()}
              className="w-9 h-9 rounded-full bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
              title="Send (Ctrl+Enter)"
            >
              {sending
                ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                : <Send className="w-4 h-4 text-white" />
              }
            </button>
          </div>

          {/* Footer note */}
          <div className="flex-shrink-0 px-3 pb-2 text-[10px] text-slate-400 text-center bg-white">
            Quick message only — use the <strong>WhatsApp</strong> button above to attach a PDF
          </div>
        </div>
      )}

      {/* ── Minimized bar ───────────────────────────────────────────── */}
      {panel === 'minimized' && (
        <div
          onClick={() => { setUnread(0); setPanel('open') }}
          className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-2xl shadow-lg cursor-pointer hover:bg-green-700 transition-colors select-none"
        >
          <MessageCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">WhatsApp — {bookingRef}</span>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {unread} new
            </span>
          )}
          <ChevronDown className="w-4 h-4 ml-1 flex-shrink-0" />
        </div>
      )}

      {fab}
    </div>
  )
}
