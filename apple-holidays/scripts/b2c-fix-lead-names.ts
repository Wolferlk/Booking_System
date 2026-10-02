/**
 * Aahaas B2C — replace account names with real traveller names.
 *
 * B2C bookings imported before checkout travellers were read have the store
 * *account* as their lead passenger (e.g. "admin6611"), while AahaasFlow shows
 * the real traveller ("Rithika Annadurai"). This sweeps every B2C booking and
 * renames the lead passenger only where it still equals the account name, so
 * anything ops has edited by hand is never touched.
 *
 * DRY RUN by default — prints what would change and writes nothing:
 *
 *   npx tsx scripts/b2c-fix-lead-names.ts                # every B2C booking
 *   npx tsx scripts/b2c-fix-lead-names.ts --ref 14779    # one booking
 *   npx tsx scripts/b2c-fix-lead-names.ts --apply        # actually rename
 *
 * The Aahaas store is only ever read (through `b2cQuery`'s read-only guard).
 * Each rename touches one `passengers.name`, moves that passenger's special
 * note with it, and is written to the activity log with the old name, so it
 * can be reversed by hand if ever needed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../src/lib/prisma'
import { fetchFlightBookings, fetchOrderCustomers, isB2cConfigured } from '../src/lib/b2c-db'
import { parseFlightBooking } from '../src/lib/b2c-flight'
import { resolveLeadPassenger } from '../src/lib/b2c-booking-map'
import { loadOrderTravellers, repairB2cLeadName } from '../src/lib/b2c-lead-name'
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

async function main() {
  loadEnv()
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const refArg = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null
  // A typo like `--red 14779` must not silently widen the run to every booking.
  const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--apply' && a !== '--ref' || (!a.startsWith('--') && args[i - 1] !== '--ref'))
  if (unknown.length > 0 || (args.includes('--ref') && !refArg)) {
    throw new Error(`Unrecognised arguments: ${unknown.join(' ') || '--ref needs a booking ref'} — use --ref <bookingRef> and/or --apply`)
  }

  if (!isB2cConfigured()) throw new Error('B2C database is not configured — set DB_HOST / DB_USERNAME / DB_DATABASE_B2C')
  console.log(apply ? 'APPLY — lead names will be updated\n' : 'DRY RUN — nothing will be written (pass --apply to rename)\n')

  const bookings = await prisma.booking.findMany({
    where: { agent: B2C_AGENT_NAME, ...(refArg ? { bookingRef: refArg } : {}) },
    select: { bookingRef: true },
    orderBy: { bookingRef: 'asc' },
  })
  // The B2C booking ref *is* the Aahaas order id.
  const orderIds = bookings.map((b) => Number(b.bookingRef)).filter((n) => Number.isInteger(n) && n > 0)
  console.log(`${orderIds.length} B2C booking(s) to check`)

  const actorId = await getAutomationUserId()
  const totals = { renamed: 0, wouldRename: 0, unchanged: 0 }
  const reasons = new Map<string, number>()

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK)
    const [customers, flightRows, travellers] = await Promise.all([
      fetchOrderCustomers(chunk),
      fetchFlightBookings(chunk),
      loadOrderTravellers(chunk),
    ])
    // Without travellers every booking would be "no traveller name", which is
    // safe but useless — stop rather than report a misleading clean sweep.
    if (travellers.error) throw new Error(`traveller lookup failed: ${travellers.error}`)

    const customerByOrder = new Map(customers.map((c) => [Number(c.order_id), c]))
    const flights = flightRows.map((r) => parseFlightBooking(r))

    for (const orderId of chunk) {
      const customer = customerByOrder.get(orderId)
      const lead = resolveLeadPassenger(
        flights.filter((f) => f.orderId === orderId),
        travellers.byOrder.get(orderId),
        customer,
      )
      const r = await repairB2cLeadName({
        bookingRef: String(orderId),
        newName: lead.name,
        via: lead.via,
        accountName: customer?.customer_name?.trim() ?? null,
        apply,
        actorId,
      })
      if (r.status === 'unchanged') {
        totals.unchanged += 1
        reasons.set(r.reason ?? '', (reasons.get(r.reason ?? '') ?? 0) + 1)
        if (refArg) console.log(`  ${r.bookingRef}: unchanged — ${r.reason}`)
        continue
      }
      if (r.status === 'renamed') totals.renamed += 1
      else totals.wouldRename += 1
      console.log(`  ${r.bookingRef}: ${r.from} → ${r.to}${apply ? '' : '  (dry run)'}`)
    }
  }

  console.log(`\n${apply ? 'Renamed' : 'Would rename'}: ${apply ? totals.renamed : totals.wouldRename}`)
  console.log(`Unchanged: ${totals.unchanged}`)
  reasons.forEach((n, reason) => console.log(`  ${n} × ${reason}`))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
