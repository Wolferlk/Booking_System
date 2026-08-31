# Today Daily Task List — 31 August 2026

**System:** Booking System / Apple Holidays Operations (Next.js — `apple-holidays/`)
**Owner:** Sasindu Diluranga
**Date:** 31 August 2026
**Branch:** `Main_v7_DEV`
**Working rule:** Keep live data safe. Read-only checks wherever possible; no Prisma migrations, `prisma db push`, role scripts or external API writes (WhatsApp/Meta, OpenAI on live records) without approval. No customer or driver is messaged from testing.

## Main outcome for today

Land and verify four deliveries: the **Driver Brief** deck (seven-slide presenter, AI talking points, D-3 → D-1 readiness report and 07:00 email); the **Aahaas B2B (Flights)** read-only board and detail page; **30 Sundays file-handler resolution** (manual button, admin sweep, 5-minute cron); and the **keyless OSM basemaps** on the journey and live-ops maps. Two items need action before the Driver Brief works at all — the table and the recipients.

## 0. Blockers to clear first — high priority

- [ ] Create the driver-brief table. Not run against live yet:
      `npx prisma db execute --file prisma/sql/2026-08-31-driver-briefs.sql --schema prisma/schema.prisma`
      Additive only, `IF NOT EXISTS`, no FK, touches nothing existing. **Until it runs, the deck 500s on load.** Get approval before running.
- [ ] Set `DRIVER_BRIEF_REPORT_TO` in `.env`. Unset = no email is ever sent; the panel still works. Confirm the recipient list with Operations before enabling.
- [ ] Confirm every new env var is documented in `.env.example` and none is committed with a real value.

## 1. Driver Brief — deck, AI talking points, readiness report

Commits `8888aca`, `bb4b204`, `222a895`. `lib/driver-brief.ts`, `driver-brief-modal.tsx` (~1,475 lines), `driver-brief-report.ts`, `driver-brief-report-scheduler.ts`, API + cron routes, `schema.prisma`, `vercel.json`.

### 1.1 The deck
- [ ] Confirm the **Driver Brief** button (teal, headphones) shows in the booking action row and is **hidden on Hotel Only files**.
- [ ] Walk all seven slides in order — Your Driver, The Guests, Flights, Hotels, The Route, Tickets, Sign Off.
- [ ] Test keyboard driving: ← → / space / Home / End, one-handed while on a call. Confirm the chapter rail ticks off what has been read.
- [ ] Verify the driver slide: portrait, name, phone, the dial sentence, Dial / Copy / WhatsApp buttons, licence, vendor, vehicle, seats, dates covered — and that **every other driver on the file** lists with their own dates, plate and dial button.
- [ ] Confirm children render with the baby icon and important notes show in amber.
- [ ] Check flight sectors label correctly as "you meet this one" / "you drop for this one".
- [ ] Confirm The Route reuses the existing agenda-sourced JourneyMap, so the brief can never disagree with the movement chart.
- [ ] Confirm Tickets group by the day the driver needs them and warn loudly on anything not activated.
- [ ] **Verify the two deliberate exclusions on a real booking: no money anywhere (rates, advances, P&L all stripped — a driver can see this screen) and no passport numbers in the model prompt.** Inspect the actual payload, not the UI.
- [ ] Confirm the AI "Say this" panel is cached on the record and reopening costs no second OpenAI call.
- [ ] Confirm the deck loads data first and lets the AI catch up — it must be usable with a driver already on the line.
- [ ] Test a booking with no driver, no flights and no tickets — empty states, not crashes.

### 1.2 Readiness report and email
- [ ] Open `/dashboard/srilanka/driver-allocation` and check the three-column panel above the filters (D-3 / D-2 / D-1) with its per-column instruction text.
- [ ] Verify the five verdicts grade correctly against real files: `no_driver`, `ready_to_brief`, `brief_started`, `briefed`, `no_driver_needed`.
- [ ] Confirm every row is one click from the deck and the dial button works.
- [ ] Test the per-row Driver Brief button in the table's driver cell (files outside the three-day window).
- [ ] Test "Email now" — **with approval, to a test recipient only.** Confirm the mail matches the panel.
- [ ] Verify the 07:00 Asia/Colombo scheduler (`cron-scheduler.ts`) and `/api/cron/driver-brief-report` (vercel.json, 01:30 UTC) are both registered, and confirm the once-a-day guard inside the run function makes running both together safe.
- [ ] Confirm no email fires from a local or preview run.

## 2. Aahaas B2B (Flights) — new, read-only

Commit `ee01183`. `b2b-db.ts`, `b2b-flights.ts` (~1,055 lines), `b2b-documents.ts`, API routes, list + detail pages, sidebar entry, `scripts/b2b-probe.mjs`.

- [ ] Run the read-only probe to confirm the schema: `node scripts/b2b-probe.mjs` from `apple-holidays/` (SHOW TABLES + COUNT(*)).
- [ ] Confirm `DB_DATABASE_B2B` points at the schema that actually holds the `b2b_*` tables (defaults to `production_live1`, falls back to `DB_DATABASE_B2C`) — **this was never confirmed against live.**
- [ ] Verify the write guard: `b2bQuery` / `b2bBatch` run every statement through `assertReadOnly`, `multipleStatements` is off, and a trailing `;` with anything after it is rejected. Try to smuggle a second statement through a parameter and confirm it throws inside our process.
- [ ] Open `/dashboard/b2b-flights` — only `confirmed`, `deleted_at IS NULL`, newest first.
- [ ] Test the stat band and every filter: search (reaching into PNR, hotel name, policy number, passenger blob), component, payment status, booked-date range.
- [ ] **Open the first real booking and confirm the segments and passenger manifest populated** — the `flight_data` / `passenger_data` mapping came from the Laravel source in Fligths_dash, not a live sample.
- [ ] Confirm an unrecognised JSON blob degrades gracefully: empty segment list, raw JSON still reachable in the collapsed inspector.
- [ ] Test "View invoice" (HTML, prints cleanly), "Invoice PDF" and "Download details" (A4).
- [ ] Confirm mixed component currencies are declared, never silently summed, and the adjustment row appears when the header amount differs.
- [ ] Confirm the sidebar entry appears for exactly the roles that already see "B2C — Aahaas", and the route is blocked server-side for the rest.
- [ ] Confirm no migration, schema change or seed came with this.

## 3. 30 Sundays file-handler resolution

Commit `ecd259e`. `quote-ai-db.ts`, `file-handler-resolve.ts`, scheduler, cron + API routes, admin settings card, booking-page chip, dry-run script.

- [ ] Run the read-only checks first: `node scripts/file-handler-resolve-dry-run.mjs` and `node scripts/quote-ai-probe.mjs`.
- [ ] Confirm `QUOTE_AI_DB_DATABASE` is set and that `quote-ai-db.ts` is structurally incapable of writing — every statement through `assertReadOnly`, `multipleStatements:false`, fresh connection per query.
- [ ] Re-verify the match: `apple_quote_ai.tbl_corporate_parties` (`is_number` + `file_handler`) joined to `bookings.isNumber`. Last dry run: 144 bookings hold `30sundays Aahaas`, 19 resolvable now (the quote table has only 45 rows so far).
- [ ] Confirm the only write is `bookings.fileHandler`, through a guarded `updateMany` requiring the row to **still** hold the placeholder — a human rename between read and write must stand.
- [ ] Confirm a quote row whose own `file_handler` is empty or is itself the placeholder resolves to nothing — a placeholder must never replace a placeholder.
- [ ] Confirm `30 Sundays Agent` (208 bookings) is a **different** handler and is never touched.
- [ ] Test the "Find real handler" chip on a booking page — it must appear only when the value is the placeholder — and confirm the ActivityLog entry records from → to.
- [ ] Test "Replace all" in admin config (admin-only): pending count, full sweep, and the list of every ref changed.
- [ ] Verify the 5-minute sweep over bookings created ≥10 min ago (72 h rolling window) picks up a booking created while the process was down, and that `/api/cron/file-handler-resolve` is registered in `vercel.json` for the serverless runtime.
- [ ] **Flag to the quote side:** VN41509's quote row says the handler is literally `testing`. The sweep copies what the quote table holds — clean it up upstream before the sweep writes it.

## 4. Basemaps — keyless OSM tiles

Commit `ff09c80`. `journey-map.tsx`, `live-ops-map.tsx`.

- [ ] Confirm tiles load on both the booking JourneyMap and the dashboard live-ops map with no API key present.
- [ ] Verify OSM attribution renders correctly and is not clipped, in both light and dark map themes.
- [ ] Confirm no map key remains in the client bundle or `.env.example`.
- [ ] Sanity-check tile load under the Driver Brief's dark-theme route slide.

## 5. Safe test and release preparation

- [ ] No WhatsApp or customer/driver message from testing without approval; test numbers only.
- [ ] No Prisma migration, `db execute` or SQL script against live without explicit sign-off (see section 0).
- [ ] Run the build and clear type/lint errors across the new pages and libraries.
- [ ] Review the diff for secrets, tokens, production URLs, customer data and passport numbers.
- [ ] Check logs for OpenAI errors on the brief path, DB connection failures on the two new read-only clients, and cron behaviour on the serverless runtime (no long-lived connections).

## 6. Handoff checklist

- [ ] Record routes tested, bookings used, dry-run output and results.
- [ ] Note the two blockers (driver-brief table, `DRIVER_BRIEF_REPORT_TO`) and their state.
- [ ] Note the unconfirmed `DB_DATABASE_B2B` schema and who is confirming it.
- [ ] List remaining issues with severity, reproduction steps and affected role.
- [ ] Prepare a deployment note covering: driver-brief SQL + env vars + two cron registrations, B2B env keys and sidebar roles, quote-AI env key and the 5-minute sweep, basemap change.

## Definition of done

The Driver Brief deck opens on a real file, reads correctly through all seven slides, carries no money and no passport data, and the D-3 → D-1 panel and its 07:00 mail grade files correctly; B2B Flights reads live agent-portal data through a client that provably cannot write, with segments and manifest confirmed against a real booking; file-handler resolution replaces only genuine placeholders, never overwrites a human edit, and the sweep runs on both runtimes; the maps render keyless with correct attribution; and every remaining risk is documented for handoff.
