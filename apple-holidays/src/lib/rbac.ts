import type { UserRole } from '@prisma/client'

export const ROLES = {
  BT_USER: 'BT_USER',
  GT_USER: 'GT_USER',
  TE_USER: 'TE_USER',
  AC_USER: 'AC_USER',
  CLIENT: 'CLIENT',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const

// Role display names
export const ROLE_LABELS: Record<UserRole, string> = {
  BT_USER: 'Booking Team',
  GT_USER: 'Ground Team',
  TE_USER: 'Travel Experience',
  AC_USER: 'Accounts Team',
  CLIENT: 'Client / Agent',
  SUPER_ADMIN: 'Super Admin',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  BT_USER: 'blue',
  GT_USER: 'green',
  TE_USER: 'purple',
  AC_USER: 'orange',
  CLIENT: 'gray',
  SUPER_ADMIN: 'red',
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
  | 'portal:read'
  | 'portal:request_update'
  | 'portal:contact_driver'
  | 'user:manage'
  | 'audit:read'
  | 'admin:override'

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  BT_USER: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm',
    'booking:submit_ground', 'booking:resubmit',
    'agenda:create', 'agenda:read', 'agenda:edit',
  ],
  GT_USER: [
    'booking:read', 'booking:edit', 'booking:ground_review', 'booking:verify',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:read', // only after T-5
    'pnl:view_profit', // only after T-5
  ],
  TE_USER: [
    'booking:read',
    'agenda:read',
    'ticket:read',
    'pnl:read',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
  ],
  AC_USER: [
    'booking:read', 'booking:edit',
    'agenda:read',
    'ticket:read',
    'pnl:create', 'pnl:read', 'pnl:edit', 'pnl:confirm_payment', 'pnl:view_profit',
    'payment:read',
  ],
  CLIENT: [
    'portal:read',
    'portal:request_update',
    'portal:contact_driver',
    'payment:read',
  ],
  SUPER_ADMIN: [
    'booking:create', 'booking:read', 'booking:edit', 'booking:confirm',
    'booking:submit_ground', 'booking:ground_review', 'booking:resubmit',
    'booking:verify', 'booking:cancel',
    'agenda:create', 'agenda:read', 'agenda:edit',
    'assignment:create', 'assignment:edit',
    'ticket:create', 'ticket:read', 'ticket:purchase',
    'pnl:create', 'pnl:read', 'pnl:edit', 'pnl:confirm_payment', 'pnl:view_profit',
    'payment:create', 'payment:read',
    'contact:create',
    'reminder:create',
    'recheck:confirm',
    'portal:read', 'portal:request_update', 'portal:contact_driver',
    'user:manage',
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

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Forbidden: role ${role} lacks permission ${permission}`)
  }
}

// Dashboard nav items per role
export const NAV_ITEMS: Record<UserRole, { label: string; href: string; icon: string }[]> = {
  BT_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'New Booking', href: '/dashboard/bookings/new', icon: 'PlusCircle' },
    { label: 'Change Requests', href: '/dashboard/change-requests', icon: 'AlertCircle' },
  ],
  GT_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Review Queue', href: '/dashboard/ground/review', icon: 'ClipboardCheck' },
    { label: 'My Assignments', href: '/dashboard/ground/assignments', icon: 'MapPin' },
    { label: 'Tickets', href: '/dashboard/ground/tickets', icon: 'Ticket' },
    { label: 'Drivers', href: '/dashboard/ground/drivers', icon: 'Car' },
  ],
  TE_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'Contacts', href: '/dashboard/te/contacts', icon: 'Phone' },
    { label: 'Reminders', href: '/dashboard/te/reminders', icon: 'Bell' },
    { label: 'Payments', href: '/dashboard/te/payments', icon: 'CreditCard' },
  ],
  AC_USER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'P&L', href: '/dashboard/accounts/pnl', icon: 'BarChart2' },
    { label: 'Profit Dashboard', href: '/dashboard/accounts/profit', icon: 'TrendingUp' },
    { label: 'Reports', href: '/dashboard/accounts/reports', icon: 'Download' },
  ],
  CLIENT: [
    { label: 'My Trip', href: '/portal', icon: 'Globe' },
  ],
  SUPER_ADMIN: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'All Bookings', href: '/dashboard/bookings', icon: 'FileText' },
    { label: 'Reports', href: '/dashboard/accounts/reports', icon: 'Download' },
    { label: 'Users', href: '/dashboard/admin/users', icon: 'Users' },
    { label: 'Audit Log', href: '/dashboard/admin/audit', icon: 'Shield' },
    { label: 'Drivers', href: '/dashboard/ground/drivers', icon: 'Car' },
    { label: 'Vehicles', href: '/dashboard/ground/vehicles', icon: 'Truck' },
    { label: 'Config', href: '/dashboard/admin/config', icon: 'Settings' },
  ],
}
