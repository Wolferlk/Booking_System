# Reservation Team — Deployment Runbook

The application code is complete and builds. **The live database has not been touched.** This document is the procedure for applying the schema change yourself.

Design notes for the module itself are in [reservation-team-proposal.md](reservation-team-proposal.md).

---

## What is being changed

| Change | Risk | Reversible |
|---|---|---|
| Create 8 new tables | None — nothing existing is read or written | Yes, while empty |
| Append `RS_USER` to the `users.role` ENUM | Metadata-only; no row is rewritten | Only before any user is given the role |

**No existing table is altered except `users.role`.** No new table carries a foreign key into an existing one — `bookingRef`, `hotelProfileId`, `accommodationId` and `budgetLineId` are deliberately soft pointers resolved in application code, so an amendment that rewrites a booking's child rows can never cascade away a confirmed supplier commitment.

New tables:

```
hotel_reservations            reservation_events        proforma_invoices
reservation_options           hotel_contracts           credit_notes
reservation_special_requests  hotel_contract_rates
```

---

## Before you start

Confirm which database you are pointed at. **`apple-holidays/.env` defines `DB_DATABASE` twice** — `apple_booking_system` on line 18 and `invoice_processor` on line 81. The second one wins with the loader Next.js uses, so anything reading that variable lands on the accounts database rather than the booking one. Every script below therefore names `apple_booking_system` explicitly and ignores the variable. This is worth fixing separately; renaming the second block's keys (e.g. `ACCOUNTS_DB_DATABASE`) would be the clean fix, but that is a change to how the running app resolves its connection and should be done deliberately, not as part of this migration.

Take a backup of the `users` table before step 3 regardless — it is one statement and it is the only irreversible step:

```sql
CREATE TABLE users_backup_pre_rs AS SELECT * FROM users;
```

---

## Procedure

### 1. Pre-flight (read-only)

```bash
cd apple-holidays
npm run rs:preflight
```

Reports the database you are connected to, whether any of the eight tables already exist, the current `users.role` ENUM, the collation the rest of the database uses, and baseline row counts. **Write the row counts down** — step 4 compares against them.

If it warns that the dominant collation is not `utf8mb4_unicode_ci`, edit the `COLLATE` clause in `scripts/sql/reservation-team-01-tables.sql` to match before continuing.

### 2. Create the tables

```bash
DATABASE_URL="mysql://USER:PASS@HOST:3306/apple_booking_system" \
  npx prisma db execute \
    --file scripts/sql/reservation-team-01-tables.sql \
    --schema prisma/schema.prisma
```

Not `prisma db push` — the live schema carries unrelated drift that a push would also try to apply. Every statement is `CREATE TABLE IF NOT EXISTS` with its foreign keys inline, so the file is safe to run twice.

### 3. Widen the users role ENUM

```bash
npm run rs:role            # dry run — prints the exact ALTER, changes nothing
npm run rs:role -- --apply # executes it
```

The script builds the statement from the ENUM **actually in the database**, preserving every existing value in its existing order and appending `RS_USER` last. It refuses to run twice and reports the row count before and after.

There is a static `scripts/sql/reservation-team-02-user-role.sql` as a fallback, but prefer the script: the static file assumes the value list matches `schema.prisma`, and if the live column has a role that list omits, applying it would drop that role and blank those users.

### 4. Verify

```bash
npx prisma generate
npm run rs:verify
```

Checks table shapes, confirms every foreign key points inside the module, confirms `RS_USER` is present, and prints the row counts again. **They must match the step-1 baseline exactly.**

### 5. Deploy the application and create a user

Deploy as normal, then create a user with role `Reservation Team` from `/dashboard/admin/users` and assign them a country. They land on the Deadline Board.

---

## Rollback

While the tables are still empty:

```bash
DATABASE_URL="..." npx prisma db execute \
  --file scripts/sql/reservation-team-99-rollback.sql \
  --schema prisma/schema.prisma
```

The rollback deliberately does **not** narrow the `users.role` ENUM. Removing a value rewrites the column and would corrupt any row already set to `RS_USER`. If you need that reversed, move those users to another role first, then narrow the ENUM by hand.

---

## What the module does on first run

Nothing. The Request Inbox is **derived on every read** from `accommodations` — it is the set of stays with no reservation row yet — so switching the module on against a live database with tens of thousands of bookings creates exactly zero rows. The first row appears when an operator presses **Claim & start**. This mirrors how the D-10 pre-checking queue already works.

---

## Safety properties worth knowing

- **The write layer never touches a row it does not own.** Bookings, accommodations, P&L lines and hotel profiles are read-only to this module. The single exception is `syncToReconfirmation()`, which pre-fills a `HotelReconfirmation` after a stay is confirmed — and it only ever fills fields that are still empty, never overwriting what the TE desk recorded.
- **Status changes go through one function.** `reservation-state.ts` decides legality; `reservations-write.ts` enforces it and its guards. The API layer cannot bypass either.
- **Confirming runs the accuracy gate.** Six blocking checks (dates match the booking, rooms cover the party, lead guest on the booking, rate captured, policy captured, confirmation number present) and five dismissible warnings, each needing a written reason. The verdict — including every waived warning and its reason — is stored on the row as evidence the check ran.
- **Money is separated by duty.** `RS_USER` holds no `pnl:edit`, `pnl:confirm_payment` or `payment:create`. Reservation verifies and forwards a proforma; Accounts releases the money. The API enforces this on the invoice route, not just in the UI.
- **`reservation_events` is append-only.** Nothing in the codebase updates or deletes it.

---

## Not yet built

Honest list of what the proposal describes and this build does not include:

- **WhatsApp / email templates.** The comms tab records and displays contacts, but does not yet send. The eight templates need Meta approval first, which is lead time rather than build time.
- **AI extraction of proforma invoices.** The `aiExtract` column and the three-way match are in place and the match runs on every invoice; the GPT vision pass that reads a PDF into those fields is not wired up. Invoices are entered by hand today.
- **Mailbox auto-capture** of hotel invoices.
- **Contracts UI.** The API (`/api/reservations/contracts`) and both tables are complete, and a contract's terms are copied onto a reservation when it is opened. The editing screen is not built, so contracts must be created via the API for now.
- **Reporting suite** — the data supports the queries; the screens are not built.
