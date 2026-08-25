/**
 * Read a hotel's proforma invoice off the document itself.
 *
 * ---- Why this exists ----
 *
 * A reservation clerk used to hold the PDF in one hand and type nine numbers
 * into a form with the other. Every one of those keystrokes is a chance to
 * transpose a figure that Accounts will later pay, and the bank details at the
 * foot of the page were not captured at all — Accounts opened the same document
 * a second time and read the account number by eye. Both readings are now done
 * once, by the model, from the file that was uploaded anyway.
 *
 * ---- What it is not ----
 *
 * It is not an authority. Everything here lands in a form the clerk can see and
 * correct before anything is filed, and the bank details it reads are shown to
 * Accounts as *what the paper says*, never as an instruction to pay. A model
 * that misreads a scanned account number must cost a correction, not a wrong
 * transfer — which is why nothing in this file writes to the database and why
 * `confidence` travels with the answer.
 *
 * ---- How it reads ----
 *
 *   images   straight to the vision model.
 *   PDFs     text first (pdf-parse). A born-digital invoice — which is most of
 *            them — reads perfectly and costs a fraction of a vision call. When
 *            the text layer comes back empty or near-empty the PDF is a scan,
 *            and there is nothing to fall back to here: the clerk is told the
 *            document could not be read and types the figures, exactly as
 *            before. Better a clear "read this yourself" than a confident
 *            hallucination over a blank page.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { extractTextFromPdf } from '@/lib/parsers/pdf-parser'

/** Below this many characters a PDF's text layer is treated as absent. */
const MIN_PDF_TEXT = 120

/** Text handed to the model, capped so a 40-page contract cannot run away. */
const MAX_TEXT_CHARS = 24_000

const MODEL = 'gpt-4o'

export interface ProformaExtraction {
  hotelName: string | null
  city: string | null
  invoiceNumber: string | null
  /** ISO YYYY-MM-DD. */
  invoiceDate: string | null
  dueDate: string | null
  /** ISO 4217, upper case. Symbols are resolved by the prompt, never stored. */
  currency: string | null
  /** The nett/room charge before tax and service. */
  amount: number | null
  taxAmount: number | null
  /** What the property is asking for. The one figure that must be right. */
  totalAmount: number | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  roomType: string | null
  mealPlan: string | null
  roomCount: number | null
  guestName: string | null
  /** Any booking/voucher reference the invoice quotes back at us. */
  reference: string | null

  bank: {
    accountName: string | null
    bankName: string | null
    branch: string | null
    accountNumber: string | null
    swift: string | null
    iban: string | null
    currency: string | null
    address: string | null
  }

  /** 0–1, the model's own reading of how legible the document was. */
  confidence: number | null
  /** Anything a person should look at before filing. */
  warnings: string[]
}

const PROMPT = `You are reading a hotel's PROFORMA INVOICE for a travel company's accounts desk.
Extract what is printed on the document. Return ONLY valid JSON matching the schema.

RULES — read these before extracting:
- Copy what is printed. Never calculate a figure the document does not state, and never
  infer one from another invoice's conventions.
- If a field is not on the document, return null. A null is correct and useful;
  a guess is not.
- Money: return plain numbers, no thousands separators, no currency symbols
  (e.g. "USD 1,234.50" -> 1234.5).
- currency: ISO 4217 only. Convert symbols: $ -> USD (unless the document says
  otherwise), Rs/LKR/SLR -> LKR, RM -> MYR, S$ -> SGD, VND/d -> VND, EUR/€ -> EUR,
  £ -> GBP, AED/Dhs -> AED, ฿ -> THB, ₹ -> INR.
- totalAmount is the amount PAYABLE — the grand total after tax and service charge,
  and after any deposit already deducted if the document shows a "balance due".
  If the document shows both a gross total and a balance due, totalAmount is the
  balance due, and note this in warnings.
- amount is the nett/room charge BEFORE tax and service. taxAmount is tax +
  service charge combined. Do not force amount + taxAmount = totalAmount; if they
  do not add up, report them as printed and add a warning.
- Dates: ISO YYYY-MM-DD. Watch for DD/MM/YYYY vs MM/DD/YYYY — hotels in Asia
  print DD/MM. If a date is genuinely ambiguous, return it and add a warning.
- mealPlan: one of RO, BB, HB, FB, AI, or null. Expand words: "Bed & Breakfast"
  -> BB, "Half Board" -> HB, "Room Only" -> RO, "Full Board" -> FB,
  "All Inclusive" -> AI.
- nights: the number of nights, not the number of days.

BANK DETAILS — the most important part, and the part most often misread:
- These are the beneficiary details for paying this invoice, usually at the foot
  of the page or in a "Bank Details" / "Payment Details" / "Remittance" block.
- accountNumber: copy EXACTLY as printed, including leading zeros, spaces and
  dashes. Do not normalise it, do not strip anything, do not treat it as a number.
- Do NOT confuse the account number with the SWIFT/BIC code, the branch code, the
  invoice number or a phone number. A SWIFT/BIC is 8 or 11 letters and digits.
- accountName is the beneficiary/account holder as printed, which may differ from
  the hotel's trading name. Copy it as printed.
- bankCurrency: the currency the ACCOUNT is held in, if the document says so.
  It is often different from the invoice currency. null if not stated.
- If more than one account is printed (e.g. an LKR account and a USD account),
  return the one matching the invoice currency and add a warning naming the other.
- If NO bank details are printed, return every bank field as null. Never invent one.

confidence: 0 to 1 — how legible and complete the document was. Below 0.6 means a
person must check every figure.
warnings: short plain-English notes about anything ambiguous, contradictory or
missing that a person should look at. Empty array if the document was clean.

Schema:
{
  "hotelName": string|null, "city": string|null,
  "invoiceNumber": string|null, "invoiceDate": string|null, "dueDate": string|null,
  "currency": string|null, "amount": number|null, "taxAmount": number|null, "totalAmount": number|null,
  "checkIn": string|null, "checkOut": string|null, "nights": number|null,
  "roomType": string|null, "mealPlan": string|null, "roomCount": number|null,
  "guestName": string|null, "reference": string|null,
  "bank": {
    "accountName": string|null, "bankName": string|null, "branch": string|null,
    "accountNumber": string|null, "swift": string|null, "iban": string|null,
    "currency": string|null, "address": string|null
  },
  "confidence": number|null, "warnings": string[]
}`

export class ProformaUnreadableError extends Error {}

/**
 * Extract one invoice.
 *
 * Throws {@link ProformaUnreadableError} when the document carries nothing to
 * read — a scanned PDF with no text layer, or an empty file. The caller turns
 * that into "type the figures yourself", which is the pre-existing behaviour
 * and a perfectly good outcome.
 */
export async function extractProformaInvoice(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  bookingRef?: string | null,
): Promise<ProformaExtraction> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new ProformaUnreadableError('Automatic reading is not configured on this deployment.')
  }

  const isImage = mimeType.startsWith('image/')
  const messages: { role: 'user'; content: unknown }[] = []

  if (isImage) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}`, detail: 'high' } },
        { type: 'text', text: `${PROMPT}\n\nThe image is the invoice (file: ${fileName}).` },
      ],
    })
  } else {
    let text = ''
    try {
      text = await extractTextFromPdf(buffer)
    } catch {
      throw new ProformaUnreadableError('That PDF could not be opened. Enter the figures by hand.')
    }

    if (text.replace(/\s+/g, '').length < MIN_PDF_TEXT) {
      throw new ProformaUnreadableError(
        'That PDF has no readable text — it is most likely a scan. Enter the figures by hand, or upload a photograph of the invoice instead, which can be read as an image.',
      )
    }

    messages.push({
      role: 'user',
      content: `${PROMPT}\n\nInvoice text (file: ${fileName}):\n\n${text.slice(0, MAX_TEXT_CHARS)}`,
    })
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: messages as never,
    response_format: { type: 'json_object' },
    // Low, not zero: this is a transcription task, and creativity in it is
    // strictly a defect.
    temperature: 0.1,
    max_tokens: 1600,
  })

  await logAiUsage({
    callType: 'proforma-invoice-extract',
    model: MODEL,
    usage: response.usage,
    bookingRef: bookingRef ?? null,
    source: 'proforma',
  })

  const raw = response.choices[0]?.message?.content
  if (!raw) throw new ProformaUnreadableError('Nothing came back from the reader. Enter the figures by hand.')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new ProformaUnreadableError('The reader returned something unreadable. Enter the figures by hand.')
  }

  return normalise(parsed)
}

/* ── Shaping the answer ──────────────────────────────────────────────────
   The model is prompted hard, and still returns "USD 1,200.00" or "N/A"
   often enough that trusting the shape would be careless. Everything is
   coerced here, and anything that will not coerce becomes null rather
   than reaching a form field as a string that looks like a number. */

const NOTHING = /^(n\/?a|none|nil|not stated|not specified|unknown|-|—)$/i

function str(v: unknown, max = 255): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || NOTHING.test(t)) return null
  return t.slice(0, max)
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  if (typeof v !== 'string') return null
  // Strip everything that is not part of a decimal number — currency codes,
  // symbols and thousands separators all arrive attached from time to time.
  const cleaned = v.replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function int(v: unknown): number | null {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** ISO date, or null. A date that will not parse is worse than no date. */
function isoDate(v: unknown): string | null {
  const s = str(v, 40)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB', 'AI']

function normalise(p: Record<string, unknown>): ProformaExtraction {
  const bank = (p.bank ?? {}) as Record<string, unknown>
  const meal = str(p.mealPlan, 8)?.toUpperCase() ?? null

  const out: ProformaExtraction = {
    hotelName: str(p.hotelName),
    city: str(p.city),
    invoiceNumber: str(p.invoiceNumber, 191),
    invoiceDate: isoDate(p.invoiceDate),
    dueDate: isoDate(p.dueDate),
    currency: str(p.currency, 8)?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || null,
    amount: num(p.amount),
    taxAmount: num(p.taxAmount),
    totalAmount: num(p.totalAmount),
    checkIn: isoDate(p.checkIn),
    checkOut: isoDate(p.checkOut),
    nights: int(p.nights),
    roomType: str(p.roomType),
    mealPlan: meal && MEAL_PLANS.includes(meal) ? meal : null,
    roomCount: int(p.roomCount),
    guestName: str(p.guestName),
    reference: str(p.reference, 191),
    bank: {
      accountName: str(bank.accountName, 255),
      bankName: str(bank.bankName, 255),
      branch: str(bank.branch, 255),
      // Whitespace collapsed, nothing else touched: the digits, dashes and
      // leading zeros are the identifier.
      accountNumber: str(bank.accountNumber, 128)?.replace(/\s{2,}/g, ' ') ?? null,
      swift: str(bank.swift, 32)?.toUpperCase().replace(/\s/g, '') ?? null,
      iban: str(bank.iban, 64)?.toUpperCase().replace(/\s/g, '') ?? null,
      currency: str(bank.currency, 8)?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || null,
      address: str(bank.address, 500),
    },
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : null,
    warnings: Array.isArray(p.warnings)
      ? p.warnings.map(w => str(w, 300)).filter((w): w is string => !!w).slice(0, 8)
      : [],
  }

  /* Two checks the model is not reliably good at, done here where they are
     cheap and deterministic. Neither changes a figure — they only tell the
     clerk where to look. */

  if (out.amount != null && out.totalAmount != null) {
    const expected = Math.round((out.amount + (out.taxAmount ?? 0)) * 100) / 100
    if (Math.abs(expected - out.totalAmount) > 0.01) {
      out.warnings.push(
        `Nett + tax (${expected}) does not equal the total (${out.totalAmount}) — check which figure is payable.`,
      )
    }
  }

  if (out.checkIn && out.checkOut) {
    const nights = Math.round(
      (new Date(out.checkOut).getTime() - new Date(out.checkIn).getTime()) / 86_400_000,
    )
    if (nights > 0 && out.nights != null && nights !== out.nights) {
      out.warnings.push(`The dates span ${nights} night(s) but the invoice says ${out.nights}.`)
    }
    if (out.nights == null && nights > 0) out.nights = nights
  }

  return out
}
