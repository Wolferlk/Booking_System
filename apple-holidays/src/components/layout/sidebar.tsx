'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, LogOut, ChevronRight, ChevronLeft,
  Truck, Home, Download, Mail, ShieldAlert, Table2, Lock, Radio,
  HardDrive, FolderOpen, X,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/rbac'
import { useCountryFilter, type CountryFilter } from '@/hooks/use-country-filter'
import { useSidebar } from '@/hooks/use-sidebar'
import type { UserRole } from '@prisma/client'

const COUNTRY_PILLS: { value: CountryFilter; flag: string; short: string }[] = [
  { value: 'ALL',                flag: '🌍', short: 'All' },
  { value: 'VIETNAM',            flag: '🇻🇳', short: 'VN' },
  { value: 'SRILANKA',           flag: '🇱🇰', short: 'LK' },
  { value: 'SINGAPORE',          flag: '🇸🇬', short: 'SG' },
  { value: 'MALAYSIA',           flag: '🇲🇾', short: 'MY' },
  { value: 'SINGAPORE_MALAYSIA', flag: '🇸🇬🇲🇾', short: 'SG & MY' },
]

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, Truck, Home, Download, Mail,
  ShieldAlert, Table2, Radio, HardDrive, FolderOpen,
}

const NAV_ITEMS: Record<UserRole, { label: string; href: string; icon: string; badge?: string; danger?: boolean }[]> = {
  BT_USER: [
    { label: 'Dashboard',      href: '/dashboard',                           icon: 'LayoutDashboard' },
    { label: 'All Bookings',   href: '/dashboard/bookings',                  icon: 'FileText' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',              icon: 'PlusCircle' },
    { label: 'Change Requests',href: '/dashboard/change-requests',           icon: 'AlertCircle' },
    { label: 'P&L Management', href: '/dashboard/accounts/pnl',             icon: 'BarChart2' },
    { label: 'Mail Inbox',     href: '/dashboard/admin/mail-inbox',          icon: 'Mail' },
    { label: 'OneDrive',       href: '/dashboard/admin/onedrive',            icon: 'HardDrive' },
    { label: 'Drive Bookings', href: '/dashboard/admin/onedrive/bookings',   icon: 'FolderOpen' },
  ],
  GT_USER: [
    { label: 'Dashboard',      href: '/dashboard',                          icon: 'LayoutDashboard' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',             icon: 'PlusCircle' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments',       icon: 'MapPin' },
    { label: 'MC Report',      href: '/dashboard/mc-report',                icon: 'Table2' },
    { label: 'Tickets',        href: '/dashboard/ground/tickets',           icon: 'Ticket' },
    { label: 'Drivers',        href: '/dashboard/ground/drivers',           icon: 'Car' },
    { label: 'Vendors',        href: '/dashboard/ground/vendors',           icon: 'Truck' },
    { label: 'Mail Inbox',     href: '/dashboard/admin/mail-inbox',         icon: 'Mail' },
    { label: 'OneDrive',       href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings', href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
  ],
  TE_USER: [
    { label: 'Dashboard',          href: '/dashboard',                          icon: 'LayoutDashboard' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',            icon: 'PlusCircle' },
    { label: 'Live Overview',      href: '/dashboard/te/live',                  icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',             icon: 'BarChart2' },
    { label: 'Review Queue',       href: '/dashboard/te/review',                icon: 'ClipboardCheck' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',               icon: 'Ticket' },
    { label: 'All Bookings',       href: '/dashboard/bookings',                 icon: 'FileText' },
    { label: 'MC Report',          href: '/dashboard/mc-report',                icon: 'Table2' },
    { label: 'Contact Log',        href: '/dashboard/te/contacts',              icon: 'Phone' },
    { label: 'Reminders',          href: '/dashboard/te/reminders',             icon: 'Bell' },
    { label: 'Payments',           href: '/dashboard/te/payments',              icon: 'CreditCard' },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',         icon: 'Mail' },
    { label: 'OneDrive',           href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
  ],
  AC_USER: [
    { label: 'Dashboard',       href: '/dashboard',                          icon: 'LayoutDashboard' },
    { label: 'New Booking',     href: '/dashboard/bookings/new',             icon: 'PlusCircle' },
    { label: 'All Bookings',    href: '/dashboard/bookings',                 icon: 'FileText' },
    { label: 'P&L Management',  href: '/dashboard/accounts/pnl',            icon: 'BarChart2' },
    { label: 'Profit Dashboard',href: '/dashboard/accounts/profit',          icon: 'TrendingUp' },
    { label: 'Credit Agents',   href: '/dashboard/accounts/credit-agents',   icon: 'CreditCard' },
    { label: 'Reports',         href: '/dashboard/accounts/reports',         icon: 'Download' },
    { label: 'Mail Inbox',      href: '/dashboard/admin/mail-inbox',         icon: 'Mail' },
    { label: 'OneDrive',        href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings',  href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
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
    { label: 'Credit Agents',      href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'P&L Management',     href: '/dashboard/accounts/pnl',      icon: 'BarChart2' },
    { label: 'Reports',            href: '/dashboard/accounts/reports',   icon: 'Download' },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',          icon: 'Mail' },
    { label: 'OneDrive Access',    href: '/dashboard/admin/onedrive',            icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',   icon: 'FolderOpen' },
    { label: 'Users',              href: '/dashboard/admin/users',               icon: 'Users' },
    { label: 'Audit Log',          href: '/dashboard/admin/audit',               icon: 'Shield' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',            icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',            icon: 'Truck' },
    { label: 'Settings',           href: '/dashboard/admin/config',              icon: 'Settings' },
    { label: 'Danger Zone',        href: '/dashboard/admin/danger',              icon: 'ShieldAlert', danger: true },
  ],
  GT_TE_USER: [
    { label: 'Dashboard',          href: '/dashboard',                    icon: 'LayoutDashboard' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',       icon: 'PlusCircle' },
    { label: 'All Bookings',       href: '/dashboard/bookings',           icon: 'FileText' },
    { label: 'Live Overview',      href: '/dashboard/te/live',            icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',       icon: 'BarChart2' },
    { label: 'Review Queue',       href: '/dashboard/te/review',          icon: 'ClipboardCheck' },
    { label: 'My Assignments',     href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'MC Report',          href: '/dashboard/mc-report',          icon: 'Table2' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',         icon: 'Ticket' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',     icon: 'Truck' },
    { label: 'Contact Log',        href: '/dashboard/te/contacts',        icon: 'Phone' },
    { label: 'Reminders',          href: '/dashboard/te/reminders',       icon: 'Bell' },
    { label: 'Payments',           href: '/dashboard/te/payments',        icon: 'CreditCard' },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',   icon: 'Mail' },
    { label: 'OneDrive',           href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
  ],
  ULTRA_SUPER_ADMIN: [
    { label: 'Dashboard',          href: '/dashboard',                   icon: 'LayoutDashboard' },
    { label: 'All Bookings',       href: '/dashboard/bookings',          icon: 'FileText' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',      icon: 'PlusCircle' },
    { label: 'Live Overview',      href: '/dashboard/te/live',           icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',      icon: 'BarChart2' },
    { label: 'MC Report',          href: '/dashboard/mc-report',         icon: 'Table2' },
    { label: 'Assignments',        href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'Ground Review',      href: '/dashboard/ground/review',     icon: 'ClipboardCheck' },
    { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',        icon: 'Ticket' },
    { label: 'Credit Agents',      href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'P&L Management',     href: '/dashboard/accounts/pnl',      icon: 'BarChart2' },
    { label: 'Reports',            href: '/dashboard/accounts/reports',   icon: 'Download' },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',          icon: 'Mail' },
    { label: 'OneDrive Access',    href: '/dashboard/admin/onedrive',            icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',   icon: 'FolderOpen' },
    { label: 'Users',              href: '/dashboard/admin/users',               icon: 'Users' },
    { label: 'Audit Log',          href: '/dashboard/admin/audit',        icon: 'Shield' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',     icon: 'Truck' },
    { label: 'Settings',           href: '/dashboard/admin/config',       icon: 'Settings' },
    { label: 'Danger Zone',        href: '/dashboard/admin/danger',       icon: 'ShieldAlert', danger: true },
  ],
}

const COUNTRY_META: Record<string, { name: string; code: string; flag: string; color: string }> = {
  VIETNAM:            { name: 'Vietnam',              code: 'MMT_VN',    flag: '🇻🇳',     color: 'border-red-500/25 bg-red-500/8' },
  SRILANKA:           { name: 'Sri Lanka',            code: 'MMT_LK',    flag: '🇱🇰',     color: 'border-yellow-500/25 bg-yellow-500/8' },
  SINGAPORE_MALAYSIA: { name: 'Singapore & Malaysia', code: 'MMT_SG_MY', flag: '🇸🇬🇲🇾', color: 'border-blue-500/25 bg-blue-500/8' },
  SINGAPORE:          { name: 'Singapore',            code: 'MMT_SG',    flag: '🇸🇬',     color: 'border-blue-500/25 bg-blue-500/8' },
  MALAYSIA:           { name: 'Malaysia',             code: 'MMT_MY',    flag: '🇲🇾',     color: 'border-emerald-500/25 bg-emerald-500/8' },
}

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const navItems = role ? NAV_ITEMS[role] ?? [] : []
  const { countryFilter, setCountryFilter, canFilter } = useCountryFilter()
  const { isCollapsed, isMobileOpen, toggleCollapse, closeMobile } = useSidebar()

  const lockedMeta = !canFilter && countryFilter && countryFilter !== 'ALL'
    ? COUNTRY_META[countryFilter]
    : null

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-full bg-slate-900 flex flex-col z-40',
          'border-r border-slate-800',
          'transition-all duration-300 ease-in-out',
          // Width: mobile always full, desktop depends on collapse state
          'w-[260px]',
          isCollapsed && 'lg:w-16',
          // Mobile: hide off-screen when closed, show when open
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible
          'lg:translate-x-0',
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={closeMobile}
          className="lg:hidden absolute top-3 right-3 z-10 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

        {/* ── Logo / Header ─────────────────────────────────────── */}
        <div className={cn('border-b border-slate-800 flex-shrink-0 px-4 py-4', isCollapsed && 'lg:px-2')}>
          <Link
            href="/"
            title="AppleHolidays Home"
            className={cn(
              'flex items-center gap-3 group mb-3',
              isCollapsed && 'lg:justify-center lg:mb-0 lg:gap-0',
            )}
          >
            <div className="relative w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-brand-500/30 bg-white">
              <Image
                src="/png/aahaslogo.png"
                alt="Aahas logo"
                fill
                sizes="36px"
                className="object-contain p-1"
              />
            </div>
            <div className={cn('flex-1 min-w-0', isCollapsed && 'lg:hidden')}>
              <p className="text-white font-bold text-sm leading-tight">AppleHolidays</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Booking System</p>
            </div>
            <Home className={cn(
              'w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0',
              isCollapsed && 'lg:hidden',
            )} />
          </Link>

          {/* Role badge */}
          {role && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/8 border border-brand-500/20',
              isCollapsed && 'lg:hidden',
            )}>
              <div className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
              <span className="text-brand-400 text-[11px] font-semibold">{ROLE_LABELS[role]}</span>
            </div>
          )}

          {/* Country filter — ULTRA_SUPER_ADMIN can switch */}
          {canFilter && (
            <div className={cn('mt-3', isCollapsed && 'lg:hidden')}>
              <p className="text-slate-600 text-[9px] uppercase tracking-widest font-semibold px-1 mb-1.5">
                Country Filter
              </p>
              <div className="grid grid-cols-4 gap-1">
                {COUNTRY_PILLS.map(pill => (
                  <button
                    key={pill.value}
                    onClick={() => setCountryFilter(pill.value)}
                    title={pill.value === 'ALL' ? 'All Countries' : pill.value.replace(/_/g, ' & ')}
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

          {/* Locked country — non-ultra users */}
          {!canFilter && role && role !== 'CLIENT' && (
            <div className={cn('mt-3', isCollapsed && 'lg:hidden')}>
              <p className="text-slate-600 text-[9px] uppercase tracking-widest font-semibold px-1 mb-1.5">
                Operating Country
              </p>
              {lockedMeta ? (
                <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${lockedMeta.color}`}>
                  <span className="text-2xl leading-none flex-shrink-0">{lockedMeta.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-bold leading-tight truncate">{lockedMeta.name}</p>
                    <p className="text-slate-500 text-[9px] uppercase tracking-wider mt-0.5">{lockedMeta.code}</p>
                  </div>
                  <Lock className="w-3 h-3 text-slate-500 flex-shrink-0" />
                </div>
              ) : (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-600/25 bg-slate-700/20">
                  <span className="text-2xl leading-none flex-shrink-0">🌍</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-bold leading-tight truncate">All Countries</p>
                    <p className="text-slate-500 text-[9px] uppercase tracking-wider mt-0.5">MMT_ALL</p>
                  </div>
                  <Lock className="w-3 h-3 text-slate-500 flex-shrink-0" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Navigation ────────────────────────────────────────── */}
        <nav className="flex-1 py-4 overflow-y-auto scrollbar-hide">
          <div className={cn('mb-2 px-3', isCollapsed && 'lg:px-1')}>
            <p className={cn(
              'text-slate-500 text-[10px] uppercase tracking-wider font-semibold px-2 mb-1',
              isCollapsed && 'lg:hidden',
            )}>
              {role ? ROLE_LABELS[role] : 'Navigation'}
            </p>
          </div>

          <ul className={cn('space-y-0.5 px-2', isCollapsed && 'lg:px-1')}>
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
                      onClick={closeMobile}
                      title={item.label}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all group',
                        isCollapsed && 'lg:justify-center lg:px-2',
                        isActive
                          ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                          : 'text-red-500/70 hover:text-red-400 hover:bg-red-500/10',
                      )}
                    >
                      {Icon && <Icon className="w-4 h-4 flex-shrink-0 text-red-500/70 group-hover:text-red-400 transition-colors" />}
                      <span className={cn(isCollapsed && 'lg:hidden')}>{item.label}</span>
                      {isActive && (
                        <ChevronRight className={cn('w-3 h-3 ml-auto text-red-400', isCollapsed && 'lg:hidden')} />
                      )}
                    </Link>
                  </li>
                )
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={closeMobile}
                    title={item.label}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all group',
                      isCollapsed && 'lg:justify-center lg:px-2',
                      isActive
                        ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800',
                    )}
                  >
                    {Icon && (
                      <Icon className={cn(
                        'w-4 h-4 flex-shrink-0 transition-colors',
                        isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300',
                      )} />
                    )}
                    <span className={cn(isCollapsed && 'lg:hidden')}>{item.label}</span>
                    {isActive && (
                      <ChevronRight className={cn('w-3 h-3 ml-auto text-brand-400', isCollapsed && 'lg:hidden')} />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* ── Desktop collapse toggle ───────────────────────────── */}
        <button
          onClick={toggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'hidden lg:flex items-center gap-2 border-t border-slate-800',
            'py-2.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800/50 transition-colors',
            isCollapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          {isCollapsed
            ? <ChevronRight className="w-4 h-4" />
            : (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span className="text-xs font-medium">Collapse</span>
              </>
            )
          }
        </button>

        {/* ── User info ─────────────────────────────────────────── */}
        {session?.user && (
          <div className={cn('border-t border-slate-800 px-4 py-4', isCollapsed && 'lg:px-2 lg:py-3')}>
            <div className={cn(
              'flex items-center gap-3 mb-3',
              isCollapsed && 'lg:justify-center lg:mb-2',
            )}>
              <div
                className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0"
                title={session.user.name ?? ''}
              >
                <span className="text-white text-xs font-bold">
                  {getInitials(session.user.name ?? 'U')}
                </span>
              </div>
              <div className={cn('flex-1 min-w-0', isCollapsed && 'lg:hidden')}>
                <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
                <p className="text-slate-500 text-xs truncate">{session.user.email}</p>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              title="Sign out"
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400',
                'hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all',
                isCollapsed && 'lg:justify-center lg:px-2',
              )}
            >
              <LogOut className="w-4 h-4" />
              <span className={cn(isCollapsed && 'lg:hidden')}>Sign out</span>
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
