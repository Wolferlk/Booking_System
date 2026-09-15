import { PrismaClient } from '@prisma/client'
import { loadEnvConfig } from '@next/env'
import { applyPoolSettings, poolSettings } from './db-tuning'

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

  if (mysqlUrl) return withPool(mysqlUrl)
  if (directUrl) return withPool(directUrl)
  if (envUrl && !envUrl.startsWith('prisma://') && !envUrl.startsWith('prisma+postgres://')) {
    return withPool(envUrl)
  }

  return envUrl ?? undefined
}

/**
 * Cap the pool on whichever URL form won above.
 *
 * Doing it here rather than in the .env is deliberate: this app resolves its
 * connection string from four different sources (DB_* parts, DIRECT_DATABASE_URL,
 * MYSQL_URL, DATABASE_URL), and only one of them is the .env line an operator
 * would think to edit. Capping at the resolver means every path is capped —
 * including Amplify, where the environment is set separately and has drifted
 * from local .env before.
 *
 * `applyPoolSettings` never overwrites a parameter the URL already carries, so
 * an explicit `?connection_limit=` in the environment still wins.
 */
function withPool(url: string): string {
  return applyPoolSettings(url, poolSettings())
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
