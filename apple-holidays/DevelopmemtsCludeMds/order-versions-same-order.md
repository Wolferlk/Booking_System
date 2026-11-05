# Order amendments as versions of the same order

**Status (2026-11-03):** built and tested on dev. **Off on live.** The database migration has been run on the dev database: GCP (`production_test11`) only.

**Switch:** `ORDER_VERSION_MODE=same_order` in the `aahaas_dev_backend` `.env`. Without it, every amendment raises a new order, as it does today.

---

## 1. Why this exists

Today every amendment of a confirmed booking creates a **new order id**, then cancels the previous order. Order 15726 is the example that prompted this change:

| Order | What it was | Lines in `tbl_checkouts` | Status now |
|---|---|---|---|
| #15726 | original, 29 Oct | 11 (now `Amended`) | Cancelled |
| #15833 | AMD2, 2 Nov 11:03 — 2 tours added | 13 (now `Amended`) | Cancelled |
| #15834 | AMD3, 2 Nov 11:06 — margin MYR 200 → 50 only | 13 | Confirmed |

That one booking ended up with three order numbers and **37 line rows for 13 products**. AMD3 copied all 13 lines even though only the margin changed.

With this mode on, the same history is **one order, #15726**, with versions AMD2 and AMD3 recorded inside it:

- **14 line rows**: 13 products, plus the old Zoo Negara price row kept for history;
- **one header**, always showing the current totals;
- **a frozen copy of every version**, for invoice reports by version.

---

## 2. The model in one page

| Table | Role | Written when |
|---|---|---|
| `tbl_checkout_ids` | **One header per booking.** It always shows the current version: totals, `order_version`. | Every amendment re-totals it. |
| `tbl_checkouts` | **One row per supplier reservation.** It is touched only when that reservation changes. New columns: `added_in_version`, `removed_in_version`. | Only for lines that change. |
| `checkouts_more_data` | Cost, selling price, markup and exchange rates per line. **Still written only by the dashboard_backend cron.** | New lines are picked up as before. Repriced lines go through the refresh queue. |
| `tbl_checkout_versions` *(new)* | One row per version: totals, margin, display total, who made it, and why. | At every amendment. Version 1 is written as a baseline at the order's first amendment. |
| `tbl_checkout_version_lines` *(new)* | A **frozen copy of every line in every version**. Invoices by version are printed from this. | At every amendment. Cost columns are filled later by the cron. |
| `tbl_checkout_line_changes` *(new)* | What each version did to each line: added, removed, repriced, rebooked. | At every amendment. |
| `checkouts_more_data_refresh` *(new)* | Lines whose `checkouts_more_data` row the cron must work out again. | When a line is repriced in place. |

### The one rule

**A row in `tbl_checkouts` is a supplier reservation.**

- If the reservation stays the same (same `related_order_id`), the row stays. Only its price may be updated, and the change is logged.
- If the reservation has to be replaced (new pre-booking), the old row is cancelled with `removed_in_version`, and a new row is inserted. This is not a duplicate. They are two real reservations, and the supplier must cancel one of them.

---

## 3. Every way a line can change

**Activities, tickets and transfers (category 3)**

| Change | Same reservation? | `tbl_checkouts` | Change log |
|---|---|---|---|
| Unchanged | yes | nothing | — |
| Price only (rate edited, exchange rate, correction) | yes | same row: `total_price`, `total_amount`, `balance_amount` (and `paid_amount` on the paid lane) | `repriced` with old and new total, plus a cron refresh request |
| Added | — | new row, `added_in_version = N` | `added` |
| Removed | — | `status = Cancel`, `delivery_status = Cancel`, `removed_in_version = N` | `removed` |
| Swapped for another product | no | old row removed, new row added | `removed` + `added` |
| Moved to another date | no (new pre-booking) | old row removed, new row added | `removed` + `rebooked`, linked |
| Pax changed (adults, children, ages) | no | old row removed, new row added | `removed` + `rebooked`, linked |
| Vehicle on a transfer changed | no | old row removed, new row added | `removed` + `rebooked`, linked |

**Hotels (category 4)**

| Change | `tbl_checkouts` | Change log |
|---|---|---|
| Unchanged | nothing | — |
| Price only (one-line reservation) | same row re-priced | `repriced` |
| Price only (reservation written as several lines) | each line keeps its own price (there is no honest way to split one cart total) | — |
| Added / removed stay | new row / `Cancel` + `removed_in_version` | `added` / `removed` |
| Hotel swapped, check-in moved, nights changed | old row removed, new row added | `removed` + `rebooked` |
| Room type, board, occupancy, bedding, room count, guests | old row removed, new row added | `removed` + `rebooked` |

**Flights (category 6)**

| Change | `tbl_checkouts` | Notes |
|---|---|---|
| Added | new row | |
| Removed (refund) | `Cancel` + `removed_in_version` | The refund itself goes through the flights desk. |
| Fare difference on a ticketed flight | same row re-priced | Date and flight changes still go through the reissue lane (`tbl_checkout_edits`). |

**Trip vehicle (category 7)**

| Change | `tbl_checkouts` | Notes |
|---|---|---|
| Any change | old row removed, new row added | The vehicle booking is tied to the cart, so a new cart books it again. The two rows are paired as one rebooking. |

**Order-level changes (no line touched)**

| Change | Where it goes |
|---|---|
| Margin only (like AMD3) | header totals + version row (`reason`: "margin 16,207.45 → 4,051.86 LKR") |
| Discount | header `discount_amount` + version row |
| Payment between versions | header `paid_amount` is kept; balance = total − discount − paid |

**Several changes on one line at once** (for example date and pax) are still **one** rebooking: one old row cancelled, one new row.

A rebooking is paired by **same category + same product id**. The trip vehicle pairs with the trip vehicle. One added line answers for one taken-off line.

---

## 4. Version numbers and references

- The version number is `max(header.order_version, number the console last showed) + 1`. `NULL` reads as 1.
- References: `AHCNF_15726` (version 1), `AHCNF_15726/AMD2`, `AHCNF_15726/AMD3`.
- A version that is already being written is refused: a unique key on `(checkout_id, version)` stops two presses creating the same version.

---

## 5. Console lane — "Amend confirmation"

**Code:** `OrderConfirmationService::amendAsNewVersion` routes to `amendWithinOrder` when the mode is on.

**Checks** (same as today):
- the order has a live confirmation;
- it is not already being amended;
- the new version is on a **new cart**;
- the cart belongs to the same customer;
- nothing has been paid (`ORDER_ALREADY_PAID` → refer to finance);
- outside-supplier lines being taken off are acknowledged (`RELEASE_NOT_ACKNOWLEDGED`).

**Steps:**

1. **Claim** the current session (`confirmed` → `amending`), so two presses can't both run.
2. **Baseline:** if the version the order stands at has no `tbl_checkout_versions` row, write it now from the order's current lines and the current session's pricing snapshot. This is how an order confirmed before this feature gets its "original booking" version.
3. **Open** a new `travel_ai_checkout_sessions` row (new cart, same `order_id`, `meta.version.same_order = true`) and a `tbl_checkout_versions` row with status `writing`. If anything fails up to here, nothing has been booked: the claim is released and the order is exactly as it was.
4. **Book** the new and changed lines with suppliers, **onto the same order id**. Lines the booking pass writes are stamped `added_in_version = N` straight away, outside the main transaction.
5. **One transaction**, holding the header's row lock. The lock serialises amendments, and all reads go to the primary, not a lagging replica:
   - re-price carried lines whose price moved, and queue their cost refresh;
   - cancel the lines taken off (`Cancel`, `removed_in_version`, `order_status_logs` row);
   - write the change log, pairing rebookings;
   - **re-total the header from the lines now on the order**;
   - write the frozen copy of every live line into `tbl_checkout_version_lines`;
   - set the version row to `pending_costs` or `complete`.
6. Write the new session's booking report and status, and the margin ledger (`tbl_order_margins` holds the **current** margin; each version's own margin is on its version row).
7. **Supersede** the old session (`status = superseded`, `meta.superseded_by`).

**If step 5 fails after suppliers were booked:** the version row reads `failed` with the error, and the old session stays `amending`, visibly, for a person to check. Nothing is rolled back automatically, because suppliers may already hold the new lines.

---

## 6. Paid lane — WhatsApp, calls, Pay now

**Code:** `PaidOrderVersions::stageWithinOrder` and `applyWithinOrder`, plus `BookingPaymentLinkController`.

| Case | What happens |
|---|---|
| **Costs more** | A link for **only the difference**. `link.order_id` is the booking itself; **no new header**. Nothing is booked until it's paid. |
| **Costs the same or less** | The link is `PAID` at once for 0 and the version is applied immediately. The refund due is recorded on the version row and the link, and handed to the team. |
| **Earlier unpaid version link** | Cancelled. The live booking's header is never touched. |

**Bank reference.** The card gateway's order id is per payment. The booking's own id already carries its first payment, so a version link pays under `meta.bank_order_id` = `<order>-V<n>-<4 random>`, for example `15726-V3-K7QZ`. The random part means a version re-staged before payment never reuses an old reference.

**Applying the version** (on payment, internal confirmation or transfer confirmation):
- **Idempotent:** if the version row is already `pending_costs` or `complete`, the stored answer is returned and nothing is booked again. A version row left `writing` or `failed` is refused with `VERSION_NEEDS_A_PERSON`.
- Carried cart rows are marked `Completed`. Added lines go through `CartOrderFinalizer` onto the same order id. Then the same transaction as the console lane runs, with `paid = true`: repriced lines are recorded as paid, and the header's `paid_amount` goes up by the amount this link collected.
- **Internal (no card) confirmation:** `meta.internal` is set **before** booking. Nothing is added to `paid_amount`, and the lines this version booked are left unpaid.

**Places in the controller that used to write the header by `link.order_id`**, and are now skipped for same-order links because the header is the live booking:
- the bank session failing to open (it used to **cancel** the order);
- `payInternal`;
- `transferSubmit`, `transferConfirm`, `transferReject`.

---

## 7. `checkouts_more_data` (dashboard_backend cron)

**Code:** `app:fetch-order-more-information` (`FetchOrderMoreInformation.php`), runs every minute.

| Situation | Handling |
|---|---|
| New line (added or rebooked) | Picked up by the existing high-water mark (`tbl_checkouts.id > MAX(checkout_id)`), as before. |
| Line repriced in place | Its id never rises past the high-water mark, so the amendment writes a `checkouts_more_data_refresh` row. After its normal batch the cron works through up to 200 requests, using **the same row builder**, `writeMoreData`. A failure is recorded on the request (`attempts`, `error`) and retried up to 5 times; it never stops the other requests. |
| Line added by version > 1 | `booked_date` and the markup lookups use the **line's own `created_at`**, not the header's first-confirmation date. |
| After writing any line | Its cost, product, vendor and rates are copied into every `tbl_checkout_version_lines` row **still waiting for them** (`costs_copied_at IS NULL`). A version whose lines all have costs turns `complete`. A version that already froze a cost keeps it: repricing in version 3 never changes the invoice of version 2. |

⚠️ **We never write `checkouts_more_data` ourselves.** A row inserted from anywhere else moves the cron's high-water mark past other orders' lines, and they are skipped for good.

The cron reads `added_in_version` only once the column exists, so it can be deployed before the migration.

---

## 8. Everything else that reads orders

| Reader | Change |
|---|---|
| **Voucher** (`OrderVoucherBuilder`) | Already excludes `Cancel` / `Amended` / `Refunded` lines. Unchanged. |
| **Session lookup** (`forOrder`) | Returns the **newest session that is not `superseded` or `failed`**. An order with a single session (every order before this) gets that session, exactly as before. |
| **Order payload** | Adds `version.same_order`. For a same-order version it also adds `version_change`, read back from the change log, so Flow can see which lines were taken off. |
| **P&L** (`PNLController::orderLines`) | Skips lines with `removed_in_version` set. Otherwise a rebooked product would be counted twice. Only same-order amendments set the column, so no other line is affected. |
| **Aahaas Flow board** | Keeps the **same** board booking. Unchanged lines are moved to their new cart line id by `checkout_row_id`, so they keep their voucher and chase state. Lines taken off become `cancelled`. One timeline event per version. The booking is never marked superseded. The amend reply is handed to Flow directly, because a replica read could miss it and the sweep never re-takes an order already on the board. |
| **Aahaas Flow B2C / supplier-cancel queue** | Reads line statuses directly. A taken-off, supplier-held line is `Cancel` with the supplier side still open, so it appears in "Supplier to cancel", as it should. |
| **Team and customer emails** | "Order #15726 amended — AMD3". No "replaces #…", no "new booking reference". Repriced lines are listed with old and new price. The thread stays the original booking's. |
| **WhatsApp and call wording** | "Your booking *15726* has been updated — same booking number." Refund handover: "booking 15726 was amended to version 3". |
| **Paid WhatsApp confirmation** | Line counts and RateHawk checks ignore cancelled lines. |
| **Admin dashboard** | Not changed. It will show taken-off lines under the order with status `Cancel`. |

---

## 9. Reading the data back

**Lines on the order now**

```sql
SELECT * FROM tbl_checkouts
 WHERE checkout_id = 15726
   AND removed_in_version IS NULL
   AND COALESCE(status, '') NOT IN ('Cancel', 'Cancelled', 'Amended', 'Refunded');
```

**The original booking (version 1)**: from the frozen copy, with the original prices:

```sql
SELECT * FROM tbl_checkout_version_lines WHERE checkout_id = 15726 AND version = 1;
SELECT * FROM tbl_checkout_versions      WHERE checkout_id = 15726 AND version = 1;
```

**Invoice for version N**: lines and header:

```sql
SELECT product_name, service_date, line_change, currency, line_total,
       net_cost_amount, net_selling_amount, markup
  FROM tbl_checkout_version_lines
 WHERE checkout_id = 15726 AND version = 2
 ORDER BY service_date, checkout_line_id;

SELECT version, confirmation_no, lines_total, margin_total, discount_amount, total_amount,
       paid_amount, balance_amount, display_currency, display_total, reason, status, created_by, created_at
  FROM tbl_checkout_versions
 WHERE checkout_id = 15726
 ORDER BY version;
```

Only read versions with `status = 'complete'` for invoices that need cost figures. `pending_costs` means the cron has not filled them yet, which normally takes about a minute.

**What changed in version N**

```sql
SELECT change_type, product_name, old_total, new_total, replaces_line_id, replaced_by_line_id, supplier_held, note
  FROM tbl_checkout_line_changes
 WHERE checkout_id = 15726 AND version = 3;
```

**Which lines were on the order at version N**, from the live table, without the copy:

```sql
SELECT * FROM tbl_checkouts
 WHERE checkout_id = 15726
   AND COALESCE(added_in_version, 1) <= 2
   AND (removed_in_version IS NULL OR removed_in_version > 2);
```

**Health checks**

```sql
-- versions that did not finish (a person must look)
SELECT * FROM tbl_checkout_versions WHERE status IN ('writing', 'failed');

-- versions still waiting for costs for more than 10 minutes
SELECT * FROM tbl_checkout_versions WHERE status = 'pending_costs' AND created_at < NOW() - INTERVAL 10 MINUTE;

-- cost refreshes that gave up
SELECT * FROM checkouts_more_data_refresh WHERE done_at IS NULL AND attempts >= 5;
```

**Example: order 15726 under this mode**

| Version | Rows written to `tbl_checkouts` | Header total (LKR) | Customer total (MYR) |
|---|---|---|---|
| 1 | 11 lines (`added_in_version` NULL = 1) | 203,844.39 | 2,515.44 |
| 2 | +2 tours; Zoo Negara re-priced 12,965.96 → 13,354.94 on its own row | 231,623.96 | 2,858.24 |
| 3 | none (margin 16,207.45 → 4,051.86) | 219,468.37 | 2,708.24 |

These are exactly the totals the real orders #15833 and #15834 carry, reproduced on one order id in the dev test.

---

## 10. Failure handling

| Failure | Result |
|---|---|
| Before the version row is open | Nothing booked. The claim is released and the order is unchanged. |
| Second press / concurrent amendment | Refused (`AMENDMENT_IN_PROGRESS` or `VERSION_ALREADY_WRITTEN`). |
| A supplier line fails to book | The version still completes. The line is reported as needing manual follow-up and the session reads `partially_confirmed`, as today. |
| The main transaction fails after booking | The version row is `failed` with the error, and the old session stays `amending`. Nothing is undone automatically, because suppliers may hold new lines. |
| Paid link applied twice (return page + bank check) | The second call returns the stored result and books nothing. |
| Cron cannot rebuild a line's cost | The refresh request keeps the error and is retried up to 5 times. Other requests carry on. |
| Mode switched on without the migration | Every amendment is refused with `SAME_ORDER_VERSIONS_NOT_READY` (HTTP 503). It never falls back silently. |

---

## 11. Rollout

1. **Database:** run the SQL in Appendix A on `production_live1`. It only adds two nullable columns (an instant ALTER) and four empty tables. No existing row changes.
2. **Deploy `aahaas_dev_backend`.** The mode stays off; the code is safe to deploy before step 1.
3. **Deploy `dashboard_backend`** (cron + P&L). Also safe before step 1: the new reads are guarded.
4. **Gateway (`n8n-project`):** its changes only act when a reply says `same_order`. `FUTURE_TRAVEL_ORDER_VERSIONING=true` must stay on, because it routes "Amend confirmation" to the version endpoint and gives each version a new cart.
5. **Before switching on**, check on the card gateway's test merchant that an order id like `15726-V3-K7QZ` is accepted. This is not verified yet.
6. **Switch on:** set `ORDER_VERSION_MODE=same_order` in the `aahaas_dev_backend` `.env`.
7. **First live amendment:** run the health checks in §9 and compare the header total with the sum of its live lines plus margin.

**Switching off:** remove `ORDER_VERSION_MODE`. New amendments go back to a new order per amendment. Orders already versioned in place keep their versions and stay readable.

**Existing chains** (like 15726 → 15833 → 15834) are not touched or back-filled. They keep reading as they do today.

---

## 12. Tests

| Test | Where | Result |
|---|---|---|
| Gateway: emails, Flow board, WhatsApp wording, today's mode unchanged | `npm run check:same-order-versions` (n8n-project) | 28 / 28 |
| Pure rules: live line, rebooking pairs, references | `php vendor/bin/phpunit tests/Unit/SameOrderVersionsTest.php` (aahaas_dev_backend) | 6 / 6 |
| End to end on the **dev** database, rolled back: baseline, AMD2, AMD3, AMD4 (drop + rebook), paid lane, double press, invoice by version | `e2e/e2e_same_order.php` in session scratchpad bbba9ed1 | 29 / 29 |
| Cron on the **dev** database, rolled back: refresh queue, cost copy, frozen costs kept, failures recorded | `e2e/e2e_cron.php` in session scratchpad bbba9ed1 | 7 / 7 |
| Existing suites, unchanged | `check:order-versioning` (64), `check:order-notify` (141), `check:confirmed-amendment` (34), `check-amendment-choices` (35), `OrderVersionPlanTest` (8) | all pass |

The scratchpad end-to-end scripts are temporary. They boot Laravel against dev only and refuse to run unless connected to `production_test11` on MySQL 8. Run them as `node --env-file=.env.local run-php.mjs <script>`.

**Not exercised** (each would touch real suppliers, the bank or live data):
- a real supplier booking pass in this mode (`OrderConfirmationBooker`, `CartOrderFinalizer`);
- the card gateway with a `-V<n>-` bank order id;
- the live migration.

---

## 13. Known gaps

- **Infants.** `priceFingerprint` (gateway `cart.js`) records adults and child ages only. Adding or removing a baby can go undetected by an amendment.
- **Pickup time, pickup hotel and notes** are not compared. They change nothing on the order.
- **Rate option** (private ↔ shared, VIP ↔ general) is only detected when it shows in the per-line party.
- **`scripts/check-amendment-duplicates.mjs`** fails to load (it imports `cartLedger`, which `cart.js` no longer exports). This is unrelated to this work.

---

## 14. Files

**aahaas_dev_backend**
- `database/migrations/2026_11_03_000001_add_same_order_versions.php` — new
- `app/Services/Checkout/SameOrderVersions.php` — new, the shared writer
- `app/Services/Checkout/OrderConfirmationService.php` — `amendWithinOrder`, `forOrder`, payload
- `app/Services/Booking/PaidOrderVersions.php` — `stageWithinOrder`, `applyWithinOrder`
- `app/Http/Controllers/Booking/BookingPaymentLinkController.php` — bank order id, header-write guards, notify fields
- `tests/Unit/SameOrderVersionsTest.php` — new

**dashboard_backend**
- `app/Console/Commands/FetchOrderMoreInformation.php` — refresh queue, per-line booked date, cost copy
- `app/Http/Controllers/PNLController.php` — `orderLines()`

**n8n-project**
- `src/modules/gateway-aahaasv3/order-notify.email.js` — same-order wording, repriced lines
- `src/modules/gateway-aahaasv3/order-confirmation.js` — hands a same-order reply to Flow
- `src/modules/gateway-aahaasv3/future-travel.routes.js`, `src/app.js` — passing that reply through; paid-confirmation line filters
- `src/modules/aahaas-flow/flow.intake.js`, `flow.repository.js` — same board row, re-key, cancel
- `src/modules/gateway-aahaasv3/trip-payment-link.js`, `wa/wa-tools.js`, `call/call-tools.js` — chat and call wording
- `scripts/check-same-order-versions.mjs`, `package.json` — new check

---

## Appendix A — SQL for the live database (MariaDB 10.11)

Every statement uses `IF NOT EXISTS` and is safe to run twice.

```sql
ALTER TABLE `tbl_checkouts`
  ADD COLUMN IF NOT EXISTS `added_in_version`   SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS `removed_in_version` SMALLINT NULL;

CREATE TABLE IF NOT EXISTS `tbl_checkout_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_id` BIGINT UNSIGNED NOT NULL,
  `version` SMALLINT NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `lane` VARCHAR(30) NULL,
  `confirmation_no` VARCHAR(64) NULL,
  `cart_id` BIGINT UNSIGNED NULL,
  `session_id` BIGINT UNSIGNED NULL,
  `payment_link_id` BIGINT UNSIGNED NULL,
  `currency` VARCHAR(10) NULL,
  `lines_total` DECIMAL(14,2) NULL,
  `discount_amount` DECIMAL(14,2) NULL,
  `margin_total` DECIMAL(14,2) NULL,
  `extra_total` DECIMAL(14,2) NULL,
  `total_amount` DECIMAL(14,2) NULL,
  `paid_amount` DECIMAL(14,2) NULL,
  `balance_amount` DECIMAL(14,2) NULL,
  `refund_due` DECIMAL(14,2) NULL,
  `display_currency` VARCHAR(10) NULL,
  `display_total` DECIMAL(14,2) NULL,
  `display_margin` DECIMAL(14,2) NULL,
  `margins` JSON NULL,
  `summary` JSON NULL,
  `reason` VARCHAR(255) NULL,
  `created_by` VARCHAR(191) NULL,
  `error` TEXT NULL,
  `costs_completed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tbl_checkout_versions_order_version_unique` (`checkout_id`, `version`),
  KEY `tbl_checkout_versions_status_index` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tbl_checkout_version_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_id` BIGINT UNSIGNED NOT NULL,
  `version` SMALLINT NOT NULL,
  `checkout_line_id` BIGINT UNSIGNED NOT NULL,
  `main_category_id` INT NULL,
  `product_id` BIGINT UNSIGNED NULL,
  `product_name` VARCHAR(255) NULL,
  `vendor_name` VARCHAR(191) NULL,
  `service_date` DATE NULL,
  `related_order_id` BIGINT UNSIGNED NULL,
  `customer_cart_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(50) NULL,
  `line_change` VARCHAR(20) NOT NULL,
  `adult_quantity` INT NULL,
  `child_quantity` INT NULL,
  `quantity` INT NULL,
  `currency` VARCHAR(10) NULL,
  `line_total` DECIMAL(14,2) NULL,
  `discount` DECIMAL(14,2) NULL,
  `paid_amount` DECIMAL(14,2) NULL,
  `balance_amount` DECIMAL(14,2) NULL,
  `base_currency` VARCHAR(10) NULL,
  `net_cost_amount` DECIMAL(14,2) NULL,
  `net_selling_amount` DECIMAL(14,2) NULL,
  `markup` DECIMAL(10,2) NULL,
  `product_markup` DECIMAL(10,2) NULL,
  `base_product_rate` VARCHAR(64) NULL,
  `base_paid_rate` VARCHAR(64) NULL,
  `costs_copied_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tbl_checkout_version_lines_unique` (`checkout_id`, `version`, `checkout_line_id`),
  KEY `tbl_checkout_version_lines_line_index` (`checkout_line_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tbl_checkout_line_changes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_id` BIGINT UNSIGNED NOT NULL,
  `version` SMALLINT NOT NULL,
  `checkout_line_id` BIGINT UNSIGNED NOT NULL,
  `change_type` VARCHAR(20) NOT NULL,
  `replaces_line_id` BIGINT UNSIGNED NULL,
  `replaced_by_line_id` BIGINT UNSIGNED NULL,
  `main_category_id` INT NULL,
  `related_order_id` BIGINT UNSIGNED NULL,
  `product_name` VARCHAR(255) NULL,
  `currency` VARCHAR(10) NULL,
  `old_total` DECIMAL(14,2) NULL,
  `new_total` DECIMAL(14,2) NULL,
  `previous_status` VARCHAR(50) NULL,
  `new_status` VARCHAR(50) NULL,
  `supplier_held` TINYINT(1) NOT NULL DEFAULT 0,
  `note` VARCHAR(500) NULL,
  `created_by` VARCHAR(191) NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `tbl_checkout_line_changes_order_version_index` (`checkout_id`, `version`),
  KEY `tbl_checkout_line_changes_line_index` (`checkout_line_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checkouts_more_data_refresh` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_line_id` BIGINT UNSIGNED NOT NULL,
  `order_id` BIGINT UNSIGNED NULL,
  `version` SMALLINT NULL,
  `reason` VARCHAR(100) NULL,
  `requested_at` TIMESTAMP NULL DEFAULT NULL,
  `done_at` TIMESTAMP NULL DEFAULT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `checkouts_more_data_refresh_pending_index` (`done_at`, `id`),
  KEY `checkouts_more_data_refresh_line_index` (`checkout_line_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `migrations` (`migration`, `batch`)
SELECT '2026_11_03_000001_add_same_order_versions', COALESCE(MAX(`batch`), 0) + 1
FROM `migrations`
WHERE NOT EXISTS (
  SELECT 1 FROM `migrations` WHERE `migration` = '2026_11_03_000001_add_same_order_versions'
);
```

**Undo** (only if the mode was never switched on, or its versions are no longer needed):

```sql
DROP TABLE IF EXISTS `checkouts_more_data_refresh`, `tbl_checkout_line_changes`,
                     `tbl_checkout_version_lines`, `tbl_checkout_versions`;
ALTER TABLE `tbl_checkouts` DROP COLUMN `added_in_version`, DROP COLUMN `removed_in_version`;
DELETE FROM `migrations` WHERE `migration` = '2026_11_03_000001_add_same_order_versions';
```
