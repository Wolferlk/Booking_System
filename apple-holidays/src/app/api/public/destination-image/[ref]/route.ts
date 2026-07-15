/**
 * Public destination hero image for the customer trip portal.
 *
 * Auth-free but gated by the same signed ?t= token as the portal itself, so
 * arbitrary callers can't burn image-generation credits. The destination is
 * derived from the booking server-side (never from user input) and each
 * destination's image is generated once via DALL·E 3 and cached on disk,
 * shared across every booking to that destination.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import { verifyPortalLinkToken } from '@/lib/portal-link'
import { generateDestinationImage, fetchDestinationImageFromWeb } from '@/lib/openai'
import { getUpload, putUpload } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const COUNTRY_NAME: Record<string, string> = {
  VIETNAM: 'Vietnam',
  SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore and Malaysia',
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'trip'
}

// De-duplicate concurrent generations for the same destination.
const inFlight = new Map<string, Promise<Buffer>>()

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!verifyPortalLinkToken(params.ref, token)) {
    return buildApiError('Invalid or expired link', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { tourDestination: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const countryName = COUNTRY_NAME[booking.operationCountry ?? ''] ?? 'a beautiful holiday destination'
  const destinationName = booking.tourDestination?.trim() || countryName
  // Cache key: prefer the specific tour destination, else the country.
  const slug = slugify(booking.tourDestination?.trim() || booking.operationCountry || 'trip')

  const cacheKey = `destinations/${slug}.png`

  // 1) Serve from cache if present (S3, with local-disk fallback).
  const cached = await getUpload(cacheKey)
  if (cached) return imageResponse(cached.buffer)

  // 2) Generate (deduped), cache to disk, then serve.
  try {
    let job = inFlight.get(slug)
    if (!job) {
      const prompt = destinationName === countryName ? destinationName : `${destinationName}, ${countryName}`
      // Primary: AI-generated cute poster. Fallback: real photo found via web search.
      job = generateDestinationImage(prompt).catch(async genErr => {
        console.warn('[destination-image] generation failed, trying web search:', (genErr as Error).message)
        return fetchDestinationImageFromWeb(prompt)
      })
      inFlight.set(slug, job)
      // Clear the slot when done; swallow rejection here so it isn't "unhandled"
      // (the awaiting caller below still sees and handles the error).
      void job.catch(() => undefined).finally(() => inFlight.delete(slug))
    }
    const buffer = await job

    await putUpload(cacheKey, buffer, 'image/png').catch(() => { /* still serve even if caching fails */ })

    return imageResponse(buffer)
  } catch (err) {
    console.error('[destination-image] generation failed:', err)
    // Signal the client to fall back to its gradient background.
    return NextResponse.json({ success: false, error: 'Image unavailable' }, { status: 502 })
  }
}

function imageResponse(buffer: Buffer) {
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
