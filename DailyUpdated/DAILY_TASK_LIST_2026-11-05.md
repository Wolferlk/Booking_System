# Daily Task List — 5 November 2026 (Thursday)

**Owner:** Sasindu Diluranga
**Date:** 5 November 2026
**Written:** 5 November 2026, from git history and working-tree status

| Project | Branch | Work on 5 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 4 commits (`c3c4b6a` … `fe8bd99`) · pushed · clean · now 9 commits ahead of `Master-Dev`, no open PR |
| Accounts System | `test-bookings-panel-order-date` (new) + `b2c-same-order-versions` (new) | 2 commits, one per branch (`cd47574`, `1280449`) · pushed · clean · **neither merged into `Master-Live`** |
| Aahaas Online Work | `main` | 4 commits (`800e5e2` … `1b281f5`) + `506fb76` from 4 Nov 18:24 · pushed · **1 uncommitted file** (`agent-downloads.ts`, agent version 1.0.2 → 1.0.4) |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Several commit messages say "not committed" or "local branch". That was true when they were written, but the work is now committed and pushed. **Nothing is confirmed as deployed.** Online Work report delivery was tested with a fake mail server and made-up data, **not real Microsoft 365 or live data.**
>
> ⚠️ **Keep `ORDER_VERSION_MODE=same_order` off on live.** OPS and Accounts are ready to read same-order amendments, but `1280449` says one n8n gap is still open, and the card gateway check in the rollout doc isn't done.

## What was done

1. **OPS:** **same-order amendments** supported: taken-off lines ignored, each version gets its own notice, OPS waits for the store's costs, and the 15912 / 15913 card is fixed.
2. **OPS:** Agent Digest email rebuilt for Outlook; **Archive → Restore** added; background scroll lock on popups; top strip on the Sent history drawer fixed.
3. **Accounts:** same-order amendments handled on **B2C Invoices, P&L and Payables**.
4. **Accounts:** test bookings now appear on the **order date**; panel wording changed; auto-invoice skips test orders.
5. **Online Work:** new **Email report** with tickets and background sending, made more reliable after the failed RPT-WVXWXG ticket.
6. **Online Work:** **Master edit** for employee IDs; batch of 10 reported issues fixed (farewell, hub visibility, header, speed).

---

## 1. OPS — same-order amendments (`fe8bd99`)

14 files · +1,203 / −95 · new `b2c-same-order.ts` · design in `DevelopmemtsCludeMds/order-versions-same-order.md` · no OPS database change

- [x] **Taken-off lines ignored** in P&L, trip dates, flights and travellers, so a rebooked product isn't counted twice. Only applies when the store has the `removed_in_version` column; other orders read as before.
- [x] **Same-order amendments detected** (OPS only noticed new order ids before).
- [x] **Each version gets its own notice:** V2 and V3 no longer overwrite each other, and a booking is no longer mistaken for its own duplicate.
- [x] **OPS waits for the store:** auto-update waits for costs (about a minute); a failed version is refused; after 15 minutes without costs a person can apply with a warning, auto-update can't.
- [x] **Rebooked lines keep their P&L line** through the store's change log, so tickets and payment proofs stay attached.
- [x] **15912 card fixed:** shows "version 2 of 2" with 15913 as the active version, not struck through as "NOT IN OPS", and lists what each version changed.
- [x] Unchanged: 15726 and 15833 still show the old one as replaced; old-style amendments like 15912 → 15913 still work.
- [ ] After deploy, check the 15912 card, and that 15726 / 15833 still look right. The commit message records no test run.

## 2. OPS — Agent Digest fixes (`c3c4b6a`, `823a59c`, `ef29448`)

- [x] **Email design:** Outlook removed the dark header gradient and left white text on a pale background. Now dark text on white with a teal bar; table layout; pending box red / green at 0; guest, flight and hotel on separate lines. Also covers the dashboard preview and `/digest` view.
- [x] **Archive and restore:** nothing archived was deleted. New **Archived (n)** section under Your digests with Show and Restore. Auto-send stays off after restore, so it must be turned back on by hand.
- [x] **Popups:** background no longer scrolls (New Digest, Send test, Sent history); Send Now is now an in-app popup; no width jump when the scrollbar goes.
- [x] **Top strip on the drawer:** a 16px list gap pushed it down (20px at 125% browser scale). Drawer moved onto `<body>`; checked with screenshots.
- [ ] After deploy, check the popups in a browser (`823a59c` was only type-checked and linted).
- [ ] After deploy, look at **Archived** to see which digests are there (the live query was blocked).

## 3. Accounts — same-order amendments (`1280449`)

Branch `b2c-same-order-versions` · 17 files · +1,121 / −42 · includes a migration and `B2cSameOrderVersionsTest.php` · live data not touched

- [x] **Taken-off lines** no longer count in sale, cost, line count, service dates or traveller names.
- [x] **Old orders amended today** are found: auto-invoice, P&L fetch and Booking updates also search by the version's date, because the order keeps its original date.
- [x] **Invoice revisions:** a newer finished version becomes the next revision (e.g. AHS-15726R2), raised once only.
- [x] **Waits for the store:** same rules as OPS (failed version refused; after 15 minutes only a person can go ahead).
- [x] **Booking updates:** one row per version marked "same order", with before and after sale; shows "—" if the true "before" isn't known.
- [x] **Payables:** a taken-off line disappears unless it has money or a desk decision on it; then it stays, tagged "taken off in v2".
- [x] Old-style amendments like 15543 v4 and 15726 work as before.
- [ ] Find out what the open **n8n gap** is. `1280449` says it's explained "below", but the message doesn't include it.
- [ ] Merge into `Master-Live`, run the migration, deploy.

## 4. Accounts — test bookings (`cd47574`)

Branch `test-bookings-panel-order-date` · 5 files · +285 / −35

- [x] **Panel date:** B2C test bookings appear on the day the order was placed, not the day the P&L was saved (AHS-15830 and three others). Falls back to the old rule if the storefront can't be read, so the mail still sends.
- [x] **Wording:** "Left out" → "Excluded records"; "marked this period" → "None this period – marked as test"; new "None yet – order placed this period". Affects every report mail with the panel.
- [x] **Auto-invoice** and the invoice timer skip test orders, including amended versions. Staff can still raise one by hand.
- [x] Left as it was: P&L sync still runs for test orders; existing invoices stay, hidden from reports.
- [ ] Merge into `Master-Live`, deploy. Both today's branches change `B2cAutoInvoiceService.php`, so expect to check that file when merging.
- [ ] After deploy, check that AHS-15875 shows its records in the 03/11 mail (if it was placed on 03/11).

## 5. Online Work — Email report (`506fb76`, `800e5e2`, `e5e3bbd`)

- [x] **Faster preview** (`506fb76`, 4 Nov 18:24): one mailbox per request with progress, only the office's mailboxes, retries after 2 / 5 / 10 s, 10-minute cache.
- [x] **Email report** (`800e5e2`, 16 files · +1,528), built because a month's report took longer than one request allows (504): choose people and file types (Excel, PDF, CSV), get a ticket like RPT-7K3MQ2, the server builds and emails it. Live progress card, **Emailed reports** list with Send again, and an **Email it instead** link on failed downloads.
- [x] **Always gets sent** (`e5e3bbd`, 9 files · +237 / −104): the report's own people read first, time limits on Microsoft calls, restarts don't use up an attempt, and a failed part is named in the email and in Data sources.
- [x] Tests: 17 failure scenarios passed 14 times in a row with a fake mail server and made-up data; type check and build pass. One earlier test run stopped with no result and couldn't be reproduced.
- [ ] After deploy, press **Send again** on **RPT-WVXWXG** (it stays failed).
- [ ] Send one real report through real Microsoft 365.
- [ ] Find out why the portal restarted (deploys, or memory on the 2 GB server):
  `journalctl -u aahaas-online-work --since "2 days ago" | grep -E "report-delivery|heap|Killed|Started"`

## 6. Online Work — Master edit and issue batch (`4055e87`, `1b281f5`)

- [x] **Master edit** (`4055e87`, 10 files · +1,222): admin and HR only. One grid for EMP ID, Terminal ID, Country and Department; proposes missing EMP IDs from the existing pattern without reusing gaps; duplicates checked against current and former staff, on screen and on save; Excel download; undo and a before → after review.
- [x] **Mail & Teams 502:** live report screens retry for about 19 seconds before warning. Cause not confirmed; a restart is the likeliest.
- [x] **Issue batch** (`1b281f5`, 26 files · +231 / −32):
  - Dark flash when switching tabs fixed.
  - Account menu and search overlay no longer stuck in the header.
  - Farewell notes: 8 per minute per IP was blocking the shared office IP (8 of 30 saved → 30 of 30).
  - Farewell QR screen updates itself after New QR; new farewell banner on the hub, employee and admin pages.
  - **Workspace Hub** only shows each person their own sites (test employee saw 8 of 8 → their 5).
  - Background page loads 14 → 2 per page view; admin pages show a loading screen.
  - Excel download blocked when there's no data; Director Board "Any Period" menu fixed.
  - Employee list limit removed when assigning.
  - India eSSL punches skipped as agreed.
- [ ] Test the assign employee list in a browser (needs the database).
- [ ] Use **Master edit** to fill missing EMP IDs after deploy.
- [ ] Commit or drop the `agent-downloads.ts` version change (1.0.2 → 1.0.4).

---

## Still to do today

- [ ] ⚠️ **Security:** confirm the boss account password from `301ca4b` (plain text in a pushed commit message) has been changed.
- [ ] **OPS:** run the agent-digest SQL on live (`--check` first), then **redeploy OPS** (digest, T-3 PDF, same-order reads, amendments, versions, carry-over, WhatsApp Retry/Report).
- [ ] **OPS:** open a PR for the 9 commits ahead of `Master-Dev`.
- [ ] **Accounts:** `php artisan migrate` (`b2c_order_amendments`, plus the new same-order migration), merge the three open branches (arrival-date, same-order, test-bookings) and deploy `Master-Live`.
- [ ] **Same-order rollout:** close the n8n gap, check that the card gateway's test merchant accepts an id like `15726-V3-K7QZ`, and only then switch on `ORDER_VERSION_MODE=same_order` (steps in §11 of the rollout doc).
- [ ] **Online Work:** check every admin is on the new access list, then deploy with the PM2 / nginx / DB pool changes; tell staff about the 7-day filing limit.
- [ ] **Fix Meta billing (error 131042)**, then WhatsApp **Retry failed**.
- [ ] Commit or drop the **HRMS** 502 retry change (uncommitted since 27 Oct).
- [ ] Write the **3 Nov, 4 Nov and 5 Nov daily updates** (none in the folder yet).

## Carried over

1. **From 4 Nov:** set up the 30 Sundays digest, send a test, switch on auto-send; check the Meta template status in Sent history; decide whether a driver vendor alone covers a line; add emergency contacts and generate T-3 for one real booking; decide if Data/Voice cost is part of Monthly cost.
2. **From 3 Nov:** check 15726 / 15833 versions and run the carry-over review with TE; check real B2C payable arrival and payment dates; Kieu's 10:53 leave email (**Send the email now**); password-reset mail settings on the server.
3. **From 2 Nov:** `php artisan b2c:order-chains` preview; compare **Store order mix** with AahaasFlow; test **Monthly Business Review**; check Apple import auto-tickets; Prev / In OPS decision; re-download the "Ticketing, Flights & Visa" roster; set department heads; remove old `pradeep.kumar@aahaas.com` BCC; department heads approving leave decision.
4. **From 31 Oct (Accounts):** deploy Payable 1.3 + missing products; **Write to the sheet tab**; **Rate sheet → Daily mail → Save & start**; Sheet doctor row fixes to the rate-sheet owner.
5. **From 30 Oct (Online Work):** Halloween items check; tell HR attendance % will change and export one period; nginx password on `/ad/bat`.
6. **From 29 Oct:** deploy OPS + AahaasFlow with the shared service key; B2C contact script for older bookings; check 14784; IT spend dates; check VN 42725 / VN42951.
7. **From 28 Oct:** Update Booking on 15679; test ticket sheet print; MDU → IXM; portal image feature on `gpt-image-2`; Karthik re-downloads Aug–Oct complaints; D-10 list decision; Accounts auto B2C invoices.
8. **From 27 Oct and earlier:** B2C Sales / AI Call reports; `pnl_date_overrides` migration; B2B quote pipeline decision; 7 calls stuck mid-dial; `n8n-project` call server; Travel Quote GPT DB; Operation App build; Meta guest template; biometric daily sync + new API key + UTC fix; transport supplier tables; Mail Scanner; ticket rate sheet dry run.
9. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
10. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.

---
