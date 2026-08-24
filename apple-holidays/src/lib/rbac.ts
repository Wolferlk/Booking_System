import type { UserRole } from '@prisma/client'
import type { OperationCountry } from './country-detection'

export const ROLES = {
  BT_USER:           'BT_USER',
  GT_USER:           'GT_USER',
  GT_VN_USER:        'GT_VN_USER',
  TE_USER:           'TE_USER',
  GT_TE_USER:        'GT_TE_USER',
  AC_USER:           'AC_USER',
  CLIENT:            'CLIENT',
  RS_USER:           'RS_USER',
  SUPER_ADMIN:       'SUPER_ADMIN',
  ULTRA_SUPER_ADMIN: 'ULTRA_SUPER_ADMIN',
} as const

// Role display names
export const ROLE_LABELS: Record<UserRole, string> = {
  BT_USER:           'Booking Team',
  GT_USER:           'Ground Team',
  GT_VN_USER:        'Vietnam Ground (Limited)',
  TE_USER:           'Travel Experience',
  GT_TE_USER:        'Ground & Travel Experience',
  AC_USER:           'Accounts Team',
  RS_USER:           'Reservation Team',
  CLIENT:            'Client / Agent',
  SUPER_ADMIN:       'Country Admin',
  ULTRA_SUPER_ADMIN: 'Ultra Super Admin',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  BT_USER:           'blue',
  GT_USER:           'green',
  GT_VN_USER:        'green',
  TE_USER:           'purple',
  GT_TE_USER:        'teal',
  AC_USER:           'orange',
  RS_USER:           'indigo',
  CLIENT:            'gray',
  SUPER_ADMIN:       'red',
  ULTRA_SUPER_ADMIN: 'gold',
}

// Country-role guardrails used by admin provisioning and backend access checks.
export const ROLE_COUNTRY_SCOPE: Record<UserRole, OperationCountry[]> = {
  BT_USER:           ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA'],
  GT_USER:           ['VIETNAM'],
  GT_VN_USER:        ['VIETNAM'],
  TE_USER:           ['VIETNAM'],
  GT_TE_USER:        ['SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA'],
  AC_USER:           ['ALL'],
  RS_USER:           ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA', 'ALL'],
  CLIENT:            ['ALL'],
  SUPER_ADMIN:       ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA', 'ALL'],
  ULTRA_SUPER_ADMIN: ['ALL'],
}

// Permission definitions
export type Permission =
  | 'booking:create'
  | 'booking:read'
  | 'booking:edit'
  | 'booking:confirm'
  | 'booking:submit_ground'
  | 'booking:ground_review'
  | 'booking:resubmit'
  | 'booking:verify'
  | 'booking:cancel'
  | 'booking:set_country'
  | 'agenda:create'
  | 'agenda:read'
  | 'agenda:edit'
  | 'assignment:create'
  | 'assignment:edit'
  | 'ticket:create'
  | 'ticket:read'
  | 'ticket:purchase'
  | 'pnl:create'
  | 'pnl:read'
  | 'pnl:edit'
  | 'pnl:confirm_payment'
  | 'pnl:view_profit'
  | 'payment:create'
  | 'payment:read'
  | 'contact:create'
  | 'reminder:create'
  | 'recheck:confirm'
  | 'reservation:read'
  | 'reservation:create'
  | 'reservation:edit'
  | 'reservation:confirm'
  | 'reservation:cancel'
  | 'reservation:contact'
  | 'contract:read'
  | 'contract:edit'
  | 'invoice:read'
  | 'invoice:verify'
  | 'invoice:forward'
  // Proforma Invoice component — filing a supplier invoice against a booking's
  // hotel. Separate from `invoice:*`, which guards the Reservation Team's
  // deadline pipeline: the desks are different, and so is the audience.
  | 'proforma:read'
  | 'proforma:manage'
  | 'creditnote:read'
  | 'creditnote:manage'
  | 'portal:read'
  | 'portal:request_update'
  | 'portal:contact_driver'
  | 'user:manage'
  | 'user:manage_critical'
  | 'audit:read'
  | 'admin:override'

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  BT_USER: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm',
    'booking:submit_ground', 'booking:resubmit',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'pnl:create', 'pnl:read', 'pnl:edit',
    // Read-only: the desk must know whether a hotel is actually secured before
    // promising it to a client.
    'reservation:read',
    // The Booking desk files hotel proformas against the booking it sold.
    'proforma:read', 'proforma:manage',
  ],
  GT_USER: [
    'booking:create', 'booking:read', 'booking:edit',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:read',
  ],
  // Vietnam Ground Team — Limited. Same ground work as GT_USER (agenda, driver
  // allocation, tickets) but a locked-down surface: dashboard, bookings list,
  // booking detail, the booking P&L (read only — that page is the Accounts
  // Detailed P&L costing sheet the tickets are built from), the MC Report, the
  // Ops Board and the driver and vehicle-vendor registries. No admin tools.
  //
  // It also runs the live customer-facing steps the Vietnam desk owns: the
  // portal link, the booking WhatsApp messages (T-7 confirmation and the T-3
  // full details + vouchers), the daily trip-detail sends, and corrections to
  // contact numbers and meal preferences. `booking:edit` is deliberately NOT
  // granted — those two corrections are allowed by a field allowlist in
  // `api/bookings/[ref]/route.ts` rather than by opening the whole file.
  GT_VN_USER: [
    'booking:read',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:read',
  ],
  TE_USER: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm', 'booking:submit_ground',
    'booking:ground_review', 'booking:verify', 'booking:cancel',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'ticket:read',
    'pnl:create', 'pnl:read', 'pnl:edit',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
    // Read-along: pre-checking already puts these stays in front of them.
    'reservation:read',
  ],
  // Combined Ground + Travel Experience (Sri Lanka, Singapore/Malaysia)
  GT_TE_USER: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm', 'booking:submit_ground',
    'booking:ground_review', 'booking:verify', 'booking:cancel',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:create', 'pnl:read', 'pnl:edit',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
    // Read-along: pre-checking already puts these stays in front of them.
    'reservation:read',
  ],
  // Reservation Team — owns the supplier side of every hotel stay.
  //
  // `pnl:edit`, `pnl:confirm_payment` and `payment:create` are deliberately NOT
  // granted. Reservation *requests* payment by forwarding a verified proforma;
  // Accounts *releases* it. Collapsing those two into one role would remove the
  // only separation of duty on outgoing supplier money.
  //
  // `booking:edit` is likewise withheld — a reservation must never rewrite the
  // accommodation line it is measured against, or the accuracy gate would be
  // comparing a value to itself.
  RS_USER: [
    'booking:read',
    'agenda:read',
    'pnl:read',
    'contact:create',
    'reminder:create',
    'reservation:read', 'reservation:create', 'reservation:edit',
    'reservation:confirm', 'reservation:cancel', 'reservation:contact',
    'contract:read', 'contract:edit',
    'invoice:read', 'invoice:verify', 'invoice:forward',
    'proforma:read', 'proforma:manage',
    'creditnote:read', 'creditnote:manage',
  ],
  AC_USER: [
    'booking:create', 'booking:read', 'booking:edit',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'ticket:read',
    'pnl:create', 'pnl:read', 'pnl:edit', 'pnl:confirm_payment', 'pnl:view_profit',
    'payment:read',
    'reservation:read',
    'invoice:read', 'invoice:verify',
    // Read-only here: Accounts acts on a proforma in its own system, where the
    // payment slip and the Payable 1.0 line are.
    'proforma:read',
    'creditnote:read', 'creditnote:manage',
    'contract:read',
  ],
  CLIENT: [
    'portal:read',
    'portal:request_update',
    'portal:contact_driver',
    'payment:read',
  ],
  // Country-scoped admin (full access within their assigned country)
  SUPER_ADMIN: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm',
    'booking:submit_ground', 'booking:ground_review', 'booking:resubmit',
    'booking:verify', 'booking:cancel', 'booking:set_country',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:create', 'pnl:read', 'pnl:edit', 'pnl:confirm_payment', 'pnl:view_profit',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
    'portal:read', 'portal:request_update', 'portal:contact_driver',
    'reservation:read', 'reservation:create', 'reservation:edit',
    'reservation:confirm', 'reservation:cancel', 'reservation:contact',
    'contract:read', 'contract:edit',
    'invoice:read', 'invoice:verify', 'invoice:forward',
    // Read-only on purpose: the Proforma Invoice component's write audience was
    // specified as the Booking desk, the Reservation Team and Ultra Super Admin.
    'proforma:read',
    'creditnote:read', 'creditnote:manage',
    'user:manage',
    'audit:read',
    'admin:override',
  ],
  // Ultra Super Admin — all countries, critical services password required
  ULTRA_SUPER_ADMIN: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm',
    'booking:submit_ground', 'booking:ground_review', 'booking:resubmit',
    'booking:verify', 'booking:cancel', 'booking:set_country',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:create', 'pnl:read', 'pnl:edit', 'pnl:confirm_payment', 'pnl:view_profit',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
    'portal:read', 'portal:request_update', 'portal:contact_driver',
    'reservation:read', 'reservation:create', 'reservation:edit',
    'reservation:confirm', 'reservation:cancel', 'reservation:contact',
    'contract:read', 'contract:edit',
    'invoice:read', 'invoice:verify', 'invoice:forward',
    'proforma:read', 'proforma:manage',
    'creditnote:read', 'creditnote:manage',
    'user:manage', 'user:manage_critical',
    'audit:read',
    'admin:override',
  ],
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p))
}

export function isRoleAllowedInCountry(role: UserRole, country: OperationCountry): boolean {
  return ROLE_COUNTRY_SCOPE[role]?.includes(country) ?? false
}

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Forbidden: role ${role} lacks permission ${permission}`)
  }
}

// Roles that can see all countries' data regardless of their country field
export const ALL_COUNTRY_ROLES: UserRole[] = ['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN']

export function canSeeAllCountries(role: UserRole, country: OperationCountry): boolean {
  if (role === 'ULTRA_SUPER_ADMIN') return true
  if (role === 'SUPER_ADMIN' && country === 'ALL') return true
  return false
}

// Dashboard nav items per role
export const NAV_ITEMS: Record<UserRole, { label: string; href: string; icon: string }[]> = {
  BT_USER: [
    { label: 'Dashboard',       href: '/dashboard',              icon: 'LayoutDashboard' },
    { label: 'Bookings',        href: '/dashboard/bookings',     icon: 'FileText' },
    { label: 'New Booking',     href: '/dashboard/bookings/new', icon: 'PlusCircle' },
    { label: 'Change Requests', href: '/dashboard/change-requests', icon: 'AlertCircle' },
    { label: 'Proforma Invoice',href: '/dashboard/proforma',         icon: 'ReceiptText' },
  ],
  GT_USER: [
    { label: 'Dashboard',      href: '/dashboard',                  icon: 'LayoutDashboard' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',     icon: 'PlusCircle' },
    { label: 'Review Queue',   href: '/dashboard/ground/review',    icon: 'ClipboardCheck' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'Tickets',        href: '/dashboard/ground/tickets',   icon: 'Ticket' },
    { label: 'Drivers',        href: '/dashboard/ground/drivers',   icon: 'Car' },
  ],
  GT_VN_USER: [
    { label: 'Vietnam Dashboard', href: '/dashboard',                  icon: 'LayoutDashboard' },
    { label: 'All Bookings',      href: '/dashboard/bookings',         icon: 'FileText' },
    { label: 'Ops Board',         href: '/dashboard/accounts/reports', icon: 'ClipboardCheck' },
    { label: 'Drivers',           href: '/dashboard/ground/drivers',   icon: 'Car' },
    { label: 'Vendors',           href: '/dashboard/ground/vendors',   icon: 'Building2' },
  ],
  TE_USER: [
    { label: 'Dashboard',  href: '/dashboard',              icon: 'LayoutDashboard' },
    { label: 'New Booking', href: '/dashboard/bookings/new', icon: 'PlusCircle' },
    { label: 'Bookings',   href: '/dashboard/bookings',     icon: 'FileText' },
    { label: 'Contacts',   href: '/dashboard/te/contacts',  icon: 'Phone' },
    { label: 'Reminders',  href: '/dashboard/te/reminders', icon: 'Bell' },
    { label: 'Payments',   href: '/dashboard/te/payments',  icon: 'CreditCard' },
  ],
  GT_TE_USER: [
    { label: 'Dashboard',      href: '/dashboard',                    icon: 'LayoutDashboard' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',       icon: 'PlusCircle' },
    { label: 'Bookings',       href: '/dashboard/bookings',           icon: 'FileText' },
    { label: 'Review Queue',   href: '/dashboard/ground/review',      icon: 'ClipboardCheck' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'Tickets',        href: '/dashboard/ground/tickets',     icon: 'Ticket' },
    { label: 'Drivers',        href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Vehicles',       href: '/dashboard/ground/vehicles',    icon: 'Truck' },
    { label: 'Vendors',        href: '/dashboard/ground/vendors',     icon: 'Building2' },
    { label: 'Reminders',      href: '/dashboard/te/reminders',       icon: 'Bell' },
    { label: 'Payments',       href: '/dashboard/te/payments',        icon: 'CreditCard' },
  ],
  AC_USER: [
    { label: 'Dashboard',      href: '/dashboard',                     icon: 'LayoutDashboard' },
    { label: 'New Booking',    href: '/dashboard/bookings/new',        icon: 'PlusCircle' },
    { label: 'Bookings',       href: '/dashboard/bookings',            icon: 'FileText' },
    { label: 'P&L',            href: '/dashboard/accounts/pnl',       icon: 'BarChart2' },
    { label: 'Profit',         href: '/dashboard/accounts/profit',    icon: 'TrendingUp' },
    { label: 'Credit Agents',  href: '/dashboard/accounts/credit-agents', icon: 'CreditCard' },
    { label: 'Cancellations',  href: '/dashboard/accounts/cancellations', icon: 'XCircle' },
    { label: 'Reports',        href: '/dashboard/accounts/reports',   icon: 'Download' },
    { label: 'Proforma Invoice',href: '/dashboard/proforma',           icon: 'ReceiptText' },
  ],
  // Kept in step with NAV_ITEMS.RS_USER in components/layout/sidebar.tsx and
  // with RS_BLOCKED_PAGES in middleware.ts.
  RS_USER: [
    { label: 'Confirm Booking Hotels', href: '/dashboard/confirm-hotels',     icon: 'CalendarCheck2' },
    { label: 'Request Inbox',   href: '/dashboard/reservations/requests',     icon: 'Inbox' },
    { label: 'Hotels & Rates',  href: '/dashboard/reservations/hotels',       icon: 'Building2' },
    { label: 'Proforma Invoice',href: '/dashboard/proforma',                  icon: 'ReceiptText' },
    { label: 'All Bookings',    href: '/dashboard/bookings',                  icon: 'FileText' },
  ],
  CLIENT: [
    { label: 'My Trip', href: '/portal', icon: 'Globe' },
  ],
  SUPER_ADMIN: [
    { label: 'Dashboard',  href: '/dashboard',                  icon: 'LayoutDashboard' },
    { label: 'All Bookings', href: '/dashboard/bookings',       icon: 'FileText' },
    { label: 'Cancellations', href: '/dashboard/accounts/cancellations', icon: 'XCircle' },
    { label: 'Reports',    href: '/dashboard/accounts/reports', icon: 'Download' },
    { label: 'Users',      href: '/dashboard/admin/users',      icon: 'Users' },
    { label: 'Audit Log',  href: '/dashboard/admin/audit',      icon: 'Shield' },
    { label: 'Drivers',    href: '/dashboard/ground/drivers',   icon: 'Car' },
    { label: 'Vehicles',   href: '/dashboard/ground/vehicles',  icon: 'Truck' },
    { label: 'Config',     href: '/dashboard/admin/config',     icon: 'Settings' },
    { label: 'Proforma Invoice', href: '/dashboard/proforma',    icon: 'ReceiptText' },
  ],
  ULTRA_SUPER_ADMIN: [
    { label: 'Dashboard',    href: '/dashboard',                    icon: 'LayoutDashboard' },
    { label: 'All Bookings', href: '/dashboard/bookings',           icon: 'FileText' },
    { label: 'Mail Inbox',   href: '/dashboard/admin/mail-inbox',   icon: 'Mail' },
    { label: 'Cancellations',href: '/dashboard/accounts/cancellations', icon: 'XCircle' },
    { label: 'Reports',      href: '/dashboard/accounts/reports',   icon: 'Download' },
    { label: 'Users',        href: '/dashboard/admin/users',        icon: 'Users' },
    { label: 'Audit Log',    href: '/dashboard/admin/audit',        icon: 'Shield' },
    { label: 'Drivers',      href: '/dashboard/ground/drivers',     icon: 'Car' },
    { label: 'Config',       href: '/dashboard/admin/config',       icon: 'Settings' },
    { label: 'Proforma Invoice', href: '/dashboard/proforma',      icon: 'ReceiptText' },
  ],
}
