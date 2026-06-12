import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'

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
    if (pathname.startsWith('/portal') && role !== 'CLIENT' && role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Admin-only routes (mail-inbox is also accessible to BT_USER)
    if (pathname.startsWith('/dashboard/admin') && role !== 'SUPER_ADMIN') {
      const allowedForBT = ['/dashboard/admin/mail-inbox']
      if (role !== 'BT_USER' || !allowedForBT.some(p => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
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
