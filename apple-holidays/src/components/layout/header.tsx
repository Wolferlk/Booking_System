'use client'

import { useSession } from 'next-auth/react'
import { Bell, Menu } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/rbac'
import { getInitials } from '@/lib/utils'
import { useSidebar } from '@/hooks/use-sidebar'
import type { UserRole } from '@prisma/client'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const { openMobile } = useSidebar()

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

          <button className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <Bell className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {getInitials(session?.user?.name ?? 'U')}
              </span>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold text-slate-800 leading-tight">
                {session?.user?.name}
              </p>
              <p className="text-xs text-slate-500">
                {role ? ROLE_LABELS[role] : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
