import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const MAIL_INBOX_ROLES: UserRole[] = [
  'BT_USER',
  'GT_USER',
  'TE_USER',
  'GT_TE_USER',
  'AC_USER',
  'SUPER_ADMIN',
  'ULTRA_SUPER_ADMIN',
]

// The Query Monitor lives under /dashboard/admin but is a Booking Team tool, so
// BT_USER reaches it too. Keep in sync with lib/query-monitor/auth.ts.
const QUERY_MONITOR_ROLES: UserRole[] = [
  'BT_USER',
  'SUPER_ADMIN',
  'ULTRA_SUPER_ADMIN',
]

/**
 * Vietnam Ground Team — Limited (`GT_VN_USER`).
 *
 * Unlike every other staff role this one is allow-listed rather than
 * deny-listed: it may only reach the pages below, and any other /dashboard
 * path bounces back to the dashboard. Keep this in sync with the GT_VN_USER
 * nav list in components/layout/sidebar.tsx.
 */
const GT_VN_ALLOWED_PAGES = [
  '/dashboard/bookings',          // list + booking detail (and its agenda/tickets sub-pages)
  '/dashboard/accounts/reports',  // Ops Board
  '/dashboard/mc-report',         // MC Report
  '/dashboard/ground/drivers',    // Driver management
  '/dashboard/ground/vendors',    // Vehicle vendor management
  '/dashboard/ground/analytics',  // Partner performance (read-only analytics)
  '/dashboard/whatsapp',          // WhatsApp inbox — the desk answers guests here
] as const

/**
 * Reservation Team (`RS_USER`) — pages removed from this desk.
 *
 * Deny-listed rather than allow-listed, so RS_USER keeps everything else it
 * has always reached. These are the pages the desk asked to have taken away:
 * the Deadline Board and the flat reservations list, Contracts & Rates, the
 * reservation-side Proforma Invoices and Credit Notes, Pre-checking and the
 * MC Report — the last two never worked for this role anyway, because neither
 * `PRECHECK_ROLES` nor the MC Report API includes it.
 *
 * Only RS_USER is affected. Every other role keeps all of these pages.
 * Keep in sync with the RS_USER nav lists in components/layout/sidebar.tsx
 * and lib/rbac.ts.
 */
const RS_BLOCKED_PAGES = [
  '/dashboard/reservations/list',
  '/dashboard/reservations/contracts',
  '/dashboard/reservations/invoices',
  '/dashboard/reservations/credit-notes',
  '/dashboard/precheck',
  '/dashboard/mc-report',
] as const

/** Where a blocked RS_USER lands instead — the desk's new home page. */
const RS_HOME = '/dashboard/confirm-hotels'

function isRsPageBlocked(pathname: string): boolean {
  // The Deadline Board is the /dashboard/reservations index itself. Matched
  // exactly so the sub-pages that survive (requests, hotels) still resolve.
  if (pathname === '/dashboard/reservations' || pathname === '/dashboard/reservations/') return true
  return RS_BLOCKED_PAGES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function isGtVnPageAllowed(pathname: string): boolean {
  if (pathname === '/dashboard') return true
  // Creating bookings is outside the limited scope. The per-booking P&L page is
  // allowed: it shows the Accounts Detailed P&L costing sheet, which the
  // Vietnam ground team needs to work tickets from.
  if (pathname.startsWith('/dashboard/bookings/new')) return false
  return GT_VN_ALLOWED_PAGES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const { pathname } = req.nextUrl

    if (!token) {
      // API routes must return 401 JSON, not a login redirect
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const role = token.role as UserRole

    // Client users can only access the portal
    if (role === 'CLIENT' && pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/portal', req.url))
    }

    // Vietnam Ground (Limited) — allow-listed pages only. API calls are left to
    // the per-route role checks so the allowed pages can still load their data.
    if (role === 'GT_VN_USER' && pathname.startsWith('/dashboard') && !isGtVnPageAllowed(pathname)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Reservation Team — the pages taken off this desk. Page routes only: the
    // API routes behind them are left alone so nothing another role relies on
    // changes, and each already runs its own permission check.
    if (role === 'RS_USER' && isRsPageBlocked(pathname)) {
      return NextResponse.redirect(new URL(RS_HOME, req.url))
    }

    // Non-client users trying to access portal without admin privileges
    if (pathname.startsWith('/portal') && role !== 'CLIENT' && !ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Auto Reports can mail booking, guest and complaint detail to external
    // addresses, so configuring one is an admin action even though it does not
    // live under /dashboard/admin.
    if (pathname.startsWith('/dashboard/reports') && !ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Admin-only routes
    if (pathname.startsWith('/dashboard/admin')) {
      // Mail Inbox is available to all internal staff roles
      if (pathname.startsWith('/dashboard/admin/mail-inbox') && MAIL_INBOX_ROLES.includes(role)) {
        return NextResponse.next()
      }

      // Query Monitor is a Booking Team tool that happens to live under /admin
      if (pathname.startsWith('/dashboard/admin/query-monitor') && QUERY_MONITOR_ROLES.includes(role)) {
        return NextResponse.next()
      }

      // ULTRA_SUPER_ADMIN and SUPER_ADMIN always allowed
      if (ADMIN_ROLES.includes(role)) return NextResponse.next()

      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      // For API routes we always proceed to the middleware function so it can
      // return a proper 401 JSON response instead of a login page redirect.
      authorized: ({ token, req }) => {
        if (req.nextUrl.pathname.startsWith('/api/')) return true
        return !!token
      },
    },
  },
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/portal/:path*',
    // Protect all API routes except intentionally public ones:
    //   auth     — NextAuth sign-in/session endpoints
    //   public   — vendor/driver registration forms (no login required)
    //   cron     — Vercel cron jobs (protected by CRON_SECRET, not session)
    //   webhooks — inbound webhooks from external services
    //   vendor   — vendor portal uses its own JWT, not NextAuth
    //   filehandler — file handler portal uses its own signed cookie, not NextAuth
    //   uploads  — static file serving
    //   pnl-by-isnumber — intentionally public IS-number lookup
    '/api/((?!auth|public|cron|webhooks|vendor|filehandler|uploads|pnl-by-isnumber|bookings/full).*)',
  ],
}
