# Daily Task List — 7 November 2026 (Saturday)

**Owner:** Sasindu Diluranga
**Date:** 7 November 2026
**Written:** 7 November 2026, 16:10, from git history and working-tree status (remotes fetched first)

| Project | Branch | Work on 7 Nov |
|---|---|---|
| Booking System / OPS | `LIVE-1.0.0v` | 4 commits (`be8670e` … `0f54862`) · pushed · clean · now **22 commits ahead of `Master-Dev`**, no open PR |
| Accounts System | `Master-Live` (checked out) | 1 commit (`1eb3c9e`) · **PR #60 merged into `Master-Live`** at 16:06 · clean |
| Aahaas Online Work | `main` | 1 commit (`1e27cec`) · pushed · clean (the blank line in `asset-inventory.tsx` went in with it) |
| HRMS | `v1.0.13` | No work · **1 uncommitted file from 27 Oct** (`onlineWorkPerformance.service.js`) |

> All commits are pushed. Several commit messages say "not committed" or "isn't live yet". The work is now committed and pushed, but **nothing is confirmed as deployed.** Today's work was checked with type-check / lint, logic checks, fake data and a fake Meta / Graph, **not on real bookings, real WhatsApp, real email or real S3 files.**
>
> ⚠️ OPS type check still shows **11 old errors** in `webhooks/whatsapp/route.ts` and `wa-groups/server.ts` (not from today's changes).
>
> ⚠️ **Keep `ORDER_VERSION_MODE=same_order` off on live**, as in the 5 Nov list.

## What was done

1. **OPS:** **Agent Digest Ticket pack**: each agent gets all their tickets on D-3, with status, downloads, ZIP and a Ticket radar tab.
2. **OPS:** digest emails now attach **PDF, Excel and Word**; WhatsApp digests carry the **PDF**.
3. **OPS:** **View and Copy** buttons on every message in the Customer WhatsApp panel, with a WhatsApp-style viewer.
4. **OPS:** new **right-side trip panel** in the WhatsApp inbox, with **Send client portal** and **Send agenda** from the chat.
5. **Accounts:** amended B2C bookings show the **chain id `AHS-15726-15834-v3`** on Invoices, P&L and Payables (PR #60 merged).
6. **Online Work:** **two support desks** (IT Support, HR & Admin Support) with leads, members, assign, and an audit timeline.

---

## 1. OPS — Agent Digest Ticket pack (`be8670e`)

17 files · +1,551 / −106 · no database changes (reuses the digest tables)

- [x] **What the agent gets:** WhatsApp template with counts and a private link ("2 bookings, with 2 of 4 tickets available to download"); email or link page shows "1 of 3 ready" per booking, with date, location, reference and quantity per ticket.
- [x] **Ticket status:** Ready to download · File ready, purchase pending · Purchased, file to follow · Activated, purchase pending · Not activated yet.
- [x] **Downloads:** one button per file, plus **Download all** as a ZIP (everything or per booking).
- [x] **Settings:** send day D-1 to D-30 (default D-3), wait rule (send anyway / at least one ready / all ready), ticket categories and fields, download rules and link expiry.
- [x] **Extras:** catch-up for late or held bookings, follow-up message when a pending ticket becomes ready (marked **New**), link stays current, **Ticket radar** tab for staff.
- [x] **Safety:** prices, costs, portals and approvals are never read; non-activated tickets can't be downloaded; every download is re-checked (wrong link, cancelled booking or expired link refused).
- [x] Tested: 19 logic checks, download security checks against a fake database, a real ZIP download in a browser, page with sample data and no console errors.
- [ ] **Submit `aahaas_agent_ticket_pack` to Meta** (Sent history → Submit to Meta) and wait for approval.
- [ ] After deploy: **New ticket pack** → add agent and recipients → **Send test** first, then turn on auto-send (starts off).
- [ ] Test with real bookings and real ticket files from S3.
- [ ] Known: the page overflows by about 50px on phones (same as Daily digests, left as is).

## 2. OPS — digest attachments (`2b97f8f`)

7 files · +572 / −45 · new `agent-digest/attachments.ts`

- [x] **Email** (Daily digest and Ticket pack): PDF + Excel + Word. **WhatsApp:** PDF + link.
- [x] All three files follow the fields chosen in the Designer; no prices or driver rates. Excel has one row per service line or ticket, filters and a frozen header.
- [x] New **Attachments** box under When & how to switch each file on or off per digest.
- [x] Tested with sample data and a fake Meta / Graph.
- [ ] ⚠️ **On by default:** saved digests will start sending the files after the redeploy. Decide per digest before deploying if any agent shouldn't get them.
- [ ] **Two new Meta templates** are needed before WhatsApp can carry the PDF: submit and wait for approval.
- [ ] Send one real digest and open the PDF, Excel and Word in Outlook and on a phone.

## 3. OPS — Customer WhatsApp View / Copy (`acce52e`)

7 files · +704 / −40 · new `whatsapp-message-viewer.tsx`, `wa-text.ts`

- [x] **Copy** on both portal messages, each trip day and the feedback form, keeping WhatsApp bold.
- [x] **View** opens a WhatsApp-style screen: message strip (Welcome, Ready, Day 1–7, Feedback) with ← → keys, old vs new text with changes highlighted, delivery status per send (red warning if the last one failed).
- [x] **Copy plain text** (for email), **Open in my WhatsApp** (nothing sends until you press send there — a workaround while the Meta billing block stops templates), and a ticket reminder when a day has files.
- [x] Tested in a browser on fake booking data (View, Copy, day switching, phone layout); no message sent. Lint clean.
- [ ] After deploy, open **VN40138** and check View and Copy on a real booking.

## 4. OPS — WhatsApp trip panel and Send agenda (`0f54862`)

7 files · +2,043 / −4 · new `trip-panel.tsx`, `trip-send.tsx`, `booking-context` API, `whatsapp-trip-context.ts` · no database changes

- [x] Luggage icon in the chat header shows or hides the panel; chat list and chat box unchanged.
- [x] Sections: **Trip** (boarding-pass card, today's plan, tonight's hotel, contacts) · **Days** · **Agenda** (flags "No driver yet") · **Guests** · **Flights** · **Stays** ("Staying now") · **Package** · **Drivers** (call and chat) · **Tickets** · **AI Calls** (recording and transcript).
- [x] **Send client portal:** Welcome or Ready to travel, with an exact preview.
- [x] **Send agenda:** same options as the Movement Chart popup (WhatsApp or Email, PDF or Word, with or without drivers, Preview), pre-filled with the open chat's number.
- [x] Booking switcher when a number is on several bookings (e.g. an agent's).
- [x] Tested on fake data only.
- [ ] Load a real booking in the panel and send one real agenda (WhatsApp and Email) to an internal number.
- [ ] Check the agent-number switcher picks the right booking before sending.

## 5. Accounts — B2C chain id (`1eb3c9e`, PR #60 → `948c797`)

9 files · +161 / −10 · no migration

- [x] Amended B2C bookings show **`AHS-15726 ▶ 15834 | v3`** with version dots; normal bookings still show `AHS-xxxxx`.
- [x] Click copies the full id; on Invoices and P&L, **Alt+click** copies (click still opens the order). Replaced versions (e.g. #15833) show faded with the number struck through.
- [x] Shows on **B2C Invoices**, **B2C PNL** (row stays stored under 15726) and **B2C Payables** (lines and "By order" headings). Search finds by first id, latest id or full id.
- [x] PHP and templates compile; id building and search checked.
- [ ] **Not seen in a browser yet:** check the three pages after deploy, using 15726 / 15834 / 15833.
- [ ] Deploy `Master-Live` (brings #57, #58, #59 and #60).

## 6. Online Work — two support desks (`1e27cec`)

24 files · +2,121 / −452 · new `support-team.ts`, `support-team-panel.tsx`, `/me/desk`, `/tickets/team`

- [x] **IT Support** and **HR & Admin Support** desks; AnyDesk setup moved inside IT.
- [x] Admins choose each desk's **leads** (see the whole desk) and **members** (see only their assigned tickets).
- [x] Assign, reassign, resolve directly, move to the other desk; new **Assigned** and **Waiting for User** statuses; audit timeline.
- [x] Extras: resolve-time targets, list and lanes views, employee progress tracker, instant answers while typing, "is it fixed?" with a rating.
- [x] Old tickets upgraded with a backup first; fixed the old bug where one bad ticket record could wipe the whole ticket file.
- [x] 60 permission and workflow checks passed on the production build (**before** the small rate-limit fix); email notifications checked in the test log with sending off.
- [ ] Re-run the 60 checks after the rate-limit fix.
- [ ] **Back up the live ticket file** before deploying, then set up the desk leads and members.
- [ ] Send one real ticket notification email after deploy.

---

## Still to do today

- [ ] ⚠️ **Security:** change the **`dev-onlineWork` database root password** and close **port 3306** to the internet (from 6 Nov).
- [ ] ⚠️ **Security:** confirm the boss account password from `301ca4b` has been changed.
- [ ] **OPS:** run the agent-digest and WhatsApp group SQL on live (`--check` first), then **redeploy OPS** (Ticket pack, attachments, View/Copy, trip panel, groups, Get trips, vehicle checks, T-3 PDF, same-order reads, amendments).
- [ ] **OPS:** open a PR for the **22 commits** ahead of `Master-Dev`.
- [ ] **Meta:** submit the Ticket pack template and the two PDF digest templates; **fix Meta billing (error 131042)**, then WhatsApp **Retry failed**.
- [ ] **Driver app:** new build for iOS and Android (Get trips design, call-first, guest picker).
- [ ] **Accounts:** `php artisan migrate` (`b2c_order_amendments` + same-order migration) and deploy `Master-Live`.
- [ ] **Online Work:** back up tickets, check every admin is on the new access list, deploy with the PM2 / nginx / DB pool changes.
- [ ] Commit or drop the **HRMS** 502 retry change (uncommitted since 27 Oct).
- [ ] Write the **3–7 Nov daily updates** (none in the folder yet).

## Carried over

1. **From 6 Nov:** WhatsApp groups on one real booking (real OpenAI replies, `gpt-4o-mini` on the gateway, link the test group, tell staff who sees messages, Meta Official Business Account); Get trips decisions (high roof with 9 seats, "Van" ranges, `/driver-board` bypass), Driver-Auto tables on live, translations; register a driver and add a vendor vehicle; Sinhala / Tamil wording check, test on iPhone and Android, old emergency number on sign-up screens; find the cause of the 0-byte commit; Online Work tray with real filings, 1.0.4 installers on S3, dropdown fix on Windows, speed on live, asset delete on real `inventory.json`, Restore button decision.
2. **From 5 Nov:** after OPS deploy, check the 15912 card and 15726 / 15833, the digest popups in a browser, and **Archived** digests; after Accounts deploy, check AHS-15875 in the 03/11 mail; after Online Work deploy, **Send again** on RPT-WVXWXG, one real report through Microsoft 365, why the portal restarted (`journalctl`), assign list, **Master edit** for EMP IDs.
3. **Same-order rollout:** close the n8n gap, check the card gateway's test merchant accepts an id like `15726-V3-K7QZ`, then switch on (§11 of the rollout doc).
4. **From 4 Nov:** 30 Sundays digest + test + auto-send; Meta template status; driver vendor alone covers a line?; emergency contacts and T-3 for one real booking; Data/Voice in Monthly cost?
5. **From 3 Nov:** 15726 / 15833 carry-over review with TE; real B2C payable dates; Kieu's 10:53 leave email; password-reset mail settings.
6. **From 2 Nov:** `php artisan b2c:order-chains` preview; Store order mix vs AahaasFlow; Monthly Business Review; Apple import auto-tickets; Prev / In OPS decision; roster re-download; department heads; remove old BCC; leave approval decision.
7. **From 31 Oct (Accounts):** Payable 1.3 + missing products; Write to the sheet tab; Rate sheet → Daily mail; Sheet doctor fixes.
8. **From 30 Oct (Online Work):** Halloween items; attendance % notice to HR; nginx password on `/ad/bat`.
9. **From 29 Oct:** OPS + AahaasFlow shared service key; B2C contact script; 14784; IT spend dates; VN 42725 / VN42951.
10. **From 28 Oct:** Update Booking on 15679; ticket sheet print; MDU → IXM; `gpt-image-2` portal images; complaints re-download; D-10 decision; auto B2C invoices.
11. **From 27 Oct and earlier:** B2C Sales / AI Call reports; `pnl_date_overrides`; B2B quote pipeline; 7 stuck calls; `n8n-project` call server; Travel Quote GPT DB; Operation App build; Meta guest template; biometric sync; transport supplier tables; Mail Scanner; ticket rate sheet dry run.
12. ⚠️ **Security:** rotate the exposed **OpenAI key** and other secrets; remove `ssh-keys/developer_key` and the door bridge token from Git history.
13. **Older items:** driver app review submission, B2C Update Booking migration, Trans-Recon setup, Accounts server load checks.

---
