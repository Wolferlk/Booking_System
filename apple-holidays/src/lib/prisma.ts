import { PrismaClient } from '@prisma/client'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaDatabaseUrl?: string
}

function buildMysqlUrlFromParts() {
  const host = process.env.DB_HOST?.trim()
  const port = process.env.DB_PORT?.trim() ?? '3306'
  const database = process.env.DB_DATABASE?.trim()
  const username = process.env.DB_USERNAME?.trim()
  const password = process.env.DB_PASSWORD

  if (!host || !database || !username || password == null) return null

  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
  return `mysql://${auth}@${host}:${port}/${database}`
}

function resolveDatabaseUrl() {
  const directUrl =
    process.env.DIRECT_DATABASE_URL?.trim() ||
    process.env.MYSQL_DATABASE_URL?.trim() ||
    process.env.MYSQL_URL?.trim()

  const mysqlUrl = buildMysqlUrlFromParts()
  const envUrl = process.env.DATABASE_URL?.trim()

  if (mysqlUrl) return mysqlUrl
  if (directUrl) return directUrl
  if (envUrl && !envUrl.startsWith('prisma://') && !envUrl.startsWith('prisma+postgres://')) {
    return envUrl
  }

  return envUrl ?? undefined
}

// Always cache on globalThis — prevents multiple PrismaClient instances across
// hot reloads (dev) AND across Next.js module re-evaluations in production
// which was causing prisma.mailMessage to appear undefined.
export const prisma =
  (globalForPrisma.prisma &&
  globalForPrisma.prismaDatabaseUrl === resolveDatabaseUrl()
    ? globalForPrisma.prisma
    : undefined) ??
  (() => {
    const databaseUrl = resolveDatabaseUrl()
    if (databaseUrl) {
      process.env.DATABASE_URL = databaseUrl
    }
    if (globalForPrisma.prisma && globalForPrisma.prismaDatabaseUrl !== databaseUrl) {
      void globalForPrisma.prisma.$disconnect().catch(() => {})
    }
    globalForPrisma.prismaDatabaseUrl = databaseUrl
    return (globalForPrisma.prisma = new PrismaClient({
      datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    }))
  })()
