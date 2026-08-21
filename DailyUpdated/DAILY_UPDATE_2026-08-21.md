# Daily Work Update — 21 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 21 Aug 2026 (Booking System / Ops + Accounts System)

---

Hi [Name],

Today continued straight on from yesterday's **Sri Lanka Drive Log**. The settlement paperwork stopped being something the desk prints and hands over: the pack now carries the **company logo from a gallery**, a **shared entrance rate card** behind the Tour Settlement sheet, a **guest feedback QR** the customer can scan from the sheet, and a **Send to driver on WhatsApp** button that delivers the whole pack (optionally with the booking details PDF) to the driver's phone.

Two other items: **full booking re-sync from the Apple System** with a **pre-arrival auto-sync scheduler**, so a booking's content is refreshed a configurable number of days before arrival; and a **"No Tickets"** mark for bookings that genuinely sell no tickets, so QC stops holding them open forever.

On the Accounts side, the new **Daily Updates** page — the P&L payment board the finance desk asked for, one row per booking with the full supplier-and-bank block, per country layout, filters and export.

---

## 1. Settlement Documents — finished into a real pack

### 1.1 PDF that works on this server
The print path was falling over: `Chromium at /tmp/chromium cannot run on this host — binary targets x86-64 but this host is arm64`. Rather than fight the bundled Chromium, the renderer now has a **PDFKit fallback** (`sl-settlement-docs-pdfkit.ts`) that draws every sheet natively — so the pack prints on this box and on any environment without Chromium. The HTML renderer is still used where it is available; the fallback is chosen automatically and reported clearly instead of throwing.

### 1.2 Orientation per sheet
**Name board is landscape A4, the other sheets portrait A4 by default**, and the choice is **changeable and saved per document**. Mixed orientation inside one PDF holds in both renderers.

### 1.3 Logo gallery
The pack's main logo defaults to `AppleHolidaysLogo.png` but is no longer hard-coded:
- New **logos endpoint** — lists the built-in logos plus everything previously uploaded, and accepts new uploads (file type and size validated, authorised, stored in the shared bucket).
- The user **picks a logo from the gallery or uploads a new one**, and it is remembered.
- A **sub-logos switch (default on)** prints the small Aahaas / Apple Holidays marks under the header on the Transport, Local Visit and Tour Settlement sheets and on the Name board.

### 1.4 Tour Settlement rate card
The Tour Settlement sheet was being filled in from memory. It now prices itself:
- New shared table **`sl_tour_rates`** holding **adult and child rates per attraction**, with GET/PUT endpoints so the desk maintains the card in one place.
- Tour lines carry **separate adult and child rates**; the sheet multiplies them by the **pax count taken from the booking**, so the totals come out without arithmetic on paper.
- Because it is one shared card, two clerks settling two bookings on the same attraction now charge the same rate.

### 1.5 Guest feedback QR + feedback form
- **Signed, login-free guest links** (`feedback-link.ts`) — token generated and verified server side, derived from a public base URL with a fallback, so no session is needed.
- **QR code** (`sl-settlement-qr.ts`, cached as data URI and PNG) printed on the pack: the guest scans it from the sheet and lands on **that booking's feedback form and customer portal**.
- A **manual feedback form** was added to the pack as its own sheet, for guests who would rather write on paper — it goes to the driver and downloads with the rest.

### 1.6 Send documents to the driver over WhatsApp
- **Send Driver Documents** button on both places on the Drive Log, backed by `sl-settlement-docs-notify.ts` and a new `sl-phone.ts` number normaliser (SL local formats → international).
- Delivery goes through a **Meta message template**. The first attempt failed with `(#132001) Template name does not exist in the translation` — the template was not approved yet — so the sender now **bootstraps / falls back to an available template** and reports the real Meta error instead of a blank failure.
- A **tick box also attaches the booking details PDF** — arrival and departure dates, passenger details, notes and the rest, fetched live from the booking API rather than from a stale copy.

---

## 2. Apple System full booking sync + pre-arrival scheduler

`as-booking-sync.ts` — a **full re-read of one booking from the Apple System** that refreshes its content in place:
- **Non-destructive.** Fields are compared before writing and **locally entered values are preserved**; a sync never overwrites what someone typed here. Per-booking sync state records the last successful run.
- A manual **"Sync from Apple System"** action on the booking page, plus `/api/bookings/[ref]/as-sync`.

`as-prearrival-sync.ts` + `as-prearrival-scheduler.ts` — the automatic side:
- Refreshes bookings **a configurable number of days before arrival**, on a daily schedule set in a new **Pre-arrival tab** (enable/disable, lead days, run now, run log).
- `node-cron` with proper timezone handling, a **boot catch-up** so a restart does not silently skip a day, and a Vercel cron entry for the serverless side.

This is the piece that stops a booking going into arrival week with content that changed upstream a fortnight ago.

---

## 3. "No Tickets" bookings

Some bookings sell no tickets at all, and QC was waiting forever for a ticket activation that was never coming.

- New **`noTickets`** mark on the booking, set and cleared from the tickets page (`/no-tickets` routes, authorised).
- **QC now reads a marked booking as "Ticket Activation done (no tickets)"** rather than pending, and booking readiness counts it as complete.
- The mark **clears itself automatically** the moment a ticket is actually added to that booking — so it can never hide a real ticket.
- Carried into the **reports, the Detailed P&L and the booking details PDF**, so the status is visible wherever the booking is looked at.

---

## 4. Accounts System — Daily Updates page

New **`/daily-updates`** page: the P&L payment board the finance desk asked for, built off the P&L lines already in the database, with the **last AS-PNL fetch time shown and an on-demand fetch** if the figures look stale.

- **One row per booking line**, per country layout:
  - **Sri Lanka:** CNTL, Tour, start/end day, currency, invoice, paid amount, balance, agent type, agent, client name, check-in/out, description, **Bud P&L, conversion, Bud LKR, CBSL, actual paid, cheque no**, supplier details, A/C name, A/C number, bank, branch, SWIFT, remark.
  - **Vietnam / Malaysia / Singapore:** the same spine with **Bud SGD / MYR / VND, actual conversion, actual paid and paid details** in place of the LKR/CBSL/cheque block.
- **Sorting and filtering** — last updated, travel date, and **Today's Arrivals as the default view**.
- **Payments are read, not recomputed** — the weighted conversion rate, the payment references and the "paid details" string are all derived from the payment records that already exist against the line, so the board and Payable 1.0 can never disagree.
- Per-line **payment recording, status, remark and payment edit** endpoints, a **P&L detail popup**, and **XLSX export** of the current view.
- Page added to the access catalogue (`config/access.php`) and the nav, so it is role-gated like every other page.

Read-only against the live data except for the payment/remark/status writes it owns — no existing table or record was altered.

---

## 5. Code Volume

| Commit | System | Item |
|---|---|---|
| `189af92` | Booking | Logo gallery endpoint + upload, sub-logo switch, logo picker in the pack (1,007 +) |
| `4b3dea0` | Booking | PDF generation fallback and error handling (arm64 Chromium failure) |
| `5873578` | Booking | Send settlement docs to driver over WhatsApp — template sender, phone normaliser, PDFKit renderer (1,492 +) |
| `b1b91fe` | Booking | Full AS booking sync + pre-arrival auto-sync scheduler and settings tab (2,159 +) |
| `2299ae0` | Booking | Per-document orientation (landscape name board, portrait forms), saved |
| `769d8eb` | Booking | Shared entrance rate card `sl_tour_rates` — adult/child rates driving Tour Settlement (1,432 +) |
| `3e1b189` | Booking | Guest feedback link + QR on the pack, manual feedback form (902 +) |
| `304b7f5` | Booking | "No Tickets" mark — QC, readiness, reports, P&L, booking PDF (1,293 +) |
| `5fa9b53` | Accounts | Daily Updates page — controller, service, board, filters, export (2,722 +) |

**Total: ~11,355 lines added, ~431 removed** across **9 commits** — 8 on the Booking System (`189af92` → `304b7f5`, branch `Main_v7_DEV`) and 1 on the Accounts System, merged as **PR #48 `feat/daily-updates`** into `REV1`.

---

## 6. Claude Code History — 21 Aug 2026

Sessions run today (times are Asia/Colombo), with the instruction that drove each:

| Time | System | Request |
|---|---|---|
| 09:48 | Accounts | New **Daily-Updates page** — P&L lines from the DB with the last AS fetch time and an on-demand fetch; the exact SL column list and the VN/MY/SG column list; good filtering; sort by last updated / travel date / **Today's Arrivals by default**. *Creative, modern, effective — and don't touch the live DB, don't lose any data* |
| 10:20 | Booking | Make the documents page **more creative and modern**; main logo defaults to `AppleHolidaysLogo.png` but can be **uploaded and stored in the bucket**, chosen from a **logo gallery**; add a **sub-logos switch (default on)** showing the Aahaas / Apple Holidays marks |
| 10:31 | Booking | *"My server does not support this"* — **Chromium targets x86-64, host is arm64**; fix the PDF path |
| 10:40 | Booking | Add a button in both places to **send the driver documents over WhatsApp**, using a message template to the driver's number |
| 12:08 | Booking | On that button, **fetch everything from the booking API** — arrival and departure dates, notes, passenger details |
| 12:18 | Booking | Meta returned **`(#132001) template does not exist`** — the template is not approved yet, so change the approach |
| 12:22 | Booking | **Name board landscape A4, the other sheets portrait A4 by default**, changeable and saved |
| 12:45 | Booking | Tour Settlement must show **adult rate and child rate**, taken with the **pax count** from the booking; build the component creatively (form photos supplied) |
| 14:08 | Booking | Add a **QR code for that booking's feedback form / customer portal**; add a **manual feedback form** document; and let the WhatsApp send **tick to include the booking details PDF** |
| 14:14 | Booking | Add the supplied logo to **Transport / Local Visit / Tour Settlement** and as **sub-logos on the Name board** |
| 15:30 | Booking | Some bookings have **no tickets** — mark them on the tickets page; QC must then read **Ticket Activation done (no tickets)** |

Standing constraints applied in every session: **do not touch live data, do not lose any records, read-only where possible.** The two tables added today are new and additive (`sl_tour_rates` in Ops, the `noTickets` column on bookings); no existing record was altered, and the "No Tickets" mark self-clears as soon as a real ticket appears.

---

## Summary

| Area | Items Delivered |
|---|---|
| Booking System | **Settlement pack finished** — PDFKit renderer so it prints on this arm64 host, per-sheet orientation, logo gallery with upload and sub-logo switch, **shared adult/child entrance rate card** driving Tour Settlement, **guest feedback QR + manual feedback form**, and **send the whole pack to the driver on WhatsApp** with the booking details PDF attached; **full AS booking re-sync** with a **pre-arrival auto-sync scheduler**; **"No Tickets"** mark closing the QC gap |
| Accounts System | **Daily Updates page** — per-country P&L payment board (SL vs VN/MY/SG column sets) with supplier and bank block, Today's Arrivals default, filters and sorting, payment/remark/status recording, P&L detail popup and XLSX export |

Happy to walk through any of the above — particularly the **WhatsApp document delivery**, which takes the settlement pack off the desk and onto the driver's phone before he leaves, and the **Daily Updates** board, which puts every booking's budgeted P&L, actual payment and supplier bank details on one line for the day's arrivals.

Best regards,
**Sasindu Diluranga**
