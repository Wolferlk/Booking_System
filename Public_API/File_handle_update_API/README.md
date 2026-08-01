# File Handler API — OPS

Everything the **File Handler Portal** (`/filehandler`) can do, exposed as a REST
API so another application can do it too: find or import a booking, maintain its
flights and hotels, correct agent/guest contacts, raise a cancellation, and
generate or email the Booking Update PDF — with tokens, scopes and the same audit
trail as a real portal click.

| File | What it is |
|---|---|
| [`FileHandler-API.md`](./FileHandler-API.md) | The full API reference — auth, every endpoint, payloads, error codes, flows |
| [`Integration-Notes.md`](./Integration-Notes.md) | How to wire it up on the other app's side + server setup and go-live checklist |
| [`FileHandler-API.postman_collection.json`](./FileHandler-API.postman_collection.json) | Postman collection — login stores the token automatically, every call is ready to fire |
| [`FileHandler-API.postman_environment.json`](./FileHandler-API.postman_environment.json) | Postman environment — base URL, credentials, test booking ref |

## 60-second start

1. Import both Postman files, select the **File Handler API — OPS Live** environment.
2. Fill `fh_credential` / `fh_password` with a **real, approved file handler's**
   portal login (or the service username, see below).
3. Run **`Auth → 1. Login`**. The token is captured into `{{access_token}}`.
4. Run **`Bookings → Search`** — the ref in `{{booking_ref}}` comes back with its
   flights, hotels, passengers and contacts.
5. Run **`Flights → Add flight`**, then **`Documents → Download PDF`**.

## Endpoints at a glance

Base path: `/api/public/fh/v1`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Service discovery: this list, live from the server |
| `POST` | `/auth/register` | — | File handler self-registration (pending admin approval) |
| `GET` | `/auth/register?email=` | — | Is this email already registered? |
| `POST` | `/auth/login` | — | Credentials → bearer token (12 h) |
| `GET` | `/auth/verify` | `booking:read` | Is my token still valid? |
| `GET` | `/auth/me` | `booking:read` | Acting file handler profile + activity stats |
| `GET` | `/bookings/search?q=` | `booking:read` | Search by booking ref / IS / CNTL |
| `POST` | `/bookings/import` | `booking:import` | Pull a quotation in from AppleSystem |
| `GET` | `/bookings/{ref}` | `booking:read` | The whole booking |
| `PATCH` | `/bookings/{ref}` | `booking:write` | Agent + guest contacts, important notes |
| `GET` | `/bookings/{ref}/flights` | `booking:read` | List flights |
| `POST` | `/bookings/{ref}/flights` | `flight:write` | Add one flight, or a batch |
| `PUT` | `/bookings/{ref}/flights/{id}` | `flight:write` | Replace a flight |
| `DELETE` | `/bookings/{ref}/flights/{id}` | `flight:write` | Remove a flight |
| `POST` | `/bookings/{ref}/flights/extract` | `ai:extract` | Read flights off a ticket with GPT-4o |
| `GET` | `/bookings/{ref}/accommodations` | `booking:read` | List hotels |
| `POST` | `/bookings/{ref}/accommodations` | `hotel:write` | Add one hotel, or a batch |
| `PUT` | `/bookings/{ref}/accommodations/{id}` | `hotel:write` | Replace a hotel |
| `DELETE` | `/bookings/{ref}/accommodations/{id}` | `hotel:write` | Remove a hotel |
| `GET` | `/bookings/{ref}/cancel` | `booking:read` | Can this booking be cancelled? |
| `POST` | `/bookings/{ref}/cancel` | `booking:cancel` | Raise a cancellation request |
| `GET` | `/bookings/{ref}/pdf` | `document:read` | Booking Update PDF (binary or base64) |
| `POST` | `/bookings/{ref}/pdf/email` | `document:send` | Email that PDF |
| `GET` | `/activity` | `activity:read` | File handler audit trail |

`{ref}` is the **booking ref, IS number or CNTL number** — whichever the calling
app has to hand, with or without spaces (`IS 40475` = `IS40475`).

## Two ways to authenticate

**A file handler's own login** — the same email/phone + password they use on the
portal. Nothing to configure; every action is attributed to them.

```jsonc
POST /auth/login
{ "credential": "nimal@appleholidays.lk", "password": "…" }
```

**A service client** — a machine account configured in the server environment, so
the other app never stores handler passwords. It names the handler it acts for
with the `X-File-Handler` header (email or id).

```jsonc
POST /auth/login
{ "username": "fh_integration", "password": "…", "act_as": "nimal@appleholidays.lk" }
```

Development-default sample service credentials:

```
username: fh_integration
password: FileHandler@2026#Portal
```

> These only work when the server has no service client configured, and are
> **refused in production** unless `FH_PUBLIC_API_ALLOW_SAMPLE=true`. Set real
> ones with `FH_PUBLIC_API_USERNAME` / `FH_PUBLIC_API_PASSWORD` before go-live.

## One thing worth knowing up front

`POST /bookings/{ref}/cancel` does **not** cancel the booking. Exactly as in the
portal, it moves the booking to `PENDING_CANCELLATION` and emails the accounts
team to approve. The response is `202 Accepted` for that reason.

*(Outright cancellation is the AppleSystem quotation API's job — see
[`../Updatecancel-AS-API/`](../Updatecancel-AS-API/).)*
