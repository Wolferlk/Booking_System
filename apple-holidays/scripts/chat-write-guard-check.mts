/**
 * Check the chat write guard — `npm run chat:guard`.
 *
 * The guard in src/lib/chat/db.ts is what stops a chat bug reaching invoices,
 * payments or P&L over a connection privileged enough to do it. It has been wrong
 * once, in a way nobody could see: `INSERT IGNORE INTO chat_settings` is a
 * different string from `INSERT INTO`, the pattern only knew the second, and so
 * the statement that creates a person's settings row on first use was refused —
 * which made the whole of chat fail to load for every OPS user, since not one of
 * them had ever managed to get a row.
 *
 * Two questions, both answered against the real guard rather than a copy of it:
 *   1. does it accept every write this app actually issues?
 *   2. does it still refuse everything it exists to refuse?
 *
 * No database and no credentials — it reads source and tests strings.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { chatWriteAllowed } from '../src/lib/chat/db'

/* ── 1. every write the app issues ─────────────────────────────────────────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

/** The SQL literals handed to chatWrite()/tx.write(), as they are at runtime. */
function writeStatements(source: string): string[] {
  const out: string[] = []
  const call = /(?:chatWrite|tx\.write)\(\s*(`|')/g
  let match: RegExpExecArray | null

  while ((match = call.exec(source))) {
    const quote = match[1]
    let i = call.lastIndex
    let sql = ''
    while (i < source.length) {
      if (source[i] === '\\') { sql += source[i + 1]; i += 2; continue }  // resolve escapes
      if (source[i] === quote) break
      sql += source[i]; i++
    }
    out.push(sql)
  }

  return out
}

const failures: string[] = []
let issued = 0

sourceFiles(join(import.meta.dirname, '..', 'src')).forEach(file => {
  writeStatements(readFileSync(file, 'utf8')).forEach(sql => {
    issued++
    if (!chatWriteAllowed(sql)) {
      failures.push(`REFUSES a real write in ${file}\n    ${sql.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
  })
})

/* ── 2. everything it must keep refusing ───────────────────────────────────── */

const mustRefuse = [
  'UPDATE `invoices` SET `total` = 0',
  'DELETE FROM `users` WHERE 1',
  'INSERT INTO `generated_invoices` (`x`) VALUES (1)',
  'INSERT IGNORE INTO `users` (`id`) VALUES (1)',
  'REPLACE INTO `payments` (`id`) VALUES (1)',
  'TRUNCATE TABLE `chat_messages`',
  'DROP TABLE `chat_messages`',
  'ALTER TABLE `chat_messages` ADD `x` INT',
  // A table whose name merely starts like a chat table is not a chat table.
  'UPDATE `chat_messages_backup` SET `body` = NULL',
  '  update  payments set amount = 1',
  // Two statements in one call, whatever the first one is.
  'UPDATE `chat_messages` SET `body` = NULL; DROP TABLE `users`',
]

mustRefuse.forEach(sql => {
  if (chatWriteAllowed(sql)) failures.push(`ALLOWS a forbidden statement\n    ${sql}`)
})

/* ── 3. shapes the guard must accept ───────────────────────────────────────── */

const mustAllow = [
  "INSERT IGNORE INTO `chat_settings` (`system`) VALUES (?)",
  "insert ignore into chat_settings (`system`) values (?)",
  "INSERT INTO `chat_presence` (`system`) VALUES (?) ON DUPLICATE KEY UPDATE `status` = 'online'",
  'UPDATE IGNORE `chat_participants` SET `is_pinned` = 1 WHERE `id` = ?',
  'DELETE FROM `chat_reactions` WHERE `id` = ?',
  'UPDATE `chat_messages` SET `body` = ? WHERE `id` = ?;',   // one trailing semicolon is fine
]

mustAllow.forEach(sql => {
  if (!chatWriteAllowed(sql)) failures.push(`REFUSES a legitimate chat write\n    ${sql}`)
})

/* ── report ────────────────────────────────────────────────────────────────── */

const checks = issued + mustRefuse.length + mustAllow.length

if (failures.length) {
  console.error(`\n✖ chat write guard: ${failures.length} of ${checks} checks failed\n`)
  failures.forEach(f => console.error('  ' + f + '\n'))
  process.exit(1)
}

console.log(`✔ chat write guard: ${checks} checks passed (${issued} writes issued by the app, `
  + `${mustRefuse.length} forbidden statements refused, ${mustAllow.length} shapes accepted)`)
