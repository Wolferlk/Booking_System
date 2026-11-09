import { NextRequest } from 'next/server'
import { deskRoute } from '@/lib/ticket-portal/route'
import { globaltixSlots } from '@/lib/ticket-portal/catalog'
import { DeskError } from '@/lib/ticket-portal/desk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams
  return deskRoute('ticket:purchase', async () => {
    try {
      return { data: await globaltixSlots(url.get('ticketTypeId') ?? '', url.get('date') ?? '') }
    } catch (err) {
      throw new DeskError(err instanceof Error ? err.message : 'Time slots could not be read.', 502)
    }
  })
}
