# Integration Notes — AS side & server setup

Companion to [`AS-Quotation-API.md`](./AS-Quotation-API.md). Everything here is
about *wiring it up*, not about the payloads.

---

## 1. Server configuration (OPS side)

Add to the OPS `.env` (Amplify environment variables in production):

```bash
# ── Public AppleSystem API ────────────────────────────────────────────────
# Credentials AppleSystem logs in with. Set BOTH before go-live.
AS_PUBLIC_API_USERNAME=as_integration
AS_PUBLIC_API_PASSWORD=<a long random password>
AS_PUBLIC_API_CLIENT_NAME=AppleSystem Integration

# Signing key for the issued tokens. Falls back to NEXTAUTH_SECRET if unset.
AS_PUBLIC_API_JWT_SECRET=<openssl rand -base64 48>

# Token lifetime in minutes (default 720 = 12 h)
AS_PUBLIC_API_TOKEN_TTL_MIN=720

# Optional: static key alternative to the bearer flow (header: x-api-key)
# AS_PUBLIC_API_KEY=<a long random key>

# Optional: allow the built-in sample credentials in production. Leave unset.
# AS_PUBLIC_API_ALLOW_SAMPLE=true
```

### Multiple clients / restricted scopes

Instead of the single username/password pair, `AS_PUBLIC_API_CLIENTS` takes a JSON
array. Handy for giving a reporting tool read-only access:

```bash
AS_PUBLIC_API_CLIENTS='[
  {"username":"as_integration","password":"…","name":"AppleSystem","scopes":["*"]},
  {"username":"as_readonly","password":"…","name":"AS Reporting","scopes":["quotation:read"]}
]'
```

Precedence: `AS_PUBLIC_API_CLIENTS` → `AS_PUBLIC_API_USERNAME`/`PASSWORD` → sample
client (dev only).

### No database change

This integration adds **no tables and no columns**. It writes only to existing
ones: `bookings` (including the existing `cancellationFees` / `cancellationFeeTotal`
columns), `booking_versions`, `status_events` and `activity_logs`. Nothing to
migrate on the live database.

---

## 2. Where the code lives

| Path | Role |
|---|---|
| `src/lib/public-api/as-api-auth.ts` | Clients, password check, JWT issue/verify, scopes |
| `src/lib/public-api/as-http.ts` | Response envelope, JSON parsing, error mapping |
| `src/lib/public-api/as-quotation-actions.ts` | Resolve / create / update / cancel — all the real logic |
| `src/app/api/public/as/v1/auth/login` · `auth/verify` | Auth endpoints |
| `src/app/api/public/as/v1/quotation/{create,update,cancel,status,sync}` | The API surface |

The create path reuses the same mapper and importer as the in-app "Import to
System" button (`as-booking-map.ts`, `as-booking-import.ts`), so an API-created
booking is byte-for-byte what a staff member would have created by hand.

---

## 3. AS-side client (PHP)

A minimal, dependency-free client. Cache the token — do not log in per request.

```php
<?php

class OpsQuotationApi
{
    private string $base = 'https://ops.aahaas.com/api/public/as/v1';
    private ?string $token = null;
    private int $tokenExpires = 0;

    public function __construct(private string $username, private string $password) {}

    private function token(): string
    {
        // Re-login a minute before expiry.
        if ($this->token && time() < $this->tokenExpires - 60) {
            return $this->token;
        }
        $res = $this->call('POST', '/auth/login', [
            'username' => $this->username,
            'password' => $this->password,
        ], false);

        $this->token        = $res['data']['access_token'];
        $this->tokenExpires = time() + (int) $res['data']['expires_in'];
        return $this->token;
    }

    private function call(string $method, string $path, array $body = [], bool $auth = true): array
    {
        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        if ($auth) {
            $headers[] = 'Authorization: Bearer ' . $this->token();
        }

        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 60,
            CURLOPT_POSTFIELDS     => $body ? json_encode($body) : null,
        ]);
        $raw    = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $json = json_decode($raw ?: '{}', true) ?: [];
        if ($status >= 400 || empty($json['success'])) {
            throw new RuntimeException(
                sprintf('[OPS %s] %s (%s)', $status, $json['error'] ?? 'unknown error',
                        $json['code'] ?? 'NO_CODE')
            );
        }
        return $json;
    }

    /** Quotation confirmed → create the ops booking. */
    public function create(string $quotationNo, string $referenceId, ?string $isNumber = null): array
    {
        return $this->call('POST', '/quotation/create', array_filter([
            'quotation_no' => $quotationNo,
            'reference_id' => $referenceId,
            'is_number'    => $isNumber,
        ]));
    }

    /** Quotation revised → refresh the ops booking. */
    public function update(string $isNumber, string $quotationNo, string $referenceId, ?string $note = null): array
    {
        return $this->call('POST', '/quotation/update', array_filter([
            'is_number'      => $isNumber,
            'quotation_no'   => $quotationNo,
            'reference_id'   => $referenceId,
            'amendment_note' => $note,
        ]));
    }

    /**
     * Quotation cancelled → cancel the ops booking automatically.
     * $fee is optional; pass null when there is no cancellation charge.
     */
    public function cancel(string $identifier, string $reason, ?float $fee = null, bool $byQuotationNo = false): array
    {
        return $this->call('POST', '/quotation/cancel', array_filter([
            $byQuotationNo ? 'quotation_no' : 'is_number' => $identifier,
            'reason'            => $reason,
            'cancellation_fee'  => $fee,
        ], fn ($v) => $v !== null));
    }
}
```

Usage inside the AS cancellation hook:

```php
$api = new OpsQuotationApi(env('OPS_API_USERNAME'), env('OPS_API_PASSWORD'));

try {
    $res = $api->cancel($quotation->is_number, $request->input('reason'), $request->input('cancel_fee'));
    Log::info('OPS booking cancelled', ['ref' => $res['data']['booking']['booking_ref']]);
} catch (\RuntimeException $e) {
    // 404 = never imported into OPS; safe to ignore. Anything else → queue a retry.
    Log::warning('OPS cancel failed: ' . $e->getMessage());
}
```

---

## 4. Which trigger fires which call

| AppleSystem event | Call | Notes |
|---|---|---|
| Quotation confirmed / IS number issued | `POST /quotation/create` | Safe to fire more than once |
| Quotation revised (any field) | `POST /quotation/update` with `reference_id` | Send `create_if_missing: true` if AS is unsure it was ever imported |
| Small correction, no full revision | `POST /quotation/update` with `fields` | No AppleSystem round-trip |
| Quotation cancelled | `POST /quotation/cancel` | Add `cancellation_fee` when a charge applies |
| Anything, single webhook | `POST /quotation/sync` with `action` | Same behaviour, one URL |

---

## 5. Go-live checklist

- [ ] `AS_PUBLIC_API_USERNAME` / `AS_PUBLIC_API_PASSWORD` set to real values in the
      live environment (the sample pair is refused in production).
- [ ] `AS_PUBLIC_API_JWT_SECRET` set to a fresh 48-byte random string.
- [ ] `AS_PUBLIC_API_ALLOW_SAMPLE` **not** set.
- [ ] Credentials stored in the AS config/secret store, not in AS source control.
- [ ] AS calls the live base URL over HTTPS.
- [ ] Cancellation notify list (`CANCELLATION_NOTIFY_LIST` in
      `src/lib/send-cancellation-email.ts`) reviewed — these mails now fire
      automatically.
- [ ] End-to-end rehearsal on a **test** booking: create → status → update →
      cancel with a fee → status shows `CANCELLED`.
- [ ] AS retries `502`/`503`/`500` with backoff and alerts on repeated `4xx`.

---

## 6. Verification status

Smoke-tested locally against a running dev server:

- ✅ `auth/login` — valid and invalid credentials, envelope and token shape
- ✅ `auth/verify` — token accepted, scopes returned
- ✅ missing / malformed auth rejected with `401 UNAUTHORIZED`
- ✅ `quotation/status` — resolved by IS number **and** by quotation number
- ✅ error paths — `BOOKING_NOT_FOUND`, `IDENTIFIER_REQUIRED`, `INVALID_ACTION`,
  `NOTHING_TO_UPDATE`
- ⚠️ The write paths (create / update / cancel) were **not** executed here: the
  local `.env` points at the live production database, so no test booking could be
  created or cancelled without touching real data. Run the rehearsal in step 5
  against a testing database before go-live.
