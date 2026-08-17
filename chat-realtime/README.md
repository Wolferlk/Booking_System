# chat-realtime — the push channel for both systems' internal chat

One small always-on process that replaces the chat polling loop in **both** apps.
Zero npm dependencies: Node's own `http` and `crypto`, nothing else to install or
keep patched.

```
Accounts (Laravel, self-hosted) ──POST /publish (HMAC, on write)──┐
                                                                  ├──▶ hub ──SSE──▶ every open browser
OPS (Next.js on Vercel)         ──POST /publish (HMAC, on write)──┘
```

## Why it exists

Every open chat tab used to ask "anything new?" every 1.5–20 seconds. Each ask
was an HTTP request (on the OPS side, a **Vercel function invocation**) plus about
five statements against the production MariaDB — including a `chat_presence`
**write**. With seven people online that is thousands of statements an hour to
answer, almost always, "no".

MySQL/MariaDB has no `LISTEN/NOTIFY`, so nothing can push from the database. And
neither app can hold a connection open per user: a Vercel function has a
deadline, and PHP-FPM would pin one worker per connected person. So the socket
terminates here instead, and the apps simply say what happened.

Measured effect: idle database traffic for chat goes to **zero**, OPS function
invocations for chat drop by ~99%, and a message appears on the other screen in
tens of milliseconds instead of up to 20 seconds.

## What it does and does not do

It holds connections and forwards events. It has **no database access**, knows
nothing about the schema, and never sees a message body — only a ≤120-character
preview for the toast. The publishing app already knows who is in the
conversation and names them.

If this process is down, both front ends fall back to polling and **nothing is
lost**: every client reconciles on reconnect, on tab focus, and on a slow safety
tick. That is why it is allowed to be this simple.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/events?ticket=…` | signed ticket | The SSE stream for one identity |
| `POST` | `/publish` | `x-chat-signature` HMAC over the body | An app reporting an event |
| `GET` | `/presence?ticket=…` | signed ticket | Who currently has a stream open |
| `GET` | `/health` | none | Liveness and counters |

Events: `hello`, `message`, `touch`, `read`, `typing`, `conversation`,
`presence`, `expired`, `bye`.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `CHAT_REALTIME_SECRET` | yes | Shared with **both** apps. ≥24 chars. Signs tickets and publishes. |
| `PORT` | no | Default `4599` |
| `HOST` | no | Default `127.0.0.1` — bind to loopback and let nginx terminate TLS |
| `CHAT_REALTIME_ORIGINS` | recommended | Comma-separated browser origins allowed to subscribe |
| `CHAT_REALTIME_HEARTBEAT_MS` | no | Default `25000`, keeps proxies from closing idle streams |

## Deploy

Run it on the **Accounts server** (the self-hosted box that already runs pm2).
The OPS app is on Vercel and cannot host it, but it can publish to it and its
browsers can subscribe to it.

**1. Generate the shared secret**

```bash
openssl rand -hex 24
```

**2. Start it under pm2**

```bash
cd /path/to/Booking_System
CHAT_REALTIME_SECRET='<secret>' \
CHAT_REALTIME_ORIGINS='https://ops.aahaas.com,https://accounts.aahaas.com' \
  pm2 start chat-realtime/server.js --name chat-realtime
pm2 save
curl -s localhost:4599/health
```

**3. Expose it through nginx**, in the Accounts server block:

```nginx
location /realtime/ {
    proxy_pass http://127.0.0.1:4599/;
    proxy_http_version 1.1;
    proxy_set_header Connection '';        # SSE needs keep-alive, not upgrade
    proxy_buffering off;                   # never hold events in a buffer
    proxy_cache off;
    proxy_read_timeout 3600s;              # a stream is meant to stay open
    chunked_transfer_encoding off;
}
```

(The app also sends `X-Accel-Buffering: no`, so buffering is off even if the
`proxy_buffering` line is missed.)

**4. Point the two apps at it**

Accounts — `.env`:

```dotenv
CHAT_REALTIME_URL=https://accounts.aahaas.com/realtime
CHAT_REALTIME_INTERNAL_URL=http://127.0.0.1:4599
CHAT_REALTIME_SECRET=<secret>
```

then `php artisan config:clear`.

OPS — Vercel environment variables:

```dotenv
CHAT_REALTIME_URL=https://accounts.aahaas.com/realtime
CHAT_REALTIME_SECRET=<secret>
```

(no `CHAT_REALTIME_INTERNAL_URL`: Vercel reaches the hub over the public URL),
then redeploy.

**Until `CHAT_REALTIME_URL` is set in an app, that app keeps polling.** Both
sides can therefore be switched on one at a time, and switching it off again is
one variable and a restart.

## Verify

```bash
node chat-realtime/selftest.js     # 12 checks: streams, addressing, forged tickets, presence
curl -s https://accounts.aahaas.com/realtime/health
```

Then, in the product: open the same conversation in Accounts and in OPS, send a
message, and watch it appear on the other screen without a poll. `/health`
should show one identity per signed-in person.

## Operating notes

- **Restarts** drop every stream; browsers reconnect within ~4 seconds and each
  one reconciles, so a deploy costs a few seconds of latency and no messages.
- **Scaling**: state is in memory, so run exactly one instance. A few hundred
  streams is nothing for it; beyond that, shard by identity or move to Redis
  pub/sub behind the same `/publish` contract — no client change either way.
- **Security**: bind to loopback; the ticket is an HMAC of
  `{system, ref, expiry}` minted from each app's own session and valid for an
  hour, so it cannot be forged and does not outlive the sitting. Publishing needs
  the body signature, so a leaked ticket cannot inject events.
- **Presence** is now "has an open stream", broadcast on connect and disconnect.
  `chat_presence` still backs the directory's online dot but is written once
  every 30 seconds per visible tab instead of once per poll tick.
