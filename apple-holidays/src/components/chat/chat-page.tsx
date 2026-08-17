'use client'

/**
 * The full chat page — conversation rail on the left, thread on the right.
 *
 * The thread pane is the very same <ChatThread> the dock's mini boxes use, in
 * its non-compact form, so nothing here can drift from what the floating box
 * does.
 *
 * Deep links: ?c=<id> opens a thread, ?with=<system>:<ref> opens (or creates)
 * the direct thread with that person — which is what a "Message" button
 * anywhere else in the product points at.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Inbox, MessageSquarePlus, MessagesSquare, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatApi, useChat } from './chat-store'
import { Aurora } from './bits'
import { ChatThread } from './chat-thread'
import { ConversationRow } from './chat-dock'
import { GroupMembersModal, NewChatModal } from './new-chat-modal'
import type { ChatConversation } from './types'

type Filter = 'all' | 'direct' | 'group' | 'unread'

export function ChatPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { ready, conversations, byId, applyConversations, toast } = useChat()

  const [activeId, setActiveId] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [term, setTerm] = useState('')
  const [newChat, setNewChat] = useState(false)
  const [members, setMembers] = useState<ChatConversation | null>(null)
  const [showThread, setShowThread] = useState(false)

  /* ---- deep links -------------------------------------------------------- */

  useEffect(() => {
    if (!ready || activeId) return

    const wanted = Number(params.get('c'))
    if (wanted && byId.has(wanted)) { open(wanted); return }

    const withWhom = params.get('with')
    if (withWhom?.includes(':')) {
      const [system, userRef] = withWhom.split(':')
      chatApi<{ conversation_id: number; conversations: ChatConversation[] }>('/conversations/direct', {
        method: 'POST', body: { system, user_ref: userRef },
      })
        .then(d => { applyConversations(d.conversations ?? []); open(d.conversation_id) })
        .catch(err => toast(err.message, 'bad'))
      return
    }

    // On a wide screen an empty right-hand pane is just a hole; open the most
    // recent thread. On a phone the list IS the page until you pick something.
    if (conversations.length && window.innerWidth > 991) open(conversations[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, conversations.length])

  const open = (id: number) => {
    setActiveId(id)
    setShowThread(true)
    // Keep the address bar in step so the view is linkable and a reload lands
    // where you were.
    window.history.replaceState({}, '', `/dashboard/chat?c=${id}`)
  }

  /* ---- filtering --------------------------------------------------------- */

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return conversations.filter(c => {
      if (filter === 'direct' && c.type !== 'direct') return false
      if (filter === 'group' && c.type !== 'group') return false
      if (filter === 'unread' && !c.unread) return false
      if (needle) {
        const haystack = `${c.title} ${c.last_message.preview ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [conversations, filter, term])

  const active = activeId ? byId.get(activeId) ?? null : null

  return (
    <div className="grid h-[calc(100vh-132px)] min-h-[520px] gap-4 p-4 sm:p-6 lg:grid-cols-[336px_1fr]">
      {/* ---- rail ---- */}
      <aside className={cn(
        'flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm',
        showThread && 'hidden lg:flex',
      )}>
        <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-teal-950 to-teal-700 px-4 pb-3.5 pt-4 text-white">
          <Aurora />
          <div className="relative z-[2] flex items-center gap-2.5">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[1.08rem] font-extrabold tracking-tight">
                <MessagesSquare className="h-5 w-5" /> Messages
              </div>
              <div className="mt-0.5 text-[.68rem] font-semibold uppercase tracking-[.06em] text-teal-200">
                Accounts · Operations
              </div>
            </div>
            <button
              onClick={() => setNewChat(true)}
              className="grid h-9 w-9 place-items-center rounded-xl transition hover:bg-white/15 active:scale-90"
              title="New conversation"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>

          <div className="relative z-[2] mt-3.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-xl border border-white/20 bg-white/15 py-2 pl-9 pr-3 text-[.82rem] text-white outline-none transition placeholder:text-slate-300 focus:border-teal-300 focus:bg-white/25"
            />
          </div>
        </header>

        <div className="flex gap-1 border-b border-slate-200 bg-slate-50/70 p-2.5">
          {(['all', 'direct', 'group', 'unread'] as const).map(key => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex-1 rounded-lg px-2 py-1.5 text-[.7rem] font-extrabold uppercase tracking-wide transition',
                filter === key
                  ? 'bg-gradient-to-br from-teal-600 to-teal-700 text-white shadow'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
              )}
            >
              {key === 'all' ? 'All' : key === 'direct' ? 'People' : key === 'group' ? 'Groups' : 'Unread'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!ready ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-14 text-center text-slate-400">
              <Inbox className="mx-auto mb-3 h-8 w-8 opacity-40" />
              <p className="text-sm">{term ? 'Nothing matches that search.' : 'No conversations yet — start one.'}</p>
            </div>
          ) : visible.map(c => (
            <ConversationRow key={c.id} conversation={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </div>
      </aside>

      {/* ---- thread ---- */}
      <div className={cn('flex min-w-0 flex-col', !showThread && 'hidden lg:flex')}>
        <ChatThread
          conversationId={activeId}
          onBack={() => setShowThread(false)}
          onManageMembers={() => active && setMembers(active)}
        />
      </div>

      <AnimatePresence>
        {newChat && <NewChatModal onClose={() => setNewChat(false)} onOpened={open} />}
        {members && <GroupMembersModal conversation={byId.get(members.id) ?? members} onClose={() => setMembers(null)} />}
      </AnimatePresence>
    </div>
  )
}
