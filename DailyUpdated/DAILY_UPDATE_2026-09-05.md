# Daily Work Update — 05 September 2026 (Saturday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 05 Sep 2026 (Accounts System, Task Manager, AHS & Booking System)

---

## Executive Summary

Today's work centred on the Accounts System, where Payable 1.1 (Vietnam) was built end to end — an AI-assisted split of bundled Vietnam P&L lines into their individually payable services, priced against the Vietnam nett-rate workbook — followed by a self-diagnosing health check for that AI path and a correctness fix to the Detailed P&L manual-line overlay. AHS received a substantial homepage and category-navigation redesign, and the Task Manager gained daily-mail routing management. No new code was committed to the Booking System / OPS today.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 4 commits | `REV1` | Clean |
| AHS | 5 own commits (+4 merges by others) | `V0.2.22-Sasindu-Edit-Homepage-Hero-2-edit-2222` | Clean |
| Aahaas Task Manager | 1 commit | `main` | Clean |
| Booking System / OPS | 0 commits | `LIVE-1.0.0v` | Clean (one untracked update document) |

---

## 1. Accounts System — Laravel

### 1.1 Payable 1.1 — Vietnam (new board at `/payables/v11`)

Built a new payables board that takes a single bundled Vietnam P&L line and turns it into the separate supplier payables hiding inside it. The whole feature is additive: nothing existing was changed except three edits — a navigation link, a page-access entry, and one public read-only wrapper method on the existing report service.

- **Splitting.** A VN P&L line is sent to OpenAI, which returns the separately payable services inside it and a category for each (Hotel, Guide, Ticket, Water, Day Cruise, Meals, Others — a configurable list). The model names and classifies only; it is never asked for a price, because a hallucinated rate would become a real payment.
- **Pricing.** Every payable is looked up in the Vietnam nett-rate workbook three ways — Apple id, then exact name, then near match. A near match below the confidence threshold is refused, as is any case where two sheet rows match equally well. Parts the sheet cannot price take an apportioned share of the line total so a split always reconciles back to the P&L, or a rate can be typed by hand.
- **Editable throughout.** A payable the model missed can be added; one it split wrongly can be renamed or re-filed; one that is not separately payable can be retired; a rate can be typed, and the line re-split or re-priced. Confirming a split makes it the stored answer, re-used for every later booking carrying the same product.
- **Payment-day settings.** A gear dialog sets a payment day per category — the supplier's own payment day (the hotel's rule from Suppliers Manage), arrival, departure, check-in, check-out, or activity date — each with a ±30-day shift. The board's date filter runs on the resolved payment day, not the service day.
- **Export.** The same export dialog as Payable 1.0 — column picker, CSV or formatted `.xlsx`, shared saved layouts — plus a second sheet reconciling each line's split against the P&L. It calls Payable 1.0's own workbook writer so the two cannot drift apart.

New code: `PayableV11Controller`, `VnPayableSplitService`, `VnAiSplitter`, `VnComponentRateResolver`, `VnPayableSettings`, the `VnPayableSplit` / `VnPayableComponent` models, a migration creating the split tables, and the `payables/v11` views (index, modals, scripts, styles).

**What testing against live data showed**

- The rate sheet prices bundles, not their parts: row 6082 is the whole cruise-plus-kayak-plus-lunch product at $45.85, and there is no row for the kayaking ticket alone. The board therefore asks twice — of the line and of each component — and shows both answers.
- 84% of VN product lines are priced by the sheet (615 of 684 by Apple id), covering 82% of the value.
- Performance: routing through Payable 1.0's normaliser cost 81s for an 11-day sweep; shaping the rows directly plus a four-minute per-day cache brought that to 22s cold and instant warm.
- The AI call itself is correct, but the OpenAI account currently has no credits and returns `credit_balance_exhausted`. Error handling was changed to surface OpenAI's own message rather than a bare "HTTP 429". Everything else on the board works without it — lines simply stay unsplit until credits are added.

### 1.2 AI health check for the splitting path

Added a health check inside the gear dialog (under *Splitting & rates*, above the AI settings) that walks the same path a real split takes and stops at the first broken step, so a failure names its own cause:

1. **API key** — is `OPENAI_API_KEY` set (shown masked, never the key itself).
2. **AI splitting** — is the feature switched on for this board (a warning, not a failure; the key can be perfect while the checkbox is off).
3. **API connection** — can OpenAI be reached, is the key accepted, does the configured model exist.
4. **JSON mode** — does the model honour `response_format: json_object`, which the whole split contract depends on.
5. **Sample split** — does a real bundled Ha Long Bay product come back as several correctly categorised payables, with the produced components shown so the model can be seen actually reading the bundle.

Supporting detail: 401, 403, 404, 429 and 5xx each get their own message because each needs a different fix; the check tests whatever model name is typed in the box rather than the last saved one, so a model can be proven before it is committed to; and it is throttled to one run every eight seconds per user so a stuck tab cannot spend tokens in a loop. The "no key" message also points at the config cache, which on a server is the likelier cause of a false negative than a missing `.env` line.

Verified live against the current account: the check correctly stops at step 3 with OpenAI's own "no credits remaining" message, and a deliberately wrong model name produces a different, correct diagnosis.

### 1.3 Health-check presentation fixes

Corrected three presentation defects found on review:

- Label and detail ran together in one sentence; both are now `display: block`, so each check reads as a bold label with its explanation beneath.
- The verdict line lower-cased the step name ("reach the api failed"); it now uses the step's own label as written.
- Two steps were renamed to noun phrases so they read correctly in both places — *Reach the API* → **API connection**, *Split a sample product* → **Sample split** — giving verdicts such as "Not working — API connection check failed".

Also added `overflow-wrap: anywhere` to the detail text, since OpenAI's quota message carries a long billing URL that would otherwise widen the row.

### 1.4 Detailed P&L overlay — chain-key row tracking (correctness fix)

Fixed a double-counting defect in the manual-line overlay that reprices Detailed P&L rows.

- The sheet draws one attraction id in either the Attraction table or the Tour Transfers table depending on its **name**, and a name the content catalogue fills in later can move a row between the two after the desk has already acted on it.
- Chaining a row's history on the raw anchor then split one row into two chains and took its cost off twice — booking MY 40097 lost 902.00 that way, voided as `products:82` / `products:1113` and then repriced again as `transfers:82`.
- Rows are now chained by a normalised `chainKey()` rather than the raw anchor, and each chain records what it has already shifted, so re-filing a chain moves its whole contribution across to the new section instead of duplicating it. A move op still states its own destination; every other op is re-filed against the table the sheet was drawing it in.
- The Detailed P&L scripts were updated with matching normalisation for the attraction tables.

Files: `PnlManualLineService`, `pnl/partials/detailed-pnl-scripts.blade.php`.

### 1.5 Outstanding items

- The Payable 1.1 migration still has to be run on the target environment.
- The `payable_v11` page grant must be issued for non-super-admin users.
- OpenAI credits are needed before the AI split and the last two health-check steps can complete.

---

## 2. AHS — Customer-Facing React Front End

### 2.1 Lifestyle homepage

Added a new `LifestyleHome` component (component plus stylesheet) presenting the lifestyle experience with dynamic content and user interaction, wired into `LifestyleMainPage`, with supporting updates to `CategorySection` and the Travel Wizard prompt. A set of redesigned hero background images was added alongside it.

### 2.2 Category navigation redesign

- Added a `CategoryAtmos` component and a shared `category-modern.css` stylesheet, replacing the previous `CategoryHero` usage with section tags for cleaner document structure across the Education, Essential, Flight, Hotel, Lifestyle and Non-Essential pages.
- Added a `CategoryTiles` component and a `useHeroHeaderMerge` hook for category navigation, and extended the Flight main page with its own stylesheet and layout updates.

### 2.3 Cleanup

Removed unused imports and tightened CSS across the cart product-group card, hero, mega menu, and several category pages — including a large simplification of `TravelWizardPrompt`.

### 2.4 Repository state

- Branch: `V0.2.22-Sasindu-Edit-Homepage-Hero-2-edit-2222`; worktree clean.
- Two merges into `sasi_Homepage_redesign_Standerd_v0.0.1` were made by another team member during the day, bringing this branch's work across.

---

## 3. Aahaas Task Manager — Next.js

### 3.1 Daily mail routing management

Implemented management and configuration of who receives the daily update mail.

- Added the `DailyMailRoutes` settings component with UI for toggling email preferences and adding or removing recipients.
- Added `DailyMailConfig` and `AuthorMailPrefs` configuration interfaces, and `dailyMail.ts` to resolve settings and recipient routes.
- Recipients are resolved from global, personal, and automatic sources, each handled distinctly.
- Added the `/api/tm/settings/daily-mail` route and the `db/schema_04_mail_routing.sql` schema, with updates to the email settings route, Graph mail helper, and email templates.

### 3.2 Supporting changes

- Added a missing-daily-updates API route and expanded the daily-updates API and library.
- Updated the daily-updates landing, new-update, and history pages.
- Completed the forgot-password / reset-password flow on both the API and page side, with validation updates.

### 3.3 Repository state

Branch `main`; worktree clean.

---

## 4. Booking System / OPS — Next.js

No new code was committed today.

- The repository remains on `LIVE-1.0.0v` with a clean worktree.
- The only untracked file is the previous day's update document in `DailyUpdated/`.

---

## 5. Main Outcomes

1. Vietnam bundled payables can now be split into their individual supplier payables, priced against the nett-rate sheet with an audit trail, edited by hand, filtered by a resolved payment day, and exported through Payable 1.0's own writer.
2. The AI dependency in that flow diagnoses itself: the health check names the exact failing step and shows OpenAI's own message, which correctly identified the account's exhausted credit balance.
3. A real double-counting defect in the Detailed P&L overlay was found and fixed, with the reproducing booking recorded.
4. AHS gained a redesigned lifestyle homepage and a consistent category navigation system across six category pages.
5. Task Manager daily update mails can now be routed to configurable global, personal, and automatic recipients.

## 6. Follow-Up Items

- Run the Payable 1.1 migration and grant `payable_v11` page access to the users who need it.
- Add OpenAI credits, then re-run the health check to confirm the JSON-mode and sample-split steps.
- Re-check any previously overlaid Malaysian P&Ls (starting with MY 40097) against the corrected chain-key logic.
- Confirm which AHS branch the homepage and category work should land on next.
- Confirm whether Booking System / OPS work resumes on the ticket-control items from 04 September.

---

**Prepared:** 05 September 2026  
**Projects reviewed:** Accounts System, AHS, Aahaas Task Manager, Booking System / OPS
