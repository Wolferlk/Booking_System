/**
 * IMAP IDLE watcher — real-time push notifications for accounts.payable@aahaas.com
 *
 * IMAP IDLE (RFC 2177) keeps a persistent TCP connection open.  When a new email
 * arrives the IMAP server sends an untagged EXISTS response *immediately* — no
 * polling required.  imapflow.idle() blocks until that notification arrives, then
 * resolves so we can fetch and process the new message in seconds.
 *
 * Two connections are used intentionally:
 *   1. "monitor"  — stays in IDLE mode permanently (one long-lived connection)
 *   2. "fetcher"  — short-lived connection opened only when new mail is detected
 *                   (reuses fetchImapPayableEmails from imap-pnl.ts)
 *
 * This keeps the IDLE loop unblocked while OpenAI extraction runs (which can take
 * several seconds).  Dedup via systemSetting prevents double-processing if the
 * 5-minute cron and IDLE fire at the same time.
 *
 * Reconnection: exponential back-off 5 s → 10 s → … → 60 s max.
 * IDLE timeout: most IMAP servers terminate IDLE after ~30 min; imapflow.idle()
 * returns naturally at that point and the loop re-issues IDLE automatically.
 */

import { ImapFlow } from 'imapflow'
import { prisma } from './prisma'
import { fetchImapPayableEmails, fetchImapAttachments, IMAP_PNL_USER } from './imap-pnl'
import { processMailboxEmail } from './incoming-mail-automation'
import { upsertCachedMailMessage } from './mail-cache'
import { getConfiguredMailboxes } from './mail-processor'

const HOST = process.env.IMAP_HOST   ?? 'outlook.office365.com'
const PORT = Number(process.env.IMAP_PORT ?? '993')
const PASS = process.env.IMAP2_PASSWORD ?? ''

let watcherRunning = false

// ── Process any unprocessed emails via a fresh short-lived IMAP connection ────

async function processNewImapEmails() {
  if (!IMAP_PNL_USER || !PASS) return

  let processed = 0
  try {
    const emails = await fetchImapPayableEmails(10)

    for (const email of emails) {
      const dedupKey = `processed_email_${email.graphId}`
      const already  = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
      if (already) continue

      try {
        await upsertCachedMailMessage({
          email,
          mailboxUser: IMAP_PNL_USER,
          mailboxKind: 'PNL',
          status:      'RECEIVED',
        }).catch(() => {})

        const attachments = email.hasAttachments
          ? await fetchImapAttachments(email.graphId).catch(() => [])
          : []

        const result = await processMailboxEmail(email, 'PNL', attachments)

        if (result.status === 'PNL_WAITING') {
          // No matching TQ booking yet — store as WAITING so the 5-min cron retries it
          // Do NOT write the dedup key, allowing future re-processing
          await upsertCachedMailMessage({
            email,
            mailboxUser: IMAP_PNL_USER,
            mailboxKind: 'PNL',
            bookingRef:  result.bookingRef,
            status:      'WAITING',
          }).catch(() => {})
          console.log(`[IDLE] PNL Tour No ${result.bookingRef} — waiting for TQ booking, will retry`)
        } else {
          await prisma.systemSetting.upsert({
            where:  { key: dedupKey },
            update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
            create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
          })
          await upsertCachedMailMessage({
            email,
            mailboxUser: IMAP_PNL_USER,
            mailboxKind: 'PNL',
            bookingRef:  result.bookingRef,
            status:      'PROCESSED',
            processedAt: new Date().toISOString(),
          }).catch(() => {})
          console.log(`[IDLE] ✓ PNL → booking ${result.bookingRef}`)
          processed++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IDLE] email processing failed:', msg)
        await upsertCachedMailMessage({
          email,
          mailboxUser: IMAP_PNL_USER,
          mailboxKind: 'PNL',
          status:      'ERROR',
        }).catch(() => {})
        await prisma.systemSetting.upsert({
          where:  { key: 'imap_idle_last_error' },
          update: { value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
          create: { key: 'imap_idle_last_error', value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
        })
      }
    }

    if (processed > 0) {
      console.log(`[IDLE] Processed ${processed} new PNL email(s)`)
    }
  } catch (err) {
    console.error('[IDLE] fetch error:', err instanceof Error ? err.message : err)
  }
}

// ── Persistent IDLE monitor loop ──────────────────────────────────────────────

async function runIdleLoop() {
  let retryDelay = 5_000 // ms, doubles on each failure up to 60 s

  while (watcherRunning) {
    const client = new ImapFlow({
      host:   HOST,
      port:   PORT,
      secure: PORT === 993,
      auth:   { user: IMAP_PNL_USER, pass: PASS },
      logger: false,
      tls:    { rejectUnauthorized: false },
    })

    try {
      await client.connect()
      retryDelay = 5_000 // connection succeeded — reset back-off
      console.log(`[IDLE] Connected to ${HOST}:${PORT} as ${IMAP_PNL_USER}`)

      const lock = await client.getMailboxLock('INBOX')
      let knownExists = (client.mailbox as { exists?: number } | null)?.exists ?? 0
      console.log(`[IDLE] Watching ${IMAP_PNL_USER} — INBOX has ${knownExists} messages`)

      // Check for any emails that arrived before we opened this connection
      processNewImapEmails().catch(() => {})

      while (watcherRunning) {
        try {
          // Blocks until server sends EXISTS / EXPUNGE / FETCH, or ~29-min IDLE timeout.
          // When it returns the client is no longer in IDLE mode — safe to fetch.
          await client.idle()

          const currentExists = (client.mailbox as { exists?: number } | null)?.exists ?? knownExists
          if (currentExists > knownExists) {
            console.log(`[IDLE] New mail arrived: ${knownExists} → ${currentExists} messages`)
            knownExists = currentExists
            // Run processing in background — don't block the next idle() call
            processNewImapEmails().catch(err => console.error('[IDLE]', err))
          }
          // If count didn't increase (EXPUNGE / FLAGS change) just loop back to idle
        } catch {
          break // inner loop: connection interrupted → reconnect
        }
      }

      try { lock.release() } catch { /* ignore */ }
    } catch (err: unknown) {
      // Log full error details — imapflow wraps IMAP errors in err.response / err.serverResponse
      const e = err as Record<string, unknown>
      const detail = e?.response ?? e?.serverResponse ?? e?.message ?? String(err)
      console.error(`[IDLE] Connection failed (${HOST}:${PORT} / ${IMAP_PNL_USER}):`, detail)
    } finally {
      try { await client.logout() } catch { /* ignore */ }
    }

    if (watcherRunning) {
      console.log(`[IDLE] Reconnecting in ${retryDelay / 1000}s…`)
      await new Promise<void>(r => setTimeout(r, retryDelay))
      retryDelay = Math.min(retryDelay * 2, 60_000)
    }
  }

  console.log('[IDLE] Watcher stopped')
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startImapIdleWatcher() {
  if (watcherRunning) return

  if (!IMAP_PNL_USER || !PASS) {
    console.log('[IDLE] IMAP2_USERNAME or IMAP2_PASSWORD not set — watcher disabled')
    return
  }

  // Skip if the same mailbox is already covered by Microsoft Graph webhook.
  // In that case real-time delivery comes through /api/mail/webhook, not IMAP.
  const graphMailboxes = getConfiguredMailboxes()
  if (graphMailboxes.some(mb => mb.user === IMAP_PNL_USER)) {
    console.log(`[IDLE] ${IMAP_PNL_USER} is handled by Graph webhook — IMAP IDLE not needed`)
    return
  }

  watcherRunning = true
  // Fire and forget — runs as a background loop for the lifetime of the process
  runIdleLoop().catch(err =>
    console.error('[IDLE] Fatal error:', err instanceof Error ? err.message : err),
  )
  console.log('[IDLE] Watcher started for', IMAP_PNL_USER)
}

export function stopImapIdleWatcher() {
  watcherRunning = false
}
