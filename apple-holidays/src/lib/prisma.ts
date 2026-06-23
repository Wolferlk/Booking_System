import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Always cache on globalThis — prevents multiple PrismaClient instances across
// hot reloads (dev) AND across Next.js module re-evaluations in production
// which was causing prisma.mailMessage to appear undefined.
export const prisma =
  globalForPrisma.prisma ??
  (globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  }))
