# AppleSystem → OPS Quotation API

The integration that lets **AppleSystem (AS)** drive a booking's whole life in the
OPS system: create it when a quotation is confirmed, update it when the quotation
is revised, and **cancel it automatically** when the quotation is cancelled — with
an optional cancellation fee.

| File | What it is |
|---|---|
| [`AS-Quotation-API.md`](./AS-Quotation-API.md) | The full API reference — auth, every endpoint, payloads, error codes, flows |
| [`Integration-Notes.md`](./Integration-Notes.md) | How to wire it up on the AS (PHP) side + server setup and go-live checklist |
| [`AS-Quotation-API.postman_collection.json`](./AS-Quotation-API.postman_collection.json) | Postman collection — login stores the token automatically, every call is ready to fire |
| [`AS-Quotation-API.postman_environment.json`](./AS-Quotation-API.postman_environment.json) | Postman environment — base URL, username, password, test IS number |

## 60-second start

1. Import both Postman files, select the **AS Quotation API — Local** environment.
2. Run **`Auth → Login`**. The token is captured into `{{access_token}}` for you.
3. Run **`Quotation → Status`** with the `is_number` already filled in.
4. Run **`Quotation → Cancel`** — the booking flips to `CANCELLED` in OPS.

> The environment ships with a real IS number / quotation number for lookups, but
> `reference_id` (`18452`) is a placeholder — take the real one from the
> AppleSystem quotation list row before running create/update.

Sample credentials (development default):

```
username: as_integration
password: AppleSystem@2026#Quote
```

> These sample credentials only work when the server has no client configured, and
> are **refused in production** unless `AS_PUBLIC_API_ALLOW_SAMPLE=true`. Set real
> ones with `AS_PUBLIC_API_USERNAME` / `AS_PUBLIC_API_PASSWORD` before go-live.

## Endpoints at a glance

Base path: `/api/public/as/v1`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Username + password → bearer token (12 h) |
| `GET` | `/auth/verify` | Is my token still valid? |
| `POST` | `/quotation/create` | Import a quotation as a new OPS booking |
| `POST` | `/quotation/update` | Apply a revised quotation (also `PUT`, `PATCH`) |
| `POST` | `/quotation/cancel` | Cancel the booking automatically (also `DELETE`) |
| `GET` | `/quotation/status` | Read what OPS currently holds |
| `POST` | `/quotation/sync` | **One URL for all three** — `{"action":"CREATE\|UPDATE\|CANCEL"}` |

Every write call identifies the booking by **IS number** *or* **quotation reference
number** — send whichever AS has to hand.

```jsonc
// cancel, identified by IS number, with an optional fee
{ "is_number": "IS48748", "reason": "Guest cancelled", "cancellation_fee": 150 }

// cancel, identified by quotation ref instead
{ "quotation_no": "479416CNTL", "reason": "Guest cancelled" }
```
