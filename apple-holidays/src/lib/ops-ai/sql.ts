import { prisma } from '@/lib/prisma'

/**
 * Read-only SQL gate for OPS_AI.
 *
 * The copilot may run ONE `SELECT` (or `WITH … SELECT`) and read rows back —
 * nothing else. Every layer here is a hard stop, not a hint:
 *
 *   • exactly one statement (no `;`-chained second query)
 *   • must begin with SELECT / WITH
 *   • no SQL comments (they are the classic way to smuggle payloads)
 *   • a whole-word blocklist of every write / DDL / side-effecting keyword
 *   • a LIMIT is forced on, and the row set is capped again in JS
 *   • a MySQL MAX_EXECUTION_TIME hint bounds a runaway scan
 *
 * Country scoping cannot be enforced on free-form SQL, so this is deliberately
 * read-only and its use is written to the activity log by the caller.
 */

const MAX_ROWS = 200
const MAX_EXECUTION_MS = 5000

// Whole-word — anything that writes, changes structure, or has side effects.
const BLOCKED = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'replace', 'merge', 'grant', 'revoke', 'rename', 'call', 'do', 'handler',
  'lock', 'unlock', 'load', 'outfile', 'dumpfile', 'into', 'set',
  'prepare', 'execute', 'deallocate', 'use', 'commit', 'rollback',
  'savepoint', 'start', 'begin', 'analyze', 'optimize', 'repair', 'flush',
  'reset', 'shutdown', 'kill', 'sleep', 'benchmark',
]

export type SqlResult =
  | { ok: true; sql: string; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: string }

/** JSON-safe: MySQL returns BigInt for COUNT/SUM and Date objects for dates. */
function normaliseValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  if (v instanceof Date) return v.toISOString()
  if (Buffer.isBuffer(v)) return `<${v.length} bytes>`
  return v
}

function normaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = normaliseValue(v)
  return out
}

export async function runReadonlySql(rawSql: string): Promise<SqlResult> {
  let sql = String(rawSql ?? '').trim()

  if (!sql) return { ok: false, error: 'Empty query.' }
  if (sql.length > 4000) return { ok: false, error: 'Query is too long.' }

  // No comments — they are the standard blocklist-bypass vector.
  if (/--|#|\/\*/.test(sql)) {
    return { ok: false, error: 'SQL comments are not allowed.' }
  }

  // Exactly one statement: drop a single trailing ';', then reject any that remain.
  sql = sql.replace(/;\s*$/, '')
  if (sql.includes(';')) {
    return { ok: false, error: 'Only a single SELECT statement is allowed.' }
  }

  const lower = sql.toLowerCase()
  if (!/^(select|with)\b/.test(lower)) {
    return { ok: false, error: 'Only SELECT queries are allowed (optionally a WITH … SELECT).' }
  }

  const hit = BLOCKED.find(kw => new RegExp(`\\b${kw}\\b`, 'i').test(lower))
  if (hit) {
    return { ok: false, error: `Keyword "${hit.toUpperCase()}" is not allowed in a read-only query.` }
  }

  // Force a row ceiling if the author didn't set one.
  let finalSql = sql
  if (!/\blimit\s+\d/i.test(lower)) {
    finalSql = `${finalSql} LIMIT ${MAX_ROWS}`
  }

  // Bound execution time on plain SELECTs (the hint is only valid there).
  if (/^select\b/i.test(finalSql)) {
    finalSql = finalSql.replace(/^select/i, `SELECT /*+ MAX_EXECUTION_TIME(${MAX_EXECUTION_MS}) */`)
  }

  try {
    const result = (await prisma.$queryRawUnsafe(finalSql)) as unknown
    const rowsRaw = Array.isArray(result) ? (result as Record<string, unknown>[]) : []
    const truncated = rowsRaw.length > MAX_ROWS
    const rows = rowsRaw.slice(0, MAX_ROWS).map(normaliseRow)
    const columns = rows.length ? Object.keys(rows[0]) : []
    return { ok: true, sql: finalSql, columns, rows, truncated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Surface the DB's own message (truncated) — it is the most useful feedback.
    return { ok: false, error: `Query failed: ${msg.slice(0, 300)}` }
  }
}
