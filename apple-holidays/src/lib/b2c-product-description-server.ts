/**
 * Server side of `b2c-product-description.ts`: read a B2C booking's store lines
 * and their admin descriptions.
 *
 * Read-only against the Aahaas store (every query goes through b2c-db's
 * SELECT-only guard) and never throws — a store that is down or not configured
 * gives an empty index, and the chart keeps the text it had before.
 */
import { fetchLifestyleDescriptions, fetchOrderProducts, isB2cConfigured } from '@/lib/b2c-db'
import { resolveLiveOrderId } from '@/lib/b2c-order-chain'
import {
  buildProductDescriptionIndex,
  EMPTY_PRODUCT_DESCRIPTIONS,
  type ProductDescriptionIndex,
} from '@/lib/b2c-product-description'

const LIFESTYLE_CATEGORY_ID = 3
const TIMEOUT_MS = 20_000

/** The store order a B2C booking came from: its numeric ref, else its IS number (as placement reads it). */
function baseOrderIdOf(b: { bookingRef: string; isNumber?: string | null }): number {
  return Number(/^\d+$/.test(b.bookingRef) ? b.bookingRef : b.isNumber ?? '')
}

export async function loadB2cProductDescriptions(
  booking: { bookingRef: string; isNumber?: string | null },
): Promise<ProductDescriptionIndex> {
  const baseOrderId = baseOrderIdOf(booking)
  if (!Number.isInteger(baseOrderId) || baseOrderId <= 0 || !isB2cConfigured()) return EMPTY_PRODUCT_DESCRIPTIONS

  const read = (async () => {
    // An amended order lives on under a newer id; its lines are the current ones.
    const { liveOrderId } = await resolveLiveOrderId(baseOrderId)
    const lines = await fetchOrderProducts([liveOrderId])
    const lifestyleIds = lines
      .filter((l) => Number(l.category_id) === LIFESTYLE_CATEGORY_ID)
      .map((l) => Number(l.product_id))
    const html = await fetchLifestyleDescriptions(lifestyleIds)
    return buildProductDescriptionIndex(lines, html, liveOrderId)
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`store did not answer within ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
  })
  try {
    return await Promise.race([read, timeout])
  } catch (err) {
    console.warn(`[b2c-product-description] ${booking.bookingRef}: admin descriptions unavailable — ${err instanceof Error ? err.message : err}`)
    return EMPTY_PRODUCT_DESCRIPTIONS
  } finally {
    if (timer) clearTimeout(timer)
  }
}
