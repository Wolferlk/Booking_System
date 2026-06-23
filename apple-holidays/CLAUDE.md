# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the `apple-holidays/` directory.

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build (TypeScript and ESLint errors are suppressed — see next.config.js)
npm run lint         # ESLint check

npm run db:push      # Push schema changes without migrations (dev)
npm run db:migrate   # Create and apply a named migration (production-safe)
npm run db:seed      # Seed database via prisma/seed.ts
npm run db:studio    # Prisma Studio GUI
```



No test suite is configured; there are no test commands.

## Database Safety

**Never run any command that destroys or resets data.** This is a live production system with real booking records. Forbidden operations include:
- `prisma migrate reset` — drops and recreates the entire database
- `prisma db push --force-reset` — wipes all tables
- Any raw SQL `DROP TABLE`, `TRUNCATE`, or `DELETE FROM` without a precise `WHERE` clause
- `db:seed` against a database that already has data (seed is for empty databases only)

For schema changes, always use `db:migrate` (creates a versioned migration file) rather than `db:push` on anything other than a local development database.

## Environment Variables

Copy `.env.example` to `.env`. Key vars:
- `DATABASE_URL` — MySQL connection string
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — NextAuth session config
- `OPENAI_API_KEY` — GPT-4o and GPT-4o-mini calls
- `CRITICAL_SERVICES_PASSWORD` — Second factor required for `ULTRA_SUPER_ADMIN` login
- Microsoft Graph / OneDrive vars — mailbox monitoring and SharePoint drive polling
- IMAP vars — fallback accounts.payable mailbox via IMAP IDLE

## Architecture Overview

### What this system is

AppleHolidays MMT is a multi-role travel booking operations system for tours in Vietnam, Sri Lanka, Singapore, and Malaysia. A booking flows from an email/document upload through AI extraction, team review stages, financial sign-off, operations, and customer-facing portal — tracked as a state machine with role-gated transitions.

### Core concepts

**Booking lifecycle** — defined entirely in [`src/lib/state-machine.ts`](src/lib/state-machine.ts). `TRANSITIONS` is the single source of truth for which roles can move a booking from one `BookingStatus` to the next. `getAvailableTransitions(status, role)` and `canTransition(from, to, role)` are the gate functions used everywhere.

**RBAC** — [`src/lib/rbac.ts`](src/lib/rbac.ts) maps roles → permissions. Always use `hasPermission(role, permission)` rather than role-checking inline. Roles are: `BT_USER` (Booking Team), `GT_USER` (Ground), `TE_USER` (Travel Experience), `GT_TE_USER` (combined for SL/SG/MY), `AC_USER` (Accounts), `CLIENT` (read-only portal), `SUPER_ADMIN` (country-scoped admin), `ULTRA_SUPER_ADMIN`.

**Country scoping** — Bookings have an `operationCountry` field (`VIETNAM | SRILANKA | SINGAPORE_MALAYSIA`). Users are assigned a country and only see their own country's bookings. Detection from booking refs uses prefixes: `VN*` → Vietnam, `IS*` → Sri Lanka, `SG*`/`MY*` → Singapore/Malaysia (see [`src/lib/country-detection.ts`](src/lib/country-detection.ts)). `ULTRA_SUPER_ADMIN` sees all; `SUPER_ADMIN` with `country=ALL` also sees all.

**P&L financial model** — P&L line totals are always **computed**, never stored directly. The formula is: `(SIC + PVT_PP + Other) × (adults + children) + (adEntrance × adults) + (chEntrance × children)`. Pax counts are stored once on `Booking` and referenced everywhere. `Accounts` confirming individual `PNLLineItem.paymentStatus` is the gate that unlocks Ground Team ticket purchasing.

### Automation pipeline

Bookings originate in two ways, both handled by the same downstream logic:

1. **Email → Booking**: Microsoft Graph polls configured mailboxes every 5 min (via `cron-scheduler.ts`). TC (Tour Confirmation) emails with `.docx` attachments and P&L emails with `.xlsx` attachments are processed by [`incoming-mail-automation.ts`](src/lib/incoming-mail-automation.ts). An IMAP IDLE watcher (`imap-idle-watcher.ts`) provides real-time push for the accounts payable mailbox as a supplement.

2. **OneDrive → Booking**: [`onedrive-monitor.ts`](src/lib/onedrive-monitor.ts) polls SharePoint/OneDrive drives every 3 min using the Microsoft Graph delta API. It watches for `TC.docx` and PNL `.xlsx` files in booking folders and triggers the same extraction and upsert logic.

**Deduplication**: Processed emails use `SystemSetting` rows with keys like `processed_email_{graphId}`. A P&L email that arrives before its matching TC booking is stored as `WAITING` status in `MailMessage` and retried on the next cron tick.

### AI extraction

[`src/lib/openai.ts`](src/lib/openai.ts) contains all GPT calls. Functions and their models:
- `extractBookingFromText()` → `gpt-4o` — parses TC.docx text into structured booking JSON
- `extractPNLFromText()` → `gpt-4o` — parses xlsx text into P&L line items
- `classifyPNLCategories()` → `gpt-4o-mini` — classifies activity names into P&L categories (HOTEL, TRANSPORT, CRUISE, etc.)
- `generateAgendaFromBooking()` → `gpt-4o` — auto-generates tour agenda from booking data
- `extractTicketDetails()` → `gpt-4o` with vision — extracts reference/driver info from ticket images
- `getBookingAISuggestion()` → `gpt-4o` — answers freeform booking questions

All calls log cost and token usage to the `AiUsageLog` table via `logAiUsage()`.

### Background scheduler

[`src/instrumentation.ts`](src/instrumentation.ts) is the Next.js instrumentation hook (runs once on server boot). On non-Vercel deployments it calls `startCronJobs()` from `cron-scheduler.ts`, which uses `setInterval` for:
- Email mailboxes: every 5 min
- OneDrive poll: every 3 min
- Webhook renewal: every 12 h

On **Vercel**, these same jobs are called via HTTP cron routes defined in [`vercel.json`](vercel.json) (`/api/cron/process-mailboxes`, `/api/cron/onedrive-poll`, `/api/cron/renew-webhook`, `/api/cron/driver-notify`). The scheduler is toggled per-job via `SystemSetting` rows (`auto_mail_enabled`, `auto_onedrive_enabled`).

### Authentication

NextAuth with `CredentialsProvider` (email + bcrypt password). `ULTRA_SUPER_ADMIN` requires a second `criticalPassword` field checked against `CRITICAL_SERVICES_PASSWORD` env var. JWT sessions, 24 h max age. Role and country are stored in the JWT token. Middleware in [`src/middleware.ts`](src/middleware.ts) enforces `/dashboard` vs `/portal` routing by role.

### API patterns

All API routes in `src/app/api/` follow the pattern:
1. `getServerSession(authOptions)` — auth check
2. `hasPermission(role, ...)` or `canSeeAllCountries(role, country)` — RBAC check
3. Country scoping applied to all Prisma queries via `andClauses`
4. Return `buildApiSuccess()` / `buildApiError()` from `src/lib/utils.ts`

### Page routing

- `/login` — public
- `/dashboard/*` — staff (all roles except CLIENT); layout has persistent `<Sidebar>`
- `/portal/*` — CLIENT role only (read-only trip view); admins can also access for support
- `/print/*` — printable booking/agenda views (no auth guard, accessed via token or direct)
- `/ultra/*` — ultra admin tooling
- Country-specific sub-apps: `/vietnam/*`, `/srilanka/*`, `/singapore/*`, `/malaysia/*`

### Key data relationships

A booking is the central entity. It owns:
- `Passengers[]`, `Flights[]`, `Accommodations[]`, `ItineraryItems[]` — extracted from TC.docx
- `TourAgenda` → `AgendaItem[]` → `Assignment` (driver/vehicle) — operational schedule
- `PNL` → `PNLLineItem[]` — financial record (Accounts-owned)
- `Ticket[]` — linked to both `AgendaItem` and `PNLLineItem`
- `Payment[]`, `ChangeRequest[]`, `StatusEvent[]`, `BookingVersion[]` — audit/workflow history
- `ContactLog[]`, `Reminder[]`, `CustomerFeedback` — TE team interactions

`BookingVersion` snapshots the raw document on each amendment. `StatusEvent` is the append-only transition audit trail.


Anydesk-osada
oska@1023!@@*
oska@1023 - LapPw
npm install --legacy-peer-deps
