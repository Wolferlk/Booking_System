import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import type { UserRole } from '@prisma/client'

import type { OperationCountry } from './country-detection'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
      country: OperationCountry
      avatar?: string | null
    }
  }
  interface User {
    id: string
    email: string
    name: string
    role: UserRole
    country: OperationCountry
    avatar?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
    country: OperationCountry
    avatar?: string | null
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:           { label: 'Email',                    type: 'email' },
        password:        { label: 'Password',                 type: 'password' },
        criticalPassword: { label: 'Critical Services Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user || !user.isActive) return null

        const isValid = await bcrypt.compare(credentials.password, user.password)
        if (!isValid) return null

        // ULTRA_SUPER_ADMIN requires an additional critical services password
        if (user.role === 'ULTRA_SUPER_ADMIN') {
          const criticalPw = process.env.CRITICAL_SERVICES_PASSWORD
          if (!criticalPw) {
            console.error('[Auth] CRITICAL_SERVICES_PASSWORD env var not set')
            return null
          }
          if (!credentials.criticalPassword || credentials.criticalPassword !== criticalPw) {
            return null
          }
        }

        return {
          id:      user.id,
          email:   user.email,
          name:    user.name,
          role:    user.role,
          country: user.country,
          avatar:  user.avatar,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id      = user.id
        token.role    = user.role
        token.country = user.country
        token.avatar  = user.avatar
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id      = token.id
        session.user.role    = token.role
        session.user.country = token.country
        session.user.avatar  = token.avatar
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
}
