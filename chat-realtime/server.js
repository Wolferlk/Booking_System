#!/usr/bin/env node
'use strict'

/**
 * chat-realtime — the push channel shared by the Accounts app and the OPS app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both systems chat over the same `chat_*` tables in one MariaDB. Until now each
 * browser asked "anything new?" every 1.5–20 seconds, which meant a Vercel
 * function invocation and ~5 statements against the production database per tab
 * per tick — including a write to `chat_presence`. Thousands of queries an hour
 * to mostly answer "no".
 *
 * MySQL has no LISTEN/NOTIFY, so nothing can push from the database itself. The
 * OPS app runs as serverless functions and the Accounts app behind PHP-FPM, and
 * neither can hold a connection open per user (a function has a deadline; FPM
 * would pin one worker per person). So the socket has to terminate in one small
 * always-on process. That is this file.
 *
 * WHAT IT DOES
 * ------------
 *   browser  ──GET /events?ticket=…──▶  held open, Server-Sent Events
 *   app      ──POST /publish (HMAC)──▶  fanned out to the named identities only
 *
 * It is deliberately dumb: no database, no schema knowledge, no message bodies
 * it has to interpret. The publishing app already knows who is in the
 * conversation and says so. If this process dies, both front ends fall back to
 * polling and nothing is lost — which is why it is allowed to be this simple.
 *
 * WHY SSE AND NOT WEBSOCKETS
 * --------------------------
 * The traffic is one-directional (server → browser); `EventSource` reconnects on
 * its own; it is plain HTTP, so no framing to implement and no dependency to
 * install and keep patched. Typing and presence go back over ordinary POSTs.
 *
 * RUN
 * ---
 *   CHAT_REALTIME_SECRET=… node chat-realtime/server.js
 * See README.md for the pm2 and nginx snippets.
 */

const http = require('http')
const crypto = require('crypto')

/* ── configuration ─────────────────────────────────────────────────────────── */

const PORT = Number(process.env.PORT || 4599)
const HOST = process.env.HOST || '127.0.0.1'

/** Shared with both apps. Tickets and publishes are signed with it. */
const SECRET = (process.env.CHAT_REALTIME_SECRET || '').trim()
if (!SECRET || SECRET.length < 24) {
  console.error('[chat-realtime] refusing to start: CHAT_REALTIME_SECRET must be set and at least 24 characters.')
  process.exit(1)
}

/** Browser origins allowed to open a stream. Both apps' public URLs. */
const ORIGINS = (process.env.CHAT_REALTIME_ORIGINS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)

/** Comment frame interval — keeps proxies from closing an idle connection. */
const HEARTBEAT_MS = Number(process.env.CHAT_REALTIME_HEARTBEAT_MS || 25_000)

/** A stream is dropped at this age so a ticket cannot outlive its own expiry. */
const MAX_STREAM_MS = Number(process.env.CHAT_REALTIME_MAX_STREAM_MS || 7_200_000)

const MAX_BODY_BYTES = 256 * 1024

/* ── identity tickets ──────────────────────────────────────────────────────── */

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(payload) {
  return b64url(crypto.createHmac('sha256', SECRET).update(payload).digest())
}

/** Constant-time compare that cannot throw on a length mismatch. */
function sameSignature(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * A ticket is `<base64url payload>.<base64url hmac>` minted by whichever app the
 * user is logged into: `{ s: system, r: user_ref, e: expiry }`.
 *
 * The identity therefore comes from the app's own session, never from anything
 * the browser can choose — this process holds no sessions and trusts no claim
 * that is not signed. It travels in the query string because EventSource cannot
 * set headers, which is why it is short-lived.
 */
function readTicket(ticket) {
  const [payload, signature] = String(ticket || '').split('.')
  if (!payload || !signature) return null
  if (!sameSignature(signature, sign(payload))) return null

  let claims
  try { claims = JSON.parse(unb64url(payload).toString('utf8')) } catch { return null }
  if (!claims || typeof claims.s !== 'string' || claims.r === undefined) return null
  if (!Number.isFinite(claims.e) || claims.e * 1000 < Date.now()) return null

  return { key: `${claims.s}:${claims.r}`, system: claims.s, ref: String(claims.r), expiresAt: claims.e * 1000 }
}

/* ── the connection registry ───────────────────────────────────────────────── */

/** identity key → Set of live streams. One person may have several tabs. */
const streams = new Map()
let nextId = 1
const startedAt = Date.now()
let published = 0
let delivered = 0

function register(key, stream) {
  if (!streams.has(key)) streams.set(key, new Set())
  streams.get(key).add(stream)
  return streams.get(key).size === 1
}

function unregister(key, stream) {
  const set = streams.get(key)
  if (!set) return false
  set.delete(stream)
  if (set.size) return false
  streams.delete(key)
  return true
}

function frame(event, data) {
  // SSE requires one "data:" line per line of payload; JSON.stringify never
  // emits a raw newline, so one line is always enough.
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function sendTo(keys, event, data) {
  let count = 0
  new Set(keys).forEach(key => {
    const set = streams.get(key)
    if (!set) return
    set.forEach(stream => {
      try { stream.res.write(frame(event, data)); count++ }
      catch { closeStream(stream) }
    })
  })
  delivered += count
  return count
}

function broadcast(event, data) {
  return sendTo(Array.from(streams.keys()), event, data)
}

function closeStream(stream) {
  clearInterval(stream.beat)
  clearTimeout(stream.deadline)
  try { stream.res.end() } catch { /* already gone */ }

  if (unregister(stream.key, stream)) {
    // Last tab for this person closed — everyone else's presence dot can go grey
    // immediately instead of waiting out a database timeout.
    broadcast('presence', { key: stream.key, online: false, at: new Date().toISOString() })
  }
}

/* ── HTTP ──────────────────────────────────────────────────────────────────── */

function cors(req, res) {
  const origin = (req.headers.origin || '').replace(/\/+$/, '')
  if (origin && (ORIGINS.length === 0 || ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-chat-signature')
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** GET /events?ticket=… — the stream itself. */
function openStream(req, res, url) {
  const who = readTicket(url.searchParams.get('ticket'))
  if (!who) return json(res, 401, { message: 'Invalid or expired ticket.' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx buffers proxied responses by default, which would hold events until
    // the buffer filled — this turns that off for this response alone, so no
    // server config has to know about SSE.
    'X-Accel-Buffering': 'no',
  })

  const stream = { id: nextId++, key: who.key, res, beat: null, deadline: null }

  // Reconnect delay the browser will honour, then the greeting the client uses
  // to trigger its catch-up read.
  res.write('retry: 4000\n\n')
  res.write(frame('hello', { key: who.key, server_time: new Date().toISOString(), stream_id: stream.id }))

  const firstTab = register(who.key, stream)
  if (firstTab) broadcast('presence', { key: who.key, online: true, at: new Date().toISOString() })

  stream.beat = setInterval(() => {
    try { res.write(': beat\n\n') } catch { closeStream(stream) }
  }, HEARTBEAT_MS)

  // The ticket expires; so must the stream it opened. The client re-tickets and
  // reconnects, which is one small fetch an hour.
  const life = Math.max(60_000, Math.min(MAX_STREAM_MS, who.expiresAt - Date.now()))
  stream.deadline = setTimeout(() => {
    try { res.write(frame('expired', { reason: 'ticket expired' })) } catch { /* gone */ }
    closeStream(stream)
  }, life)

  req.on('close', () => closeStream(stream))
  req.on('error', () => closeStream(stream))
}

/**
 * POST /publish — an app reporting something that happened.
 *
 * Signed over the exact bytes of the body, so a leaked ticket cannot be used to
 * inject events and nothing but the two apps can publish.
 *
 * { to: ["ops:cmq…", "accounts:1"], event: "message", data: { … } }
 */
async function publish(req, res) {
  let raw
  try { raw = await readBody(req) } catch { return json(res, 413, { message: 'Body too large.' }) }

  const header = String(req.headers['x-chat-signature'] || '').replace(/^sha256=/, '')
  const expected = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  if (!sameSignature(header, expected)) return json(res, 401, { message: 'Bad signature.' })

  let body
  try { body = JSON.parse(raw) } catch { return json(res, 400, { message: 'Body must be JSON.' }) }

  const events = Array.isArray(body) ? body : [body]
  let count = 0

  events.forEach(e => {
    if (!e || typeof e.event !== 'string') return
    const to = Array.isArray(e.to) ? e.to.filter(k => typeof k === 'string') : []
    published++
    count += to.length ? sendTo(to, e.event, e.data ?? {}) : broadcast(e.event, e.data ?? {})
  })

  json(res, 200, { ok: true, events: events.length, delivered: count })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  cors(req, res)

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  if (req.method === 'GET' && url.pathname === '/events') return openStream(req, res, url)
  if (req.method === 'POST' && url.pathname === '/publish') return void publish(req, res)

  if (req.method === 'GET' && url.pathname === '/presence') {
    // The live "who is online" answer, with no database involved: presence is
    // now simply "has an open stream".
    if (!readTicket(url.searchParams.get('ticket'))) return json(res, 401, { message: 'Invalid or expired ticket.' })
    return json(res, 200, { online: Array.from(streams.keys()) })
  }

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    let connections = 0
    streams.forEach(set => { connections += set.size })
    return json(res, 200 , {
      ok: true,
      identities: streams.size,
      connections,
      published,
      delivered,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    })
  }

  json(res, 404, { message: 'Not found.' })
})

// A held-open SSE response must never be cut by a request timeout.
server.requestTimeout = 0
server.headersTimeout = 60_000
server.keepAliveTimeout = 76_000
server.timeout = 0

server.listen(PORT, HOST, () => {
  console.log(`[chat-realtime] listening on http://${HOST}:${PORT} — origins: ${ORIGINS.join(', ') || '(any)'}`)
})

function shutdown(signal) {
  console.log(`[chat-realtime] ${signal} — closing ${streams.size} identities`)
  // Tell every browser to reconnect rather than leaving them on a dead socket;
  // EventSource will retry and each client catches up on reconnect.
  broadcast('bye', { reason: 'server restarting' })
  streams.forEach(set => set.forEach(closeStream))
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
