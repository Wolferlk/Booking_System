'use client'

/**
 * Start a conversation, or manage a group's people.
 *
 * The directory here is BOTH systems at once — Accounts and Operations in one
 * list, filterable, live. That is the point: an OPS file handler should be able
 * to find the accountant who raised an invoice without knowing which product
 * they sit in.
 *
 * Picking one person starts a direct thread; picking two or more turns the form
 * into a group, because that is what it now is.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Check, Plus, Search, UserMinus, UserX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatApi, useChat } from './chat-store'
import { Aurora, Avatar, SystemBadge } from './bits'
import type { ChatConversation, ChatPerson } from './types'

function Shell({
  title, subtitle, onClose, children, footer,
}: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-5 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-700 px-6 py-4 text-white">
          <Aurora />
          <div className="relative z-[2]">
            <b className="text-[1.06rem] font-extrabold tracking-tight">{title}</b>
            {subtitle && <p className="mt-0.5 text-[.72rem] text-indigo-200">{subtitle}</p>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[.8rem] font-bold text-slate-700 hover:bg-slate-50">Close</button>
          {footer}
        </footer>
      </motion.div>
    </motion.div>
  )
}

function PersonRow({
  person, picked, trailing, onClick, delay = 0,
}: { person: ChatPerson; picked?: boolean; trailing?: React.ReactNode; onClick?: () => void; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay }}
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition hover:translate-x-1 hover:bg-slate-100',
        picked && 'bg-teal-50',
      )}
    >
      <Avatar person={person} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[.82rem] font-bold text-slate-900">
          <span className="truncate">{person.name}</span>
          <SystemBadge system={person.system} />
        </div>
        <div className="truncate text-[.68rem] text-slate-500">
          {person.role_label}{person.is_online ? ' · online' : ''}
        </div>
      </div>
      {trailing ?? (
        <span className={cn(
          'grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border-2 text-white transition',
          picked ? 'scale-110 border-teal-600 bg-teal-600' : 'border-slate-200',
        )}>
          <Check className="h-3 w-3" />
        </span>
      )}
    </motion.div>
  )
}

/* ── new conversation ──────────────────────────────────────────────────────── */

export function NewChatModal({ onClose, onOpened }: { onClose: () => void; onOpened: (conversationId: number) => void }) {
  const { config, applyConversations, toast } = useChat()
  const [query, setQuery] = useState('')
  const [system, setSystem] = useState<'all' | 'accounts' | 'ops'>('all')
  const [people, setPeople] = useState<ChatPerson[]>([])
  const [picked, setPicked] = useState<ChatPerson[]>([])
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)

  // Two or more people is a group by definition; the form follows.
  const isGroup = picked.length > 1

  const load = useCallback(() => {
    const qs = new URLSearchParams()
    if (query.trim()) qs.set('q', query.trim())
    if (system !== 'all') qs.set('system', system)
    chatApi<{ people: ChatPerson[] }>(`/people?${qs}`)
      .then(d => setPeople(d.people ?? []))
      .catch(() => {})
  }, [query, system])

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  const toggle = (p: ChatPerson) => {
    setPicked(prev => prev.some(x => x.key === p.key) ? prev.filter(x => x.key !== p.key) : [...prev, p])
  }

  const go = () => {
    setBusy(true)
    const req = isGroup
      ? chatApi<{ conversation_id: number; conversations: ChatConversation[] }>('/conversations/group', {
          method: 'POST',
          body: {
            title: groupName.trim(),
            members: picked.map(p => ({ system: p.system, user_ref: p.user_ref })),
            emoji: '💬',
          },
        })
      : chatApi<{ conversation_id: number; conversations: ChatConversation[] }>('/conversations/direct', {
          method: 'POST',
          body: { system: picked[0].system, user_ref: picked[0].user_ref },
        })

    req
      .then(d => { applyConversations(d.conversations ?? []); onOpened(d.conversation_id); onClose() })
      .catch(err => { toast(err.message, 'bad'); setBusy(false) })
  }

  return (
    <Shell
      title="New conversation"
      subtitle="Everyone in Accounts and Operations, in one directory."
      onClose={onClose}
      footer={
        <button
          onClick={go}
          disabled={busy || !picked.length || (isGroup && !groupName.trim())}
          className="rounded-xl bg-gradient-to-br from-teal-600 to-teal-700 px-4 py-2 text-[.8rem] font-bold text-white shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGroup ? 'Create group' : 'Start chat'}
        </button>
      }
    >
      {!!picked.length && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map(p => (
            <motion.span
              key={p.key}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 py-1 pl-1 pr-2 text-[.72rem] font-bold"
            >
              <Avatar person={p} size={28} />
              {p.name}
              <button onClick={() => toggle(p)} className="text-rose-500"><X className="h-3 w-3" /></button>
            </motion.span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search people in Accounts and Operations…"
          className="w-full rounded-xl border-[1.5px] border-slate-200 py-2.5 pl-10 pr-3.5 text-[.86rem] outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
        />
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {(['all', 'accounts', 'ops'] as const).map(key => (
          <button
            key={key}
            onClick={() => setSystem(key)}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 text-[.7rem] font-extrabold uppercase tracking-wide transition',
              system === key ? 'bg-gradient-to-br from-teal-600 to-teal-700 text-white shadow' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            {key === 'all' ? 'Everyone' : config.systems[key]?.label ?? key}
          </button>
        ))}
      </div>

      <div className="mt-2.5">
        {people.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <UserX className="mx-auto mb-2 h-7 w-7 opacity-40" />
            <p className="text-sm">Nobody matches that.</p>
          </div>
        ) : people.map((p, i) => (
          <PersonRow
            key={p.key}
            person={p}
            picked={picked.some(x => x.key === p.key)}
            onClick={() => toggle(p)}
            delay={Math.min(i * 0.022, 0.32)}
          />
        ))}
      </div>

      <AnimatePresence>
        {isGroup && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <label className="mb-1.5 mt-4 block text-[.62rem] font-extrabold uppercase tracking-[.09em] text-slate-400">Group name</label>
            <input
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="e.g. “Vietnam September files”"
              className="w-full rounded-xl border-[1.5px] border-slate-200 px-3.5 py-2.5 text-[.86rem] outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  )
}

/* ── group members ─────────────────────────────────────────────────────────── */

export function GroupMembersModal({ conversation, onClose }: { conversation: ChatConversation; onClose: () => void }) {
  const { me, applyConversations, toast } = useChat()
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<ChatPerson[]>([])
  const members = conversation.members

  useEffect(() => {
    if (!query.trim()) { setCandidates([]); return }
    const t = setTimeout(() => {
      chatApi<{ people: ChatPerson[] }>(`/people?q=${encodeURIComponent(query.trim())}`)
        .then(d => setCandidates((d.people ?? []).filter(p => !members.some(m => m.key === p.key))))
        .catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [query, members])

  const add = (p: ChatPerson) => {
    chatApi<{ conversations: ChatConversation[] }>(`/conversations/${conversation.id}/members`, {
      method: 'POST', body: { members: [{ system: p.system, user_ref: p.user_ref }] },
    })
      .then(d => { applyConversations(d.conversations ?? []); setCandidates(prev => prev.filter(c => c.key !== p.key)) })
      .catch(err => toast(err.message, 'bad'))
  }

  const remove = (p: ChatPerson) => {
    chatApi<{ conversations: ChatConversation[] }>(`/conversations/${conversation.id}/members`, {
      method: 'DELETE', body: { system: p.system, user_ref: p.user_ref },
    })
      .then(d => { applyConversations(d.conversations ?? []); if (me && p.key === me.key) onClose() })
      .catch(err => toast(err.message, 'bad'))
  }

  const canManage = conversation.my_role !== 'member'

  return (
    <Shell
      title={`${conversation.emoji ?? '💬'} ${conversation.title}`}
      subtitle={`${conversation.member_count} members${conversation.cross_system ? ' · spans both systems' : ''}`}
      onClose={onClose}
    >
      <label className="mb-1.5 block text-[.62rem] font-extrabold uppercase tracking-[.09em] text-slate-400">Members</label>
      {members.map(p => (
        <PersonRow
          key={p.key}
          person={p}
          trailing={(canManage || (me && p.key === me.key)) ? (
            <button onClick={() => remove(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title={me && p.key === me.key ? 'Leave group' : 'Remove'}>
              <UserMinus className="h-4 w-4" />
            </button>
          ) : <span />}
        />
      ))}

      {canManage && (
        <>
          <label className="mb-1.5 mt-4 block text-[.62rem] font-extrabold uppercase tracking-[.09em] text-slate-400">Add people</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Accounts and Operations…"
            className="w-full rounded-xl border-[1.5px] border-slate-200 px-3.5 py-2.5 text-[.86rem] outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
          />
          <div className="mt-2">
            {candidates.map(p => (
              <PersonRow key={p.key} person={p} onClick={() => add(p)} trailing={<Plus className="h-4 w-4 text-teal-600" />} />
            ))}
          </div>
        </>
      )}
    </Shell>
  )
}
