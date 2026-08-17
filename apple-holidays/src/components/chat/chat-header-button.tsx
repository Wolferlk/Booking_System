'use client'

/**
 * The header's way in to chat.
 *
 * Renders nothing when the store is not mounted (the WhatsApp portal and other
 * full-screen routes render outside the dashboard shell), so it is safe to drop
 * into any header.
 */

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { MessagesSquare } from 'lucide-react'
import { useChatOptional } from './chat-store'
import { UnreadBadge } from './bits'

export default function ChatHeaderButton() {
  const store = useChatOptional()
  const router = useRouter()
  if (!store) return null

  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.94 }}
      onClick={() => router.push('/dashboard/chat')}
      title="Chat with Operations & Accounts"
      className="relative flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-[.8rem] font-bold text-teal-700 transition hover:border-transparent hover:bg-gradient-to-br hover:from-teal-600 hover:to-teal-700 hover:text-white hover:shadow-lg"
    >
      <MessagesSquare className="h-4 w-4" />
      <span className="hidden lg:inline">Chat</span>
      {store.totalUnread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-white">
          <UnreadBadge count={store.totalUnread} />
        </span>
      )}
    </motion.button>
  )
}
