#!/usr/bin/env node
'use strict'

/**
 * End-to-end check of the hub, with no database and no browser.
 *
 * Starts the server on a spare port, opens two streams as two different people,
 * publishes to one of them, and asserts who received what — including that a
 * forged ticket and an unsigned publish are both refused.
 *
 *   node chat-realtime/selftest.js
 */

const crypto = require('crypto')
const http = require('http')
const { spawn } = require('child_process')

const PORT = 4611
const SECRET = 'selftest-secret-selftest-secret-1234'
const BASE = `http://127.0.0.1:${PORT}`

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ticket = (system, ref, seconds = 300) => {
  const payload = b64url(JSON.stringify({ s: system, r: ref, e: Math.floor(Date.now() / 1000) + seconds }))
  return `${payload}.${b64url(crypto.createHmac('sha256', SECRET).update(payload).digest())}`
}

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `  → ${detail}` : ''}`)
}

/** Open an SSE stream and collect the events it receives. */
function openStream(t) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/events?ticket=${encodeURIComponent(t)}`, res => {
      if (res.statusCode !== 200) { resolve({ status: res.statusCode, events: [], close: () => req.destroy() }); return }
      const events = []
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        let i
        while ((i = buffer.indexOf('\n\n')) > -1) {
          const block = buffer.slice(0, i); buffer = buffer.slice(i + 2)
          const name = /^event: (.+)$/m.exec(block)
          const data = /^data: (.+)$/m.exec(block)
          if (name) events.push({ event: name[1], data: data ? JSON.parse(data[1]) : null })
        }
      })
      resolve({ status: 200, events, close: () => req.destroy() })
    })
    req.on('error', reject)
  })
}

function post(path, body, sign = true) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body)
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) }
    if (sign) headers['x-chat-signature'] = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex')

    const req = http.request(`${BASE}${path}`, { method: 'POST', headers }, res => {
      let text = ''
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(raw)
  })
}

const get = path => new Promise((resolve, reject) => {
  http.get(`${BASE}${path}`, res => {
    let text = ''
    res.on('data', d => { text += d })
    res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
  }).on('error', reject)
})

const wait = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const child = spawn(process.execPath, [`${__dirname}/server.js`], {
    env: { ...process.env, PORT: String(PORT), CHAT_REALTIME_SECRET: SECRET, CHAT_REALTIME_ORIGINS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', d => process.stderr.write(`[hub] ${d}`))

  try {
    for (let i = 0; i < 40; i++) {
      try { await get('/health'); break } catch { await wait(50) }
    }

    const alice = await openStream(ticket('ops', 'cmq-alice'))
    const bob = await openStream(ticket('accounts', '1'))
    await wait(120)

    check('stream accepts a valid ticket', alice.status === 200 && bob.status === 200)
    check('stream greets with hello', alice.events.some(e => e.event === 'hello'))
    // Alice connected first, so it is Bob's arrival that she is told about.
    check('a joiner is announced to those already connected',
      alice.events.some(e => e.event === 'presence' && e.data.key === 'accounts:1' && e.data.online === true))

    const forged = await openStream('eyJzIjoib3BzIiwiciI6IngifQ.deadbeef')
    check('forged ticket is refused', forged.status === 401, `got ${forged.status}`)

    const expired = await openStream(ticket('ops', 'cmq-alice', -60))
    check('expired ticket is refused', expired.status === 401, `got ${expired.status}`)

    const before = alice.events.length
    const sent = await post('/publish', {
      to: ['ops:cmq-alice'],
      event: 'message',
      data: { conversation_id: 4, last_id: 12, preview: 'hiii' },
    })
    await wait(120)

    check('publish reports one delivery', sent.status === 200 && sent.body.delivered === 1, JSON.stringify(sent.body))
    const got = alice.events.slice(before).find(e => e.event === 'message')
    check('addressee receives the event', Boolean(got) && got.data.last_id === 12)
    check('non-addressee receives nothing', !bob.events.some(e => e.event === 'message'))

    const unsigned = await post('/publish', { to: ['ops:cmq-alice'], event: 'message', data: {} }, false)
    check('unsigned publish is refused', unsigned.status === 401, `got ${unsigned.status}`)

    const presence = await get(`/presence?ticket=${encodeURIComponent(ticket('ops', 'cmq-alice'))}`)
    check('presence lists both identities', presence.body.online.length === 2, JSON.stringify(presence.body))

    alice.close()
    await wait(150)
    check('a leaver is announced to others', bob.events.some(e => e.event === 'presence' && e.data.key === 'ops:cmq-alice' && e.data.online === false))

    const health = await get('/health')
    check('health reports the remaining stream', health.body.ok && health.body.identities === 1, JSON.stringify(health.body))

    bob.close()
    await wait(80)
  } finally {
    child.kill('SIGTERM')
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
