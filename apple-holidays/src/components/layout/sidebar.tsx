'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, LogOut, ChevronRight, Truck, Home, Download, Mail,
  ShieldAlert, Table2,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/rbac'
import { useCountryFilter } from '@/hooks/use-country-filter'
import type { UserRole } from '@prisma/client'
import type { OperationCountry } from '@/lib/country-detection'

const COUNTRY_PILLS: { value: OperationCountry | 'ALL'; flag: string; short: string }[] = [
  { value: 'ALL',                flag: '🌍', short: 'All' },
  { value: 'VIETNAM',            flag: '🇻🇳', short: 'VN' },
  { value: 'SRILANKA',           flag: '🇱🇰', short: 'LK' },
  { value: 'SINGAPORE_MALAYSIA', flag: '🇸🇬🇲🇾', short: 'SG/MY' },
]

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, Truck, Home, Download, Mail, ShieldAlert, Table2,
}

const NAV_ITEMS: Record<UserRole, { label: string; href: string; icon: string; badge?: string; danger?: boolean }[]> = {
  BT_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'All Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'New Booking', href: '/dashboard/bookings/new', icon: 'PlusCircle' },
    { label: 'Change Requests', href: '/dashboard/change-requests', icon: 'AlertCircle' },
    { label: 'P&L Management', href: '/dashboard/accounts/pnl', icon: 'BarChart2' },
    { label: 'Mail Inbox', href: '/dashboard/admin/mail-inbox', icon: 'Mail' },
  ],
  GT_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'MC Report', href: '/dashboard/mc-report', icon: 'Table2' },
    { label: 'Tickets', href: '/dashboard/ground/tickets', icon: 'Ticket' },
    { label: 'Drivers', href: '/dashboard/ground/drivers', icon: 'Car' },
    { label: 'Vendors', href: '/dashboard/ground/vendors', icon: 'Truck' },
  ],
  TE_USER: [
    { label: 'Dashboard',          href: '/dashboard',                icon: 'LayoutDashboard' },
    { label: 'Live Overview',      href: '/dashboard/te/live',        icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',   icon: 'BarChart2' },
    { label: 'Review Queue',       href: '/dashboard/te/review',      icon: 'ClipboardCheck' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',     icon: 'Ticket' },
    { label: 'All Bookings',       href: '/dashboard/bookings',       icon: 'FileText' },
    { label: 'MC Report',          href: '/dashboard/mc-report',      icon: 'Table2' },
    { label: 'Contact Log',        href: '/dashboard/te/contacts',    icon: 'Phone' },
    { label: 'Reminders',          href: '/dashboard/te/reminders',   icon: 'Bell' },
  ],
  AC_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'All Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'P&L Management', href: '/dashboard/accounts/pnl', icon: 'BarChart2' },
    { label: 'Profit Dashboard', href: '/dashboard/accounts/profit', icon: 'TrendingUp' },
    { label: 'Credit Agents', href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'Reports', href: '/dashboard/accounts/reports', icon: 'Download' },
  ],
  CLIENT: [
    { label: 'My Trip', href: '/portal', icon: 'Globe' },
  ],
  SUPER_ADMIN: [
    { label: 'Dashboard',          href: '/dashboard',                  icon: 'LayoutDashboard' },
    { label: 'Live Overview',      href: '/dashboard/te/live',          icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',     icon: 'BarChart2' },
    { label: 'All Bookings',       href: '/dashboard/bookings',         icon: 'FileText' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',     icon: 'PlusCircle' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',       icon: 'Ticket' },
    { label: 'Ground Review',      href: '/dashboard/ground/review',    icon: 'ClipboardCheck' },
    { label: 'Assignments',        href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'MC Report',          href: '/dashboard/mc-report',         icon: 'Table2' },
    { label: 'Credit Agents', href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'P&L Management', href: '/dashboard/accounts/pnl', icon: 'BarChart2' },
    { label: 'Reports', href: '/dashboard/accounts/reports', icon: 'Download' },
    { label: 'Mail Inbox', href: '/dashboard/admin/mail-inbox', icon: 'Mail' },
    { label: 'Users', href: '/dashboard/admin/users', icon: 'Users' },
    { label: 'Audit Log', href: '/dashboard/admin/audit', icon: 'Shield' },
    { label: 'Drivers', href: '/dashboard/ground/drivers', icon: 'Car' },
    { label: 'Vendors', href: '/dashboard/ground/vendors', icon: 'Truck' },
    { label: 'Settings', href: '/dashboard/admin/config', icon: 'Settings' },
    { label: 'Danger Zone', href: '/dashboard/admin/danger', icon: 'ShieldAlert', danger: true },
  ],
  GT_TE_USER: [
    { label: 'Dashboard',        href: '/dashboard',                   icon: 'LayoutDashboard' },
    { label: 'My Assignments',   href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'MC Report',        href: '/dashboard/mc-report',          icon: 'Table2' },
    { label: 'Tickets',          href: '/dashboard/ground/tickets',     icon: 'Ticket' },
    { label: 'Drivers',          href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Vendors',          href: '/dashboard/ground/vendors',     icon: 'Truck' },
    { label: 'Live Overview',    href: '/dashboard/te/live',            icon: 'LayoutDashboard' },
    { label: 'Review Queue',     href: '/dashboard/te/review',          icon: 'ClipboardCheck' },
    { label: 'Reminders',        href: '/dashboard/te/reminders',       icon: 'Bell' },
    { label: 'Contact Log',      href: '/dashboard/te/contacts',        icon: 'Phone' },
  ],
  ULTRA_SUPER_ADMIN: [
    { label: 'Dashboard',          href: '/dashboard',                   icon: 'LayoutDashboard' },
    { label: 'All Bookings',       href: '/dashboard/bookings',          icon: 'FileText' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',      icon: 'PlusCircle' },
    { label: 'Live Overview',      href: '/dashboard/te/live',           icon: 'LayoutDashboard' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',      icon: 'BarChart2' },
    { label: 'MC Report',          href: '/dashboard/mc-report',         icon: 'Table2' },
    { label: 'Assignments',        href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'Ground Review',      href: '/dashboard/ground/review',     icon: 'ClipboardCheck' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',        icon: 'Ticket' },
    { label: 'Credit Agents',      href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'P&L Management',     href: '/dashboard/accounts/pnl',      icon: 'BarChart2' },
    { label: 'Reports',            href: '/dashboard/accounts/reports',   icon: 'Download' },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',   icon: 'Mail' },
    { label: 'Users',              href: '/dashboard/admin/users',        icon: 'Users' },
    { label: 'Audit Log',          href: '/dashboard/admin/audit',        icon: 'Shield' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',     icon: 'Truck' },
    { label: 'Settings',           href: '/dashboard/admin/config',       icon: 'Settings' },
    { label: 'Danger Zone',        href: '/dashboard/admin/danger',       icon: 'ShieldAlert', danger: true },
  ],
}

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const navItems = role ? NAV_ITEMS[role] ?? [] : []
  const { countryFilter, setCountryFilter, canFilter } = useCountryFilter()

  return (
    <aside className="fixed left-0 top-0 h-full w-[260px] bg-slate-900 flex flex-col z-30 border-r border-slate-800">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-800">
        <Link href="/" className="flex items-center gap-3 group mb-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-brand-500/30">
            <span className="text-white font-black text-sm">AH</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight">AppleHolidays</p>
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">MMT Vietnam</p>
          </div>
          <Home className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
        </Link>
        {/* Role badge */}
        {role && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/8 border border-brand-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
            <span className="text-brand-400 text-[11px] font-semibold">{ROLE_LABELS[role]}</span>
          </div>
        )}
        {/* Country filter — only for admins who can see all countries */}
        {canFilter && (
          <div className="mt-3">
            <p className="text-slate-600 text-[9px] uppercase tracking-widest font-semibold px-1 mb-1.5">
              Country Filter
            </p>
            <div className="grid grid-cols-4 gap-1">
              {COUNTRY_PILLS.map(pill => (
                <button
                  key={pill.value}
                  onClick={() => setCountryFilter(pill.value)}
                  title={pill.value === 'ALL' ? 'All Countries' : pill.value.replace('_', ' & ')}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-1.5 px-0.5 rounded-lg text-center transition-all text-[9px] font-semibold leading-tight',
                    countryFilter === pill.value
                      ? 'bg-brand-500/20 border border-brand-500/40 text-brand-300'
                      : 'bg-slate-800/60 border border-slate-700/40 text-slate-500 hover:text-slate-300 hover:bg-slate-700/60',
                  )}
                >
                  <span className="text-base leading-none">{pill.flag}</span>
                  <span>{pill.short}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Country badge for scoped users */}
        {!canFilter && session?.user && (session.user as any).country && (session.user as any).country !== 'ALL' && (
          <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40">
            <span className="text-xs">{COUNTRY_PILLS.find(p => p.value === (session.user as any).country)?.flag ?? '🌍'}</span>
            <span className="text-slate-400 text-[10px] font-medium">
              {(session.user as any).country === 'VIETNAM' ? 'Vietnam'
                : (session.user as any).country === 'SRILANKA' ? 'Sri Lanka'
                : 'Singapore & Malaysia'}
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto scrollbar-hide">
        <div className="px-3 mb-2">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold px-2 mb-1">
            {role ? ROLE_LABELS[role] : 'Navigation'}
          </p>
        </div>
        <ul className="space-y-0.5 px-2">
          {navItems.map(item => {
            const Icon = ICON_MAP[item.icon]
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)

            if (item.danger) {
              return (
                <li key={item.href} className="mt-2 pt-2 border-t border-slate-800">
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all group',
                      isActive
                        ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                        : 'text-red-500/70 hover:text-red-400 hover:bg-red-500/10',
                    )}
                  >
                    {Icon && <Icon className="w-4 h-4 flex-shrink-0 text-red-500/70 group-hover:text-red-400 transition-colors" />}
                    {item.label}
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto text-red-400" />}
                  </Link>
                </li>
              )
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all group',
                    isActive
                      ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800',
                  )}
                >
                  {Icon && (
                    <Icon
                      className={cn(
                        'w-4 h-4 flex-shrink-0 transition-colors',
                        isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300',
                      )}
                    />
                  )}
                  {item.label}
                  {isActive && (
                    <ChevronRight className="w-3 h-3 ml-auto text-brand-400" />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User info */}
      {session?.user && (
        <div className="px-4 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {getInitials(session.user.name ?? 'U')}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
              <p className="text-slate-500 text-xs truncate">{session.user.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}
