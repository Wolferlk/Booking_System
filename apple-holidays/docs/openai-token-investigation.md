# OpenAI Token Usage Investigation — AppleHolidays Booking System

**Date:** 2026-06-22  
**Prepared by:** System Investigation  
**Status:** High Spend Alert — Root Causes Identified

---

## Executive Summary

The AppleHolidays system uses **OpenAI GPT-4o** across **9 distinct call sites** covering email processing, document extraction, agenda generation, PNL classification, and ticket scanning. Token spend is high because:

1. The **agenda generation system prompt alone is ~2,259 tokens** (loaded from a file every call)
2. **Every inbound email triggers 2–3 sequential GPT-4o calls** (up to ~13,000 tokens per email)
3. **GPT-4o is used for tasks that could use the cheaper gpt-4o-mini** (10× price difference on output)
4. **No `max_tokens` cap** on most calls — output size is unconstrained
5. **Image tickets with `detail: 'high'`** — the most expensive possible vision mode

---

## 1. Where GPT Is Called — All 9 Call Sites

| # | Function / Route | Model | Data Sent | Trigger |
|---|---|---|---|---|
| 1 | `extractBookingFromText()` | gpt-4o | TC document (up to 12,000 chars) | OneDrive sync, file upload |
| 2 | `classifyPNLCategories()` | gpt-4o-mini | Activity list (variable) | OneDrive sync, upload, mail |
| 3 | `extractPNLFromText()` | gpt-4o | PNL spreadsheet (up to 12,000 chars) | OneDrive sync, upload |
| 4 | `generateAgendaFromBooking()` | gpt-4o | Booking JSON (up to 8,000 chars) | Automation |
| 5 | `extractTicketDetails()` | gpt-4o | Image base64 (detail='high') | Ticket upload |
| 6 | `getBookingAISuggestion()` | gpt-4o | Booking context (up to 4,000 chars) | AI chat |
| 7 | `/agenda/generate` route | gpt-4o | System rules (9,035 chars) + doc (12,000 chars) | Manual / automation |
| 8 | `/agenda/describe` route | gpt-4o | Per-item prompt (500–700 chars) | UI per-item button |
| 9 | `mail-processor` email extract | gpt-4o | Email body (up to 14,000 chars) | Incoming email webhook |

**Models breakdown:**
- `gpt-4o` — 8 call sites (expensive: $2.50 input / $10.00 output per 1M tokens)
- `gpt-4o-mini` — 1 call site (cheap: $0.15 input / $0.60 output per 1M tokens)

---

## 2. Token Count Per Call — Detailed Breakdown

> **Estimate basis:** 1 token ≈ 4 characters of English text

### Call 1 — `extractBookingFromText()` (gpt-4o)
**Source:** `src/lib/openai.ts:141`

| Component | Size | Tokens |
|---|---|---|
| System: `BOOKING_EXTRACTION_PROMPT` | ~3,800 chars | ~950 |
| User: `documentText.slice(0, 12000)` | up to 12,000 chars | up to 3,000 |
| Output: Full booking JSON | ~3,200-6,000 chars | ~800–1,500 |
| **Total per call** | | **~4,750–5,450 tokens** |

**Called when:** OneDrive sync finds a TC folder, or user uploads a TC document.

---

### Call 2 — `classifyPNLCategories()` (gpt-4o-mini) ✅ Cheap
**Source:** `src/lib/openai.ts:161`

| Component | Size | Tokens |
|---|---|---|
| System: `"Return only valid JSON"` | ~15 chars | ~4 |
| User: Category rules prompt + activity list | ~2,000–3,000 chars | ~500–750 |
| Output: `{"categories": [...]}` | ~200 chars | ~50 |
| **Total per call** | | **~554–804 tokens** |

**Cost is low.** This is the only call correctly using gpt-4o-mini.

---

### Call 3 — `extractPNLFromText()` (gpt-4o)
**Source:** `src/lib/openai.ts:213`

| Component | Size | Tokens |
|---|---|---|
| System: `PNL_EXTRACTION_PROMPT` | ~700 chars | ~175 |
| User: `sheetText.slice(0, 12000)` | up to 12,000 chars | up to 3,000 |
| Output: Full PNL JSON with line items | ~2,000 chars | ~500 |
| **Total per call** | | **~3,675 tokens** |

---

### Call 4 — `generateAgendaFromBooking()` (gpt-4o)
**Source:** `src/lib/openai.ts:232`

| Component | Size | Tokens |
|---|---|---|
| System: Inline agenda rules prompt | ~1,200 chars | ~300 |
| User: `JSON.stringify(bookingData, null, 2).slice(0, 8000)` | up to 8,000 chars | up to 2,000 |
| Output: Agenda JSON array | ~4,000–8,000 chars | ~1,000–2,000 |
| **Total per call** | | **~3,300–4,300 tokens** |

**Note:** `JSON.stringify(..., null, 2)` (pretty-printed with indentation) wastes ~20–30% extra tokens compared to compact JSON.

---

### Call 5 — `extractTicketDetails()` with Image (gpt-4o) 🔴 Very Expensive
**Source:** `src/lib/openai.ts:267`

| Component | Size | Tokens |
|---|---|---|
| Image (base64, `detail: 'high'`) | varies | **1,500–2,000** |
| Text prompt in user message | ~400 chars | ~100 |
| Output: JSON (max_tokens: 400) | up to 400 tokens | up to 400 |
| **Total per image call** | | **~2,000–2,500 tokens** |

> **⚠️ `detail: 'high'` is the most expensive OpenAI vision mode.** A single image can cost ~$0.005–0.008 per scan. Using `detail: 'low'` or `detail: 'auto'` would cut image tokens by 60–75%.

---

### Call 6 — `getBookingAISuggestion()` (gpt-4o)
**Source:** `src/lib/openai.ts:334`

| Component | Size | Tokens |
|---|---|---|
| System: Brief prompt + `bookingContext.slice(0, 4000)` | ~4,200 chars | ~1,050 |
| User: Question text | ~50–200 chars | ~50 |
| Output (max_tokens: 500) | up to 500 tokens | up to 500 |
| **Total per call** | | **~1,600–1,800 tokens** |

---

### Call 7 — `/api/bookings/[ref]/agenda/generate` Route (gpt-4o) 🔴 Most Expensive
**Source:** `src/app/api/bookings/[ref]/agenda/generate/route.ts:143`

This is the single most token-expensive call in the entire system.

| Component | Size | Tokens |
|---|---|---|
| System: Inline operational rules (in code) | ~3,500 chars | ~875 |
| System: `Generating_Agenda_conditions.md` (loaded from file) | **5,535 chars** | **~1,384** |
| **System prompt total** | **~9,035 chars** | **~2,259** |
| User: `documentText.slice(0, 12000)` | up to 12,000 chars | up to 3,000 |
| Output: Full agenda JSON (7–14 items, 8 fields each) | ~6,000–12,000 chars | ~1,500–3,000 |
| **Total per call** | | **~6,759–8,259 tokens** |

> **The `Generating_Agenda_conditions.md` file (119 lines, 5,535 chars) is read from disk and injected into the system prompt on every single agenda generation call.** This alone costs ~1,384 tokens each time.

---

### Call 8 — `/api/bookings/[ref]/agenda/describe` Route (gpt-4o)
**Source:** `src/app/api/bookings/[ref]/agenda/describe/route.ts:72`

| Component | Size | Tokens |
|---|---|---|
| User prompt: Movement item details + rules | ~600–800 chars | ~150–200 |
| Output (max_tokens: 200) | up to 200 | up to 200 |
| **Per describe call** | | **~350–400 tokens** |

**Compounding risk:** If a user clicks "Describe" for every item in a 10-day itinerary, that is **10 × 400 = 4,000 tokens** in rapid succession, all on gpt-4o.

---

### Call 9 — `mail-processor.ts` Email Extraction (gpt-4o)
**Source:** `src/lib/mail-processor.ts:264`

| Component | Size | Tokens |
|---|---|---|
| System: `TOUR_CONFIRMATION_PROMPT` (very long schema) | ~3,500 chars | ~875 |
| User: `emailBody.slice(0, 14000)` | up to 14,000 chars | up to 3,500 |
| Output: Full booking JSON | ~3,200–6,000 chars | ~800–1,500 |
| **Total per call** | | **~4,175–5,875 tokens** |

> **The `emailBody` window is 14,000 characters** — the largest input slice in the system. This is because email threads accumulate quoted replies, signatures, and forwarded headers that are mostly noise but still cost tokens.

---

## 3. Cost Per Processing Chain

### Chain A — Inbound TC Email (Webhook / IMAP)
Triggered by every incoming tour confirmation email.

```
Email arrives → mail-processor extract (Call 9)
             → buildAgendaItems automation (Call 7 variant)
             → classifyPNLCategories (Call 2) [if PNL data present]
```

| Step | Model | Tokens |
|---|---|---|
| Email extraction (Call 9) | gpt-4o | ~5,000 |
| Agenda build from email (automation) | gpt-4o | ~7,500 |
| PNL classify (optional) | gpt-4o-mini | ~650 |
| **Total per TC email** | | **~12,500–13,150 tokens** |

**Cost per email:**
- Input ~10,000 tokens × $2.50/M = $0.025
- Output ~3,000 tokens × $10.00/M = $0.030
- **≈ $0.055 per email**

| Daily volume | Daily cost | Monthly cost |
|---|---|---|
| 20 emails/day | $1.10 | **$33** |
| 50 emails/day | $2.75 | **$82** |
| 100 emails/day | $5.50 | **$165** |

---

### Chain B — OneDrive Sync (per booking folder)
Triggered on every scan that finds a booking folder with TC and PNL files.

```
Folder detected → extractBookingFromText (Call 1)
               → extractPNLFromText (Call 3)
               → classifyPNLCategories (Call 2)
```

| Step | Model | Tokens |
|---|---|---|
| TC extraction (Call 1) | gpt-4o | ~5,100 |
| PNL extraction (Call 3) | gpt-4o | ~3,675 |
| Category classify (Call 2) | gpt-4o-mini | ~650 |
| **Total per folder** | | **~9,425 tokens** |

**If a scan processes 20 folders: ~188,500 tokens → ≈ $0.90 per scan run**

---

### Chain C — Manual Agenda Generation (UI button)
```
User clicks "Generate Agenda" → /agenda/generate route (Call 7)
User clicks "Describe" per item → /agenda/describe × N (Call 8)
```

| Step | Model | Tokens |
|---|---|---|
| Agenda generate (Call 7) | gpt-4o | ~7,500 |
| Describe × 10 items (Call 8) | gpt-4o | ~4,000 |
| **Total per booking** | | **~11,500 tokens** |

---

## 4. Root Causes — Why Tokens Are High

### 🔴 Root Cause 1: Huge Agenda System Prompt (2,259 tokens wasted every call)
**File:** `public/Generating_Agenda_conditions.md` (5,535 chars, 119 lines)

This file is read from disk and **injected into the system prompt on every agenda generation call**. The conditions file alone consumes **~1,384 tokens** before any booking data is sent. Combined with the inline prompt in `route.ts` (~875 tokens), the system prompt is **2,259 tokens — bigger than most responses**.

```typescript
// agenda/generate/route.ts — every call reads this file
const conditions = loadConditions()  // 5,535 chars every time
const systemPrompt = `...${conditions}` // injected into every call
```

**Fix:** Compress the conditions file. The 119-line markdown with tables and blank lines can be reduced to ~40 lines of compact rules with no tables, saving ~600–800 tokens.

---

### 🔴 Root Cause 2: gpt-4o Used for Every Task
8 of 9 call sites use `gpt-4o`. The output price is **$10.00 per 1M tokens** — 16× more expensive than `gpt-4o-mini` output ($0.60).

Tasks that do NOT need gpt-4o vision or complex reasoning:
- `extractPNLFromText` — structured spreadsheet data → **switch to gpt-4o-mini**
- `classifyPNLCategories` — already using mini ✅
- `/agenda/describe` — short operational paragraph → **switch to gpt-4o-mini**
- `getBookingAISuggestion` — Q&A against booking data → **switch to gpt-4o-mini**

Potential savings if 4 calls move to gpt-4o-mini: **~50–70% cost reduction on those calls**.

---

### 🔴 Root Cause 3: Email Body Window is 14,000 Characters
**File:** `src/lib/mail-processor.ts:268`

```typescript
content: `Extract from this email:\n\n${emailBody.slice(0, 14000)}`
```

14,000 chars = ~3,500 tokens of user content. Most TC emails are 4,000–8,000 chars. The excess window capacity means forwarded email chains, signatures, legal disclaimers, and base64 image previews inside the email body are all sent to GPT unnecessarily.

**Fix:** Strip quoted replies, email signatures, and disclaimers before sending. Target: 6,000–8,000 chars is sufficient for any TC email.

---

### 🔴 Root Cause 4: Each Email Fires 2 Sequential gpt-4o Calls
When a TC email arrives, the automation pipeline runs:
1. **Call 9** — extract booking fields from email body (~5,000 tokens)
2. **Automation agenda build** — generate full movement chart (~7,500 tokens)

Both calls happen every time, even when the booking already exists (update scenario). The agenda rebuild on an existing booking re-spends 7,500 tokens to regenerate something that hasn't changed.

**Fix:** Skip agenda generation on `isNew === false` updates unless the itinerary fields changed.

---

### 🔴 Root Cause 5: `detail: 'high'` for Ticket Images
**File:** `src/lib/openai.ts:289`

```typescript
image_url: { url: `data:${mimeType};base64,${fileBase64}`, detail: 'high' }
```

`detail: 'high'` sends the image in high resolution tiles. For a typical voucher PNG:
- `detail: 'high'` → ~1,500–2,000 tokens for the image
- `detail: 'low'` → ~85 tokens fixed cost
- **Switching to `detail: 'auto'` or `detail: 'low'` saves ~1,400–1,900 tokens per ticket scan**

Vouchers and driver confirmation screenshots do not need high-resolution analysis — the text content is what matters.

---

### 🟡 Root Cause 6: No `max_tokens` Cap on Large Calls
Most expensive calls have no `max_tokens` limit:

| Call | max_tokens set? |
|---|---|
| `extractBookingFromText` | ❌ None |
| `extractPNLFromText` | ❌ None |
| `/agenda/generate` | ❌ None |
| `mail-processor extract` | ❌ None |
| `extractTicketDetails` | ✅ 400 |
| `getBookingAISuggestion` | ✅ 500 |
| `/agenda/describe` | ✅ 200 |

Without a cap, GPT can return unexpectedly verbose responses. Setting `max_tokens: 3000` on agenda generation and `max_tokens: 2000` on extraction calls prevents runaway output billing.

---

### 🟡 Root Cause 7: Pretty-Printed JSON Sent to GPT
**File:** `src/lib/openai.ts:254`

```typescript
content: `Generate agenda from:\n${JSON.stringify(bookingData, null, 2).slice(0, 8000)}`
```

`JSON.stringify(obj, null, 2)` adds indentation whitespace on every line. For a booking with 10 accommodations and 20 itinerary items, this adds ~15–20% extra characters (and tokens) compared to compact `JSON.stringify(obj)`.

**Fix:** Use `JSON.stringify(bookingData)` — no indentation. 8,000 chars of compact JSON carries ~30% more actual data than pretty-printed.

---

### 🟡 Root Cause 8: No Deduplication Guard Before AI Calls
**File:** `src/lib/incoming-mail-automation.ts`

The email webhook and IMAP idle watcher can both trigger for the same email. While there is a DB check for duplicate processing, the guard runs **after** the expensive GPT extraction call in some code paths. If the same email is delivered twice (Microsoft webhook retry), both extractions complete before dedup kicks in.

---

## 5. Token Budget Estimate — Last 30 Days

The following is a model-based projection (actual figures available from OpenAI Usage dashboard at [platform.openai.com/usage](https://platform.openai.com/usage)).

### Assumptions
- 30 TC emails/day (weekdays only: ~20 days/month = 600 emails/month)
- 5 OneDrive sync runs/month processing 50 folders each = 250 folder scans
- 10 manual agenda generations/month  
- 20 ticket image uploads/month
- 5 agenda describe sessions × 8 items each = 40 describe calls

| Source | Calls/Month | Tokens/Call | Total Tokens | Model | Approx. Cost |
|---|---|---|---|---|---|
| TC email extraction | 600 | ~5,000 | 3,000,000 | gpt-4o | $8.25 |
| Email → Agenda build | 600 | ~7,500 | 4,500,000 | gpt-4o | $12.38 |
| OneDrive TC extract | 250 | ~5,100 | 1,275,000 | gpt-4o | $3.51 |
| OneDrive PNL extract | 250 | ~3,675 | 918,750 | gpt-4o | $2.53 |
| PNL classification | 850 | ~650 | 552,500 | gpt-4o-mini | $0.09 |
| Manual agenda gen | 10 | ~7,500 | 75,000 | gpt-4o | $0.21 |
| Ticket image scans | 20 | ~2,300 | 46,000 | gpt-4o | $0.13 |
| Agenda describe | 40 | ~400 | 16,000 | gpt-4o | $0.06 |
| AI suggestions | 50 | ~1,700 | 85,000 | gpt-4o | $0.24 |
| **TOTAL** | | | **~10,468,250** | | **≈ $27.40/month** |

> **Note:** gpt-4o pricing split: ~65% input ($2.50/M), ~35% output ($10.00/M). The output cost dominates due to large JSON responses with no `max_tokens` cap.

---

## 6. What Data Is Being Read

### Data sent to GPT per call type:

**TC Document (extractBookingFromText):**
- Full text of `.docx` or PDF tour confirmation
- Includes: passenger names, passport numbers, flight details, hotel names, contact numbers, pricing
- ⚠️ Contains PII (passport numbers, phone numbers)

**PNL Spreadsheet (extractPNLFromText):**
- Row-by-row text dump of Excel/CSV
- Includes: activity costs, rates, revenue per person

**Email Body (mail-processor):**
- Full email thread text (up to 14,000 chars)
- Includes: agent email, quoted replies, unrelated forwarded content

**Agenda Conditions File:**
- Internal operational rules from `Generating_Agenda_conditions.md`
- No PII, but sends internal business rules to OpenAI every call

**Ticket Images:**
- Base64-encoded image of driver/voucher confirmations
- May include: driver phone numbers, vehicle plates, booking references

---

## 7. Optimization Recommendations

### Priority 1 — Immediate (saves ~30–40% tokens)

| Action | Savings | Effort |
|---|---|---|
| Switch `extractPNLFromText` to `gpt-4o-mini` | ~1,800 tokens/call, 16× output cost saving | Low |
| Switch `/agenda/describe` to `gpt-4o-mini` | ~350 tokens/call at mini price | Low |
| Change ticket image `detail: 'high'` → `detail: 'low'` | ~1,500 tokens/call | 1 line change |
| Cap `/agenda/generate` at `max_tokens: 3000` | Prevents output overrun | 1 line change |
| Cap `extractBookingFromText` at `max_tokens: 2000` | Prevents output overrun | 1 line change |

### Priority 2 — Medium (saves ~20–30% tokens)

| Action | Savings | Effort |
|---|---|---|
| Compress `Generating_Agenda_conditions.md` from 119 lines to ~40 lines compact rules | ~800 tokens/agenda call | Medium |
| Reduce `emailBody.slice(0, 14000)` to `slice(0, 8000)` after stripping signatures | ~1,500 tokens/email | Medium |
| Use `JSON.stringify(data)` instead of `JSON.stringify(data, null, 2)` | ~15% input token saving | 2 char change |
| Skip agenda rebuild when `isNew === false` and itinerary unchanged | 7,500 tokens per duplicate | Medium |

### Priority 3 — Structural (saves ~50%+ long term)

| Action | Savings | Effort |
|---|---|---|
| Pre-strip email noise (quotes, signatures, legal footers) before sending | Up to 40% of email tokens | High |
| Cache system prompts — send identical prompts with caching headers | OpenAI Prompt Caching: 50% discount on cached input tokens | Medium |
| Move `extractBookingFromText` to `gpt-4o-mini` with structured output | 16× output cost saving | Medium (needs testing) |
| Rate-limit `/agenda/describe` — batch all items in one call | 10 calls → 1 call | Medium |

---

## 8. How to Monitor Actual Token Usage

Check the real-time spend dashboard:

```
https://platform.openai.com/usage
```

Filter by:
- **Model:** `gpt-4o` (main spend) vs `gpt-4o-mini`
- **Date range:** Last 7 / 30 days
- **Token type:** Input vs Output (output is 4× more expensive)

Set a **spending limit** at OpenAI to prevent unexpected bills:
```
platform.openai.com → Settings → Billing → Usage limits
```

---

## 9. Quick Win Code Changes

### Change 1 — Cheaper model for PNL extraction
**File:** `src/lib/openai.ts:214`
```typescript
// Before
model: 'gpt-4o',
// After
model: 'gpt-4o-mini',
```

### Change 2 — Ticket image detail mode
**File:** `src/lib/openai.ts:289`
```typescript
// Before
image_url: { url: `data:${mimeType};base64,${fileBase64}`, detail: 'high' }
// After
image_url: { url: `data:${mimeType};base64,${fileBase64}`, detail: 'low' }
```

### Change 3 — Add max_tokens to agenda generate
**File:** `src/app/api/bookings/[ref]/agenda/generate/route.ts`
```typescript
// Add to the openai.chat.completions.create call:
max_tokens: 3000,
```

### Change 4 — Compact JSON for agenda input
**File:** `src/lib/openai.ts:254`
```typescript
// Before
content: `Generate agenda from:\n${JSON.stringify(bookingData, null, 2).slice(0, 8000)}`
// After
content: `Generate agenda from:\n${JSON.stringify(bookingData).slice(0, 8000)}`
```

### Change 5 — Reduce email body window
**File:** `src/lib/mail-processor.ts:268`
```typescript
// Before
content: `Extract from this email:\n\n${emailBody.slice(0, 14000)}`
// After
content: `Extract from this email:\n\n${emailBody.slice(0, 8000)}`
```

---

## Appendix — File Locations Reference

| File | Purpose |
|---|---|
| `src/lib/openai.ts` | All shared OpenAI functions + system prompts |
| `src/lib/mail-processor.ts` | Email extraction + Tour Confirmation prompt |
| `src/lib/incoming-mail-automation.ts` | TC/PNL email pipeline (2 GPT calls per email) |
| `src/app/api/bookings/[ref]/agenda/generate/route.ts` | Manual agenda generation (most expensive) |
| `src/app/api/bookings/[ref]/agenda/describe/route.ts` | Per-item AI description |
| `src/app/api/drives/[driveKey]/extract/route.ts` | Drive file extraction (gpt-4o-mini) |
| `src/app/api/ai/classify-category/route.ts` | PNL category classification |
| `src/app/api/upload/route.ts` | File upload with AI extraction |
| `public/Generating_Agenda_conditions.md` | 5,535 char rules file injected every agenda call |
