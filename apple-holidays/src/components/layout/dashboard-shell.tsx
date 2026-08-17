'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/hooks/use-sidebar'
import Sidebar from './sidebar'
import { ChatProvider } from '@/components/chat/chat-store'
import { ChatDock } from '@/components/chat/chat-dock'

// Routes that render their own full-screen chrome instead of the persistent
// sidebar shell — e.g. the WhatsApp inbox, which opens in its own browser tab
// and wants the whole viewport, like a dedicated portal.
const FULL_SCREEN_ROUTES = ['/dashboard/whatsapp']

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  // Deliberately `isPinned`, not `isCollapsed`: the rail expands on hover, and
  // reserving space for that would shove the whole page sideways every time
  // the pointer crossed the left edge. A hover-expanded rail floats over the
  // content; only a pinned one takes width out of the layout.
  const { isPinned } = useSidebar()
  const pathname = usePathname()

  if (FULL_SCREEN_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))) {
    return <div className="min-h-screen bg-slate-50">{children}</div>
  }

  return (
    /*
     * The chat provider wraps the whole shell, not just the chat page: the
     * floating dock, the header's unread badge and the full page all read one
     * store and share ONE poll loop, so ten open surfaces still cost a single
     * request per tick. See components/chat/chat-store.tsx.
     */
    <ChatProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main
          className={cn(
            'flex-1 min-w-0 transition-all duration-300',
            'ml-0',
            isPinned ? 'lg:ml-[260px]' : 'lg:ml-16',
          )}
        >
          {children}
        </main>
      </div>

      {/* Minimizable chat boxes, on every screen of the product. Restores
          whatever this user had open, so a conversation survives navigating. */}
      <ChatDock />
    </ChatProvider>
  )
}
