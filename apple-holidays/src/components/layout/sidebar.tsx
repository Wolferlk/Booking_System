'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, LogOut, ChevronRight, ChevronLeft,
  Truck, Home, Download, Mail, ShieldAlert, Table2, Lock, Radio,
  HardDrive, FolderOpen, X, XCircle, Bot, Navigation2, Trash2, Cloud, MessageCircle, FileCheck2, PackagePlus, CalendarClock,
  PlaneTakeoff, Search, CornerDownLeft, SearchX, ShoppingBag, MailCheck, Inbox,
  ChevronDown, Zap,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/rbac'
import { useCountryFilter, type CountryFilter } from '@/hooks/use-country-filter'
import { useSidebar } from '@/hooks/use-sidebar'
import type { UserRole } from '@prisma/client'
import { CountryFlag } from '@/components/ui/country-flag'

const COUNTRY_PILLS: { value: CountryFilter; short: string }[] = [
  { value: 'ALL',                short: 'All' },
  { value: 'VIETNAM',            short: 'VN' },
  { value: 'SRILANKA',           short: 'LK' },
  { value: 'SINGAPORE',          short: 'SG' },
  { value: 'MALAYSIA',           short: 'MY' },
  { value: 'SINGAPORE_MALAYSIA', short: 'SG & MY' },
]

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, FileText, PlusCircle, AlertCircle, ClipboardCheck,
  MapPin, Ticket, Car, Phone, Bell, CreditCard, BarChart2, TrendingUp,
  Users, Shield, Settings, Globe, Truck, Home, Download, Mail,
  ShieldAlert, Table2, Radio, HardDrive, FolderOpen, Bot, Navigation2, Trash2, Cloud, MessageCircle, FileCheck2,
  XCircle, PackagePlus, CalendarClock, PlaneTakeoff, ShoppingBag, MailCheck, Inbox,
}

// The WhatsApp inbox is its own full-screen portal (no persistent sidebar), so
// it opens in a new tab rather than navigating the current dashboard view away.
const WHATSAPP_NAV_ITEM = { label: 'WhatsApp', href: '/dashboard/whatsapp', icon: 'MessageCircle', external: true }

const NAV_ITEMS: Record<UserRole, { label: string; href: string; icon: string; badge?: string; danger?: boolean; external?: boolean }[]> = {
  BT_USER: [
    { label: 'Dashboard',      href: '/dashboard',                           icon: 'LayoutDashboard' },
    { label: 'All Bookings',   href: '/dashboard/bookings',                  icon: 'FileText' },
    { label: 'AS Bookings',    href: '/dashboard/as-bookings',               icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',              icon: 'PlusCircle' },
    { label: 'Change Requests',href: '/dashboard/change-requests',           icon: 'AlertCircle' },
    { label: 'P&L Management', href: '/dashboard/accounts/pnl',             icon: 'BarChart2' },
    { label: 'Driver Logs',    href: '/dashboard/driver-log',                icon: 'Navigation2' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',     href: '/dashboard/admin/mail-inbox',          icon: 'Mail' },
    { label: 'OneDrive',       href: '/dashboard/admin/onedrive',            icon: 'HardDrive' },
    { label: 'Drive Bookings', href: '/dashboard/admin/onedrive/bookings',   icon: 'FolderOpen' },
  ],
  GT_USER: [
    { label: 'Dashboard',      href: '/dashboard',                          icon: 'LayoutDashboard' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',             icon: 'PlusCircle' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments',       icon: 'MapPin' },
    { label: 'MC Report',      href: '/dashboard/mc-report',                icon: 'Table2' },
    // { label: 'Tickets',        href: '/dashboard/ground/tickets',           icon: 'Ticket' },
    { label: 'Drivers',        href: '/dashboard/ground/drivers',           icon: 'Car' },
    { label: 'Driver Logs',    href: '/dashboard/driver-log',               icon: 'Navigation2' },
    { label: 'Vendors',        href: '/dashboard/ground/vendors',           icon: 'Truck' },
    { ...WHATSAPP_NAV_ITEM },
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
    // { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',               icon: 'Ticket' },
    { label: 'All Bookings',       href: '/dashboard/bookings',                 icon: 'FileText' },
    { label: 'AS Bookings',        href: '/dashboard/as-bookings',              icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'MC Report',          href: '/dashboard/mc-report',                icon: 'Table2' },
    { label: 'Contact Log',        href: '/dashboard/te/contacts',              icon: 'Phone' },
    { label: 'AI Call Bot',        href: '/dashboard/te/ai-call-bot',           icon: 'Bot' },
    { label: 'AI Call Report',     href: '/dashboard/te/ai-call-report',       icon: 'BarChart2' },
    { label: 'Reminders',          href: '/dashboard/te/reminders',             icon: 'Bell' },
    { label: 'Payments',           href: '/dashboard/te/payments',              icon: 'CreditCard' },
    { label: 'Driver Logs',        href: '/dashboard/driver-log',               icon: 'Navigation2' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',         icon: 'Mail' },
    { label: 'OneDrive',           href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
  ],
  AC_USER: [
    { label: 'Dashboard',       href: '/dashboard',                          icon: 'LayoutDashboard' },
    { label: 'New Booking',     href: '/dashboard/bookings/new',             icon: 'PlusCircle' },
    { label: 'All Bookings',    href: '/dashboard/bookings',                 icon: 'FileText' },
    { label: 'AS Bookings',     href: '/dashboard/as-bookings',              icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'P&L Management',  href: '/dashboard/accounts/pnl',            icon: 'BarChart2' },
    { label: 'Profit Dashboard',href: '/dashboard/accounts/profit',          icon: 'TrendingUp' },
    { label: 'Credit Agents',   href: '/dashboard/accounts/credit-agents',   icon: 'CreditCard' },
    { label: 'Cancellations',   href: '/dashboard/accounts/cancellations',   icon: 'XCircle' },
    { label: 'Reports',         href: '/dashboard/accounts/reports',         icon: 'Download' },
    { label: 'Driver Logs',     href: '/dashboard/driver-log',               icon: 'Navigation2' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',      href: '/dashboard/admin/mail-inbox',         icon: 'Mail' },
    { label: 'OneDrive',        href: '/dashboard/admin/onedrive',           icon: 'HardDrive' },
    { label: 'Drive Bookings',  href: '/dashboard/admin/onedrive/bookings',  icon: 'FolderOpen' },
  ],
  CLIENT: [
    { label: 'My Trip', href: '/portal', icon: 'Globe' },
  ],
  SUPER_ADMIN: [
    { label: 'Dashboard',          href: '/dashboard',                             icon: 'LayoutDashboard' },
    { label: 'Live Overview',      href: '/dashboard/te/live',                     icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',                icon: 'BarChart2' },
    { label: 'All Bookings',       href: '/dashboard/bookings',                    icon: 'FileText' },
    { label: 'AS Bookings',        href: '/dashboard/as-bookings',                 icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',                icon: 'PlusCircle' },
    { label: 'SL Driver Alloc',    href: '/dashboard/srilanka/driver-allocation',  icon: 'Navigation2' },
    // { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',                  icon: 'Ticket' },
    { label: 'Ground Review',      href: '/dashboard/ground/review',               icon: 'ClipboardCheck' },
    { label: 'Assignments',        href: '/dashboard/ground/assignments',          icon: 'MapPin' },
    { label: 'MC Report',          href: '/dashboard/mc-report',                   icon: 'Table2' },
    { label: 'Driver Logs',        href: '/dashboard/driver-log',                  icon: 'Navigation2' },
    { label: 'AI Call Bot',        href: '/dashboard/te/ai-call-bot',              icon: 'Bot' },
    { label: 'AI Call Report',     href: '/dashboard/te/ai-call-report',          icon: 'BarChart2' },
    { label: 'Credit Agents',      href: '/dashboard/accounts/credit-agents',      icon: 'CreditCard' },
    { label: 'P&L Management',     href: '/dashboard/accounts/pnl',               icon: 'BarChart2' },
    { label: 'Cancellations',      href: '/dashboard/accounts/cancellations',      icon: 'XCircle' },
    { label: 'Reports',            href: '/dashboard/accounts/reports',            icon: 'Download' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',            icon: 'Mail' },
    { label: 'OneDrive Access',    href: '/dashboard/admin/onedrive',              icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',     icon: 'FolderOpen' },
    { label: 'Users',              href: '/dashboard/admin/users',                 icon: 'Users' },
    { label: 'File Handlers',      href: '/dashboard/admin/file-handlers',         icon: 'PlaneTakeoff' },
    { label: 'Query Monitor',      href: '/dashboard/admin/query-monitor',        icon: 'Inbox' },
    { label: 'Audit Log',          href: '/dashboard/admin/audit',                 icon: 'Shield' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',              icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',              icon: 'Truck' },
    { label: 'Auto Reports',       href: '/dashboard/reports/auto',                icon: 'MailCheck' },
    { label: 'Schedules',          href: '/dashboard/admin/schedules',             icon: 'CalendarClock' },
    { label: 'Settings',           href: '/dashboard/admin/config',                icon: 'Settings' },
    { label: 'Bookings Cleanup',   href: '/dashboard/admin/bookings-cleanup',      icon: 'Trash2',      danger: true },
    { label: 'Danger Zone',        href: '/dashboard/admin/danger',                icon: 'ShieldAlert', danger: true },
  ],
  GT_TE_USER: [
    { label: 'Dashboard',          href: '/dashboard',                             icon: 'LayoutDashboard' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',                icon: 'PlusCircle' },
    { label: 'All Bookings',       href: '/dashboard/bookings',                    icon: 'FileText' },
    { label: 'AS Bookings',        href: '/dashboard/as-bookings',                 icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'SL Driver Alloc',    href: '/dashboard/srilanka/driver-allocation',  icon: 'Navigation2' },
    { label: 'Live Overview',      href: '/dashboard/te/live',                     icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',                icon: 'BarChart2' },
    { label: 'Review Queue',       href: '/dashboard/te/review',                   icon: 'ClipboardCheck' },
    { label: 'My Assignments',     href: '/dashboard/ground/assignments',          icon: 'MapPin' },
    { label: 'MC Report',          href: '/dashboard/mc-report',                   icon: 'Table2' },
    // { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',                  icon: 'Ticket' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',              icon: 'Car' },
    { label: 'Driver Logs',        href: '/dashboard/driver-log',                  icon: 'Navigation2' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',              icon: 'Truck' },
    { label: 'Contact Log',        href: '/dashboard/te/contacts',                 icon: 'Phone' },
    { label: 'AI Call Bot',        href: '/dashboard/te/ai-call-bot',              icon: 'Bot' },
    { label: 'AI Call Report',     href: '/dashboard/te/ai-call-report',          icon: 'BarChart2' },
    { label: 'Reminders',          href: '/dashboard/te/reminders',                icon: 'Bell' },
    { label: 'Payments',           href: '/dashboard/te/payments',                 icon: 'CreditCard' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',            icon: 'Mail' },
    { label: 'OneDrive',           href: '/dashboard/admin/onedrive',              icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',     icon: 'FolderOpen' },
  ],
  ULTRA_SUPER_ADMIN: [
    { label: 'Dashboard',          href: '/dashboard',                             icon: 'LayoutDashboard' },
    { label: 'All Bookings',       href: '/dashboard/bookings',                    icon: 'FileText' },
    { label: 'AS Bookings',        href: '/dashboard/as-bookings',                 icon: 'Cloud' },
    { label: 'AS Bookings V2', href: '/dashboard/as-bookings-v2',            icon: 'FileCheck2' },
    { label: 'New AS Booking', href: '/dashboard/new-as-booking',            icon: 'PackagePlus' },
    { label: 'B2C — Aahaas',    href: '/dashboard/b2c',                       icon: 'ShoppingBag' },
    { label: 'New Booking',        href: '/dashboard/bookings/new',                icon: 'PlusCircle' },
    { label: 'SL Driver Alloc',    href: '/dashboard/srilanka/driver-allocation',  icon: 'Navigation2' },
    { label: 'Live Overview',      href: '/dashboard/te/live',                     icon: 'Radio' },
    { label: 'Analytics',          href: '/dashboard/te/analytics',                icon: 'BarChart2' },
    { label: 'MC Report',          href: '/dashboard/mc-report',                   icon: 'Table2' },
    { label: 'Assignments',        href: '/dashboard/ground/assignments',          icon: 'MapPin' },
    { label: 'Ground Review',      href: '/dashboard/ground/review',               icon: 'ClipboardCheck' },
    { label: 'Driver Logs',        href: '/dashboard/driver-log',                  icon: 'Navigation2' },
    // { label: 'Tickets & Vouchers', href: '/dashboard/te/tickets',                  icon: 'Ticket' },
    { label: 'AI Call Bot',        href: '/dashboard/te/ai-call-bot',              icon: 'Bot' },
    { label: 'AI Call Report',     href: '/dashboard/te/ai-call-report',          icon: 'BarChart2' },
    { label: 'Credit Agents',      href: '/dashboard/accounts/credit-agents',      icon: 'CreditCard' },
    { label: 'P&L Management',     href: '/dashboard/accounts/pnl',               icon: 'BarChart2' },
    { label: 'Cancellations',      href: '/dashboard/accounts/cancellations',      icon: 'XCircle' },
    { label: 'Reports',            href: '/dashboard/accounts/reports',            icon: 'Download' },
    { ...WHATSAPP_NAV_ITEM },
    { label: 'Mail Inbox',         href: '/dashboard/admin/mail-inbox',            icon: 'Mail' },
    { label: 'OneDrive Access',    href: '/dashboard/admin/onedrive',              icon: 'HardDrive' },
    { label: 'Drive Bookings',     href: '/dashboard/admin/onedrive/bookings',     icon: 'FolderOpen' },
    { label: 'Users',              href: '/dashboard/admin/users',                 icon: 'Users' },
    { label: 'File Handlers',      href: '/dashboard/admin/file-handlers',         icon: 'PlaneTakeoff' },
    { label: 'Query Monitor',      href: '/dashboard/admin/query-monitor',        icon: 'Inbox' },
    { label: 'Audit Log',          href: '/dashboard/admin/audit',                 icon: 'Shield' },
    { label: 'Drivers',            href: '/dashboard/ground/drivers',              icon: 'Car' },
    { label: 'Vendors',            href: '/dashboard/ground/vendors',              icon: 'Truck' },
    { label: 'Auto Reports',       href: '/dashboard/reports/auto',                icon: 'MailCheck' },
    { label: 'Schedules',          href: '/dashboard/admin/schedules',             icon: 'CalendarClock' },
    { label: 'Settings',           href: '/dashboard/admin/config',                icon: 'Settings' },
    { label: 'Bookings Cleanup',   href: '/dashboard/admin/bookings-cleanup',      icon: 'Trash2',      danger: true },
    { label: 'Danger Zone',        href: '/dashboard/admin/danger',                icon: 'ShieldAlert', danger: true },
  ],
}

const COUNTRY_META: Record<string, { name: string; code: string; color: string }> = {
            VIETNAM:            { name: 'Vietnam',              code: 'MMT_VN',    color: 'border-red-500/25 bg-red-500/8' },
            SRILANKA:           { name: 'Sri Lanka',            code: 'MMT_LK',    color: 'border-yellow-500/25 bg-yellow-500/8' },
            SINGAPORE_MALAYSIA: { name: 'Singapore & Malaysia', code: 'MMT_SG_MY', color: 'border-blue-500/25 bg-blue-500/8' },
            SINGAPORE:          { name: 'Singapore',            code: 'MMT_SG',    color: 'border-blue-500/25 bg-blue-500/8' },
            MALAYSIA:           { name: 'Malaysia',             code: 'MMT_MY',    color: 'border-emerald-500/25 bg-emerald-500/8' },
          }

type NavItem = (typeof NAV_ITEMS)[UserRole][number]

/* ─────────────────────────── Category model ───────────────────────────
 * The per-role lists above stay the single source of truth for *access*.
 * Everything below only decides how those items are *presented*: which
 * category a link belongs to, and which links are promoted to the pinned
 * Quick Access rail at the top of the sidebar.
 * ------------------------------------------------------------------- */

type NavGroupId = 'quick' | 'bookings' | 'ops' | 'te' | 'finance' | 'reports' | 'comms' | 'admin' | 'danger'

/** The day-to-day links, in the order they should appear when pinned. */
const QUICK_ACCESS_HREFS = [
  '/dashboard/bookings',
  '/dashboard/mc-report',
  '/dashboard/accounts/reports',
  '/dashboard/whatsapp',
  '/dashboard/srilanka/driver-allocation',
  '/dashboard/ground/drivers',
  '/dashboard/ground/vendors',
] as const

const QUICK_RANK = new Map<string, number>(QUICK_ACCESS_HREFS.map((href, i) => [href, i]))

const GROUP_META: Record<NavGroupId, {
  label: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  dot: string
  rail: string
}> = {
  quick:    { label: 'Quick Access',      icon: Zap,           accent: 'text-amber-400',   dot: 'bg-amber-400',   rail: 'border-amber-500/30'   },
  bookings: { label: 'Bookings',          icon: FileText,      accent: 'text-brand-400',   dot: 'bg-brand-400',   rail: 'border-brand-500/25'   },
  ops:      { label: 'Ground Ops',        icon: Truck,         accent: 'text-emerald-400', dot: 'bg-emerald-400', rail: 'border-emerald-500/25' },
  te:       { label: 'Travel Experience', icon: Radio,         accent: 'text-sky-400',     dot: 'bg-sky-400',     rail: 'border-sky-500/25'     },
  finance:  { label: 'Finance',           icon: CreditCard,    accent: 'text-violet-400',  dot: 'bg-violet-400',  rail: 'border-violet-500/25'  },
  reports:  { label: 'Reports',           icon: BarChart2,     accent: 'text-cyan-400',    dot: 'bg-cyan-400',    rail: 'border-cyan-500/25'    },
  comms:    { label: 'Communication',     icon: MessageCircle, accent: 'text-pink-400',    dot: 'bg-pink-400',    rail: 'border-pink-500/25'    },
  admin:    { label: 'Administration',    icon: Settings,      accent: 'text-slate-300',   dot: 'bg-slate-400',   rail: 'border-slate-600/40'   },
  danger:   { label: 'Danger Zone',       icon: ShieldAlert,   accent: 'text-red-400',     dot: 'bg-red-500',     rail: 'border-red-500/30'     },
}

const GROUP_ORDER: NavGroupId[] = ['quick', 'bookings', 'ops', 'te', 'finance', 'reports', 'comms', 'admin', 'danger']

/** Buckets a nav link into a category. First rule that matches wins. */
function classifyNavItem(item: NavItem): NavGroupId {
  const h = item.href
  if (item.danger) return 'danger'
  if (QUICK_RANK.has(h)) return 'quick'
  // Mail/Drive live under /admin but belong with the other inboxes.
  if (h.startsWith('/dashboard/whatsapp')) return 'comms'
  if (h.startsWith('/dashboard/admin/mail-inbox')) return 'comms'
  if (h.startsWith('/dashboard/admin/onedrive')) return 'comms'
  if (h.startsWith('/dashboard/admin/query-monitor')) return 'comms'
  if (h.startsWith('/dashboard/mc-report')) return 'reports'
  if (h.startsWith('/dashboard/reports')) return 'reports'
  if (h.startsWith('/dashboard/bookings')) return 'bookings'
  if (h.startsWith('/dashboard/as-bookings')) return 'bookings'
  if (h.startsWith('/dashboard/new-as-booking')) return 'bookings'
  if (h.startsWith('/dashboard/b2c')) return 'bookings'
  if (h.startsWith('/dashboard/change-requests')) return 'bookings'
  if (h.startsWith('/dashboard/ground')) return 'ops'
  if (h.startsWith('/dashboard/srilanka')) return 'ops'
  if (h.startsWith('/dashboard/driver-log')) return 'ops'
  if (h.startsWith('/dashboard/te')) return 'te'
  if (h.startsWith('/dashboard/accounts')) return 'finance'
  if (h.startsWith('/dashboard/admin')) return 'admin'
  return 'quick'
}

/**
 * Subsequence match — "asb" finds "AS Bookings", "pnl" finds "P&L Management".
 * Returns the matched character positions (for highlighting) or null if no match.
 */
function fuzzyMatch(label: string, query: string): number[] | null {
  const haystack = label.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')
  const positions: number[] = []
  let cursor = 0

  for (let i = 0; i < needle.length; i++) {
    const found = haystack.indexOf(needle[i], cursor)
    if (found === -1) return null
    positions.push(found)
    cursor = found + 1
  }
  return positions
}

/** Lower is better: reward early matches and runs of adjacent characters. */
function matchScore(positions: number[]): number {
  if (!positions.length) return 0
  let score = positions[0] * 2
  for (let i = 1; i < positions.length; i++) {
    score += (positions[i] - positions[i - 1] - 1) * 3
  }
  return score
}

function HighlightedLabel({
  label,
  positions,
  hitClassName = 'text-brand-300 font-bold',
}: { label: string; positions: number[]; hitClassName?: string }) {
  if (!positions.length) return <>{label}</>
  const hits = new Set(positions)
  return (
    <>
      {label.split('').map((char, i) =>
        hits.has(i)
          ? <span key={i} className={hitClassName}>{char}</span>
          : <span key={i}>{char}</span>,
      )}
    </>
  )
}

/**
 * A link is active when it is the deepest nav entry matching the current path,
 * so `/dashboard/admin/onedrive/bookings` doesn't also light up `…/onedrive`.
 */
function isItemActive(item: NavItem, pathname: string, navItems: NavItem[]): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard'
  if (pathname === item.href) return true
  if (!pathname.startsWith(item.href + '/')) return false
  const hasMoreSpecificMatch = navItems.some(other =>
    other.href !== item.href &&
    other.href.startsWith(item.href) &&
    pathname.startsWith(other.href),
  )
  return !hasMoreSpecificMatch
}

function NavRow({
  item, positions, isActive, isHighlighted, isCollapsed, quickIndex, groupLabel, onNavigate,
}: {
  item: NavItem
  positions: number[]
  isActive: boolean
  isHighlighted: boolean
  isCollapsed: boolean
  /** 0-based slot in Quick Access — renders the ⌥N shortcut hint. */
  quickIndex?: number
  /** Category name shown as a trailing chip while searching. */
  groupLabel?: string
  onNavigate: () => void
}) {
  const Icon = ICON_MAP[item.icon]
  const danger = Boolean(item.danger)

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.label}
      {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all group',
        isCollapsed && 'lg:justify-center lg:px-2',
        danger
          ? isActive
            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
            : 'text-red-500/70 hover:text-red-400 hover:bg-red-500/10'
          : isActive
            ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
            : 'text-slate-400 hover:text-white hover:bg-slate-800',
        isHighlighted && (danger
          ? 'ring-1 ring-red-500/50 bg-red-500/10'
          : 'ring-1 ring-brand-500/50 bg-slate-800 text-white'),
      )}
    >
      {Icon && (
        <Icon className={cn(
          'w-4 h-4 flex-shrink-0 transition-colors',
          danger
            ? 'text-red-500/70 group-hover:text-red-400'
            : isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300',
        )} />
      )}

      <span className={cn('truncate', isCollapsed && 'lg:hidden')}>
        <HighlightedLabel
          label={item.label}
          positions={positions}
          hitClassName={danger ? 'text-red-300 font-bold' : 'text-brand-300 font-bold'}
        />
      </span>

      {groupLabel && (
        <span className={cn(
          'ml-auto flex-shrink-0 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold',
          'bg-slate-800 text-slate-500 border border-slate-700/60',
          isCollapsed && 'lg:hidden',
        )}>
          {groupLabel}
        </span>
      )}

      {!groupLabel && quickIndex !== undefined && quickIndex < 9 && (
        <kbd className={cn(
          'ml-auto flex-shrink-0 hidden lg:block px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold',
          'border border-slate-700/70 bg-slate-900/70 text-slate-600 group-hover:text-slate-400 transition-colors',
          isCollapsed && 'lg:hidden',
        )}>
          ⌥{quickIndex + 1}
        </kbd>
      )}

      {!groupLabel && quickIndex === undefined && isActive && (
        <ChevronRight className={cn(
          'w-3 h-3 ml-auto flex-shrink-0',
          danger ? 'text-red-400' : 'text-brand-400',
          isCollapsed && 'lg:hidden',
        )} />
      )}
    </Link>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const navItems = useMemo(() => (role ? NAV_ITEMS[role] ?? [] : []), [role])
  const { countryFilter, setCountryFilter, canFilter } = useCountryFilter()
  const { isCollapsed, isMobileOpen, toggleCollapse, closeMobile } = useSidebar()

  const [query, setQuery] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const wantsFocusRef = useRef(false)

  const matches = useMemo(() => {
    if (!query.trim()) return null
    return navItems
      .map(item => {
        const positions = fuzzyMatch(item.label, query)
        return positions ? { item, positions, score: matchScore(positions) } : null
      })
      .filter((m): m is { item: NavItem; positions: number[]; score: number } => m !== null)
      .sort((a, b) => a.score - b.score)
  }, [query, navItems])

  const visibleItems: { item: NavItem; positions: number[] }[] = matches
    ?? navItems.map(item => ({ item, positions: [] as number[] }))

  useEffect(() => { setActiveIndex(0) }, [query])

  /* ── Categories ─────────────────────────────────────────────────── */

  // The overview link sits above the categories rather than inside one.
  const overviewItem = useMemo(() => navItems.find(i => i.href === '/dashboard'), [navItems])

  const groups = useMemo(() => {
    const buckets = new Map<NavGroupId, NavItem[]>()
    for (const item of navItems) {
      if (item.href === '/dashboard') continue
      const id = classifyNavItem(item)
      const bucket = buckets.get(id)
      if (bucket) bucket.push(item)
      else buckets.set(id, [item])
    }
    buckets.get('quick')?.sort(
      (a, b) => (QUICK_RANK.get(a.href) ?? 99) - (QUICK_RANK.get(b.href) ?? 99),
    )
    return GROUP_ORDER
      .filter(id => (buckets.get(id)?.length ?? 0) > 0)
      .map(id => ({ id, items: buckets.get(id)! }))
  }, [navItems])

  const quickItems = useMemo(
    () => groups.find(g => g.id === 'quick')?.items ?? [],
    [groups],
  )

  // Which category owns the page currently open — used to auto-reveal it.
  const activeGroupId = useMemo(() => {
    const active = navItems.find(item => item.href !== '/dashboard' && isItemActive(item, pathname, navItems))
    return active ? classifyNavItem(active) : null
  }, [navItems, pathname])

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar-groups')
      if (saved) setOpenGroups(JSON.parse(saved) as Record<string, boolean>)
    } catch {}
  }, [])

  const toggleGroup = useCallback((id: NavGroupId, defaultOpen: boolean) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? defaultOpen) }
      try { localStorage.setItem('sidebar-groups', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Quick Access and the category you're currently in are open unless you
  // explicitly closed them; everything else stays folded away.
  const groupDefaultOpen = useCallback(
    (id: NavGroupId) => id === 'quick' || id === activeGroupId,
    [activeGroupId],
  )
  const isGroupOpen = useCallback(
    (id: NavGroupId) => openGroups[id] ?? groupDefaultOpen(id),
    [openGroups, groupDefaultOpen],
  )

  // ⌘K / Ctrl+K jumps to the search box from anywhere in the dashboard.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isCollapsed) {
          wantsFocusRef.current = true
          toggleCollapse()
        } else {
          searchRef.current?.focus()
          searchRef.current?.select()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, toggleCollapse])

  // Focus once the sidebar has finished expanding (from ⌘K or the collapsed icon).
  useEffect(() => {
    if (isCollapsed || !wantsFocusRef.current) return
    wantsFocusRef.current = false
    const timer = setTimeout(() => searchRef.current?.focus(), 320)
    return () => clearTimeout(timer)
  }, [isCollapsed])

  const goToItem = useCallback((item: NavItem) => {
    setQuery('')
    searchRef.current?.blur()
    if (item.external) {
      window.open(item.href, '_blank', 'noopener,noreferrer')
      return
    }
    closeMobile()
    router.push(item.href)
  }, [closeMobile, router])

  // ⌥1…⌥9 jump straight to the pinned Quick Access links.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      // e.key carries the alt-composed character on macOS, so use the code.
      const match = /^Digit([1-9])$/.exec(e.code)
      if (!match) return
      const target = quickItems[Number(match[1]) - 1]
      if (!target) return
      e.preventDefault()
      goToItem(target)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [quickItems, goToItem])

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) { e.preventDefault(); setQuery('') }
      else searchRef.current?.blur()
      return
    }
    if (!visibleItems.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % visibleItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + visibleItems.length) % visibleItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = visibleItems[activeIndex]
      if (target) goToItem(target.item)
    }
  }

  const expandAndSearch = () => {
    wantsFocusRef.current = true
    toggleCollapse()
  }

  const lockedMeta = !canFilter && countryFilter && countryFilter !== 'ALL'
    ? COUNTRY_META[countryFilter]
    : null

  return (
    <>
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
          'w-[260px]',
          isCollapsed && 'lg:w-16',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        )}
      >
        <button
          onClick={closeMobile}
          className="lg:hidden absolute top-3 right-3 z-10 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

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
                src="/png/apple-logo.png"
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

          {role && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/8 border border-brand-500/20',
              isCollapsed && 'lg:hidden',
            )}>
              <div className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
              <span className="text-brand-400 text-[11px] font-semibold">{ROLE_LABELS[role]}</span>
            </div>
          )}

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
                  <CountryFlag country={pill.value} className="w-5 h-4" />                    <span>{pill.short}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!canFilter && role && role !== 'CLIENT' && (
            <div className={cn('mt-3', isCollapsed && 'lg:hidden')}>
              <p className="text-slate-600 text-[9px] uppercase tracking-widest font-semibold px-1 mb-1.5">
                Operating Country
              </p>
              {lockedMeta ? (
                <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${lockedMeta.color}`}>
                  <CountryFlag country={countryFilter} className="w-8 h-6 flex-shrink-0" />                  <div className="flex-1 min-w-0">
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

        <div className={cn('flex-shrink-0 px-3 pt-3', isCollapsed && 'lg:px-2')}>
          <button
            onClick={expandAndSearch}
            title="Search menu (⌘K)"
            aria-label="Search menu"
            className={cn(
              'hidden w-full items-center justify-center rounded-xl py-2',
              'bg-slate-800/60 border border-slate-700/50 text-slate-500',
              'hover:text-brand-400 hover:border-brand-500/40 transition-colors',
              isCollapsed && 'lg:flex',
            )}
          >
            <Search className="w-4 h-4" />
          </button>

          <div className={cn('relative', isCollapsed && 'lg:hidden')}>
            {/* Soft gradient halo that lights up while the field is focused */}
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute -inset-[2px] rounded-xl blur-[3px] transition-opacity duration-300',
                'bg-gradient-to-r from-brand-500/50 via-brand-400/25 to-transparent',
                isSearchFocused ? 'opacity-100' : 'opacity-0',
              )}
            />
            <div className={cn(
              'relative flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors',
              'bg-slate-800/70 border',
              isSearchFocused ? 'border-brand-500/50' : 'border-slate-700/50',
            )}>
              <Search className={cn(
                'w-3.5 h-3.5 flex-shrink-0 transition-colors',
                isSearchFocused || query ? 'text-brand-400' : 'text-slate-500',
              )} />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="Quick jump…"
                aria-label="Search menu"
                className="flex-1 min-w-0 bg-transparent text-[12px] text-white placeholder:text-slate-500 outline-none"
              />
              {query ? (
                <button
                  onClick={() => { setQuery(''); searchRef.current?.focus() }}
                  aria-label="Clear search"
                  className="p-0.5 rounded text-slate-500 hover:text-white hover:bg-slate-700/70 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : (
                <kbd className="hidden lg:block px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/70 text-slate-500 text-[9px] font-sans font-semibold">
                  ⌘K
                </kbd>
              )}
            </div>

            {query && (
              <div className="flex items-center justify-between px-1.5 mt-1.5">
                <span className="text-slate-500 text-[9px] uppercase tracking-widest font-semibold">
                  {visibleItems.length} {visibleItems.length === 1 ? 'match' : 'matches'}
                </span>
                {visibleItems.length > 0 && (
                  <span className="flex items-center gap-1 text-slate-600 text-[9px] font-semibold">
                    <CornerDownLeft className="w-2.5 h-2.5" /> open
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto scrollbar-hide">
          {/* Searching flattens every category into one keyboard-driven list. */}
          {query ? (
            <>
              <p className={cn(
                'text-slate-500 text-[10px] uppercase tracking-wider font-semibold px-5 mb-2',
                isCollapsed && 'lg:hidden',
              )}>
                Search Results
              </p>

              {visibleItems.length === 0 ? (
                <div className={cn('px-5 py-6 flex flex-col items-center gap-2 text-center', isCollapsed && 'lg:hidden')}>
                  <SearchX className="w-6 h-6 text-slate-700" />
                  <p className="text-slate-500 text-xs">
                    No menu item matches <span className="text-slate-300 font-medium">“{query}”</span>
                  </p>
                </div>
              ) : (
                <ul className={cn('space-y-0.5 px-2', isCollapsed && 'lg:px-1')}>
                  {visibleItems.map(({ item, positions }, index) => (
                    <li key={item.href}>
                      <NavRow
                        item={item}
                        positions={positions}
                        isActive={isItemActive(item, pathname, navItems)}
                        isHighlighted={index === activeIndex}
                        isCollapsed={isCollapsed}
                        groupLabel={GROUP_META[classifyNavItem(item)].label}
                        onNavigate={() => { setQuery(''); closeMobile() }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className={cn('px-2 space-y-1', isCollapsed && 'lg:px-1')}>
              <p className={cn(
                'text-slate-500 text-[10px] uppercase tracking-wider font-semibold px-3 mb-1',
                isCollapsed && 'lg:hidden',
              )}>
                {role ? ROLE_LABELS[role] : 'Navigation'}
              </p>

              {overviewItem && (
                <NavRow
                  item={overviewItem}
                  positions={[]}
                  isActive={pathname === '/dashboard'}
                  isHighlighted={false}
                  isCollapsed={isCollapsed}
                  onNavigate={closeMobile}
                />
              )}

              {groups.map(group => {
                const meta = GROUP_META[group.id]
                const GroupIcon = meta.icon
                const open = isGroupOpen(group.id)
                const holdsActive = activeGroupId === group.id
                const isQuick = group.id === 'quick'

                return (
                  <div
                    key={group.id}
                    className={cn(
                      'pt-1',
                      // Collapsed rail has no labels, so hairlines carry the grouping.
                      isCollapsed && 'lg:mt-1 lg:pt-1 lg:border-t lg:border-slate-800',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id, groupDefaultOpen(group.id))}
                      aria-expanded={open}
                      title={`${meta.label} · ${group.items.length}`}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors group/head',
                        'hover:bg-slate-800/60',
                        isCollapsed && 'lg:justify-center lg:px-0 lg:py-0.5 lg:pointer-events-none lg:hover:bg-transparent',
                      )}
                    >
                      <GroupIcon className={cn(
                        'w-3.5 h-3.5 flex-shrink-0 transition-colors',
                        holdsActive ? meta.accent : 'text-slate-500 group-hover/head:text-slate-300',
                        isCollapsed && 'lg:w-3 lg:h-3',
                      )} />
                      <span className={cn(
                        'text-[10px] uppercase tracking-widest font-bold transition-colors',
                        holdsActive ? 'text-slate-200' : 'text-slate-500 group-hover/head:text-slate-300',
                        isCollapsed && 'lg:hidden',
                      )}>
                        {meta.label}
                      </span>
                      {holdsActive && !open && (
                        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', meta.dot, isCollapsed && 'lg:hidden')} />
                      )}
                      <span className={cn(
                        'ml-auto text-[9px] font-semibold text-slate-600 tabular-nums',
                        isCollapsed && 'lg:hidden',
                      )}>
                        {group.items.length}
                      </span>
                      <ChevronDown className={cn(
                        'w-3 h-3 flex-shrink-0 text-slate-600 transition-transform duration-200',
                        !open && '-rotate-90',
                        isCollapsed && 'lg:hidden',
                      )} />
                    </button>

                    <ul className={cn(
                      'mt-0.5 space-y-0.5 ml-3.5 pl-2 border-l',
                      meta.rail,
                      isQuick && 'py-0.5',
                      !open && 'hidden',
                      // Collapsed rail always shows every icon, folded or not.
                      isCollapsed && 'lg:block lg:mt-0 lg:ml-0 lg:pl-0 lg:border-l-0',
                    )}>
                      {group.items.map(item => (
                        <li key={item.href}>
                          <NavRow
                            item={item}
                            positions={[]}
                            isActive={isItemActive(item, pathname, navItems)}
                            isHighlighted={false}
                            isCollapsed={isCollapsed}
                            quickIndex={isQuick ? group.items.indexOf(item) : undefined}
                            onNavigate={closeMobile}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </nav>

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
              onClick={async () => {
                // Redirect ourselves instead of letting NextAuth use NEXTAUTH_URL,
                // which points at a different host than the one being browsed.
                await signOut({ redirect: false })
                window.location.href = '/login'
              }}
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
