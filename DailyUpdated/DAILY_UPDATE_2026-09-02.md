# Daily Work Update — 02 September 2026

**To:** [Manager / Team]
**From:** Sasindu Diluranga
**Subject:** Daily Development Update — 02 Sep 2026 (Accounts System, Booking System & AHS)

---

Hi [Name],

Below is a detailed summary of today's work across three systems — the **Accounts System** (Laravel), the **Booking System** (Next.js / Ops) and **AHS** (the Aahaas customer-facing React front end).

Today had one dominant thread and one separate one.

**The dominant thread: the daily reports did not agree, and now they do.** Three mails went out every morning — the OPS Daily Operations Report, the invoice auto-report and the P&L auto-report — and each counted "a day" on a different definition. All three were individually correct and none could be reconciled against the others from the mail alone. The day's work was making all three answer the *same* question, in the *same* words, off the *same* cohort of bookings: **the confirmations the Apple System raised that day**. That work spans both the Accounts System and the Booking System and ended in a cross-repo branch (`b2b-daily-cohort`) merged on both sides.

**The separate thread: Payable 1.0 was not paying what the Detailed P&L says.** Hand-built corrections on the costing sheet — added lines, removed lines, repriced lines — never reached the payable board. That was a real money defect and is now fixed.

**And on AHS:** the standard-mode front end got a full modern/animated redesign pass — hero, category navigation and scroll experience — across six landing pages.

---

## 1. The reporting thread — one day, one definition, three mails

### 1.1 The diagnosis (morning)

The two Accounts mails counted a day on two different clocks:

- The **invoice report** counts *documents we raised that day* — `generated_invoices.created_at`, Asia/Colombo.
- The **P&L report** counts *bookings the Apple System raised that day* — `pnl_records.as_created_at`, the "Extract Date" column on the sheet.

These agree for a booking confirmed and invoiced the same day. They **do not** agree for an amendment issued against an older booking. `AsPnlSyncRunner.php:57-60` states outright that an upstream edit does not change a booking's created date. So `VN41548_R6` is billed on 01/09 (its R6 invoice is on the invoice report) while its P&L still sits under a July / August extract date — and therefore appears on **no** P&L report at all, because that earlier day's report was sent weeks ago. Six of the eight bookings reported missing were `_R#` amendments, which matches exactly.

The email's own count check (41 bookings · 41 P&Ls · 41 invoices — balanced) was *consistent* with this, because the Sync Ledger also buckets by upstream date, so it never saw those 8 either.

### 1.2 Accounts — P&L / invoice parity (`f958f69`, 10:41)
Read-only in effect: no writes, no migrations, no data touched.

- **`Reports/PnlInvoiceParity.php`** (+162, new) — for the report's window, resolves every invoice the invoice report counts to its *newest* P&L (through the existing `BookingKey` / `InvoicePnlPairer` matching) and returns the ones the date query missed. **Union only** — nothing that was on the report is removed, and each carried booking still has to pass the report's own guards (channel, country, confirmed-only, not cancelled).
- **`PnlReportSource::build()`** — merges those in, re-sorted into the listing's order. **Scheduled reports only**; the `/pnl/db` page and its exports are untouched.
- **`PnlDbReportService`** (+75) — shared `applyGuards()` / `sortRecords()`, a `carried_in` count in stats, and the workbook's Remarks column now prints `CARRIED IN — billed in this period, raised <date>` (no column changes).
- **`PnlRecord`** — `carried_in` is a declared **PHP property, deliberately not an Eloquent attribute**, so it can never become a database write.
- **`ReportSchedule`** — the schedule's timezone now travels with P&L reports, so both reports cut the same office day.
- **`CheckPnlInvoiceParity.php`** (+172, new) — read-only command `php artisan pnl:parity-check 2026-09-01`, which prints what each report counts and, booking by booking, *why* the P&L report missed it (no stored P&L / raised earlier / cancelled / suppressed revision).
- Email note in `pnl-auto-report.blade.php` explaining the carried-in count.

### 1.3 Accounts — single-business test runs in the scheduler (`c9355ff`, 10:43)
So a fix like the one above can be proved on one book of business before it reaches everybody's inbox.

- `AutoReportService` dispatch logic extended to run a **single business** as a test.
- `AutoReportController` and `AutoPnlReportController` gained the endpoints; `reports/auto.blade.php` and `pnl/auto.blade.php` gained the controls (+41 each).

### 1.4 Accounts — Aahaas B2B (Flights) gets its own daily report (`07312b7`, 11:21)
**Why a new report type and not a third brand in the existing split:** that split cuts one day of `generated_invoices` into AHDS (B2B) and Aahaas (B2C). Flights bookings **never enter `generated_invoices`** — they live only on the read-only `b2b` connection. There is nothing to slice out, so this is its own book of business sending one mail.

- **`Reports/B2bFlightsReportSource.php`** (+302, new) — builds the report from `B2bBookingService` through the board's own `resolveFilters()`, so the emailed workbook is always a view the page could have produced. 19-column xlsx (reference, booked / travel dates, lead traveller, pax, agent, route, PNR, components, amount, payment), with unsettled orders shaded.
- **`emails/b2b-flights-report.blade.php`** (+262) — counts, gross value per currency, settled vs pending, component mix, a by-agent cut, and the first 60 bookings.
- **`ReportSchedule`** — `TYPE_B2B_FLIGHTS` plus its own filter-summary wording; registered in `ReportSourceRegistry`.
- **`b2b/index.blade.php`** (+265) and **`B2bBookingController`** (+225) — a Daily email card: start / stop, cadence, timezone, period, component / payment / currency scope, recipients + CC / BCC, subject, body note, **Send now** with dry-run and "as if it were", and a recent-sends log with file download.
- Defaults match the live invoice report: daily, 08:00 Asia/Colombo, "Yesterday only". **Seeded stopped with no recipients** on first visit — nothing is emailed until someone fills in addresses and presses Start.

### 1.5 Accounts — repair command for manual line totals (`f60d4c9`, 11:51)
- **`Console/Commands/RepairManualLineTotals.php`** (+105, new) — repairs stored totals on P&L records carrying hand-built lines, where the total and its lines had drifted apart.
- **`PnlManualLineService`** (+122 / −47) — the totalling logic reworked so the drift cannot recur.
- **`detailed-pnl-scripts.blade.php`** (+64 / −27) — the sheet's own arithmetic brought onto the same rule, so browser and server agree.

### 1.6 Accounts — count check wording moved into config (`4330334`, 12:13)
- **`config/reports.php`** (+17) — the count-check rows and their sentence become configuration.
- Applied across `accounts-daily-summary.blade.php`, `auto-report.blade.php` and `pnl-auto-report.blade.php`, so **three mails can no longer phrase the same verdict three different ways.** This is what made the cross-system alignment later in the day possible.

### 1.7 Ops — the OPS Daily Operations Report leads with the same count check (`8bcc9a0`, 14:08 · PR #315)

**What was wrong.** The two mails answered different questions and neither said so. OPS led with "42 new bookings" (bookings created in OPS, by OPS's own clock); Accounts led with "41 bookings · 41 P&Ls · 41 invoices" (confirmations raised upstream) and "50 invoices" (documents issued, mostly amendments to older bookings). All three are correct; none could be reconciled from the mails.

**What was built.**
- **`lib/reports/count-check.ts`** (+515, new) — reads `sync_ledger_entries` over the **read-only** `ACCOUNTS_DB_*` connection and re-implements the Accounts `SyncParityService` tally **field for field**: one booking counted once, cancellations not owed an invoice, zero-settling B2C orders not billable, and an unswept window reading **not checked** rather than *balanced*.
- A **Count check** section in `report-html.ts:159`, placed above intake, with the OPS column printed in full (Accounts folds it into "short"), plus a stat-strip tile, preheader, subject escalation and CSV blocks (+232 / −15).
- An **intake reconciliation** that accounts for every booking on either side of the 42-vs-41 gap: created here and confirmed upstream in the period / created here against an earlier confirmation / confirmed in the period but filed here after midnight / confirmed upstream with nothing here. **Only the last is a finding.**
- What Accounts issued, with the AHDS figure leading — and a sentence saying it is *supposed* to exceed the confirmation count.
- **`scripts/count-check-render.mts`** (+61) — `npm run countcheck:render -- 2026-09-01`: renders the mail, sends nothing, writes to neither database.

**Verified against live 01/09/2026 data, read-only:** AHDS 50 invoices = 6 new + 44 amended, matching the Accounts email exactly. Count check: AS 39/39/39, B2C 12/–/12/12, balanced. Typecheck clean on all touched files (the three `tsc` errors in the repo are pre-existing, in unrelated routes: qc-send, destination-image, uploads).

**Two things to know:**
1. The ledger reads **39** for 01/09, not the 41 the 05:07 mail showed. A later sweep (07:27) superseded two rows — a revision creates a new AS booking id and the old key is folded in. That is the documented `scopeForDay` behaviour and **both systems apply it**, so they will agree; but it means the count check restates the day as the ledger *currently* understands it, not as it stood when the earlier mail went.
2. The intake table was blank in the local preview only because this laptop cannot reach the OPS booking database (`DATABASE_URL` is held by Vercel). That path **degrades cleanly** — logged, section still renders — which the run proves. It populates on the server; it is the one part not confirmed against real numbers.

### 1.8 Accounts — the day cohort, and pre-send validation (`fce3e7b`, 17:01 · PR #54)

This is the piece the whole thread was building towards, and it comes straight from the requirement: *the OPS report must show only Apple System-created booking counts — if the Apple System raised 41 confirmations on 1 September, the mail and the workbook show those 41 and only those.*

- **`Services/Reports/AppleDayCohort.php`** (+455, new) — resolves **the cohort of bookings the Apple System confirmed on a given day**, as one shared definition that every report reads. The cohort, not each report's own date query, is now what a day *means*.
- **`InvoiceReportSource`** (+117) and **`PnlReportSource`** (+127) — both sources build against the cohort, so the invoice mail and the P&L mail are cutting the same set of bookings.
- **`InvoiceReportService`** (+121) and **`PnlDbReportService`** (+167) — cohort tallies carried into the analytics both mails print.
- **`emails/partials/cohort-check.blade.php`** (+143, new) — a single shared partial rendering the cohort check, included by `auto-report.blade.php` (+63) and `pnl-auto-report.blade.php` (+55). One partial is the mechanism that stops two mails describing the same discrepancy differently.
- **`config/reports.php`** — new **`cohort_preflight`** setting controlling **pre-send sweeping**: before a B2B daily report goes out, the cohort is swept and gaps repaired, so the mail reports a *repaired* day rather than reporting a gap and leaving it. Registered in `AppServiceProvider`.
- **1,262 insertions across 10 files.**

### 1.9 Ops — the same cohort logic on the OPS side (`e908f6c`, 17:01 · PR #316)
Merged in the same cross-repo cycle, so both systems changed together.

- **`lib/reports/apple-cohort.ts`** (+149, new) — the Apple System confirmation cohort, on the OPS side.
- **`lib/reports/report-data.ts`** (+138) and **`report-html.ts`** (+88) — the OPS report builds and prints against that cohort.
- **`scripts/cohort-report-check.mts`** (+32, new) — a read-only checking script, matching the `count-check-render` pattern.

### 1.10 Accounts — uncounted P&L activity removed from the mails (`8e2d89e`, 17:30 · PR #55)
The last change of the day, and a deletion rather than an addition.

Once the cohort defines the day, a block listing P&L activity that falls *outside* the counted set is no longer informative — it is a second set of numbers next to the count check, inviting exactly the "which figure is right?" question the whole day's work existed to end.

- **48 lines removed** from `auto-report.blade.php`, **47 removed** from `pnl-auto-report.blade.php`, descriptions updated in `cohort-check.blade.php`. Net **−93 / +5**.

---

## 2. Accounts System — Detailed P&L corrections now reach Payable 1.0 (`fff5d19`, 12:45)

**A correction to the premise first:** two kinds of edit exist on that sheet, and only one was broken.

- **"Edit figures"** — typing over an Apple System cell — goes through `PnlPayloadEditService`, which writes into `as_payload`, and **every payable line is rebuilt from `as_payload` on each request**. Those already flowed through. Nothing to fix.
- **Whole-line work** — the ✎ ADDED chips, plus remove / reprice / rename / re-file — goes through `PnlManualLineService`, which **deliberately never touches `as_payload`** (so a re-sync cannot erase the desk's work). The board read the payload half only. **That is the real gap:** "Harry Potter Vision Of Magic Peak" (127.60) and "SIC" (84.00) were never payable, and a line taken *off* the P&L was still being paid.

**What was built — `PayableManualLineOverlay.php`** (+566, new), replayed once at the end of `PayableReportService::generateReport()`, so the board, Daily Updates, driver advances, exports and the ledger sync **all cost a booking identically**.

Matching a sheet row to a payable row, in descending confidence:
1. **`pnl_anchor`** — every payable builder now stamps the row with the key the sheet gives it. `pnlAnchor()` is a transliteration of the browser's `mlKey`, verified against 5 real anchor shapes.
2. **section + name**
3. **the section's lump line** — a per-day meal correction has no counterpart on a board that pays meals as one figure
4. **a visible signed "— P&L correction" row**, so a correction is never *silently* dropped

**Three decisions worth flagging:**
- A **voided line stays on the board at zero, struck through** — it may already carry a payment, a hold or a supplier, and that work must not vanish without a word.
- **`move` changes the section only, never `type`** — `type` is half the sync key, so re-pointing it would orphan every payment recorded against the line.
- **Added lines get a permanent identity** (`MANUAL-<TYPE>-ML<id>`, now honoured by `syncKeyFor`), so payments stay attached across renames and re-syncs.

A consequence was also fixed: the booking rail compared *corrected* lines against the *uncorrected* payload cost, which would have reported every hand-reduced booking as missing a payable. `asBuyTotals()` now adds the overlay's net via a new `PnlManualLineService::netByRecord()`.

**Verification — honest state.** All files lint clean, and an offline harness was run over a fabricated booking modelled on SG 40063: two added lines, a reprice-then-void chain, a move, a rename, a per-day meal void and an unmatchable correction. Board total came out at **872.60**, exactly what the overlay says it should be — and it **caught a real bug on the first run** (a per-day meal void was zeroing the entire meal bill instead of reducing it). It could **not** be verified against live data: the production DB is unreachable from here (RDS connection timeout), so the anchor match for the actual SG 40063 rows is reasoned, not observed. Opening that booking on the SG board should show the two *Added by hand* chips — that is the one check that could not be run here.

Files: `PayableManualLineOverlay.php` (+566), `PayableReportService` (+96), `PayableSyncService` (+10), `PnlManualLineService` (+30), `PayableV1Controller` (+6), `payables/v1/index.blade.php` (+71) — overlay chips showing, on the board, what was changed on the Detailed P&L.

---

## 3. AHS (Aahaas front end) — standard-mode redesign

Scope was explicit: **standard mode only** — AI mode and hybrid mode untouched, and no existing feature dropped.

### 3.1 Glossy light hero across six pages (`b0a779a7`, 14:59)
- **`CategoryHero`** (`.jsx` +252, `.css` +491, both new) — a shared hero: bright photo → soft white veil → dark navy headline with a red-orange gradient accent word.
- **`heroSlides.js`** (+185, new) — every slide swapped to bright, airy photography (Santorini blue domes, pastel balloons, turquoise shores, sunlit resorts, bright cabin skies). **All 16 URLs verified live.**
- **Two veil recipes** — `VEIL_SPLIT` (left-to-right wash for lifestyles, copy on the bright edge) and `VEIL_STACKED` (top-down wash where copy sits centred over the search card). The component picks per layout.
- **Pastel bloom layer** — drifting pink / blue / peach radial washes.
- **`HeroSearchBar`** (`.jsx` +130, `.css` +245, new) — frosted-white glass eyebrow pill, "Start exploring" button and search chips, with inset highlights and soft drop shadows; chips flipped to dark ink on white glass so they read on the light ground.
- **`useScrollReveal.js`** (+130, new) and **`scroll-reveal.css`** (+41) — the scroll-down experience.
- Rolled out to `/hotels`, `/flights`, `/education`, `/essential`, `/non-essential` and lifestyles.

**Three fixes shipped in the same commit:**
1. **The duplicated photo band below the wave was the parallax.** The scroll handler was transforming `.ahero-stage` itself, and since hotels / flights set `overflow: visible` (so the booking card can float past the hero edge), the whole stage slid down past the wave and painted the photo underneath it. The transform now goes on a new `.ahero-parallax` wrapper **inside** `.ahero-stage`, and the stage always keeps `overflow: hidden` — the photo can never escape the hero again, whether or not the hero itself clips. Heroes are also shorter now: tall went 600 → 560px. *(The missing title/nav bar in the reported screenshots was not a bug — the page was scrolled.)*
2. **Arrows and dots removed** from every hero. The banner still auto-rotates on its own (6.5s), pausing when the tab is hidden. No arrows, no dots, no play button anywhere.
3. **Lifestyles: Special Offers above the fold.** The trust strip was deleted entirely — component, markup, CSS and data. The lifestyles hero is now compact (420px), so with header + nav at ~132px, Special Offers lands at roughly 550px — visible without scrolling. Education / Essential / Non-Essential got the same compact treatment; hotels and flights stay taller because they carry a full booking form.
4. Brand CTA: the AI Assistant button now uses the red→orange brand gradient instead of teal, **scoped to the hero** so the button elsewhere is untouched. Softer, glowier sparkles with a pink halo; the flight path is a red dashed trail rather than white.

### 3.2 Category dock and hero transition (`258e1b06`, 15:41)
**Category dock — about 55% shorter and restyled.** From a stacked 6-column grid (icon over label, ~106px tall) to a compact chip row (~46px tall):
- Chips are icon + label side by side, auto-width, centred — the dock takes only the space it needs instead of stretching full width.
- Icon sits in a 26px rounded tile; the whole chip is a rounded pill. Hero overlap tightened from −38px to −24px, and the dock is a 999px capsule rather than a wide card.
- **The highlight pill is measured, not assumed.** Since chips size to their own labels, `CategoryNav.jsx` (+131, new) measures the active button's `offsetLeft` / `offsetWidth` and animates the pill's `transform` and width to match, so it morphs and glides between chips of different sizes on a springy curve. A `ResizeObserver` re-measures when webfonts land or the dock resizes, and the pill stays hidden until its first measurement so it never flashes at the wrong spot.
- Animation: a sheen sweeps the active pill on a 3.8s loop; the icon tile pops with a spring (scale + rotate) on activation; hover lifts the chip 2px and tilts the icon tile −8°; chips stagger in 55ms apart on mount; the pill gradient morphs to each category's colour as it travels.
- **Mobile:** the row scrolls, the active chip auto-scrolls into view, and the pill still tracks correctly because it scrolls with the content.
- `CategoryNav.css` (+239, new); `CategorySection.jsx` reduced by 186 → 40 lines as its navigation moved out.

**Hero transition — wipe removed.** The three skewed panels crossing the viewport are gone entirely. In their place, a calm cross-fade on mount: the photo eases up from a 3.5% zoom over 0.9s while the veil and pastel bloom fade in over 1.1s. Nothing travels across the screen — the copy, search slot and dock chips just rise on their own stagger, which is what actually made the page change read as animated.
- Caught while wiring the fade: it would have replaced the bloom's 16s drift animation outright, so the bloom now declares **both** animations together and keeps drifting.

**`ModeSwitch`** (`.jsx` +142, `.css` +253, both new) — the standard / AI / hybrid switch rebuilt to match, without altering what the other two modes do.

Build clean.

---

## 4. Cross-system alignment delivered today

| Question | Before | After |
|---|---|---|
| **How many bookings on 01/09?** | OPS said 42 (created here, OPS clock); Accounts said 41 (confirmed upstream). Irreconcilable from the mails | One **Apple day cohort** defines the day. Both systems build against it, and the intake reconciliation names every booking on either side of the gap — only "confirmed upstream with nothing here" is a finding |
| **Why 50 invoices against 41 confirmations?** | Unexplained | Printed as 6 new + 44 amended, with a sentence saying the AHDS figure is *supposed* to exceed the confirmation count. Verified equal on both sides for 01/09 |
| **Amendments to older bookings** | Billed on the invoice report, on **no** P&L report at all | `PnlInvoiceParity` carries them in, marked `CARRIED IN — billed in this period, raised <date>` |
| **Wording of the verdict** | Three mails, three phrasings | `config/reports.php` + one shared `cohort-check` partial — one sentence, one rule |
| **Detailed P&L corrections** | Added / removed / repriced lines never reached the payable board | `PayableManualLineOverlay` replays them once, so board, Daily Updates, driver advances, exports and ledger sync cost a booking identically |

---

## 5. Summary

| Area | Items delivered |
|---|---|
| **Accounts System** | Apple day cohort + pre-send validation (`AppleDayCohort`, 455 lines) driving both daily mails; P&L↔invoice parity with `CARRIED IN` marking and a read-only `pnl:parity-check` command; Aahaas B2B (Flights) as its own scheduled report (source + email + scheduler card); **Detailed P&L overlay reaching Payable 1.0** (566-line overlay, 4-tier row matching); manual-line total repair command; count-check wording moved to config; single-business test dispatch; uncounted P&L activity removed from both mails |
| **Booking System** | OPS Daily Operations Report leads with the same count check as the Accounts mail — `count-check.ts` (515 lines) re-implementing `SyncParityService` field for field over a read-only connection, intake reconciliation, AHDS invoice split, `countcheck:render` preview script; plus the OPS-side Apple cohort (`apple-cohort.ts`) and its check script |
| **AHS** | Standard-mode redesign across 6 landing pages: new glossy light `CategoryHero` + `HeroSearchBar`, 16 new verified hero images, two veil recipes, pastel bloom, scroll-reveal; measured-pill animated `CategoryNav` (dock 55% shorter); parallax overflow bug fixed; hero arrows/dots removed; lifestyles Special Offers above the fold; trust strip deleted; `ModeSwitch` rebuilt — AI and hybrid modes untouched |

**Commits today:** 8 on the Accounts System (`f958f69` → `8e2d89e`, including PR #54 and PR #55 from `b2b-daily-cohort`); 4 on the Booking System (`8bcc9a0`, `e908f6c`, PR #315 from `Main_v7_DEV` and PR #316 from `b2b-daily-cohort`); 2 on AHS (`b0a779a7`, `258e1b06`).

**Migrations added today:** none. No schema change on any system.

**Verification note (honest state):** the production RDS and the `b2b` host are not reachable from this machine, and the OPS `DATABASE_URL` is held by Vercel. So the count check *was* verified against live 01/09 data through the read-only Accounts connection (AHDS 50 = 6 + 44, matching the Accounts mail exactly; AS 39/39/39, B2C 12/–/12/12, balanced), while the Payable overlay and the B2B Flights report were verified only by lint, typecheck, offline harness and synthetic-data renders. **Two things remain to be confirmed on a machine that can see the databases:** the overlay's anchor match on the real SG 40063 rows, and the first B2B Flights send (worth doing as a dry run from the page). **The PHPUnit suite was not run** — it drops tables in `tearDown` and `.env` points at production.

Happy to walk through any of the above — particularly the **Apple day cohort** (it changes what "a day" means in all three mails) and the **Payable 1.0 overlay**, which was under- and over-paying suppliers wherever the desk had corrected a costing sheet by hand.

Best regards,
**Sasindu Diluranga**
