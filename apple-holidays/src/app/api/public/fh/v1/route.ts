import { NextRequest } from 'next/server'
import { apiOk, runRoute } from '@/lib/public-api/fh-http'
import { ALL_SCOPES } from '@/lib/public-api/fh-api-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1  — **no token required**
 *
 * Service discovery: what this API is and every route it exposes. Handy as a
 * health check and as the one URL to hand a new integrator.
 */
export async function GET(_req: NextRequest) {
  return runRoute('index', async (requestId) =>
    apiOk(
      {
        name: 'AppleHolidays OPS — File Handler API',
        version: '1.0',
        base_path: '/api/public/fh/v1',
        description:
          'Everything the File Handler Portal can do, callable from another application: find or import a booking, maintain flights and hotels, update contacts, raise a cancellation, and generate or email the Booking Update PDF.',
        authentication: {
          bearer: 'POST /auth/login with a file handler email/phone + password, or a configured service username',
          api_key: 'X-API-Key header, when FH_PUBLIC_API_KEY is configured',
          act_as: 'Service callers name the file handler with the X-File-Handler header (email or id)',
          scopes: ALL_SCOPES,
        },
        endpoints: [
          { method: 'GET', path: '/', scope: null, purpose: 'This document' },
          { method: 'POST', path: '/auth/register', scope: null, purpose: 'Self-registration (pending admin approval)' },
          { method: 'GET', path: '/auth/register?email=', scope: null, purpose: 'Is this email already registered?' },
          { method: 'POST', path: '/auth/login', scope: null, purpose: 'Credentials → bearer token' },
          { method: 'GET', path: '/auth/verify', scope: 'booking:read', purpose: 'Is my token still valid?' },
          { method: 'GET', path: '/auth/me', scope: 'booking:read', purpose: 'Acting file handler profile + stats' },
          { method: 'GET', path: '/bookings/search?q=', scope: 'booking:read', purpose: 'Search by ref / IS / CNTL (auto_import=true to pull from AppleSystem)' },
          { method: 'POST', path: '/bookings/import', scope: 'booking:import', purpose: 'Import a quotation from AppleSystem' },
          { method: 'GET', path: '/bookings/{ref}', scope: 'booking:read', purpose: 'Full booking' },
          { method: 'PATCH', path: '/bookings/{ref}', scope: 'booking:write', purpose: 'Update contacts + important notes' },
          { method: 'GET', path: '/bookings/{ref}/flights', scope: 'booking:read', purpose: 'List flights' },
          { method: 'POST', path: '/bookings/{ref}/flights', scope: 'flight:write', purpose: 'Add one flight or a batch' },
          { method: 'PUT', path: '/bookings/{ref}/flights/{flightId}', scope: 'flight:write', purpose: 'Replace a flight' },
          { method: 'DELETE', path: '/bookings/{ref}/flights/{flightId}', scope: 'flight:write', purpose: 'Remove a flight' },
          { method: 'POST', path: '/bookings/{ref}/flights/extract', scope: 'ai:extract', purpose: 'Read flights off a ticket (text, base64 or multipart); save=true to persist' },
          { method: 'GET', path: '/bookings/{ref}/accommodations', scope: 'booking:read', purpose: 'List hotels' },
          { method: 'POST', path: '/bookings/{ref}/accommodations', scope: 'hotel:write', purpose: 'Add one hotel or a batch' },
          { method: 'PUT', path: '/bookings/{ref}/accommodations/{accId}', scope: 'hotel:write', purpose: 'Replace a hotel' },
          { method: 'DELETE', path: '/bookings/{ref}/accommodations/{accId}', scope: 'hotel:write', purpose: 'Remove a hotel' },
          { method: 'GET', path: '/bookings/{ref}/cancel', scope: 'booking:read', purpose: 'Can this booking be cancelled?' },
          { method: 'POST', path: '/bookings/{ref}/cancel', scope: 'booking:cancel', purpose: 'Raise a cancellation request (accounts approve it)' },
          { method: 'GET', path: '/bookings/{ref}/pdf', scope: 'document:read', purpose: 'Booking Update PDF (binary, or ?format=base64)' },
          { method: 'POST', path: '/bookings/{ref}/pdf/email', scope: 'document:send', purpose: 'Email the PDF' },
          { method: 'GET', path: '/activity', scope: 'activity:read', purpose: 'File handler audit trail' },
        ],
        documentation: 'Public_API/File_handle_update_API/FileHandler-API.md',
      },
      200,
      requestId,
    ),
  )
}
