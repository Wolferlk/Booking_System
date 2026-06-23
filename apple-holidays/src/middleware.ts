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
      authorized: ({ token }) => !!token,
    },
  },
)

export const config = {
  matcher: ['/dashboard/:path*', '/portal/:path*'],
}
