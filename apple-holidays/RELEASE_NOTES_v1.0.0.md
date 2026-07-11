# Apple Holidays Booking System

## Release Notes — Version 1.0.0

**Release date:** 11 July 2026
**Product:** AppleHolidays MMT — Multi-Country Travel Booking Operations Platform
**Status:** Production / General Availability

---

## Overview

Apple Holidays Booking System 1.0.0 is the first production release of an end-to-end travel booking operations platform. It manages the complete lifecycle of a tour booking — from an incoming email or uploaded document, through AI-powered data extraction, multi-team review, financial sign-off, ground operations, and a customer-facing trip portal.

The system currently supports operations across **four destinations**: Vietnam, Sri Lanka, Singapore, and Malaysia. Every booking is tracked as a role-gated state machine, ensuring each team acts only on what it is authorised to and at the right stage.

---

## Highlights at a Glance

- **AI-driven intake** — Tour Confirmation documents and P&L spreadsheets are parsed automatically into structured bookings.
- **Automated email & cloud monitoring** — Mailboxes and OneDrive/SharePoint folders are polled continuously to create bookings with no manual entry.
- **Role-based multi-team workflow** — Booking Team, Ground, Travel Experience, and Accounts each have dedicated dashboards.
- **Full financial engine** — Computed P&L, credit-agent tracking, payments, and profit reporting.
- **Ground operations** — Driver, vehicle, vendor, and assignment management with driver logs.
- **Customer portal & WhatsApp automation** — Live trip views, agenda delivery, feedback, and automated messaging.
- **Vendor self-service portal** — External vendors manage their own drivers, vehicles, and trips.
- **Country-scoped access & robust RBAC** — Users see only their own country's operations.

---

## Core Features

### 1. Booking Lifecycle & State Machine
- Single source of truth for booking status transitions, with each transition gated by role.
- Append-only status event audit trail for every booking.
- Booking versioning — a raw document snapshot is captured on each amendment.
- Change requests, resubmission, recheck, cancellation, and completion flows.

### 2. AI Extraction Engine
- **Booking extraction** — parses Tour Confirmation (`.docx`) documents into structured booking data (passengers, flights, accommodations, itinerary).
- **P&L extraction** — parses cost spreadsheets (`.xlsx`) into itemised P&L line items.
- **Automatic category classification** — activity names classified into P&L categories (Hotel, Transport, Cruise, Entrance, etc.).
- **Auto-generated tour agenda** — day-by-day agenda created from booking data.
- **Ticket detail extraction** — reads reference and driver info directly from ticket images (vision).
- **Booking AI assistant** — answers freeform questions about a booking.
- Full token and cost logging for every AI call.

### 3. Automated Intake Pipeline
- **Email → Booking:** Microsoft Graph polls configured mailboxes every 5 minutes; TC and P&L emails are processed automatically.
- **OneDrive → Booking:** SharePoint/OneDrive drives polled every 3 minutes via the Graph delta API for TC and P&L files.
- **Real-time IMAP watcher** for the accounts-payable mailbox.
- **Smart deduplication** — a P&L that arrives before its matching booking is held and retried automatically.

### 4. Financial & Accounts Module
- Computed P&L model — line totals always calculated from pax counts, never stored stale.
- Per-line payment confirmation that gates ground-team ticket purchasing.
- Credit-agent management, agent bookings, and agent payment tracking.
- Payments, bill uploads, profit reporting, and accounts reports.
- P&L overview, linking, and external P&L sync.

### 5. Ground Operations Module
- Driver, vehicle, and vendor registries with registration links.
- Assignment of drivers and vehicles to agenda items.
- Sri Lanka driver-allocation tooling with country-specific rules.
- Ticket lifecycle: create, upload, extract, activate, and purchase.
- **Driver Logs** — generated per booking with PDF output and WhatsApp delivery.

### 6. Travel Experience (TE) Module
- Live trip monitoring, contacts, reminders, and daily views.
- Customer feedback collection and AI-generated feedback summaries.
- TE analytics dashboard.
- **AI Call Bot** and WhatsApp automation for customer interactions.
- Payments and ticket views for the TE team.

### 7. Customer Portal
- Read-only, secure per-booking trip view for clients.
- Live booking updates and agenda access.
- Customer feedback forms and photo uploads.

### 8. Vendor Self-Service Portal
- Separate vendor authentication.
- Vendors manage their own profile, drivers, vehicles, and trips.

### 9. Admin & Platform Tooling
- User management with country-scoped roles.
- Activity/audit logs and AI usage dashboard.
- Mail inbox monitoring and OneDrive booking-automation controls.
- System configuration with per-job automation toggles.
- Ultra admin tooling with a protected second-factor login.

---

## Special Features

- **🤖 AI Call Bot (Travel Experience)** — automated customer calling and conversation handling.
- **💬 WhatsApp Automation** — consolidated driver briefings, cancellation notices, customer daily briefings, and feedback requests delivered automatically.
- **📄 Document Generation** — booking confirmations, agendas (HTML, Word & PDF), and driver logs generated on demand.
- **🧾 Vision-based Ticket Reading** — driver and reference details extracted directly from ticket photos.
- **🌏 Multi-Country Operations** — Vietnam, Sri Lanka, Singapore, and Malaysia in a single platform with automatic country detection from booking references.
- **🔁 Zero-Touch Booking Creation** — bookings created end-to-end from email or cloud files without manual entry.
- **📊 Live Computed P&L** — always-accurate financials driven by a single pax count.
- **🔐 Ultra Super Admin** — critical operations protected by a second authentication factor.
- **⏱️ Background Automation Scheduler** — mailbox, OneDrive, webhook renewal, and notification jobs run automatically (via cron on Vercel or interval scheduler on self-hosted).

---

## Roles & Access Control

| Role | Responsibility |
|------|----------------|
| **Booking Team (BT)** | Intake, review, and submission of bookings |
| **Ground Team (GT)** | Drivers, vehicles, assignments, tickets |
| **Travel Experience (TE)** | Customer contact, agenda, feedback |
| **GT + TE (combined)** | Sri Lanka / Singapore / Malaysia operations |
| **Accounts (AC)** | P&L confirmation, payments, profit |
| **Client** | Read-only trip portal |
| **Super Admin** | Country-scoped administration |
| **Ultra Super Admin** | Full platform control (second factor required) |

Users are scoped to a country and see only their own country's bookings; admins can be granted all-country visibility.

---

## Technology Stack

- **Framework:** Next.js 14 (App Router) with React 18 and TypeScript
- **Database:** MySQL via Prisma ORM
- **Authentication:** NextAuth (credentials + bcrypt), JWT sessions
- **AI:** OpenAI GPT-4o / GPT-4o-mini (text + vision)
- **Integrations:** Microsoft Graph (mail & OneDrive), IMAP IDLE, WhatsApp
- **Documents:** Puppeteer & PDFKit (PDF), `docx` (Word), `mammoth` / `xlsx` / `pdf-parse` (extraction)
- **UI:** Tailwind CSS, Radix UI, Recharts, Framer Motion

---

## Notes & Recommendations

- This is a **live production system** with real booking data — database resets and destructive operations are strictly prohibited.
- Schema changes must always go through versioned migrations.
- Background automation can be toggled per-job through System Settings.

---

*© 2026 Apple Holidays MMT. Booking System v1.0.0 — First General Availability Release.*
