'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Menu } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/rbac'
import { getInitials } from '@/lib/utils'
import { useSidebar } from '@/hooks/use-sidebar'
import NotificationsBell from '@/components/layout/notifications-bell'
import LastMinuteAlert from '@/components/layout/last-minute-alert'
import LastMinutePanel from '@/components/layout/last-minute-panel'
import ChatHeaderButton from '@/components/chat/chat-header-button'
import type { UserRole } from '@prisma/client'

interface HeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const { openMobile } = useSidebar()
  const userId = session?.user?.id
  const [photoFailed, setPhotoFailed] = useState(false)

  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
      <div className="px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-3">
        {/* Left: hamburger (mobile) + title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={openMobile}
            className="lg:hidden p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors flex-shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>

        {/* Right: actions + bell + user */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {actions}

          {/* Internal chat, shared with the Accounts system. Renders nothing on
              routes outside the dashboard shell, where the store is not mounted. */}
          <ChatHeaderButton />

          {/* Bookings sold inside D-4 that nobody has picked up yet. Renders its
              own chip only when there is something outstanding, and carries the
              recurring alarm dialog with it. */}
          <LastMinuteAlert />

          {/* The permanent way in to the same D-4 rule. The chip above vanishes
              the moment everything is acknowledged — this icon does not, so the
              week's late files stay reachable after the alarm has been answered. */}
          <LastMinutePanel />

          {/* Live traveller-experience alerts (complaints raised on AI calls) */}
          <NotificationsBell />

          {/* The user chip is the way in to /dashboard/profile — the photo set
              there is the same one the Accounts system shows in chat. It falls
              back to initials whenever there is no photo, or the photo fails to
              load, so it is never a broken image. */}
          <Link
            href="/dashboard/profile"
            title="My profile"
            className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200 rounded-r-lg hover:bg-slate-50 transition-colors py-1 pr-2 -mr-1"
          >
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {userId && !photoFailed ? (
                /* eslint-disable-next-line @next/next/no-img-element -- served
                   from an authenticated route, not an optimisable static asset */
                <img
                  src={`/api/chat/avatar/ops/${encodeURIComponent(userId)}`}
                  alt={session?.user?.name ?? 'My profile'}
                  onError={() => setPhotoFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white text-xs font-bold">
                  {getInitials(session?.user?.name ?? 'U')}
                </span>
              )}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-slate-800 leading-tight">
                {session?.user?.name}
              </p>
              <p className="text-xs text-slate-500">
                {role ? ROLE_LABELS[role] : ''}
              </p>
            </div>
          </Link>
        </div>
      </div>
    </header>
  )
}
