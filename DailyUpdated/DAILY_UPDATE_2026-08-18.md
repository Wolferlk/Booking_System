# Daily Work Update — 18 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 18 Aug 2026 (Accounts System & Booking System)

---

Hi [Name],

Below is today's work across the **Booking System (Ops)** and the **Accounts System**. The two headline items are the new **Daily Update Sheet** (a single operational sheet for upcoming and current bookings, with creative PDF/HTML/Excel exports) and the **Experience Report Centre** (post-trip AI-call + feedback-form reporting, with automatic escalation and a client thank-you letter). Alongside those: shared profile photos across both systems, emoji/stickers in the internal chat, and an expanded service-type model.

---

## 1. Booking System (Ops)

### 1.1 Daily Update Sheet — new component (largest item of the day)
The team had no single place to see what is arriving, who the guest and agent are, and how to reach them. Built `/dashboard/daily-update`:

- **Sheet** (`daily-update-sheet.tsx`, `lib/daily-update.ts`, `/api/daily-update`) — travel dates, booking created and last-updated dates, IS and CNTL numbers, guest name and contact, agent name and contact, departure date. Defaults to the **next 10 days of arrivals with today's bookings on top**, with country, arrival-date, created-date and agent filters.
- **Editable contacts** — guest and agent **phone, WhatsApp and email** can be corrected in the sheet, and a missing IS/CNTL number can be filled in, without touching the source booking record.
- **Exports** — a designed **PDF**, the same layout as a standalone **HTML** file, and an **XLSX** workbook (`daily-update-pdf.ts`, `daily-update-html.ts`, `daily-update-xlsx.ts`). The PDF generator was then refactored to render from the HTML layout so all three exports stay identical.
- **Smoke script** `scripts/daily-update-smoke.mts` to verify the sheet and its exports without hitting live data.

### 1.2 Daily Update — AI Call Tracking
- Added `/api/daily-update/calls`, `lib/daily-update-calls.ts` and `lib/daily-update-calls-data.ts` — every booking row now shows its **on-ground AI call** state and summary, carried into the HTML and XLSX exports.
- Split the fetching logic from the data handling into a dedicated module so the sheet, the exports and the report engine all read the same call data.
- Added **WhatsApp call approval** (`lib/daily-update-approval.ts`) — a call result can be approved before it is used downstream, instead of flowing straight into reports.

### 1.3 Daily Update — Digital Feedback Forms
- Integrated the **digital feedback form responses** into the sheet (`lib/daily-update-feedback.ts`), surfaced on the booking page as well, and included in both exports — so the call result and the guest's own feedback are read side by side.

### 1.4 Experience Report Centre — new module
Post-trip reporting for the Experience Team (`/dashboard/te/experience-reports`, 22 new files):

- **Schema + SQL** (`2026-08-18-te-experience-reports.sql` and its apply script) and the full `/api/te/experience-reports` surface — list, detail, settings — plus a **cron route** wired in `vercel.json`.
- **Engine** under `lib/te/experience-report/` — `collect` (pulls the day's completed bookings, AI calls and feedback), `risk` (classifies a response as good or bad), `narrative` (writes the summary), `email`, `run`, `store`, `auth` and `types`.
- **Auto-send rule** as specified: reports cover **day-before-yesterday's completed bookings**; if **neither** an on-ground call nor a feedback form exists, the report **waits in pending** for the Experience Team to write it manually; if **at least one** of the two exists, it sends automatically. **Bad reviews escalate by mail** (existing behaviour, now wired to the new engine).
- **Client thank-you letter** (`client-mail.ts`) — a creative, AI-written thank-you email to the guest after the trip, generated per booking and sent from the report detail view.
- UI: report list, **report detail** with the full narrative and per-booking evidence, and a **settings panel** for recipients and schedule.

### 1.5 Service Types Expanded
- New `lib/service-types.ts` plus `2026-08-18-agenda-service-types.sql` and a schema change — the expanded service types now flow through the **agenda** (generate, Word, PDF), **ground assignments**, the **MC report** and its print view, the **TE daily view**, the vendor dashboard and the Ops AI registry.

### 1.6 Chat — Emoji & Stickers
- Added an emoji and sticker tray to the chat composer (`chat/emoji.ts`, `composer.tsx`, `message-bubble.tsx`), including recent-usage tracking.

### 1.7 Chat / WhatsApp / Ops AI — Launcher Alignment
- Fixed the misaligned floating launchers: the chat dock, the WhatsApp mini chat and the Ops AI button now sit in one consistent launcher lane without disturbing the components themselves.

---

## 2. Accounts System

### 2.1 Shared Profile Photos (cross-system, pairs with 3.1)
Profile pictures were not resolving across the two systems, so chat showed blank faces.

- **`ChatAvatarService`** + **`AvatarController`** and a dedicated `/avatar` route — each system serves faces from its own route, reading from **one shared `avatars/` store** in the shared bucket, so no cross-site image request is needed.
- **`PublishAvatarsToShared`** command to push existing photos into the shared store; `ChatDirectory` and `ChatMediaService` updated to resolve avatars through the new service; filesystem disk, `config/chat.php` and `config/access.php` entries added.
- Profile page updated to upload and manage the photo.

### 2.2 Chat — Emoji & Stickers (pairs with 1.6)
- Built the emoji/sticker tray in `public/js/chat.js` and `public/css/chat.css` with customisable trays and **recent-usage tracking**, then fixed the tray closing behaviour and versioned the chat assets so the browser picks up the new build.
- Corrected chat **avatar sizing** in the dock and thread.

### 2.3 Payable 1.0 — MY/SG Excel Export Columns
- Reworked the CSV/Excel export on `/payables/v1` with **dynamic column handling**: for **Malaysia and Singapore only**, the export now leads with Booking Arrival, CNTL Number, IS Number, Currency, Invoice Amount, Received Amount, Balance, Line Check-In, Line Check-Out, Agent Type, Agent, Client Name, Supplier, Actual Payable, Paid Amount, Balance and UEN Number, with the remaining columns after. Other countries are unchanged.

---

## 3. Cross-System Integrations Delivered Today

| Integration | Booking System (Ops) | Accounts System |
|---|---|---|
| **Shared profile photos** | `/api/chat/avatar/[system]/[ref]`, `lib/chat/avatars.ts`, profile page + photo upload | `ChatAvatarService`, `/avatar` route, `PublishAvatarsToShared`, shared disk |
| **Emoji & stickers in chat** | `chat/emoji.ts` + composer tray | `chat.js` tray with recent-usage tracking |
| **Experience reporting inputs** | AI calls + feedback forms collected per booking | (reads the same booking/IS keys already shared) |

---

## 4. Git History — 18 Aug 2026

### 4.1 Booking System — branch `Main_v7_DEV` (13 commits)

| Time | Commit | Subject | Change |
|---|---|---|---|
| 09:31 | `38adc39` | chat: launcher-lane positioning | 4 files, +121/−12 |
| 10:53 | `e8d3ce4` | **Experience Report Centre** (generation, mailing, escalation) | 22 files, **+4,480** |
| 11:23 | `d42a116` | Daily Update PDF + XLSX generation | 10 files, +2,136/−2 |
| 11:32 | `69c929a` | Daily Update HTML export, XLSX improvements | 8 files, +531/−378 |
| 12:00 | `0a64017` | Daily Update export (XLSX) refinements | 1 file, +226/−33 |
| 12:16 | `9bb4390` | Profile page + shared avatar handling + profile APIs | 10 files, +809/−32 |
| 12:51 | `b1b4c31` | Call tracking for the Daily Update sheet | 11 files, +1,057/−158 |
| 13:07 | `e5ec262` | Split call fetching from data handling | 3 files, +169/−152 |
| 14:28 | `87c7c6f` | Digital feedback forms into the Daily Update | 10 files, +782/−43 |
| 14:46 | `f03f878` | Expanded service types across agenda/MC/TE/vendor | 18 files, +253/−84 |
| 16:04 | `a1594a6` | Emoji & stickers in the chat composer | 3 files, +297/−9 |
| 16:27 | `e4f5df9` | WhatsApp call approval in the Daily Update | 6 files, +522/−4 |
| 17:11 | `a2885ad` | Client thank-you letter + report handling | 15 files, +1,035/−84 |

**Total: ~12,400 lines added, ~990 removed.**

### 4.2 Accounts System — branch `REV1` (5 commits)

| Time | Commit | Subject | Change |
|---|---|---|---|
| 11:07 | `691e801` | Payable 1.0 CSV export — dynamic columns (MY/SG) | 1 file, +135/−49 |
| 12:16 | `af939f1` | Shared avatar storage & retrieval (cross-system) | 13 files, +550/−43 |
| 15:58 | `0fb1479` | Emoji & sticker trays + recent-usage tracking | 2 files, +294/−2 |
| 16:03 | `a1d94f5` | Close emoji box, version chat assets | 2 files, +7/−2 |
| 16:08 | `dad65ff` | Chat avatar sizing + asset versioning | 3 files, +21/−9 |

**Total: ~1,007 lines added, ~105 removed.**

---

## 5. Claude Code History — 18 Aug 2026

Sessions run today (times are Asia/Colombo), with the instruction that drove each:

| Time | System | Request |
|---|---|---|
| 09:23 | Booking | Fix the messed-up alignment of the WhatsApp chat, internal chat and Ops AI launchers — without disturbing the components themselves |
| 10:41 | Accounts | Payable Excel download for **MY and SG only**: lead with the listed 17 columns, then the rest |
| 11:07 | Booking | Create the **Daily Update Sheet** — travel/created/updated dates, IS & CNTL, guest and agent contacts, country and date filters, default next-10-days arrivals, creative PDF and Excel, live data safe |
| 11:27 | Booking | PDF download must also produce the creative **HTML view** and an **Excel** file |
| 11:50 | Booking | Add **editing of guest and agent phone, WhatsApp and email** in the sheet |
| 12:00 | Accounts | Images not showing across sites — serve **profile pictures** correctly in chat on both systems |
| 13:06 | Booking | Fix the Next.js production build failure |
| 15:52 | Accounts | Send **emojis and stickers** in chat |
| 16:05 | Accounts | Fix the profile picture issue in Accounts chat |
| 16:29 | Booking | Fix the component — **no live-data changes, no data loss** |
| 16:55 | Booking | Auto-send the day-before-yesterday's completed bookings with **AI call + feedback summaries**; hold in pending when neither exists; bad reviews escalate; send the client a creative **thank-you email** |
| 17:23 | Booking | Write a clear explanation of the Experience Report flow for management, with a diagram |

Standing constraints applied in every session: **do not touch live data, do not lose any records** — all schema work went through forward-only migrations / manual SQL files.

---

## Summary

| Area | Items Delivered |
|---|---|
| Booking System | Daily Update Sheet (filters, editable contacts, PDF/HTML/XLSX exports), AI call tracking + WhatsApp call approval, digital feedback forms, Experience Report Centre (collect/risk/narrative/email/cron, auto-send rules, escalation), client thank-you letter, expanded service types, chat emoji & stickers, launcher alignment |
| Accounts System | Shared cross-system profile photos (service, route, publish command, shared disk), chat emoji & sticker trays with recent usage, chat avatar sizing and asset versioning, Payable 1.0 MY/SG Excel column rework |

**Commits today:** 13 on the Booking System (`38adc39` → `a2885ad`, branch `Main_v7_DEV`) and 5 on the Accounts System (`691e801` → `dad65ff`, branch `REV1`) — roughly **13,400 lines added** across the two systems.

Happy to walk through any of the above — particularly the **Experience Report Centre**, which now closes the loop from the on-ground AI call and the guest's feedback form through to escalation and the client thank-you letter, and the **Daily Update Sheet**, which gives the team one place to see and correct every arriving booking's contact details.

Best regards,
**Sasindu Diluranga**
