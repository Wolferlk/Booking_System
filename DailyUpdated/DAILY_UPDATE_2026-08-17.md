# Daily Work Update — 17 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 17 Aug 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is a detailed summary of today's work across the **Accounts System** (Laravel) and the **Booking System** (Next.js / Ops). The headline item is the **internal Chat** built into both systems, delivered end-to-end today, plus work on the Detailed P&L and the Vietnam rate-sheet re-check.

---

## 1. Accounts System

### 1.1 Internal Chat — full module (new, largest item of the day)
Teams were coordinating booking questions over WhatsApp and email, with nothing tied to the booking itself. Chat is now built into the system.

- **Schema** — migration `create_chat_tables` (conversations, participants, messages, attachments, reactions, presence, settings) with the matching models under `app/Models/Chat/`.
- **`ChatService`** — the conversation engine: direct and group conversations, send/edit/delete, read receipts, unread counts, mute and pin, member management.
- **`ChatDirectory` + `ChatDirectorySql`** — the "who can I message" directory, resolved from the real user/role tables. Added the `chat_directory` **view** migration, then a follow-up migration to **fix a collation mismatch** that was breaking directory joins across tables of differing charsets.
- **`ChatCardService`** — a message can carry a **booking/invoice/P&L card**: paste or pick a reference and the chat renders a live summary card that opens the record, instead of a bare number in plain text.
- **`ChatMediaService`** + a dedicated filesystem disk — image and file attachments, with the **`ChatPurgeMedia`** command and a schedule entry so chat media does not grow unbounded.
- **`ChatRealtime`** — real-time delivery over **SSE** with presence and typing indicators, replacing the polling approach; gated behind `CHAT_REALTIME_URL` so it degrades safely to polling if the hub is not running.
- **UI** — the full-page chat (`/chat`) plus a **chat dock** available on every page from the app layout (`public/js/chat.js`, `public/css/chat.css`, `chat/index`, `partials/chat-dock`), with the access entry in `config/access.php` and a dedicated `config/chat.php`.
- Refined **chat sorting** and dock integration so the most relevant conversation surfaces first.

### 1.2 Detailed P&L — Hand Editing of Costing Lines (new, super-admin)
- Built **`PnlPayloadEditService`** and the **`pnl_payload_edits`** table / `PnlPayloadEdit` model — a super admin can now **hand-correct individual costing lines** on a Detailed P&L when the source data from the Apple System is wrong.
- Every edit is **stored separately from the source payload, audited and revertable**, and the **quoted selling price is never touched** — only the cost side.
- Added `PnlLineEditController` and the supporting routes, with the editing UI in the Detailed P&L modal, scripts and styles.

### 1.3 Detailed P&L — Basis Switch
- Added a **basis switch** to the Detailed P&L view (`DbPnlController` + modal) so the same booking can be read on either basis without leaving the view — previously it meant opening a different page to compare.

### 1.4 P&L Card Titling
- Improved the **P&L card title logic** so each row is labelled by what it actually is, rather than falling back to a generic product name.

### 1.5 Vietnam Excel Re-check — Implausible Rates
- Reworked **implausible-rate handling** in `VietnamExcelPriceService` and tightened **row selection** against the rate sheet, so a suspect rate is refused rather than written into a P&L, and the correct sheet row is picked when several are close matches.
- Related tidy-ups in `ExcelRecheckService` and `SharePointRateSheetService`.

---

## 2. Booking System (Ops)

### 2.1 Internal Chat — Ops side (pairs with 1.1)
- Added the chat schema to `prisma/schema.prisma` and built the full **`/api/chat/*`** surface: bootstrap, conversations (direct/group/members/read/mute/pin), messages, reactions, uploads, media, people, presence, typing, pulse, dock, live (SSE) and settings.
- Built the chat library under `src/lib/chat/` — `service`, `db`, `directory`, `cards`, `realtime`, `session`, `storage`, `config` — including **session management and file storage for chat media**.
- Built the chat components (`chat-dock`, `chat-page`, `chat-thread`, `composer`, `message-bubble`, `new-chat-modal`, `card-viewer`, `chat-store`) and integrated them into the **dashboard layout, header and sidebar**.
- Hardened it for the serverless environment: **connection retry logic and transaction handling** for database reliability, **error handling and loading states**, and improved **message merging** so an optimistic message and its server copy do not duplicate.
- Fixed the **collation mismatch** in the chat directory queries on this side as well.
- Extended the **write guard** to recognise the chat tables' SQL modifiers, so chat writes are allowed while the guard still protects everything else.

### 2.2 Chat Real-time Push Hub (new service, cross-system)
- Built **`chat-realtime/`** — a standalone Node **SSE hub** (`server.js`) that both systems connect to for live message, presence and typing push, with a **`selftest.js`** and a README covering setup.
- Added the configuration and README section on the Ops side so the hub can be pointed at per environment.

### 2.3 MC Report — Cancellation Request Tracking
- Added **cancellation request tracking** to the MC report (`/api/mc-report`, the MC report page and the print view) so a booking with a pending cancellation is visible on the report instead of appearing as a normal confirmed booking.
- Substantial refactor of the MC report and accounts report pages, moving the shared logic out of the page components.

### 2.4 Query Monitor — Thread Rounds
- Added the **`newRound`** column to `query_monitor_entries` (schema + `manual-sql/2026-08-17-query-monitor-thread-rounds.sql`) to track rounds within a query thread.
- Fixed row handling in the monitor so a **hand-typed File Handler is preserved** when the sheet is rewritten — previously an automated rewrite could overwrite a manual entry.

### 2.5 Smaller Fixes
- Avatar image handling fixed across the dashboard.
- Booking agenda generation improved (`agenda/generate`, `agenda/word`, agenda mailer, PDF/HTML generators).
- Tidy-ups in `incoming-mail-automation`, `own-arrangement`, `emergency-contacts`, `rbac`, `state-machine` and `reports/ops-day-data`.

---

## 3. Cross-System Integrations Delivered Today

| Integration | Booking System (Ops) | Accounts System |
|---|---|---|
| **Internal Chat** | `/api/chat/*` + chat dock in the dashboard shell | `ChatService` + `/chat` page and site-wide dock |
| **Chat Real-time Push** | Connects to the SSE hub for live push | Same hub, gated by `CHAT_REALTIME_URL`; hub runs alongside the Accounts app |
| **Booking / Invoice / P&L cards in chat** | `lib/chat/cards.ts` renders the card | `ChatCardService` resolves the booking, invoice and P&L data behind it |

---

## Summary

| Area | Items Delivered |
|---|---|
| Accounts System | Internal chat module (schema, service, directory, cards, media, SSE real-time, full-page + dock UI, media purge), Detailed P&L hand editing (audited & revertable), Detailed P&L basis switch, P&L card titling, Vietnam implausible-rate handling |
| Booking System | Internal chat (API surface, lib, components, dashboard integration, serverless hardening), standalone SSE real-time hub, MC report cancellation tracking, query monitor thread rounds + File Handler preservation, agenda & avatar fixes |

**Commits today:** 9 on the Accounts System (`c421797` → `da2f9ff`, branch `REV1`) and 15 on the Booking System (`e473049` → `501a257`, branch `Main_v7_DEV`) — roughly **9,800 lines added on Accounts** and **1,600 on Ops**, mostly the chat module.

*Also delivered over the weekend (15 Aug), for completeness:* the **SharePoint auto-fetch for the Excel rate sheet** (the workbook is now polled automatically rather than uploaded by hand) and the **re-check page for corrected Vietnam P&Ls**, which re-prices previously corrected P&Ls against the current sheet and flags suspect rates.

Happy to walk through any of the above — particularly the internal chat, which now spans both systems with live push and booking-aware cards, and the Detailed P&L hand editing, which lets us correct bad Apple System cost data without losing the audit trail.

Best regards,
**Sasindu Diluranga**
