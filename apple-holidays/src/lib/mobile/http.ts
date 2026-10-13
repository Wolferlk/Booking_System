/**
 * Shared response handling for `/api/mobile/*`.
 *
 * Every route body runs inside `mobileRoute`, which turns the auth / domain
 * errors below into the `{ success, error }` shape the rest of the API uses,
 * and turns "the mobile_* tables are not on this database yet" into a clear
 * 503 instead of a stack trace — the routes can ship before
 * prisma/sql/apply-driver-app.sh has been run.
 */
import { NextRequest } from 'next/server'
import { buildApiError } from '@/lib/utils'
import { MobileAuthError } from './auth'

export class MobileError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message) }
}

export const SETUP_MESSAGE =
  'The driver app is not switched on for this server yet. Operations: run prisma/sql/apply-driver-app.sh.'

export function isMobileTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (e?.code === 'P2021') return true
  return /mobile_[a-z_]+.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>

export function mobileRoute<C = unknown>(name: string, handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      if (err instanceof MobileAuthError) return buildApiError(err.message, err.status)
      if (err instanceof MobileError) {
        return Response.json({ success: false, error: err.message, code: err.code }, { status: err.status })
      }
      if (isMobileTableMissing(err)) {
        return Response.json({ success: false, error: SETUP_MESSAGE, code: 'setup_required' }, { status: 503 })
      }
      console.error(`[mobile ${name}]`, err)
      return buildApiError('Something went wrong. Please try again.', 500)
    }
  }
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new MobileError('Invalid request body.')
  }
}

export function clientIp(req: NextRequest): string | null {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || null
}
