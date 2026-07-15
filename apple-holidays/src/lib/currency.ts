/**
 * Live currency conversion for the Driver Advance Sheet.
 *
 * The sheet's amounts are stored in whatever currency the Accounts PNL carries
 * (usually USD). Ground teams in Sri Lanka / Vietnam / Malaysia / Singapore want
 * to hand the driver a figure in local money, so the panel can re-display any
 * total in a target currency using live rates from exchangerate-api.com.
 *
 * Rates are fetched with the `latest/{base}` endpoint (one call returns every
 * target) and cached in-process for CACHE_TTL_MS so we don't hammer the API or
 * burn quota on every page load. Pure display conversion — stored amounts never
 * change.
 */

const API_KEY = process.env.EXCHANGE_RATE_API_KEY ?? process.env.EXCHANGERATE_API_KEY ?? ''

// Currencies the driver-log UI offers, beyond the sheet's own base currency.
export const SUPPORTED_TARGET_CURRENCIES = ['USD', 'LKR', 'VND', 'MYR', 'SGD'] as const
export type TargetCurrency = (typeof SUPPORTED_TARGET_CURRENCIES)[number]

export const CURRENCY_LABEL: Record<string, string> = {
  USD: 'US Dollar',
  LKR: 'Sri Lankan Rupee',
  VND: 'Vietnamese Dong',
  MYR: 'Malaysian Ringgit',
  SGD: 'Singapore Dollar',
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface RateBundle {
  base: string
  rates: Record<string, number>
  fetchedAt: number
}

const cache = new Map<string, RateBundle>()

function normalize(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

export function isExchangeConfigured(): boolean {
  return API_KEY.length > 0
}

/** Fetch (and cache) all rates for a base currency. Throws on failure. */
async function fetchRates(base: string): Promise<RateBundle> {
  const cached = cache.get(base)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached

  if (!API_KEY) throw new Error('EXCHANGERATE_API_KEY is not configured')

  const url = `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${encodeURIComponent(base)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Exchange API returned HTTP ${res.status}`)

  const json = (await res.json()) as {
    result?: string
    'error-type'?: string
    conversion_rates?: Record<string, number>
  }
  if (json.result !== 'success' || !json.conversion_rates) {
    throw new Error(`Exchange API error: ${json['error-type'] ?? 'unknown'}`)
  }

  const bundle: RateBundle = { base, rates: json.conversion_rates, fetchedAt: Date.now() }
  cache.set(base, bundle)
  return bundle
}

export interface ConversionResult {
  from: string
  to: string
  rate: number
  fetchedAt: string
}

/**
 * Resolve the multiplicative rate to convert an amount `from → to`.
 * Same currency (or missing/empty codes) short-circuits to rate = 1.
 */
export async function getConversionRate(from: string, to: string): Promise<ConversionResult> {
  const base   = normalize(from) || 'USD'
  const target = normalize(to)   || base

  if (base === target) {
    return { from: base, to: target, rate: 1, fetchedAt: new Date().toISOString() }
  }

  const bundle = await fetchRates(base)
  const rate = bundle.rates[target]
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(`No exchange rate available for ${base} → ${target}`)
  }
  return { from: base, to: target, rate, fetchedAt: new Date(bundle.fetchedAt).toISOString() }
}
