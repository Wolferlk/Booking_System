/**
 * Who is calling, and how a refusal becomes a response.
 *
 * Every chat route resolves the caller exactly once, here, to the identity pair
 * ('ops', <user id>). Nothing anywhere trusts a `system`/`user_ref` that arrived
 * in a request body for the CALLER — only for the person being addressed.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SYSTEM } from './config'
import { ChatForbidden, ChatInvalid, type Identity } from './service'

export async function currentIdentity(): Promise<Identity | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  return { system: SYSTEM, ref: String(session.user.id) }
}

export function unauthorized() {
  return Response.json({ message: 'Unauthenticated.' }, { status: 401 })
}

/**
 * Run a handler and turn the services' deliberate refusals into the same status
 * codes the Accounts API uses — 422 for "you asked for something impossible",
 * 403 for "you may not", 500 only for genuine faults.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await fn())
  } catch (err) {
    if (err instanceof ChatInvalid) return Response.json({ message: err.message }, { status: 422 })
    if (err instanceof ChatForbidden) return Response.json({ message: err.message }, { status: 403 })
    console.error('[chat] request failed', err)
    return Response.json({ message: (err as Error)?.message || 'Something went wrong.' }, { status: 500 })
  }
}
