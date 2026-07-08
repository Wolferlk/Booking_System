import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { countryScope } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const countryParam     = searchParams.get('country') as OperationCountry | null
  const userCountry      = session.user.country as OperationCountry | undefined
  const effectiveCountry = (!userCountry || userCountry === 'ALL') ? countryParam : userCountry
  const countryWhere     = effectiveCountry ? { country: { in: countryScope(effectiveCountry)! } } : {}
  const vendorMode       = searchParams.get('vendorMode') === '1'   // include all / independent only

  const drivers = await prisma.driver.findMany({
    where: {
      ...countryWhere,
      ...(vendorMode ? {} : { vendorId: null }),
    },
    include: {
      vehicle: { include: { vendor: true } },
      driverPayments: {
        include: { paidBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      vendorOwner: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  })

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Drivers ────────────────────────────────────────────────────────
  const driverRows = drivers.map(d => ({
    'Name':             d.name,
    'Phone':            d.phone,
    'Email':            d.email ?? '',
    'License No':       d.licenseNo ?? '',
    'Country':          d.country ?? '',
    'Status':           d.isActive ? 'Active' : 'Inactive',
    'Vendor':           d.vendorOwner?.name ?? 'Independent',
    'Vehicle Plate':    d.vehicle?.plateNo ?? '',
    'Vehicle Type':     d.vehicle?.type ?? '',
    'Vehicle Brand':    d.vehicle?.brand ?? '',
    'Vehicle Model':    d.vehicle?.model ?? '',
    'Vehicle Capacity': d.vehicle?.capacity ?? '',
    'Bank Name':        d.bankName ?? '',
    'Account No':       d.bankAccountNo ?? '',
    'Account Holder':   d.bankHolder ?? '',
    'Branch':           d.bankBranch ?? '',
    'SWIFT / Code':     d.bankCode ?? '',
    'Advance Balance':  Number(d.advanceBalance),
  }))
  const ws1 = XLSX.utils.json_to_sheet(driverRows)
  ws1['!cols'] = [
    { wch: 22 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 10 },
    { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'Drivers')

  // ── Sheet 2: Payment History ─────────────────────────────────────────────────
  const payRows: Record<string, unknown>[] = []
  for (const d of drivers) {
    for (const p of d.driverPayments) {
      payRows.push({
        'Driver Name':    d.name,
        'Driver Phone':   d.phone,
        'Country':        d.country ?? '',
        'Payment Type':   p.type,
        'Amount (USD)':   Number(p.amount),
        'Description':    p.description ?? '',
        'Ref Number':     p.refNumber ?? '',
        'Paid By':        p.paidBy.name,
        'Date':           new Date(p.createdAt).toLocaleDateString('en-GB'),
      })
    }
  }
  const ws2 = XLSX.utils.json_to_sheet(payRows.length ? payRows : [{ Note: 'No payment records' }])
  ws2['!cols'] = [
    { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
    { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws2, 'Payment History')

  // ── Sheet 3: Bank Details ────────────────────────────────────────────────────
  const bankRows = drivers.filter(d => d.bankAccountNo).map(d => ({
    'Driver Name':    d.name,
    'Country':        d.country ?? '',
    'Bank':           d.bankName ?? '',
    'Account No':     d.bankAccountNo ?? '',
    'Account Holder': d.bankHolder ?? '',
    'Branch':         d.bankBranch ?? '',
    'SWIFT / Code':   d.bankCode ?? '',
  }))
  const ws3 = XLSX.utils.json_to_sheet(bankRows.length ? bankRows : [{ Note: 'No bank records' }])
  ws3['!cols'] = [
    { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws3, 'Bank Details')

  const buf = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="drivers-report-${date}.xlsx"`,
    },
  })
}
