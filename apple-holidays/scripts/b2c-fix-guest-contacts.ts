/**
 * Aahaas B2C — give bookings the guest's own email / phone.
 *
 * Orders placed on the shared desk login (admin6611) were imported holding the
 * desk's inbox (admin@it.aahaas.com) and often no phone, so the agenda print
 * and the booking page showed the desk instead of the guest (pradmu@gmail.com,
 * +94703288141 on order 14784). The guest contact comes from the same places
 * AahaasFlow reads — the confirmed lead traveller, then the flight's ticket
 * contact (see `guestContactOf`). Only a blank or a staff inbox is replaced;
 * anything ops typed is never touched.
 *
 * DRY RUN by default — prints what would change and writes nothing:
 *
 *   npx tsx scripts/b2c-fix-guest-contacts.ts                    # every B2C booking
 *   npx tsx scripts/b2c-fix-guest-contacts.ts --ref 14784        # one booking
 *   npx tsx scripts/b2c-fix-guest-contacts.ts --apply            # actually update
 *   npx tsx scripts/b2c-fix-guest-contacts.ts --apply --engage   # …and put upcoming
 *        guests on AI calls + send the call-permission WhatsApp (10 per run)
 *
 * The Aahaas store is only ever read. Each update is in the activity log with
 * the old values, so it can be reversed by hand if ever needed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../src/lib/prisma'
import { fetchFlightBookings, fetchOrderCustomers, isB2cConfigured } from '../src/lib/b2c-db'
import { parseFlightBooking } from '../src/lib/b2c-flight'
import { guestContactOf, resolveLeadPassenger } from '../src/lib/b2c-booking-map'
import { loadOrderTravellers } from '../src/lib/b2c-lead-name'
import { repairB2cGuestContact } from '../src/lib/b2c-guest-contact'
import { engageB2cGuests } from '../src/lib/b2c-guest-engage'
import { getAutomationUserId } from '../src/lib/as-booking-import'
import { B2C_AGENT_NAME } from '../src/lib/booking-source'

/** Same minimal loader as `b2c-dry-run.ts` — existing env always wins. */
function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync(join(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[m[1]] = value
  }
}

/** Store reads are batched so a full sweep is a handful of queries, not thousands. */
const CHUNK = 200
const FLAGS = new Set(['--apply', '--engage', '--ref'])

async function main() {
  loadEnv()
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const engage = args.includes('--engage')
  const refArg = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null
  // A typo like `--red 14784` must not silently widen the run to every booking.
  const unknown = args.filter((a, i) => (a.startsWith('--') && !FLAGS.has(a)) || (!a.startsWith('--') && args[i - 1] !== '--ref'))
  if (unknown.length > 0 || (args.includes('--ref') && !refArg)) {
    throw new Error(`Unrecognised arguments: ${unknown.join(' ') || '--ref needs a booking ref'} — use --ref <bookingRef>, --apply, --engage`)
  }

  if (!isB2cConfigured()) throw new Error('B2C database is not configured — set DB_HOST / DB_USERNAME / DB_DATABASE_B2C')
  console.log(apply ? 'APPLY — guest contacts will be updated\n' : 'DRY RUN — nothing will be written (pass --apply to update)\n')

  const bookings = await prisma.booking.findMany({
    where: { agent: B2C_AGENT_NAME, ...(refArg ? { bookingRef: refArg } : {}) },
    select: { bookingRef: true },
    orderBy: { bookingRef: 'asc' },
  })
  // The B2C booking ref *is* the Aahaas order id.
  const orderIds = bookings.map((b) => Number(b.bookingRef)).filter((n) => Number.isInteger(n) && n > 0)
  console.log(`${orderIds.length} B2C booking(s) to check`)

  const actorId = await getAutomationUserId()
  const totals = { repaired: 0, wouldRepair: 0, unchanged: 0 }
  const reasons = new Map<string, number>()
  const engageCandidates: { bookingRef: string; guestPhone: string | null; storeStatus: string | null }[] = []

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK)
    const [customers, flightRows, travellers] = await Promise.all([
      fetchOrderCustomers(chunk),
      fetchFlightBookings(chunk),
      loadOrderTravellers(chunk),
    ])
    // Travellers carry the confirmed lead's contact; without them a sweep would
    // fall back to ticket contacts only — stop rather than half-repair.
    if (travellers.error) throw new Error(`traveller lookup failed: ${travellers.error}`)

    const customerByOrder = new Map(customers.map((c) => [Number(c.order_id), c]))
    const flights = flightRows.map((r) => parseFlightBooking(r))

    for (const orderId of chunk) {
      const customer = customerByOrder.get(orderId)
      const orderFlights = flights.filter((f) => f.orderId === orderId)
      const lead = resolveLeadPassenger(orderFlights, travellers.byOrder.get(orderId), customer)
      const guest = guestContactOf(orderFlights, lead, customer)
      const bookingRef = String(orderId)
      engageCandidates.push({ bookingRef, guestPhone: guest.phone, storeStatus: customer?.checkout_status ?? null })

      const r = await repairB2cGuestContact({
        bookingRef, email: guest.email, phone: guest.phone,
        source: 'scripts/b2c-fix-guest-contacts', apply, actorId,
      })
      if (r.status === 'unchanged') {
        totals.unchanged += 1
        reasons.set(r.reason ?? '', (reasons.get(r.reason ?? '') ?? 0) + 1)
        if (refArg) console.log(`  ${bookingRef}: unchanged — ${r.reason}`)
        continue
      }
      if (r.status === 'repaired') totals.repaired += 1
      else totals.wouldRepair += 1
      const what = r.changes.map((c) => `${c.field} ${c.from ?? '—'} → ${c.to}`).join(' · ')
      console.log(`  ${bookingRef}: ${what}${apply ? '' : '  (dry run)'}`)
    }
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${apply ? totals.repaired : totals.wouldRepair}`)
  console.log(`Unchanged: ${totals.unchanged}`)
  reasons.forEach((n, reason) => console.log(`  ${n} × ${reason}`))

  if (!engage) return
  console.log(`\nAI calls + WhatsApp — ${apply ? 'registering' : 'would register'} (max 10 this run):`)
  const engaged = await engageB2cGuests(engageCandidates, { apply, actor: 'auto (B2C backfill script)' })
  if (engaged.length === 0) console.log('  nothing — or auto_b2c_guest_engage_enabled is false')
  for (const r of engaged) {
    if (r.status === 'skipped' && !refArg && !r.reason?.startsWith('failed')) continue
    console.log(`  ${r.bookingRef}: ${r.status}${r.approval ? ` (permission ${r.approval})` : ''}${r.reason ? ` — ${r.reason}` : ''}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
