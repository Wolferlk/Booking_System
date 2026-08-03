# Integration Notes — client side & server setup

Companion to [`FileHandler-API.md`](./FileHandler-API.md). Everything here is
about *wiring it up*, not about the payloads.

---

## 1. Server configuration (OPS side)

Nothing has to be configured for the **handler login** flow — a file handler who
can sign in to `/filehandler` can already get a token. The variables below only
matter if you also want a **service client** (a machine account acting on behalf
of a handler).

Add to the OPS `.env` (Amplify environment variables in production):

```bash
# ── Public File Handler API ───────────────────────────────────────────────
# A machine account, so the calling app never stores handler passwords.
FH_PUBLIC_API_USERNAME=fh_integration
FH_PUBLIC_API_PASSWORD=<a long random password>
FH_PUBLIC_API_CLIENT_NAME=File Handler Integration

# The handler a service client acts for when no X-File-Handler header is sent.
FH_PUBLIC_API_ACT_AS=nimal@appleholidays.lk

# Signing key for the issued tokens. Falls back to NEXTAUTH_SECRET if unset.
FH_PUBLIC_API_JWT_SECRET=<openssl rand -base64 48>

# Token lifetime in minutes (default 720 = 12 h)
FH_PUBLIC_API_TOKEN_TTL_MIN=720

# Optional: static key alternative to the bearer flow (header: x-api-key)
# FH_PUBLIC_API_KEY=<a long random key>

# Optional: allow the built-in sample service credentials in production. Leave unset.
# FH_PUBLIC_API_ALLOW_SAMPLE=true
```

### Several clients / restricted scopes

`FH_PUBLIC_API_CLIENTS` takes a JSON array instead of the single
username/password pair. Useful for giving a dashboard read-only access, or
pinning a partner app to one handler:

```bash
FH_PUBLIC_API_CLIENTS='[
  {"username":"partner_app","password":"…","name":"Partner Booking App",
   "scopes":["*"],"actAs":"nimal@appleholidays.lk"},
  {"username":"reporting","password":"…","name":"Reporting",
   "scopes":["booking:read","activity:read"]},
  {"username":"kiosk","password":"…","name":"Airport Kiosk",
   "scopes":["booking:read","flight:write"],"actAs":"kiosk@appleholidays.lk","lockActAs":true}
]'
```

`lockActAs: true` makes the client ignore `X-File-Handler` — it can only ever act
as its configured handler.

Precedence: `FH_PUBLIC_API_CLIENTS` → `FH_PUBLIC_API_USERNAME`/`PASSWORD` →
sample client (dev only).

### No database change

This API adds **no tables and no columns**. It writes only to existing ones:
`bookings`, `flights`, `accommodations` and `file_handler_logs`. Nothing to
migrate on the live database.

### Existing behaviour it depends on

| Feature | Needs |
|---|---|
| `POST /bookings/import` | AppleSystem credentials (`APPLESYSTEM_*`) already configured for the staff import screen |
| `POST /flights/extract` | `OPENAI_API_KEY` — the same GPT-4o path the portal uses |
| `POST /pdf/email` and cancellation alerts | Microsoft Graph mail (`sendMailViaGraph`) already configured |
| Cancellation approval mail | At least one active `AC_USER` |

Each of these fails softly and reports why — a broken mailbox does not take the
rest of the API down.

---

## 2. Where the code lives

| Path | Role |
|---|---|
| `src/lib/public-api/fh-api-auth.ts` | Handler + service auth, JWT issue/verify, scopes, act-as resolution |
| `src/lib/public-api/fh-http.ts` | Response envelope, JSON parsing, error mapping |
| `src/lib/public-api/fh-actions.ts` | Booking lookup, flights, hotels, contacts, cancellation — the real logic |
| `src/lib/public-api/fh-import.ts` | The AppleSystem import path |
| `src/app/api/public/fh/v1/**` | The API surface (17 routes) |

The portal's own routes under `src/app/api/filehandler/*` are untouched and keep
serving the browser on its signed cookie. The public API re-expresses the same
rules against the same tables, so both produce identical audit rows — the only
visible difference is the `[API]` tag appended to `file_handler_logs.details`.

`/api/public/**` is outside the NextAuth middleware matcher
(`src/middleware.ts`), which is why these routes are reachable without a session
cookie.

---

## 3. Client examples

### PHP — cache the token, do not log in per request

```php
<?php

class OpsFileHandlerApi
{
    private string $base;
    private string $user;
    private string $pass;
    private ?string $token = null;
    private int $expiresAt = 0;

    public function __construct(string $base, string $user, string $pass)
    {
        $this->base = rtrim($base, '/') . '/api/public/fh/v1';
        $this->user = $user;
        $this->pass = $pass;
    }

    private function token(): string
    {
        if ($this->token && time() < $this->expiresAt - 60) {
            return $this->token;
        }
        $res = $this->call('POST', '/auth/login', [
            'credential' => $this->user,
            'password'   => $this->pass,
        ], false);

        $this->token     = $res['data']['access_token'];
        $this->expiresAt = time() + (int) $res['data']['expires_in'];
        return $this->token;
    }

    private function call(string $method, string $path, ?array $body = null, bool $auth = true): array
    {
        $ch = curl_init($this->base . $path);
        $headers = ['Content-Type: application/json'];
        if ($auth) {
            $headers[] = 'Authorization: Bearer ' . $this->token();
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 60,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $raw    = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode($raw, true) ?: [];
        if ($status >= 400) {
            // Always log request_id — it is the key to the server-side log entry.
            throw new RuntimeException(sprintf(
                '[%s] %s (request_id %s)',
                $decoded['code'] ?? 'HTTP_' . $status,
                $decoded['error'] ?? 'Request failed',
                $decoded['request_id'] ?? '-'
            ));
        }
        return $decoded;
    }

    public function getBooking(string $ref): array
    {
        return $this->call('GET', '/bookings/' . rawurlencode($ref))['data']['booking'];
    }

    public function addFlights(string $ref, array $flights): array
    {
        return $this->call('POST', '/bookings/' . rawurlencode($ref) . '/flights', ['flights' => $flights])['data'];
    }

    public function requestCancellation(string $ref, string $reason, array $fees = []): array
    {
        return $this->call('POST', '/bookings/' . rawurlencode($ref) . '/cancel', [
            'reason' => $reason,
            'fees'   => $fees,
        ])['data'];
    }
}
```

### Node / TypeScript

```ts
const BASE = 'https://ops.aahaas.com/api/public/fh/v1'

let token = ''
let expiresAt = 0

async function auth(): Promise<string> {
  if (token && Date.now() < expiresAt - 60_000) return token
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: process.env.FH_USER, password: process.env.FH_PASS }),
  })
  const body = await res.json()
  if (!body.success) throw new Error(`${body.code}: ${body.error}`)
  token = body.data.access_token
  expiresAt = Date.now() + body.data.expires_in * 1000
  return token
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await auth()}`,
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json()
  if (!body.success) throw new Error(`${body.code}: ${body.error} (request_id ${body.request_id})`)
  return body.data as T
}

// Ticket in → flights saved, in two calls.
const { flights } = await api<{ flights: unknown[] }>(`/bookings/IS48748/flights/extract`, {
  method: 'POST',
  body: JSON.stringify({ text: pastedTicketText }),
})
await api(`/bookings/IS48748/flights`, { method: 'POST', body: JSON.stringify({ flights }) })
```

### curl — the five-minute smoke test

```bash
BASE=https://ops.aahaas.com/api/public/fh/v1

TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"credential":"nimal@appleholidays.lk","password":"…"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["access_token"])')

curl -s "$BASE/auth/verify"                  -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/bookings/search?q=IS48748"    -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/bookings/IS48748/cancel"      -H "Authorization: Bearer $TOKEN"
curl -s -o update.pdf "$BASE/bookings/IS48748/pdf" -H "Authorization: Bearer $TOKEN"
```

---

## 4. Things that bite

**Adding a flight is not idempotent.** A retried `POST /flights` creates a second
row. If your app retries on timeout, either read the flight list first, or keep
the `id` you got back and switch to `PUT`.

**`{ref}` may contain a space.** `IS 40475` works, but URL-encode it
(`IS%2040475`). The server normalises spaces away either way.

**Cancellation is a request, not an act.** `202 Accepted` and
`PENDING_CANCELLATION` mean the accounts team still has to approve. Do not show
your users "cancelled" until `GET /bookings/{ref}` reports `CANCELLED`.

**`email_sent: false` is not a failure of the cancellation.** The request is
recorded either way; only the notification failed. Surface it to ops, do not
retry the cancellation.

**Service tokens need `X-File-Handler`.** Forgetting it is `400 ACT_AS_REQUIRED`,
not a 401 — the token is fine, it just does not know who it is acting for.

**Approval is re-checked on every call.** Deactivating a handler in the admin
screen kills their API access immediately, mid-token.

**Token TTL is 12 hours and there is no refresh.** Cache the token, watch
`expires_at`, and log in again when it lapses.

**Extraction costs money.** Every `/flights/extract` call is a GPT-4o request
logged to `AiUsageLog`. Do not put it in a polling loop.

---

## 5. Go-live checklist

- [ ] `FH_PUBLIC_API_JWT_SECRET` set to a fresh random value (not the fallback)
- [ ] Real service credentials set, or handler-login-only agreed with the partner
- [ ] `FH_PUBLIC_API_ALLOW_SAMPLE` **unset** in production
- [ ] Every file handler the integration acts as exists and is approved
- [ ] Scopes narrowed per client — nobody gets `*` who does not need it
- [ ] `X-File-Handler` wired into the partner's request layer (service clients)
- [ ] Partner logs `request_id` on every failure
- [ ] Smoke test run against live: verify → search → PDF (all read-only)
- [ ] One end-to-end write rehearsed on a disposable booking, then checked in
      `/dashboard/admin/file-handlers` and on the `/view` Live Screen
- [ ] Accounts team told that cancellation requests can now arrive from the
      partner app as well as the portal
