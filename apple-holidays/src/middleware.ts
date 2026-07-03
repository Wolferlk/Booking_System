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

    // Non-client users trying to access portal without admin privileges
    if (pathname.startsWith('/portal') && role !== 'CLIENT' && !ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Admin-only routes
    if (pathname.startsWith('/dashboard/admin')) {
      // Mail Inbox is available to all internal staff roles
      if (pathname.startsWith('/dashboard/admin/mail-inbox') && MAIL_INBOX_ROLES.includes(role)) {
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
    //   uploads  — static file serving
    //   pnl-by-isnumber — intentionally public IS-number lookup
    '/api/((?!auth|public|cron|webhooks|vendor|uploads|pnl-by-isnumber).*)',
  ],
}
