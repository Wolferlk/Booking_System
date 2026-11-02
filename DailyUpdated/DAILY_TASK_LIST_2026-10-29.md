# Daily Task List — 29 October 2026 (Thursday)

**Owner:** Sasindu Diluranga
**Date:** 29 October 2026
**Written:** 31 October 2026, from git history and working-tree status

| Project | Branch | Work on 29 Oct |
|---|---|---|
| Booking System / OPS | `Master-Dev` / `LIVE-1.0.0v` | Merged PR #318 (`3649fe2`) into `Master-Dev`, then 2 commits on `LIVE-1.0.0v` (`de5d8ab`, `c542dd6`) · pushed · **not yet merged to `Master-Dev`** · clean |
| Accounts System | `Master-Live` | 1 commit (`076b08b`) · pushed · clean |
| Aahaas Online Work | `main` | 2 commits (`2693af1`, `9be274a`) · pushed · clean |
| Task Manager / AHS | `main` / `sewminiV3-UI-changes` | No work · clean |

> All commits are pushed. Some commit messages say "nothing is committed". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Checked with type-check, lint, sample data or headless Chrome, **not against the live database.**

## What was done

1. **OPS:** PR #318 (`LIVE-1.0.0v` → `Master-Dev`) merged, bringing in the 26–28 Oct work.
2. **OPS:** **wrong B2C customer email** (desk login) corrected automatically, plus **automatic AI-call and WhatsApp enrolment** for B2C guests.
3. **OPS:** new **AahaasFlow section** on B2C bookings (journey, documents, products, P&L) and a fixed browser PDF download.
4. **Online Work:** devices handed over up to 29 Oct count as **confirmed "on record"**.
5. **Online Work:** IT spend — **cover and due dates editable** on Record a payment.
6. **Accounts:** P&L report finds P&Ls for **re-billed bookings** (VN 42725) and says why one has none (VN42951).

---

## 1. OPS — PR #318 merged (`3649fe2`)

- [x] Merged `LIVE-1.0.0v` into `Master-Dev` (Sales Report B2C, test orders, AI Call Report, flight import, Aahaas Order card, Print tickets, report fixes).
- [ ] `de5d8ab` and `c542dd6` came after the merge and are only on `LIVE-1.0.0v`. Open a new PR.

## 2. OPS — B2C email fix + auto AI-call / WhatsApp enrolment (`de5d8ab`)

13 files · +665 / −21

- [x] **Why 14784 showed `admin@it.aahaas.com`:** placed on the shared desk login (admin6611) and imported before the importer read the e-ticket contact; the importer never revisits existing bookings.
- [x] Contact is replaced **only when empty or an @aahaas.com inbox**; anything typed by a person is never overwritten, and every change is logged with the old value.
- [x] Runs when a B2C booking is opened, on every import run, and through a one-off script for older bookings. For 14784: `pradmu@gmail.com`, phone and WhatsApp +94703288141.
- [x] Agenda print, PDF and Word never show a staff inbox as the B2C customer email.
- [x] **Auto enrolment:** a B2C booking with a guest WhatsApp number is registered for AI calls (same defaults as Register) and gets the WhatsApp "allow calls" request. Number must match the guest's store contact; desk phone never used; 07… numbers without country code skipped.
- [x] Skips cancelled bookings, finished trips and anything staff already registered (including paused/cancelled). Once per booking, **max 10 per run** (Meta is already limiting the ops number). Store cancellation pauses AI calls and stops WhatsApp.
- [x] On by default; `auto_b2c_guest_engage_enabled = false` turns it off.
- [ ] Run the one-off script for older bookings after deploy.
- [ ] Open 14784 after deploy and check the contact fills in.

## 3. OPS — AahaasFlow section + PDF download (`c542dd6`)

10 files · +1,495 / −46

- [x] Server API to fetch AahaasFlow order details with a **shared service key**, with clear errors per status code.
- [x] Section below the Aahaas Order card: **order journey** (Booked → … → Travel) with NOW marker and Next action; **documents** (invoice, supplier vouchers, `AHCNF_<order>.pdf`, P&L statement) with View and PDF; **product cards** (photos, service date, progress, totals, supplier contact, details, read-only checklist, voucher); **P&L** card for `pnl:view_profit` roles only.
- [x] Browser PDF download via hidden iframe + html2canvas. Tested in headless Chrome: valid 2-page PDF, all 60 rows, page break between rows. Two cut-off bugs found and fixed.
- [ ] Set the **shared service key on both OPS and AahaasFlow** and redeploy both.
- [ ] Check the section on a real order (no AahaasFlow login here).

## 4. Online Work — old handovers confirmed "on record" (`2693af1`)

6 files · +43 / −6

- [x] Handovers to a person issued **before 30 Oct 2026 00:00 Sri Lanka time** and not confirmed are marked confirmed when the register loads (`asset-store.ts`), so My equipment, overview count, filters, issue desk, registers and Excel all agree.
- [x] Shown as **"On record"**, never as if the person signed. Self-confirmed devices, team equipment and later handovers untouched. Idempotent.
- [x] Tested on sample handovers (27 Oct, today 11 pm → on record; tomorrow 00:30 → still waits).
- [x] Cut-off is `HANDOVER_CONFIRM_FROM` in `asset-types.ts`.

## 5. Online Work — IT spend payment dates (`9be274a`)

1 file · +76 / −11

- [x] **✎ Change dates** on Record a payment (new, Raise for payment, edit): Covers from, Covers to, Due on. Covers to follows the billing cycle; due date follows the start when they matched; **↺ Back to the service's dates**.
- [x] Checks: due date required, period can't end before it starts. "Already paid for this period" uses the entered dates.
- [ ] Open in a browser (only TypeScript checked; project has no ESLint config).

## 6. Accounts — P&L report for re-billed bookings (`076b08b`)

4 files · +283 / −31

- [x] **VN 42725 "no P&L":** re-billed on 28/10 but confirmed on 17/10, so its P&L was dropped before the lookup. Now falls back to the newest revision on the whole P&L board, still skipping cancelled/test and keeping channel and country rules (`PnlReportSource.php`, `PnlDbReportService.php`). Workbook and booking count unchanged.
- [x] **VN42951:** if the Sync Ledger noted the Apple System has no quotation, the row shows "no P&L" with a red **"AS API: no quotation found"**. Read-only; never calls the Apple System.
- [ ] Check the next scheduled P&L mail for VN 42725 and VN42951 (reading of the code only, not confirmed on live).

---

## Still to do today

- [ ] PR `LIVE-1.0.0v` → `Master-Dev` for `de5d8ab` and `c542dd6`.
- [ ] Deploy OPS and AahaasFlow with the shared service key.
- [ ] Deploy Online Work (handover rule, IT spend dates) and Accounts (P&L report).
- [ ] Write the **29 Oct daily update**.

## Carried over

1. **From 28 Oct:** deploy OPS (flight import, Aahaas Order card, Print tickets, report fix); click Update Booking on 15679; print one test ticket sheet; MDU → IXM in the airport list; check the portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; decide on the D-10 list cut; deploy Accounts auto B2C invoices.
2. **From 27 Oct:** deploy B2C Sales Report, AI Call Report, Online Work (asiacharm, Asset Management, IT spend, 502 fix); `pnl_date_overrides` migration; B2B quote pipeline decision; asiacharm spelling; 7 calls stuck mid-dial.
3. **From 26 Oct (OPS):** `n8n-project` call server; Travel Quote GPT DB connection and `WHATSAPP_REENGAGE_TEMPLATE`; Operation App build; "Quick call failed".
4. **From 24 Oct:** Meta guest template and VN41510 message; `biometric_daily_attendance` and `BIOMETRIC_DAILY_SYNC=on`; new biometric API key; biometric UTC fix.
5. **From 21 Oct:** transport supplier tables; Mail Scanner; ticket rate sheet dry run.
6. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
7. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.
