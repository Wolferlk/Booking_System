# Daily Work Update — 20 August 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 20 Aug 2026 (Booking System / Ops + Accounts System)

---

Hi [Name],

Today's headline item is the **Sri Lanka Drive Log** — a new Ops component that puts a booking's transport cost, the driver advance we paid, the balance still owed and the resulting **Transport P/L** on one line, and then lets the desk type in what the trip *actually* cost and send that straight to Payable 1.0. It ships with its own **settlement document pack** (the name board and three settlement forms the desk has been filling in by hand, now printed as one PDF).

Around it: the **All Mails ledger** on the Query Monitor with the new *Usefull mail* column, the **journey-map playback settings** and airport-name geocoding fix from yesterday's review, the **Payable 1.0 Excel export dialog** (the MY/SG attraction payment-run sheet), and two fixes on the non-credit invoice page.

Work spanned **both systems** today, because the Drive Log reads Accounts figures and writes back to Payable 1.0.

---

## 1. Sri Lanka Drive Log — new component (largest item of the day)

`/dashboard/srilanka/drive-log` in the Booking System. One row per Sri Lankan booking:

- **IS number** (main) with **CNTL number** beneath it, **arrival date**, and the **assigned driver** — clicking the driver opens the full driver and vehicle detail including account details.
- **Client invoice amount** for that booking, read from the Accounts system.
- **Total transport cost** (balance payable + driver advance), **driver advance**, **balance payable**, **advance paid**, **actual paid balance**, and **Transport Profit/Loss** = total cost − (advance paid + rest paid).
- Filtering, sorting, and **PDF / Excel export** of the board. Default view is travel dates from two days out, as requested.

**Nothing on this board is recomputed.** Every derived figure comes from the driver-advance envelopes the Accounts system already produces (`sl_driver_advance_snapshots`); the Drive Log only re-arranges them. That was a deliberate rule — two systems computing the same money independently is how the two systems start disagreeing.

Files: `src/lib/sl-drive-log.ts` (pure maths, filters, formatting), `-server.ts` (assembly), `-xlsx.ts`, `-pdf.ts`, the four API routes under `/api/srilanka/drive-log/`, and the page itself. Gated on `pnl:read`; the money columns on `pnl:view_profit`.

**"Still owed" was renamed "Transport P/L"** on the board, the PDF and the workbook after review — the number can be negative (we overpaid), and "still owed" reads as if it never can be.

---

## 2. Actual figures → Payable 1.0 (cross-system)

The derived figure is right most of the time, but not always — an extra airport run, a re-agreed package. The people who know were retyping numbers into Payable 1.0 out of WhatsApp.

- Two **editable columns** on the Drive Log: **Actual Transport Package Cost** and **Actual Balance Payable**, entered in a popup and saved per booking.
- **Submit to Accounts** posts the row to a new shared table, `sl_transport_settlement_requests` — the *only* table OPS was added to on the Accounts write allowlist, alongside the existing ticket approvals.
- On the Accounts side, `SlTransportSettlementRequest` + migration: Payable 1.0's **Transport settlement window** now reads the pending row, **shows the variance against the derived figure**, and pre-fills the rest-payment box. Recording the payment stamps the row `recorded` with the batch reference.
- **OPS never pays anything.** The submitted amount is a suggestion the clerk sees; the payment is still checked against the real ceiling by the existing settlement code, exactly like any typed figure. Actuals win over derived in the P/L wherever they are entered; status only says how far the figure got with accounts, never whether it is believed.

Also today, per the standing instruction: two no-database check scripts (`npm run drivelog:guard`, `drivelog:render`) that prove the board renders and that the write path cannot touch anything outside its own table.

---

## 3. Settlement Documents — the paper pack, printed

The SL desk fills four sheets in by hand for every settlement. There is now a **Documents** button on each Drive Log row that opens an editor for all four and prints them as **one PDF**:

- **Name board** (landscape, guest name large), **transport settlement**, **local visit settlement**, **tour settlement**.
- Each sheet is **drafted from the booking, agenda, driver allocation and the accounts advance detail**, then edited on screen — because the sheets carry hand-approved extras, agreed batta rates and shop signatures that exist in no database. The whole pack is stored as JSON per booking, and **a saved pack always beats the fresh draft**; nothing is silently refreshed under the person who edited it.
- Mixed orientation in a single PDF (landscape board + portrait forms) works through named CSS page boxes. The editor's preview is rendered by the **same** renderer as the print, so preview and print cannot drift; download posts the on-screen pack, so unsaved edits still print.

Additive SQL only (`prisma/sql/2026-08-20-sl-settlement-docs.sql`), no foreign key, no change to any existing table.

---

## 4. Query Monitor — All Mails ledger

- New **All Mails** tab and API: **one message, one row** — the chaser, the voucher, the out-of-office, the colleague's forward, in arrival order. Every other Query Monitor view filters something out; this one is the complete record, exported to its own sheet tab.
- A row is a *message* but its columns come from the *query* it belongs to: a chaser reads the root thread's SLA, reply detail and summary rather than showing blanks. Mail with no query at all carries what the envelope knows and says so in the Status column.
- **New "Usefull mail" column** — the sender rules that already map a domain (or an exact address, which wins) to Sales Person and Agent now also stamp each row **Usefull** or **NotUsefull**, so the noise can be filtered out of the ledger in one click.

---

## 5. Journey Map follow-ups (from yesterday's review)

- **Playback is now configurable and saved in Settings** — speed (default slowed to 0.55×, because the old pace crossed a leg in 1.5s and nobody could read a stop before the camera left), follow zoom, cinematic camera that rides with the vehicle, auto-open of each place's detail card on arrival, and fullscreen-on-play for the traveller portal. One operator tunes it once for everyone; an individual viewer can still override locally.
- **Manual zoom and touch gestures during playback** — two-finger zoom and rotate on the client portal.
- **Room type and meal type** added to the hotel pins.
- **Airport names resolved properly before geocoding** — a code or a bare airport name was being geocoded as a town, which put pins in the wrong place; journey map, agenda journey and the ops gazetteer now share one resolver.

---

## 6. Accounts System

### 6.1 Payable 1.0 — Excel export dialog
The Export button now opens a **column and format picker** instead of downloading at once: `.xlsx` (default) or `.csv`, a per-column checkbox list with ordering, and a toggle for portal totals. **MY and SG on the Attraction section default to the exact payment-run sheet the desk asked for** — arrival → P&L approval, 29 columns including the supplier's bank block. Choices are remembered per country and section. Control numbers, account numbers and SWIFT codes are forced to Excel text so leading zeros survive.

### 6.2 Non-credit invoices — SG40059 not appearing
- **Search widened** to match on **invoice number and reference number**, not just the previous fields — which is why SG40059 could not be found.
- **Only the latest revision is listed.** An amendment arrives as a new confirmation email under the same IS number and gets its own invoice (SG40059 → SG40059_R2/R2), so the page was printing the same booking two or three times. The listing now shows only the current revision — using the `is_latest` flag the invoice model already maintains — and the export follows the same rule. A booking with no invoice yet is still shown, unless something else already holds an invoice for that IS number.

### 6.3 Vietnam ground team access
The VN Limited role can now reach the **Drivers** and **Vehicle Vendors** registries (nav + middleware), which it needed for allocation work. No admin tools were opened up.

---

## 7. Code Volume

| Commit | System | Item |
|---|---|---|
| `13a95a6` | Booking | Journey-map playback settings, hotel room/meal type, portal touch controls (1,689 +) |
| `ad307e2` | Booking | Airport-name resolution for accurate geocoding |
| `b2543a8`, `841e4fd`, `a56fed8` | Booking | All Mails ledger — API, sheet export, mail logging, tab management (1,354 +) |
| `0336340` | Booking | "Usefull mail" column driven by the sender rules |
| `963116e` | Booking | Drive Log — core logic, board, workbook, PDF, driver detail (3,140 +) |
| `12e263c` | Booking | "Still owed" → "Transport P/L" across board, PDF and workbook |
| `a9d5816` | Booking | Transport actuals — save / submit / withdraw, VN ground access (1,587 +) |
| `bd88389` | Booking | Drive Log render + write-guard check scripts |
| `cfcf932` | Booking | Settlement documents — name board + 3 forms, one PDF (2,618 +) |
| `5f309a8` | Accounts | Payable 1.0 export dialog + server-side XLSX (466 +) |
| `ad52d14` | Accounts | Non-credit search on invoice / reference number |
| `4628f28` | Accounts | Latest-revision-only filtering for non-credit listings |
| `72dddec` | Accounts | `SlTransportSettlementRequest` model, migration, settlement window (592 +) |

**Total: ~12,169 lines added, ~766 removed** across **15 commits** — 11 on the Booking System (`13a95a6` → `cfcf932`, branch `Main_v7_DEV`) and 4 on the Accounts System (`5f309a8` → `72dddec`, branch `REV1`).

---

## 8. Claude Code History — 20 Aug 2026

Sessions run today (times are Asia/Colombo), with the instruction that drove each:

| Time | System | Request |
|---|---|---|
| 09:39 | Booking | Map animation is too fast — **speed settable and saved in Settings**; on Play, **zoom in on the vehicle** and show each place's description at the side; **manual zoom while playing**; same on the client portal with **two-finger zoom and rotate** |
| 11:24 | Booking | Continue — and **ensure the live database is safe, do not harm live data, do not lose data** |
| 11:50 | Booking | On All Mails, add a **"Usefull mail" column** — useful if the sender rules map the domain (or exact address, which wins) to Sales Person and Agent; otherwise NotUsefull |
| 12:54 | Accounts | On **Payable 1.0**, the SG & MY Attractions Excel download must come out in this exact 29-column format by default, with the option to change columns and file format |
| 14:06 | Accounts | **SG40059** is a non-credit invoice and shows here, but is **not on the non-credit invoice page** — fix it |
| 14:26 | Accounts | Don't show both — show **only the latest one**; SG40059_R2/R2 is the amendment |
| 15:04 | Booking | Build the **Drive Log** component creatively from `DriveLogV1.md` — don't harm other components |
| 16:13 | Booking | Add an **Actual Balance Payable** column entered in a popup, with a **Submit to Accounts** button |
| 16:21 | Both | Submitting must **update the Accounts rest payment and show profit/loss compared against it**; also add an **Actual Transport Package Cost** column. *Do this accurately* |
| 16:31 | Booking | Give the **VN ground limited team** access to driver and vendor management |
| 16:52 | Both | **Don't touch the live DBs — read-only, data must be safe, nothing lost.** Continue |
| 17:09 | Booking | Add a **Document Download** button on the Drive Log — produce, for a particular booking, the detailed documents the desk currently fills in by hand (photos of the paper forms supplied) |
| 17:24 | Booking | Corrections against the supplied form photos — layout, orientation and figures on the settlement sheets |

Standing constraints applied in every session: **do not touch live data, do not lose any records, read-only where possible.** The two tables added today are both new and additive (`sl_transport_settlement_requests` in Accounts, the settlement-docs store in Ops); no existing table, column or record was altered, and the Drive Log's write path is covered by an automated guard check.

---

## Summary

| Area | Items Delivered |
|---|---|
| Booking System | **SL Drive Log** (cost / advance / balance / Transport P/L per booking, driver and vehicle detail, filters, PDF + Excel); **transport actuals** submitted to Payable 1.0 with variance shown; **settlement document pack** (name board + 3 forms, edited then printed as one mixed-orientation PDF); **All Mails ledger** with the Usefull-mail column; journey-map playback settings, touch controls and airport geocoding fix; VN ground team access to drivers and vendors |
| Accounts System | **Payable 1.0 export dialog** with the MY/SG attraction payment-run sheet; **`SlTransportSettlementRequest`** + Transport settlement window reading OPS submissions; non-credit invoices searchable by invoice/reference number and **listing only the latest revision** |

Happy to walk through any of the above — particularly the **Drive Log**, which closes the loop between what a Sri Lankan trip was budgeted to cost, what we advanced the driver, and what it actually cost, and the **settlement document pack**, which takes the last hand-written step off the desk.

Best regards,
**Sasindu Diluranga**
