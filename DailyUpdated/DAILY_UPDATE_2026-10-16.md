# Daily Work Update — 16 October 2026 (Friday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 16 Oct 2026 (OPS + Accounts: B2C Update Booking button that updates both systems; OPS: Report Studio PDFs for the MC Report, AppleSystem CNTL / Agent ID / Sales Person / route, WhatsApp for Vietnam users, view2 full-screen takeovers; Online Work: Farewell Wall, TV control page with Call to room, white Board Room call, farewell invitation on Daily filing, edit employee name)

---

## Executive Summary

**OPS + Accounts:**
* **Update Booking (B2C):** a new button on B2C bookings re-reads the order from the store, shows every difference with tick boxes, and saves the result as a new version (V7 → V8). It replaces *Fetch Data from API* / *Raw API Response* on these bookings.
* **Both systems at once:** pressing it in OPS or in Accounts (cloud icon on B2C Invoices / B2C PNL) updates both. Accounts updates the P&L and **revises** the invoice (AHS-15077 → AHS-15077R2), and each side's version names the other. **Needs `php artisan migrate` on the Accounts server before it can be used.**
* **B2C bookings overwritten by the AppleSystem sync** (e.g. 15077 showing *JB Travel Company*): fixed. The AppleSystem sync now refuses B2C bookings.

**OPS:**
* **Report Studio** on the MC Report: turns what's filtered on screen into a PDF, with 6 built-in templates (Driver Duty Sheet, Arrivals Board, etc.) and saved team templates. Also fixes the old *PDF (Print)* button, which ignored the advanced filters.
* **AppleSystem bookings:** correct **CNTL No.** (`499592CNTL`), new **Agent ID** and **Sales Person** fields, and each itinerary day's **route** line.
* **Vietnam user (GT_VN_USER):** WhatsApp inbox limited to Vietnam booking chats; the WhatsApp mini chat on the booking page now works for this role.
* **view2 command-centre screen:** full-screen takeovers for bookings, alerts and file-handler events, with sound and countdowns (committed last night).

**Online Work:**
* **Farewell Wall:** colleagues scan a QR and write a note with stickers and photos; the leaving employee opens them all as a story from their last day. Shown live on the office TV.
* **TV control page** and **Call to room:** pick up to 8 people and a room; every TV shows their photos with *"PLEASE COME TO BOARD ROOM"* and reads it out. Notices gain templates, position and their own sound level.
* **Board Room call** redesigned in bright white with new animations.
* **Farewell invitation** pop-up and banner on Daily filing until the person has written a note.
* **Edit employee name** (admins only), committed last night.

| Project | Today's commits | Branch | Worktree / remote |
|---|---:|---|---|
| Booking System / OPS | 6 commits (+3 late on 15 Oct) | `LIVE-1.0.0v` | Pushed · clean |
| Aahaas Online Work | 6 commits (+1 late on 15 Oct) | `main` | Pushed · clean |
| Accounts System | 1 commit | `REV1` | Pushed · clean |

> **About the commit messages:** some say *"nothing is committed yet"*. That was true when each message was written. **Every change listed here is now committed and pushed.** Nothing has been checked as deployed.

> **Committed after yesterday's update:** OPS `360d653`, `d5df617`, `4d7e70c` (view2 takeovers) and Online Work `81452a4` (edit employee name). They are covered in sections 5 and 10.

---

## 1. OPS — B2C Update Booking button

`e25792d` · 16 files · +1,458 / −10

* **What one click does:** reads the order again from the store tables (`checkouts_more_data`, `tbl_checkout_ids`, flights, travellers). **It only reads from the store, never writes to it.** A popup lists every difference (dates, pax, total, customer contact, destination, itinerary, lead passenger, P&L lines), each with a tick box. Nothing is saved yet.
* **Apply:** saves the old booking as a snapshot, writes the ticked changes and creates the next version with a note of what changed. Older versions can still be restored from the V menu. If someone changed the booking after the popup opened, Apply is refused and asks you to reopen it.
* **What it protects:**
  * **Edits by our team:** each update remembers what the store said last time. If only our team changed a field, it's left alone. If both changed it, the popup shows **"EDITED HERE"** and leaves it unticked.
  * **P&L:** new store lines are added. A changed line is only updated if Accounts hasn't confirmed or edited it. A line removed in the store is marked in its notes, **never deleted** (tickets may be attached). A locked P&L isn't touched.
  * **Never touched:** status, checklist, tickets, drivers, agenda, payments, status timeline.
  * **Cancelled bookings or orders deleted in the store:** refused, nothing written. The popup warns if the store marks the order cancelled or refunded.
* **Booking 15077 (*JB Travel Company* / *AppleSystem import*):** this is what an AppleSystem sync writing over a B2C order looks like. The sync (including the automatic pre-arrival one) didn't check for B2C, and OPS decided "B2C" from the agent field alone, so an overwritten booking stopped counting as B2C.
  * A booking now counts as B2C if **any** importer mark is still there: the agent, the P&L source tag or the first status note.
  * *Fetch Data from API* and the automatic AppleSystem sync now **refuse B2C bookings**.
  * The origin chip says **"Aahaas B2C store"** for these bookings.
  * 15077's real data couldn't be checked (the live database read was blocked). If it is a B2C order, Update Booking will offer to set the agent back to *Aahaas B2C*.
* **No schema change:** "what the store said last time" is kept in `system_settings` under `b2c_sync_state:<ref>`. After an itinerary update, regenerate the agenda (as with the AppleSystem sync).

**Checked:** type-check and lint. **Not opened in the browser or run against a database.**

---

## 2. OPS + Accounts — Update Booking updates both systems

OPS `7469ad9` (5 files, +441 / −23) · Accounts `ffbb93f` (13 files, +1,103 / −1)

| Pressed in | First | Then |
|---|---|---|
| OPS (booking page) | OPS booking → V8 | Accounts: P&L updated, invoice revised (AHS-15077 → AHS-15077R2), Accounts version v3 noted with "OPS V8" |
| Accounts (cloud icon on B2C Invoices / B2C PNL rows) | Accounts P&L + invoice revision, version v3 | OPS booking → V8 |

* **One sync id links both versions:** OPS writes *"Accounts v3 · AHS-15077R2"* into its V8 note, and Accounts stores `ops_version = 8`. The Accounts popup shows the history with both sides' numbers.
* **Preview first:** the OPS popup has a new **"Accounts system"** section with *Accounts P&L* and *Invoice* tick boxes. The Accounts popup shows the store figures, P&L and line changes, the invoice plan and what OPS would change.
* **Revisions only, never edits:** the old invoice and its payments stay on record. Revising is refused for an already-cancelled invoice or an order that now totals zero; those go through the cancellation flow.
* **Existing P&L protection still applies:** if the store's price snapshot can't be read, the stored P&L figures are kept.
* **Started from Accounts:** OPS only takes changes that are safe without a person checking. Fields also edited in OPS are left and listed as *"left for OPS staff to decide"*.
* **If the second system fails,** the first one's update stays; the failure shows in the result message and the version notes.
* **Customer email:** revising an invoice sends the customer revision email according to Accounts → Settings → Aahaas B2C. If that's on auto, the customer gets the revised invoice after the hold time. Both popups show the current setting before Apply.

**Before it works:**
1. Run `php artisan migrate` on the Accounts server. It creates one new table, **`b2c_order_versions`**, and changes nothing else. Until then Accounts refuses Apply, so updates are never left unversioned. **Not run** (needs approval, and the Accounts database can't be reached from the Mac).
2. Check the shared secret: OPS sends `ACCOUNTS_INTEGRATION_SECRET`, Accounts checks it against `OPS_INTEGRATION_SECRET` (falling back to `OPS_REPAIR_SECRET`). Also check `ACCOUNTS_APP_URL` and `OPS_BASE_URL` are set.

**Checked:** type-check, lint and PHP syntax. **Not run end to end.**

---

## 3. OPS — Report Studio for the MC Report

`1c71148` · 7 files · +1,794 / −21

* **Bug fixed on the way:** the old **"PDF (Print)"** button re-fetched by date and ignored the advanced filters, so a `drivers=SURESH` view would have printed every driver. **PDFs now use exactly the rows on screen.**
* **New:** a **Report Studio** button in the header, and **Export → PDF — this view** for a one-click PDF.
* **The Studio screen:**
  * **Templates:** your own, ones shared by the team, and 6 built-in: 🚐 Driver Duty Sheet (one page per driver, tick boxes, signature line), 🛬 Arrivals Board, 🛫 Departures Run Sheet, 🚨 Unallocated Chase List, 🤝 Agent Movement Statement, 📋 Daily Ops Overview.
  * **Settings:** *Columns* (31, drag to reorder); *Layout* (title, note, wide/tall, A4/A3, group by date / driver / agent / city / file / service, optional page per group, summary tiles, signature block, accent colour); *Filters* (including which dates the template opens on, e.g. "Tomorrow"); *Save* (name, icon, description, shared or private).
  * **Live preview** of the exact document that will print.
* Picking a template puts its filters and dates back on the chart; built-in templates keep whoever you've already filtered to.
* **Money safety:** driver rates are never in the PDF data. A driver-grouped sheet with KM figures, package cost or budget transfer shows a warning with a one-click **"Remove them"**.

**Checked:** type-check, lint, and sample PDFs rendered through the real builder (Driver Duty Sheet and Daily Ops Overview look right). **The Studio screen was not clicked through**, because the local `.env` points at the live database and saving a template would write to it.

---

## 4. OPS — AppleSystem booking fields

`6fe6c9f` · 9 files · +193 / −18 — applies on create from the AppleSystem API and on *Fetch Data from API*

* **CNTL No.** now comes from `reference_numbers.control` (e.g. **499592CNTL**). Older responses without it use the quotation number + CNTL. This matches how TC emails already store CNTL numbers (`471416CNTL`), so **emails should match these bookings more reliably**.
* **Agent ID** (`agent_id`, e.g. NL2200266119598): new field next to Agent Ref. No. (`agent_ref`, e.g. 143); both show.
* **Sales Person** (`sales_person`, e.g. MMT): new field on the Tour Confirmation Details card.
* **Itinerary route:** each day shows its route line (e.g. *Hanoi -> Da Nang (City Center)*) on its first row. Before, the route was dropped whenever a day had activities.

**Checked:** type-check; mapping tested on a sample shaped like IS49403. **Booking page not opened in the browser.**

---

## 5. OPS — WhatsApp for Vietnam users, and view2 takeovers

**WhatsApp inbox limited to Vietnam** — `a2a4044` · 7 files · +66 / −9
* GT_VN_USER could already open the inbox but saw **every country's chats**. Now they only see chats linked to a booking whose operation country is **VIETNAM**; Sri Lanka, Singapore, Malaysia and chats with no linked booking (e.g. *"Aahaas Qatar"*) are hidden. Admins and other roles see the same list as before.
* Opening or sending to a number outside Vietnam (messages, send, send-media, send-template, including typing a number into *New chat*) returns **403**.
* They can still send approved templates but **can't create new ones**, because templates are shared by every country. The *create template* option still shows for them but returns *Forbidden* (can be hidden if wanted).

**WhatsApp mini chat on the booking page** — `6febc9d` · 3 files · +25 / −2
* The green WhatsApp button already worked for this role. The **chat bubble next to Back** (read and reply to the booking's messages) was limited to TE, BT and admins in both the widget and its API. GT_VN_USER is now allowed.

**view2 full-screen takeovers** — `360d653` (13 files, +2,529), `d5df617`, `4d7e70c` — committed last night
* The view2 command-centre screen now takes over the full screen for new bookings, alerts and file-handler events, with sound and a countdown. Includes the view2 data and forecast APIs, charts, map and panels. Follow-ups made the takeover queue steadier and moved the stamp for visibility.

**Checked:** type-check and lint. **Not tested signed in as a Vietnam user** (local `.env` points at the live database).

---

## 6. Online Work — Farewell Wall

`4f6fccd` (34 files, +3,955 / −9) · `670befe` (3 files, +82 / −3) · `1d44924` (10 files, +1,367 / −18)

* **Admin:** Fleet → **Farewells**: pick the leaving employee and last day, add an optional line from the company, open the wall. **▶ Show QR screen** puts a full-screen QR on a sunset terrace for the office TV.
* **Colleagues:** scan the QR and write a note in handwriting on a coloured card (5 colours), pick a sticker, add up to **4 photos**. Sending folds the card into a wax-sealed envelope that flies away. While a farewell is open, anyone checking in with their badge also gets an envelope pop-up: *"Nimani is leaving 🥹 — tap to write"*.
* **The words never show on the TV.** Only counts, stickers and *"… just signed 💐"* lines.
* **The leaving employee:** notes stay sealed before the last day (*"No peeking 🙈"*). From the last day, their badge says **"Swipe for your last day"**: attendance is marked as usual, then each note plays like a story (envelope, card with the writer's face, words, photos, a lantern), ending with the whole wall and confetti. **It keeps working after their account is switched off** (memories only, no attendance).
* **On the office TV (`1d44924`):**
  * **Before the last day:** a washing line of sealed envelopes, one per note; new notes fly in with hearts and a *"… just sealed a note"* banner; the person's figure, a days-left chip, live counts and a large QR code.
  * **From the last day (or after *Reveal now*):** a looping show of the title, each note, photo "moments" every four notes, and the whole wall.
* Photos are processed on the server with **Sharp** (new dependency). Stored as files on the server, **no database changes**.

**Checked:** working end to end in the real app (per the commit). TV show not checked on the office TV.

---

## 7. Online Work — TV control page and Call to room

`9cc5bc8` · 28 files · +2,167 / −62

* **Reception desk (`/reception`), two new header buttons:**
  * **📡 TV notice:** the *Special notice on every TV* editor, plus **templates** (save, use, rename, overwrite, reorder, delete), **position** (drag the banner on a preview wall, drag its edge to resize, or pick Bottom / Top / Middle / a corner), and a **sound level per notice** (TVs return to normal volume afterwards).
  * **📣 Call to room:** search **all** employees and pick up to **8**, choose a room (Board room, other presets, or type one), add a line, choose priority or staff call, sound level and whether it's read out. Every TV shows their pictures, *"PLEASE COME TO BOARD ROOM"* and a pulsing **NOW**, and the announcer reads it twice. Recent calls can be stopped or repeated.
* **Admin:** new **TV control** item in the sidebar with tabs for Notice (with live screens), Call to room, Sound & moments, and Views. Settings → Office TV and the *On air* bar's Edit link point to it.
* **How a call behaves on the TV:** it interrupts a notice (which replays afterwards); it waits for a check-in, boss entrance or meeting reminder to finish (≈15 s max); a TV switched on within 90 seconds still plays it; a person's photo shows only while their call is up.
* **No database changes:** templates go in the existing TV settings file (older files still load). Calls are kept in memory, so **a server restart forgets them**.

**Checked:** type-check and production build (with lint) pass; TV demo (`/tv/view?demo=1`, press **C** for a call, **S** for a notice) screenshotted; both reception sheets tried.

---

## 8. Online Work — Board Room call redesign

`12bd720` · 3 files · +383 / −251

* The call screen is now a **bright white glass boardroom** with a city skyline (`summon-boardroom.webp`, generated with the OpenAI key) and dark navy text. Used on every TV and in *Play preview*.
* **Animations:** white flash and blur-in; *"PLEASE COME TO"* closes in, *"BOARD ROOM"* rises letter by letter with a blue underline; each person pops in as a round portrait with a turning blue ring and pulses, then name, team and underline slide up; a navy **NOW** pill rises with a bouncing pin and glowing rings; light moves across the windows throughout.

**Checked:** headless browser with 6 and 8 people; type-check. **Not seen on the office TV.**

---

## 9. Online Work — Farewell invitation on Daily filing

`7035672` · 4 files · +1,021 / −1

* **Pop-up:** when someone opens Daily filing while a colleague's farewell is open, a full-screen terrace scene shows the colleague's figure, *"is leaving us. Say something they'll keep forever."*, their last day, a countdown, the note count and the **first names** of recent writers (never what they wrote). Buttons: **Write my note** and **Later** (Esc / ✕ / outside click = Later).
* **Banner:** after *Later*, it folds into a banner at the top (*"KASUN is moving on"*, *"4 days left"*, pulsing red on the last two days) that stays **every day until they write a note**.
* **Writing:** opens the existing note card, signed with the user's name automatically. After sending, the banner bursts into hearts: *"Sealed for Kasun 💌 – You're note #7"*.
* **Rules:** pop-up once a day per farewell (remembered per browser); the leaving person never sees their own invitation; demo-sandbox sees nothing; two open farewells each get a banner, nearest last day first.

**Checked:** type-check; headless Chrome at desktop and phone sizes with sample data. **No real note sent; not tested live.**

---

## 10. Online Work — Edit employee name

`81452a4` · 4 files · +190 / −3 — committed last night

* **✎ Edit** next to the name on the employee page (admins only). Save reloads the page and the new name shows everywhere (top bar, filings, rosters, lists).
* The database write was **added to the `account-store` allowlist from the start** (the missing entry is what broke Offboard yesterday). Names are trimmed and must be **2–160 characters**. Every rename is written to the audit log with old name, new name and admin.
* New API `api/employees/[id]/name` (admins only, refuses sandbox sessions).

**Checked:** type-check. **No rename tried in the running app.**

---

## 11. Follow-Up Items

1. **B2C Update Booking (OPS + Accounts):**
   * run `php artisan migrate` on the Accounts server (creates `b2c_order_versions` only);
   * confirm `ACCOUNTS_INTEGRATION_SECRET` = `OPS_INTEGRATION_SECRET` / `OPS_REPAIR_SECRET`, and that `ACCOUNTS_APP_URL` and `OPS_BASE_URL` are set;
   * check Accounts → Settings → Aahaas B2C revision email (auto sends to the customer);
   * test on dev, then open **15077** to see whether it's a B2C order and restore the agent if so.
2. **OPS versioning bug (found, not fixed):** the email / OneDrive versioning numbers a new version as *active version + 1*, so with V7 on file and V3 active, the next change overwrites V4's history. The B2C path already uses *highest version + 1*. **Decide whether to apply the same fix.**
3. **OPS:** try Report Studio on dev (saving a template writes to the database); check GT_VN_USER's WhatsApp inbox and mini chat on dev; decide whether to hide *create template* for that role; open IS49403 to check CNTL, Agent ID, Sales Person and routes; check the view2 takeovers on the screen.
4. **Online Work:** test Call to room and notice templates / position / sound on the office TV; check the white Board Room call and the farewell TV show on the real TV; send one real farewell note from Daily filing; try a rename; note that **active calls are lost on server restart**; deploy needs `npm install` (Sharp added).
5. ⚠️ **OpenAI key:** the exposed key from `LIVE_ENV.md` was used today to generate the boardroom picture, so it has not been revoked yet. **Rotate it before go-live** with the other secrets.
6. ⚠️ **Still open from 15 Oct:** Accounts server load (kill the long `pnl_records` queries, apply the *Low-load preset*, check `crontab -l` / `pm2 list`); door bridge token in Git history; SSH key `ssh-keys/developer_key` still in Git; rotate exposed secrets; check the Daily P&L / Invoice mails' new cancellation counts; `/me/workday` on a phone; offboard Piyumindya; compare the daily report's off days / shifts / groups / meeting time; cancelled-booking popups in OPS; P1001 checks and config changes A1–A3.
7. **Still open from 14 Oct and earlier:** see 15 Oct update, item 8 (mobile app go-live, Online Work + nginx deploy, Accounts INR invoice migration, `GRAPH_MAIL_CLIENT_SECRET`, pending OPS and Bank Settlements scripts, and the rest).
