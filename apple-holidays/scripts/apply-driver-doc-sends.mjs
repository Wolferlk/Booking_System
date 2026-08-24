/**
 * Create `sl_driver_doc_sends` — the driver-document delivery receipts.
 *
 *   node scripts/apply-driver-doc-sends.mjs                 # dry run: says what it would do
 *   node scripts/apply-driver-doc-sends.mjs --apply         # create the table
 *   node scripts/apply-driver-doc-sends.mjs --apply --database=apple_holidays_testing
 *   node scripts/apply-driver-doc-sends.mjs --apply --host=… --user=… --database=…
 *
 * The dev site runs against a different server from the live one, so applying
 * it there means passing --host as well as --database.
 *
 * ---- Why a script and not `prisma db execute` ----
 *
 * Two reasons, both of which have bitten this repository before.
 *
 * 1. This project's `.env` defines `DB_DATABASE` twice. Whichever loader runs
 *    last decides, and the answer is not the booking system — so a bare
 *    `prisma db execute` can quietly create the table in the wrong schema. This
 *    script parses `.env` taking the FIRST value of each key and prints the
 *    database it is about to touch before touching it.
 *
 * 2. The live database carries schema drift that `prisma db push` would try to
 *    "correct". Nothing here goes near `push`: one `CREATE TABLE IF NOT EXISTS`
 *    is executed and nothing else. No existing table, column or row is read,
 *    altered, dropped or rewritten, and running it twice is a no-op.
 *
 * It refuses to do anything at all without `--apply`, so the default outcome of
 * running it by accident is a printed plan.
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const has  = flag => args.includes(flag)
const opt  = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

/** `.env`, first value of each key wins — the opposite of what the loaders do. */
function readEnvFile(path = '.env') {
  const out = {}
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    if (m[1] in out) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const file = readEnvFile()
const pick = key => process.env[key] ?? file[key]

const database = opt('database') ?? pick('DB_DATABASE_BOOKING') ?? 'apple_booking_system'
const host     = opt('host') ?? pick('DB_HOST')
const port     = opt('port') ?? pick('DB_PORT') ?? '3306'
const user     = opt('user') ?? pick('DB_USERNAME')
const password = pick('DB_PASSWORD')

if (!host || !user || password == null) {
  console.error('✖ DB_HOST / DB_USERNAME / DB_PASSWORD are not set. Nothing was done.')
  process.exit(1)
}

const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`

const TABLE = 'sl_driver_doc_sends'

const CREATE = `
CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
    \`id\`            VARCHAR(191) NOT NULL,
    \`bookingRef\`    VARCHAR(191) NOT NULL,
    \`kind\`          VARCHAR(32)  NOT NULL,
    \`audience\`      VARCHAR(16)  NOT NULL DEFAULT 'driver',
    \`driverId\`      VARCHAR(191) NULL,
    \`driverName\`    VARCHAR(191) NULL,
    \`phone\`         VARCHAR(32)  NOT NULL,
    \`channel\`       VARCHAR(16)  NULL,
    \`docs\`          VARCHAR(255) NULL,
    \`filename\`      VARCHAR(255) NULL,
    \`mediaUrl\`      TEXT         NULL,
    \`body\`          TEXT         NULL,
    \`waMessageId\`   VARCHAR(191) NULL,
    \`status\`        VARCHAR(24)  NOT NULL DEFAULT 'pending',
    \`failureReason\` TEXT         NULL,
    \`sentAt\`        DATETIME(3)  NULL,
    \`deliveredAt\`   DATETIME(3)  NULL,
    \`readAt\`        DATETIME(3)  NULL,
    \`failedAt\`      DATETIME(3)  NULL,
    \`copyOfId\`      VARCHAR(191) NULL,
    \`copyLabel\`     VARCHAR(191) NULL,
    \`sentById\`      VARCHAR(191) NULL,
    \`sentByName\`    VARCHAR(191) NULL,
    \`createdAt\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`),
    INDEX \`${TABLE}_bookingRef_idx\`  (\`bookingRef\`),
    INDEX \`${TABLE}_waMessageId_idx\` (\`waMessageId\`),
    INDEX \`${TABLE}_phone_idx\`       (\`phone\`, \`createdAt\`),
    INDEX \`${TABLE}_status_idx\`      (\`status\`),
    INDEX \`${TABLE}_createdAt_idx\`   (\`createdAt\`),
    INDEX \`${TABLE}_copyOfId_idx\`    (\`copyOfId\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`

const prisma = new PrismaClient({ datasources: { db: { url } } })

try {
  console.log(`host      ${host}:${port}`)
  console.log(`database  ${database}`)
  console.log(`table     ${TABLE}`)

  const before = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    database, TABLE,
  )
  const exists = Number(before?.[0]?.n ?? 0) > 0

  if (exists) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${TABLE}\``)
    console.log(`\n✓ Already there — ${Number(rows?.[0]?.n ?? 0)} receipt(s) recorded. Nothing to do.`)
    process.exit(0)
  }

  if (!has('--apply')) {
    console.log('\nThe table does not exist yet.')
    console.log('This would run one additive CREATE TABLE and touch nothing else.')
    console.log('Re-run with --apply to create it.')
    process.exit(0)
  }

  await prisma.$executeRawUnsafe(CREATE)

  const after = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
    database, TABLE,
  )
  console.log(`\n✓ Created ${TABLE} with ${Number(after?.[0]?.n ?? 0)} columns. No existing table was touched.`)
} catch (err) {
  console.error('\n✖ Failed:', err?.message ?? err)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
