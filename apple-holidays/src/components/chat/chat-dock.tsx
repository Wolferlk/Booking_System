'use client'

/**
 * The minimizable chat dock.
 *
 * Mounted in the dashboard shell, so it is present on every screen of the
 * product: a conversation opened on the driver-allocation board stays open while
 * you walk over to the tickets page. Which boxes are open is stored per user
 * (chat_settings.dock_state), so it survives a reload and follows you between
 * machines.
 *
 * A minimized box becomes a bubble that nudges when something lands in it. An
 * idle launcher is completely still — the halo only runs when there is unread,
 * so the animation actually means something.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, MessagesSquare, Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from './chat-store'
import { ConversationAvatar, UnreadBadge, shortTime } from './bits'
import { ChatThread } from './chat-thread'
import { NewChatModal } from './new-chat-modal'
import type { ChatConversation } from './types'

export function ChatDock() {
  const router = useRouter()
  const { ready, conversations, byId, totalUnread, dock, openInDock, minimizeInDock, expandInDock, closeInDock, toasts, dismissToast } = useChat()
  const [panelOpen, setPanelOpen] = useState(false)
  const [newChat, setNewChat] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement | null>(null)

  // Close the quick panel on an outside click.
  useEffect(() => {
    if (!panelOpen) return
    const onClick = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      if (launcherRef.current?.contains(e.target as Node)) return
      setPanelOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [panelOpen])

  if (!ready) return null

  const open = (id: number) => { openInDock(id); setPanelOpen(false) }

  return (
    <>
      {/* toasts */}
      <div className="pointer-events-none fixed bottom-24 right-5 z-[105] flex flex-col items-end gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, x: 28, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 28 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              onClick={() => { t.onClick?.(); dismissToast(t.id) }}
              className={cn(
                'pointer-events-auto max-w-[340px] rounded-2xl px-4 py-3 text-left text-[.8rem] font-semibold text-white shadow-2xl',
                t.tone === 'bad' ? 'bg-rose-800' : 'bg-gradient-to-br from-slate-900 to-teal-900',
              )}
            >
              {t.message}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex items-end gap-3">
        {/* ---- open boxes and minimized bubbles ---- */}
        <AnimatePresence mode="popLayout">
          {dock.map(entry => {
            const conversation = byId.get(entry.id)
            if (!conversation) return null

            return entry.minimized ? (
              <MinimizedBubble
                key={`min-${entry.id}`}
                conversation={conversation}
                onExpand={() => expandInDock(entry.id)}
                onClose={() => closeInDock(entry.id)}
              />
            ) : (
              <motion.div
                key={`box-${entry.id}`}
                layout
                initial={{ opacity: 0, y: 28, scale: 0.86 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 330, damping: 28 }}
                style={{ transformOrigin: 'bottom right' }}
                className="pointer-events-auto flex h-[476px] max-h-[calc(100vh-40px)] w-[348px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              >
                <ChatThread
                  conversationId={entry.id}
                  compact
                  onMinimize={() => minimizeInDock(entry.id)}
                  onClose={() => closeInDock(entry.id)}
                  onPopOut={() => router.push(`/dashboard/chat?c=${entry.id}`)}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>

        {/* ---- quick panel ---- */}
        <AnimatePresence>
          {panelOpen && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              style={{ transformOrigin: 'bottom right' }}
              className="pointer-events-auto flex max-h-[460px] w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            >
              <header className="flex items-center gap-2.5 bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-700 px-3.5 py-3 text-white">
                <MessagesSquare className="h-4 w-4" />
                <div>
                  <div className="text-[.82rem] font-extrabold">Chat</div>
                  <div className="text-[.6rem] font-semibold text-indigo-200">Accounts + Operations</div>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-2">
                {conversations.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <MessagesSquare className="mx-auto mb-2 h-7 w-7 opacity-40" />
                    <p className="text-sm">No conversations yet.</p>
                  </div>
                ) : conversations.slice(0, 24).map(c => (
                  <ConversationRow key={c.id} conversation={c} onClick={() => open(c.id)} />
                ))}
              </div>

              <div className="flex gap-2 border-t border-slate-200 p-2.5">
                <button
                  onClick={() => { setNewChat(true); setPanelOpen(false) }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-teal-600 to-teal-700 px-3 py-2 text-[.8rem] font-bold text-white shadow-lg active:scale-95"
                >
                  <MessageSquarePlus className="h-4 w-4" /> New
                </button>
                <button
                  onClick={() => router.push('/dashboard/chat')}
                  className="grid place-items-center rounded-xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50"
                  title="Open the full page"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- launcher ---- */}
        <motion.button
          ref={launcherRef}
          whileHover={{ y: -4, scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setPanelOpen(v => !v)}
          className="pointer-events-auto relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-slate-900 to-teal-700 text-white shadow-[0_16px_34px_-12px_rgba(13,148,136,.85)]"
          title="Chat"
        >
          {/* Two offset halos, only while something is unread. */}
          {totalUnread > 0 && [0, 1.1].map(delay => (
            <motion.span
              key={delay}
              className="absolute inset-0 rounded-full border-2 border-teal-300"
              animate={{ scale: [1, 1.75], opacity: [0.85, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay }}
            />
          ))}
          <MessagesSquare className="h-5 w-5" />
          {totalUnread > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full border-2 border-white">
              <UnreadBadge count={totalUnread} />
            </span>
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {newChat && (
          <NewChatModal onClose={() => setNewChat(false)} onOpened={id => openInDock(id)} />
        )}
      </AnimatePresence>
    </>
  )
}

/* ── pieces ────────────────────────────────────────────────────────────────── */

function MinimizedBubble({
  conversation, onExpand, onClose,
}: { conversation: ChatConversation; onExpand: () => void; onClose: () => void }) {
  const [nudge, setNudge] = useState(false)
  const lastUnread = useRef(conversation.unread)

  // Nudge when something new lands while the box is collapsed.
  useEffect(() => {
    if (conversation.unread > lastUnread.current) {
      setNudge(true)
      const t = setTimeout(() => setNudge(false), 640)
      return () => clearTimeout(t)
    }
    lastUnread.current = conversation.unread
  }, [conversation.unread])

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 26, scale: 0.5 }}
      animate={nudge
        ? { opacity: 1, y: [0, -9, 0, -4, 0], rotate: [0, -7, 6, -3, 0], scale: 1 }
        : { opacity: 1, y: 0, rotate: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      whileHover={{ y: -5, scale: 1.07 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      onClick={onExpand}
      title={conversation.title}
      className="group pointer-events-auto relative h-[52px] w-[52px] flex-shrink-0 rounded-full border-[2.5px] border-white shadow-xl"
    >
      <ConversationAvatar conversation={conversation} size={48} />
      {conversation.unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-white">
          <UnreadBadge count={conversation.unread} />
        </span>
      )}
      <span
        onClick={e => { e.stopPropagation(); onClose() }}
        className="absolute -left-1.5 -top-1.5 grid h-5 w-5 scale-50 place-items-center rounded-full bg-slate-700 text-white opacity-0 transition group-hover:scale-100 group-hover:opacity-100"
      >
        <X className="h-2.5 w-2.5" />
      </span>
    </motion.button>
  )
}

export function ConversationRow({
  conversation, active, onClick,
}: { conversation: ChatConversation; active?: boolean; onClick: () => void }) {
  const { typing } = useChat()
  const typingNames = typing[conversation.id] ?? []

  const preview = typingNames.length
    ? (typingNames.length === 1 ? `${typingNames[0]} is typing…` : 'several people are typing…')
    : (conversation.last_message.preview ?? 'No messages yet')

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className={cn(
        'relative flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition',
        active ? 'bg-gradient-to-r from-teal-500/12 to-indigo-500/8' : 'hover:bg-slate-100',
      )}
    >
      {active && <span className="absolute inset-y-[14%] left-0.5 w-[3px] rounded bg-gradient-to-b from-teal-500 to-indigo-500" />}

      <ConversationAvatar conversation={conversation} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-[.84rem] text-slate-900', conversation.unread ? 'font-extrabold' : 'font-bold')}>
            {conversation.title}
          </span>
          <span className="ml-auto flex-shrink-0 text-[.62rem] font-semibold text-slate-400">
            {shortTime(conversation.last_message.at)}
          </span>
        </div>
        <div className={cn(
          'mt-0.5 truncate text-[.74rem]',
          typingNames.length ? 'font-bold text-teal-600' : conversation.unread ? 'font-semibold text-slate-700' : 'text-slate-500',
        )}>
          {preview}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <UnreadBadge count={conversation.unread} />
      </div>
    </motion.div>
  )
}
