# Daily Task List — 28 October 2026 (Wednesday)

**Owner:** Sasindu Diluranga
**Date:** 28 October 2026
**Written:** 31 October 2026, from git history and working-tree status

| Project | Branch | Work on 28 Oct |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 7 commits (`003db15`, `d001034`, `d4fb602`, `ccb03c7`, `82a4b8f`, `fbbd173`, `bc3ee75`) · pushed · merged to `Master-Dev` on 29 Oct (PR #318) · clean |
| Accounts System | `Master-Live` | 1 commit (`d94c0d9`) · pushed · clean |
| Aahaas Online Work | `main` | No work · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Most of it was checked only with type-check or sample data built from order 15679, **not against the live store database** (still closed to this Mac).

## What was done

1. **OPS:** **flight-only B2C orders** (e.g. 15679) are now imported; they were skipped because they have no service date.
2. **OPS:** new **Aahaas Order card** on B2C bookings: store money in LKR and USD, order source, real guest email, invoice INV-15679.
3. **OPS:** new **Print tickets** for B2C flights: A4 double-sided, 3 tickets a sheet, then cross-checks and auto-fetch of the issued e-ticket.
4. **OPS:** **Auto Report complaint downloads** no longer cut at 30 rows.
5. **OPS:** ticket **Download PDF** always produces a PDF (browser print fallback).
6. **Accounts:** **B2C invoices raised automatically** every 5 minutes, store payment status shown, LKR/USD/both downloads, real guest email.

---

## 1. OPS — flight-only B2C orders imported (`003db15`)

5 files · +295 / −24

- [x] **Cause:** Aahaas saves flight orders with an empty service date ("TRAVEL — No service date" in AahaasFlow). The importer only took orders with a service date, so every flight-only order was skipped silently. This is also why 15679 wasn't in "Upcoming in store" and Fetch Now didn't help.
- [x] Travel date now comes from the flight booking: confirmed PNR date first (stays right after a reissue), then the searched date, then a date in the line's name like "(2026-11-10)". For 15679: CMB → IXM on 2026-11-10.
- [x] Fixed in one place (`b2c-db.ts`), so the 5-minute live watch, nightly import, preview, overview counts and Update Booking all pick it up. Flight lines get their own date in the itinerary (`b2c-booking-map.ts`); the reconcile report no longer files flights as "not importable".
- [x] Read-only on the store, no OPS schema change, existing bookings untouched.
- [ ] After deploy, check 15679 imports and shows in "Upcoming in store".

## 2. OPS — Aahaas Order card (`d001034`)

10 files · +981 / −13

- [x] Card above the P&L Summary on B2C bookings: order value, product total, paid and balance in **LKR and USD** at the store's own order-day rate (≈ 1 USD = 335.57 LKR for 15679), so it matches AahaasFlow and the USD P&L.
- [x] Order source badge ("AI WhatsApp", AI Voice, AI Chat, AI Web …) and an **AahaasFlow** button that opens the order on ai.aahaas.com.
- [x] **Invoice INV-15679** built by OPS from store figures (view, print, PDF, HTML), laid out like AahaasFlow's, with the USD equivalent. A missing stored discount shows as an "Adjustment" line so totals add up.
- [x] **Guest email:** `admin@it.aahaas.com` is the shared WhatsApp desk login. The real address is taken from the flight booking (where the e-ticket went); new imports never pick an @aahaas.com address when a guest one exists.
- [ ] For 15679, click **Update Booking** once after deploy to save the corrected email.

## 3. OPS — Print tickets for B2C flights (`d4fb602`, `ccb03c7`, `fbbd173`)

13 files · +1,497 / −1, then 4 files · +197 / −84, then 8 files · +371 / −64

- [x] **Print tickets** button on the Aahaas Order card: A4 double-sided, 3 tickets a sheet, cut on crop marks to 190 × 88 mm. Front: cities, flight, date, times, class, baggage, PNR / booking ref / e-ticket no., red stub with passenger name and QR code. Back: personalised important info, image and contact bar.
- [x] Two text-free artworks generated once with OpenAI and saved as static files; nothing generated per ticket.
- [x] Back side mirrored and measured: within 0.1 mm (long edge) / 0.5 mm (short edge). Dialog has a flip-edge setting and a ± mm back nudge, remembered per computer.
- [x] Gate, seat and boarding time left out (assigned at check-in); every ticket says it is an e-ticket itinerary, not a boarding pass.
- [x] **Cross-check (`ccb03c7`):** warnings for missing or mismatched ticket details against the store booking; PDF parser handles letter-spaced e-tickets; QR easier to scan.
- [x] **Auto-fill (`fbbd173`):** the dialog fetches the issued e-ticket from the Aahaas gateway in download mode (nothing sent to the guest). Store-booking reader fixed for the real field names (`fromAirportCode`, `departureTime`) and pairs ticket numbers to passengers. Tested against real order 15679: every field filled, no warnings.
- [x] Dialog has **Preview**, **Fetch again** and a line saying where the details came from.
- [ ] Print one test sheet, hold it to the light to check the backs line up, and nudge if needed.
- [ ] Madurai is under the wrong code (**MDU**, should be IXM) in the shared OPS airport list. Left alone because other screens use it.
- [ ] `gpt-image-1` no longer works on the OpenAI key (now `gpt-image-2`). Check the portal destination-image feature.

## 4. OPS — Auto Report complaint downloads (`82a4b8f`)

5 files · +27 / −17

- [x] **Cause:** the "max rows" setting (default 30) cut the complaint list, and CSV/Excel read the same cut list, so Aug/Sep/Oct all showed exactly 30 while the dashboard counted 140 / 48 / 133.
- [x] Report keeps a short list for the email and a full list for downloads (`report-data.ts`, `report-html.ts`, `report-workbook.ts`, `daily-workbook.ts`). Preview drops the full list to stay fast. Older open complaints are listed as "Carried, still open".
- [ ] After deploy, Karthik re-downloads the three months from Reports → Auto Report. Until then, raise "max rows" to 250.
- [ ] **Decide:** "Guest reconfirmation – past D-10" in the download is also cut at 30. Same small fix if wanted.

## 5. OPS — ticket Download PDF fallback (`bc3ee75`)

4 files · +214 / −133

- [x] The error showed at the top of the form, out of sight, and the server PDF was too slow on Amplify (Chromium downloading images and fonts).
- [x] Images are now built into the page before Chromium starts; font wait capped at 6 s. The dialog gives the server 35 s, then opens the browser print window for the same sheets ("Save as PDF").
- [x] Status and errors show next to Download PDF; button reads "Making PDF…".
- [ ] After deploy, check the dialog says **"From the issued e-ticket (fetched from Aahaas)"**. "SRILANKAN AIRLINES" in capitals means it fell back to the store booking.

## 6. Accounts — automatic B2C invoices (`d94c0d9`)

16 files · +741 / −28

- [x] **Why AHS-15679 said "Not raised":** invoices were only raised by the Settings → Fetching task (every 6 hours, off unless switched on).
- [x] New job every 5 minutes raises the AHS- invoice for new B2C orders without one. On by default, with switch, Run now and last-run log at `/settings/b2c`. Never revises existing invoices; skips agent, fully cancelled and refunded-to-zero orders.
- [x] Payment column shows the store's status before an invoice exists ("Paid on Aahaas · LKR 149,818.00", Part paid, Unpaid); after that, the existing auto-settle job marks it Paid.
- [x] Download is a menu: **LKR only**, **USD only** or **both**. LKR now matches AahaasFlow exactly (149,818.00, not 149,818.81). Stored invoice and ledger untouched.
- [x] Invoice uses the e-ticket email, never an @aahaas.com address. Older invoices keep their email until revised.
- [x] Tests: 87 passed, 4 skipped (need full app schema).
- [ ] Deploy Accounts and check `/settings/b2c` shows the job running and 15679 gets its invoice.

---

## Still to do today

- [ ] Merge `LIVE-1.0.0v` into `Master-Dev` and deploy `ops.aahaas.com` (import fix, Aahaas Order card, Print tickets, report fix).
- [ ] Deploy Accounts (auto B2C invoices).
- [ ] Write the **28 Oct daily update**.

## Carried over

1. **From 27 Oct:** deploy OPS (B2C Sales Report, test orders, preview fix, AI Call Report); deploy Online Work (asiacharm sign-in, Asset Management, IT spend, 502 fix); run the `pnl_date_overrides` migration and deploy Accounts; decide on the B2B quote pipeline in the Sales Report; confirm the `asiacharm.aahaas.com` spelling; look at the 7 calls stuck mid-dial since August.
2. **From 26 Oct (OPS):** deploy the traveller-experience call server (`n8n-project`); set the Travel Quote GPT DB connection and `WHATSAPP_REENGAGE_TEMPLATE`; new Operation App build for alert tones; root cause of "Quick call failed".
3. **From 24 Oct:** register the guest message template with Meta and send the queued VN41510 message; create `biometric_daily_attendance` on live and set `BIOMETRIC_DAILY_SYNC=on`; share a new biometric API key; deploy the biometric UTC timestamp fix.
4. **From 21 Oct:** transport supplier tables; Mail Scanner migration and first real scan; ticket rate sheet dry run.
5. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
6. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
