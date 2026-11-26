# Daily Task List — 25 November 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 25 November 2026
**Written:** 25 November 2026, evening, from git history (GitHub `Wolferlk/Booking_System`, `Wolferlk/Accounts_system`, `parindaSathsara/n8n-project`). Covers commits up to 17:39.

| Project | Branch | Work on 25 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 9 commits straight on `LIVE-1.0.0v` · pushed · in sync with `origin` · **1 file not committed** (`journey-map.tsx`) |
| Accounts System | `Master-Live` | 5 commits straight on `Master-Live` · pushed · clean · in sync with `origin` |
| AI Quotation (n8n-project) | `AIImproved-V5` | 2 commits by me (`6d857e6a`, `13ed8c09`) + 2 merges · pushed · in sync with `origin` |
| Online Work | `main` | No work |

> **About the commit messages:** many of them say *"Nothing is committed or deployed"*. That was true when they were written. **Every commit listed here is now pushed.** Some commit messages also describe a different change from the files in that commit, because work was committed in batches (see each section). **Nothing is deployed.** Most changes were checked with type-check / PHP syntax check only, because starting the apps here would run the live pollers against live data. Live databases were only read (SELECTs through the read-only replica); **nothing was written to any live database and no email was sent.**

## What was done

1. **OPS:** meal preferences now show on the agenda, PDF and Word.
2. **OPS:** "Tickets Activated" checklist box no longer ticks itself when a booking comes in.
3. **OPS:** Apple System activity descriptions no longer have the day text pasted in front of them.
4. **OPS:** new **daily check for amendments in AS** on upcoming bookings (QA issue #4) + "Updated from AS" filter on All Bookings.
5. **OPS + AI Quotation:** Agent ID, Sales Person and guest name are now read from the AI Quotation system (fixes SG40099 blanks).
6. **AI Quotation:** own-arrangement hotel names keep being sent to OPS until OPS has the booking (fixes VN43430).
7. **OPS:** B2C **transport (category 7)** legs now reach the itinerary and agenda (order 16382).
8. **OPS:** B2C **return transfers** and **chains of one-way transfers** get their own agenda rows, in travel order, with remarks on every product.
9. **OPS:** airport rows with no flight get a **blank meeting time** instead of a made-up one.
10. **Accounts:** new **B2C P&L detail modal** that matches the admin PDF, with editable exchange rate; new P&Ls store the same figures.
11. **Accounts:** B2C invoices now book the **quote margin and header discount** (AHS-16382) and fix a **3-cent rounding gap** (AHS-16378).
12. **Accounts:** line Status column removed from the P&L modal and downloads.

---

## 1. OPS — Meal preferences on the agenda (`f398940b`)

9 files · +335 / −29

- [x] **Why:** "Only veg" was saved as a Special Note, which the agenda never read. Meal chips were also lost unless "Save Meal Prefs" was clicked.
- [x] Agenda Meal Preference cell shows meal chips + dietary special note.
- [x] Green **dietary strip** on the Passengers card ("1 guest with meal needs: …"), visible even when collapsed.
- [x] 🍽 badge on meal movements ("Vegetarian ×2 · Only veg"), with per-guest hover.
- [x] Meal chips **save on their own** after ~0.5 s ("✓ Saved · shows on agenda"); agenda tab picks up changes without reload.
- [x] PDF and Word include dietary notes only. Non-food notes (e.g. "arrange a cake") stay off guest documents.
- [x] **Safety fix:** meal-save endpoint now only updates passengers that belong to the booking being edited.
- [ ] Deploy, then try it on one booking.

## 2. OPS — "Tickets Activated" box (`4bfa55b4`)

1 file · +83 / −23 · booking `page.tsx`

- [x] **Why:** blank ticket records are created automatically when the P&L comes in, so the box went green straight after the order (checked read-only on IS49616: 3 tickets, none purchased, still DRAFT).
- [x] Box now counts tickets like the Tickets & Vouchers page:

  | Situation | Box shows | Colour |
  |---|---|---|
  | No tickets needed | Tickets Activated | follows booking stage |
  | Created, not all activated | Tickets Activated 1/3 | grey |
  | All activated, some bought | Tickets Issued 2/5 | amber |
  | All bought | Tickets Issued 5/5 | green ✓ |

- [ ] **Heads-up for staff:** older bookings with unbought tickets will now show e.g. "Tickets Issued 0/3" instead of green.
- [ ] **Separate issue:** "Bentota–Galle City Tour without Entrance" was put in the ticket category although it's a tour (P&L line sorting).

## 3. OPS — Activity description mismatch (QA #7) (`a2e51d9e`)

8 files · +1,429 / −31 · *this commit also contains most of the upcoming-updates job from section 4*

- [x] **Why:** on Apple System import, the day's general text ("The Republic of Singapore…") was added to the start of every activity's description.
- [x] Each activity now carries only its own description, as on the confirmation voucher. Day text shows once as a **"Day overview"** under the day route.
- [ ] Existing bookings (e.g. SG40099): itinerary corrects on the next AS sync; if the agenda already exists, use **Regenerate agenda** or **Confirmation Descriptions → Replace**.

## 4. OPS — Daily AS update check for upcoming bookings (QA #4) (`c942fd88`, `a2e51d9e`)

13 files · +1,107 / −16 (plus library files in `a2e51d9e`) · no schema change

- [x] **Why:** once a booking was imported, nothing re-checked AS. Amendments made days or weeks after confirmation never came through.
- [x] New job **every day at 04:30** checks every live B2B booking arriving tomorrow → +180 days (~1,660 today). Lists AS by arrival date in 2-week batches; re-fetches only bookings changed in AS (max 150 per run, configurable).
- [x] **New AS Booking → Upcoming Updates** tab: Daily check switch (default ON), Auto-apply switch (default ON), **Check now**, field-by-field changes with old value, run history.
- [x] **All Bookings** filter: Updated from AS · Yesterday / Today / Last 7 days / Needs review. Blue "AS updated" and amber "AS update · review" badges.
- [x] **Safety:** writes only through the existing Fetch Data from API code; never touches status, tickets, drivers, agenda, P&L, payments or checklist; hand-edited text waits for Replace / Skip; big changes (arrival moved > 3 weeks, different agent, pax/total changed by half, itinerary/hotels mostly gone) go to Needs review; **safety stop** if ≥ 40% (and ≥ 60) bookings change at once; never creates or cancels; skips B2C, cancelled and completed.
- [x] Reply to QA issue #4 drafted (`0a890eee` message).
- [ ] Deploy, then retest: amend a test booking in AS → **Check now** → confirm it shows under Updated from AS.
- [ ] Note: first ~10 days after go-live, later arrivals may not be checked yet — use Fetch Data from API for urgent ones.

## 5. OPS + AI Quotation — Agent ID / Sales Person / guest from Flow (`0a890eee`, n8n `6d857e6a`)

OPS: 5 files · +223 / −2 · n8n: 2 files · +118

- [x] **Why (checked read-only):** SG40099 (quotation 508339) came in with blank Agent ID and Sales Person and guest "teest booking". Apple System drops the agency reference, sales person and client when a quotation is re-saved; the AI Quotation system keeps its own copy (voucher shows "Malik / Miss Test Booking").
- [x] **AI Quotation:** new read-only feed `GET /v1/aahaas-flow/parties/{quotationNo}` (SME + Corporate), using the existing read-only OPS key.
- [x] **OPS:** new `flow-parties.ts` used by new imports, AS sync and refetch / public API. Lead guest renamed only while it still holds Apple's own name — names typed in OPS are never overwritten.
- [x] If the AI Quotation system is down, slow (6 s limit) or has nothing, OPS behaves as before.
- [ ] Deploy **both** n8n-project and OPS, then check SG40099.
- [ ] Not confirmed: the AI Quotation DB couldn't be read from here, so "Malik" for 508339 is not verified.

## 6. AI Quotation — Own-stay hotel names reach OPS (n8n `13ed8c09`)

4 files · +263 / −35

- [x] **Why:** VN43430 hotels (Alagon Saigon, Labe Phu Quoc, MK Premier Boutique) never reached OPS. The OPS pull has never filled a stay in production; the Flow push only ran at save / confirm / import time, before OPS had the booking.
- [x] **5-minute sweep:** re-checks quotations from the last 14 days whose trip hasn't ended and fills blank stays once OPS has the booking. Back-off 5 → 10 → 20 min … up to 3 h. `OWN_STAYS_OPS_SWEEP_MIN=0` turns it off.
- [x] Edits follow: an own-arrangement hotel changed in the AI quotation updates OPS, as long as OPS still shows the name Flow sent.
- [x] SME quotations use the hotel the brief named, only where the brief marked the stay as the customer's own.
- [x] 8 rule tests pass on test data; dry run on real data looks right.
- [ ] Deploy n8n-project, then check VN43430 fills within ~5 minutes.

## 7. OPS — B2C transport legs (category 7) (`2071f9bd`)

5 files · +186 / −7

- [x] **Why:** B2C import only read `checkouts_more_data` (categories 3–6). Transport lives in `tbl_checkouts` (cat 7) → `ai_transport_booking` → `ai_transport_leg`. Order 16382 got 9 agenda rows; missing city tours, Pinnawala, Ramboda, Horton Plains, the 15 Dec airport drop, etc.
- [x] New read-only `fetchOrderTransportLegs()`; each leg becomes one itinerary row (vehicle, distance, leg number in the description); arrival / departure widened to cover transport.
- [x] Importer: transport read fails → order still imports with a warning. Update Booking: transport read fails → sync stops (so it won't offer to delete transfer rows).
- [x] Checked against 16382's real data: **30 rows (9 product + 21 transport), 9–15 Dec**.
- [ ] After deploy: 16382 → **Update Booking → Itinerary**, then **Regenerate agenda**.

## 8. OPS — B2C return transfers and one-way chains (`bce2a89c`, `fde8e033`)

3 files · +205 / −22 · 3 files · +441 / −45

- [x] **Why:** the store saves outbound and return as identical rows; the agenda merged them and the return was lost (16378: 11 legs, every day). Real route is in `tbl_lifestyle_bookings.display_label` (read-only join checked on 16378).
- [x] Itinerary lines use the real route as the title; reverse route on the same day marked "Return transfer"; unlabelled duplicates tagged (Outbound) / (Return) / (k of n).
- [x] New `agenda-transfer-chain.ts`: every one-way leg kept and matched by direction; day's legs put in **travel order** (Hotel → Night Safari → Restaurant → Hotel); tickets / restaurants sit after the leg that takes the guest there; dropped legs put back with correct From / To.
- [x] Every product on the route (tickets, restaurants, activities) gets the "To here / From here / Today's route" remark; legs show "leg k of n".
- [x] Tested with mocked AI output on chains shaped like 16378 and 16382. Only B2C agendas affected.
- [x] P&L line names unchanged on purpose (Accounts-confirmed lines not affected).
- [ ] After deploy: 16378 → **Update Booking → Itinerary**, then **Regenerate agenda**.
- [ ] **Open:** a leg that had to be put back gets 08:00 unless the store gives a time — may need a manual fix.
- [ ] **Open:** AI sometimes marks a ticket row as Private Transfer (double-driver risk) — can now force those to Ticket Only.

## 9. OPS — Airport row with no flight → blank time (`268804f0`)

3 files · +49 / −4

- [x] **Why:** the AI invented 00:30 for an airport transfer on 16382 with no flight.
- [x] New `isUntimedAirportTransfer()` in `agenda-flight-link.ts`: From / To says airport / airfield / aerodrome and no flight that day gives a pickup time → meeting time left **blank**.
- [x] Applied in AI Generate and in the automatic agenda at intake (runs after the Sri Lanka defaults, so no 09:00 default either).
- [ ] Deploy, then regenerate 16382's agenda and check the airport row.

## 10. Accounts — B2C P&L detail modal like the admin PDF (`2d8a79f`, `72ad08b`)

8 files · +1,623 / −119 · 5 files · +295 / −11

- [x] **Why 16382 was wrong:** the LKR 221,617.50 vehicle-with-driver booking was never priced (USD 1,030 instead of 1,696.62), and the stored rate was 584.19 instead of the paid-time 332.668.
- [x] Modal now matches the admin PDF **to the cent** for 16382 (sale 563,999.98 / cost 525,477.44 / profit 38,522.54 LKR).
- [x] Shows order details, lifestyles with adult / child / package rates and FOC tag, hotels with meal plan and room, transport with all 21 routes and cost breakdown (LKR 192,710.87 net, 15% margin).
- [x] **Editable exchange rate:** USD, LKR, INR, MYR, SGD, VND; presets (storefront rate, paid-day rate, CBSL rate) or typed; PDF / Excel export at the same rate.
- [x] **New P&Ls store the live-preview figures** — scheduled fetch, Fetch now, Update booking, resync command and ledger repair all use the same save code.
- [x] **Save live figures** button on the live-preview banner (confirm dialog with before → after; P&L record only, logged; refuses on incomplete read or replaced order).
- [x] Checked against the read-only replica + headless Chrome render. Nothing stored.
- [ ] Deploy `Master-Live`, then **(live write)** press Save live figures on 16382.

## 11. Accounts — B2C invoice header money and rounding (`19a4141`, `31a0975`)

5 files · +194 / −13 · 2 files · +79 / −10

- [x] **AHS-16382:** Quote GPT orders keep the quote margin (7%) and discount only on the `tbl_checkout_ids` header. Invoice now books:

  | | LKR | USD |
  |---|---:|---:|
  | Services | 564,413.23 | 1,696.62 |
  | Service charges | 37,561.32 | 112.92 |
  | Discount | − 27,823.02 | − 83.64 |
  | **Total / Received** | **574,151.53** | **1,725.90** |

- [x] **AHS-16378:** invoice total now = amount paid at the printed rate (USD **1,636.71**, was 1,636.74) when the gap is only rounding (≤ 5 cents or 0.5%); leftover cent goes on the largest line.
- [x] Normal orders unchanged (16141, 16378 header = lines). Invoices raised before this change keep their old layout.
- [x] Checked read-only against live data and rendered to PDF; nothing saved.
- [ ] Deploy, then **(live write)** regenerate AHS-16382 (id 13266) and AHS-16378.
- [ ] **Decisions** listed at the end of the `19a4141` message (open).

## 12. Accounts — Line Status column removed (`a169a95`)

3 files · +20 / −36

- [x] Removed the order-time / booking / re-priced badge column from the P&L modal, PDF and Excel.
- [x] Explained why "re-priced" showed: Seetha Amman Temple and Galle Fort are likely free entries with 0 sale in the checkout record, so they fall back to today's catalogue (not checked in the DB).
- [ ] Open the modal and download a PDF / Excel to check the layout (only PHP syntax check run).

---

## Not committed

- [ ] `OPS System/apple-holidays/src/components/bookings/journey-map.tsx` (+27 / −6): trip summary card hides while the fly-through plays or a stop's drawer is open; now-playing HUD moved below the control row so it doesn't overlap. **Review and commit.**

## Still to do today

- [ ] **Deploy all three:** `LIVE-1.0.0v` (OPS), `Master-Live` (Accounts), `AIImproved-V5` (n8n-project).
- [ ] After deploy: Update Booking → Itinerary + Regenerate agenda for **16378** and **16382**; Check now on Upcoming Updates; check SG40099 and VN43430.
- [ ] **Live writes (need approval + backup):** Save live figures on 16382's P&L; regenerate invoices AHS-16382 and AHS-16378.
- [ ] ⚠️ **Security:** `OPS System/apple-holidays/CLAUDE.md` has an AnyDesk password and a laptop password in plain text at the bottom — remove them and change both passwords.
- [ ] ⚠️ Rotate the Gemini key (from 16 Nov).

## Carried over

1. **From 23 Nov:** no daily task list written for 23 Nov (OPS: WhatsApp Drivers filter, own-stay hotel names, MMT flights, Word agenda country, "[customer replied]" fix; Accounts: VN43457 invoice bug, VN43462_R2 / R2 numbering, File Handler from Apple System, Incoming Emails timeout). **Graph secret expired 23 Nov — mailbox import stopped**; check / renew it.
2. **From 24 Nov:** no commits found in OPS, Accounts or n8n-project.
3. **From 21 Nov:** run the PNL Rates Replacer in stages; decide on repairing OneDrive-overwritten bookings (VN40813 + others); may OneDrive amend its own bookings?
4. **From 20 Nov:** turn off "Arriving tomorrow" on the 30 Sundays digest; check OPS report and Aahaas mails with real data; D-6 / D-10 scope decision; `Call with Safraz and Sassindu .docx` in the OPS repo root.
5. **From 19 Nov:** `pnl_price_adjustments` index migration decision; cancellation-card number decision; try remove driver on one booking.
6. **From 18 Nov:** confirm Fetching tasks run again (VN43307_R2); Sync now on Payable 2.2VN; Online Work type-check + deploy, `PORTAL_URL`, email-reply mode decision.
7. **From 17 Nov:** decide on correcting stored B2C invoices / P&L rows (approval + backup); order-date rate decision; Excel MC Generate trial.
8. **From 16 Nov:** Gemini settings in ERP `.env` and both servers; invoice PDF / logo check; Reconciliation download check; "Sri Lanka" in address decision.
9. **From 11–14 Nov:** ⚠️ security (DB root password, port 3306, old password in `301ca4b`, OpenAI key, Git history cleanup); Meta billing `131042`; Vendor Payable migration; other items from the 21 Nov list.
