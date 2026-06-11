import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ─── Users ────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('password123', 12)

  const [admin, btUser, gtUser, teUser, acUser, client] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@apple.com' },
      update: {},
      create: { email: 'admin@apple.com', name: 'Super Admin', password, role: 'SUPER_ADMIN', phone: '+1-555-0001' },
    }),
    prisma.user.upsert({
      where: { email: 'bt@apple.com' },
      update: {},
      create: { email: 'bt@apple.com', name: 'Esther Booking', password, role: 'BT_USER', destination: 'VIETNAM', phone: '+1-555-0002' },
    }),
    prisma.user.upsert({
      where: { email: 'gt@apple.com' },
      update: {},
      create: { email: 'gt@apple.com', name: 'Ground Ops', password, role: 'GT_USER', destination: 'VIETNAM', phone: '+1-555-0003' },
    }),
    prisma.user.upsert({
      where: { email: 'te@apple.com' },
      update: {},
      create: { email: 'te@apple.com', name: 'Travel Experience', password, role: 'TE_USER', destination: 'VIETNAM', phone: '+1-555-0004' },
    }),
    prisma.user.upsert({
      where: { email: 'ac@apple.com' },
      update: {},
      create: { email: 'ac@apple.com', name: 'Accounts Manager', password, role: 'AC_USER', destination: 'VIETNAM', phone: '+1-555-0005' },
    }),
    prisma.user.upsert({
      where: { email: 'client@apple.com' },
      update: {},
      create: { email: 'client@apple.com', name: 'Vikas Arora', password, role: 'CLIENT', destination: 'VIETNAM', phone: '+91-98765-43210' },
    }),
  ])

  // ─── Sri Lanka Users ─────────────────────────────────────────────────
  await Promise.all([
    prisma.user.upsert({
      where: { email: 'bt-sl@apple.com' },
      update: {},
      create: { email: 'bt-sl@apple.com', name: 'SL Booking Team', password, role: 'BT_USER', destination: 'SRI_LANKA', phone: '+94-77-123-0001' },
    }),
    prisma.user.upsert({
      where: { email: 'gt-sl@apple.com' },
      update: {},
      create: { email: 'gt-sl@apple.com', name: 'SL Ground Ops', password, role: 'GT_USER', destination: 'SRI_LANKA', phone: '+94-77-123-0002' },
    }),
    prisma.user.upsert({
      where: { email: 'te-sl@apple.com' },
      update: {},
      create: { email: 'te-sl@apple.com', name: 'SL Travel Experience', password, role: 'TE_USER', destination: 'SRI_LANKA', phone: '+94-77-123-0003' },
    }),
    prisma.user.upsert({
      where: { email: 'ac-sl@apple.com' },
      update: {},
      create: { email: 'ac-sl@apple.com', name: 'SL Accounts Manager', password, role: 'AC_USER', destination: 'SRI_LANKA', phone: '+94-77-123-0004' },
    }),
    prisma.user.upsert({
      where: { email: 'client-sl@apple.com' },
      update: {},
      create: { email: 'client-sl@apple.com', name: 'Rajiv Perera', password, role: 'CLIENT', destination: 'SRI_LANKA', phone: '+94-71-234-5678' },
    }),
  ])

  console.log('✅ Users created (Vietnam + Sri Lanka)')

  // ─── Drivers ────────────────────────────────────────────────────────
  const [driver1, driver2] = await Promise.all([
    prisma.driver.upsert({
      where: { id: 'driver-001' },
      update: {},
      create: { id: 'driver-001', name: 'Nguyen Van Minh', phone: '+84-905-123456', email: 'minh@van.vn', licenseNo: 'VN-2024-001' },
    }),
    prisma.driver.upsert({
      where: { id: 'driver-002' },
      update: {},
      create: { id: 'driver-002', name: 'Tran Thi Lan', phone: '+84-906-789012', email: 'lan@transport.vn', licenseNo: 'VN-2024-002' },
    }),
  ])

  await Promise.all([
    prisma.vehicle.upsert({
      where: { plateNo: '30A-12345' },
      update: {},
      create: { type: 'van', plateNo: '30A-12345', capacity: 7, description: 'Toyota Hiace 7-seater' },
    }),
    prisma.vehicle.upsert({
      where: { plateNo: '51B-67890' },
      update: {},
      create: { type: 'minibus', plateNo: '51B-67890', capacity: 16, description: 'Ford Transit 16-seater' },
    }),
  ])

  console.log('✅ Drivers & vehicles created')

  // ─── Booking VN19005 ─────────────────────────────────────────────────
  const existingBooking = await prisma.booking.findUnique({ where: { bookingRef: 'VN19005' } })

  if (!existingBooking) {
    const arrival = new Date('2026-05-18')
    const departure = new Date('2026-05-25')
    const cancellationDeadline = new Date('2026-04-27') // 21 days before arrival

    const booking = await prisma.booking.create({
      data: {
        bookingRef: 'VN19005',
        agentBookingId: 'NL2202565846800',
        agent: 'Make My Trip',
        fileHandler: 'ESTHER',
        version: 2,
        amendmentNote: '02. AMENDED — Cruise Lunch Changed',
        status: 'GT_REVIEW',
        arrivalDate: arrival,
        departureDate: departure,
        paxAdults: 2,
        paxChildren: 0,
        quotedTotal: 580.00,
        currency: 'USD',
        cancellationDeadline,
        terms: 'Cancellation charges: 100% if cancelled within 21 days of arrival. Mandatory tips for guides and drivers. No refund for unused services.',
        exclusions: 'International/domestic airfares, travel insurance, meals not mentioned, personal expenses, visa fees',
        policyNotes: 'Please confirm flight details at least 48 hours before arrival. Airport transfer not guaranteed without confirmed flight details.',
        createdById: btUser.id,
        clientUserId: client.id,
        emergencyContacts: {
          create: [
            { name: 'Izzon', phone: '+84-901-111111', role: 'Operations Manager' },
            { name: 'Helen', phone: '+84-902-222222', role: 'Travel Coordinator' },
            { name: 'Tina', phone: '+84-903-333333', role: 'Ground Support' },
            { name: 'Senthoor', phone: '+84-904-444444', role: 'Emergency Contact' },
          ],
        },
        passengers: {
          create: [
            { name: 'Vikas Arora', type: 'ADULT', age: 49, isLead: true, nationality: 'Indian', passport: 'Z1234567' },
            { name: 'Richa Arora', type: 'ADULT', age: 46, isLead: false, nationality: 'Indian', passport: 'Z7654321' },
          ],
        },
        flights: {
          create: [
            { flightNo: 'VJ1926', date: new Date('2026-05-18'), fromApt: 'DEL', depTime: '06:30', toApt: 'HAN', arrTime: '14:15', airline: 'VietJet Air' },
            { flightNo: 'VJ517', date: new Date('2026-05-20'), fromApt: 'HAN', depTime: '10:00', toApt: 'DAD', arrTime: '11:20', airline: 'VietJet Air' },
            { flightNo: 'VJ637', date: new Date('2026-05-23'), fromApt: 'DAD', depTime: '12:00', toApt: 'SGN', arrTime: '13:15', airline: 'VietJet Air' },
            { flightNo: 'VJ1805', date: new Date('2026-05-25'), fromApt: 'SGN', depTime: '22:00', toApt: 'DEL', arrTime: '01:30', airline: 'VietJet Air' },
          ],
        },
        accommodations: {
          create: [
            { city: 'Hanoi', hotel: 'La Siesta Trendy Hotel', checkIn: new Date('2026-05-18'), checkOut: new Date('2026-05-19'), nights: 1, roomType: 'Deluxe', mealType: 'BB' },
            { city: 'Sa Pa', hotel: 'Sapa Elegance Hotel', checkIn: new Date('2026-05-19'), checkOut: new Date('2026-05-21'), nights: 2, roomType: 'Superior', mealType: 'BB' },
            { city: 'Da Nang', hotel: 'Hilton Da Nang', checkIn: new Date('2026-05-21'), checkOut: new Date('2026-05-23'), nights: 2, roomType: 'Ocean View', mealType: 'BB' },
            { city: 'Ho Chi Minh City', hotel: 'Rex Hotel Saigon', checkIn: new Date('2026-05-23'), checkOut: new Date('2026-05-25'), nights: 2, roomType: 'Deluxe', mealType: 'BB' },
          ],
        },
        itineraryItems: {
          create: [
            { dayNo: 1, date: new Date('2026-05-18'), title: 'Arrival Hanoi — City Tour', description: 'Arrive at Noi Bai Airport. Transfer to hotel. Afternoon: Hoan Kiem Lake, Old Quarter walking tour.' },
            { dayNo: 2, date: new Date('2026-05-19'), title: 'Hanoi → Sa Pa (Overnight Train)', description: 'Day free in Hanoi. Evening: Board overnight train to Lao Cai, transfer to Sa Pa.' },
            { dayNo: 3, date: new Date('2026-05-20'), title: 'Sa Pa — Own Arrangement', description: 'Free day in Sa Pa. Optional: Fansipan cable car, trekking to Cat Cat Village.' },
            { dayNo: 4, date: new Date('2026-05-21'), title: 'Sa Pa → Da Nang (Flight VJ517)', description: 'Morning: Return to Hanoi by train. Afternoon flight to Da Nang. Evening: My Khe Beach.' },
            { dayNo: 5, date: new Date('2026-05-22'), title: 'Da Nang — Hoi An Day Trip', description: 'Full day excursion to Hoi An Ancient Town. Tailoring, street food, lantern making.' },
            { dayNo: 6, date: new Date('2026-05-23'), title: 'Da Nang → Ho Chi Minh City (Flight VJ637)', description: 'Morning: Dragon Bridge, Marble Mountains. Afternoon flight to HCMC. Ben Thanh Market visit.' },
            { dayNo: 7, date: new Date('2026-05-24'), title: 'Ho Chi Minh City — Full Day', description: 'War Remnants Museum, Reunification Palace, Cu Chi Tunnels half-day tour. Evening dinner cruise.' },
            { dayNo: 8, date: new Date('2026-05-25'), title: 'Departure — HCMC', description: 'Free morning. Transfer to Tan Son Nhat Airport. Flight home (VJ1805 22:00).' },
          ],
        },
      },
    })

    // Status event
    await prisma.statusEvent.createMany({
      data: [
        { bookingId: booking.id, toState: 'DRAFT', actorId: btUser.id, note: 'Booking created from MMT quotation' },
        { bookingId: booking.id, fromState: 'DRAFT', toState: 'BT_CONFIRMED', actorId: btUser.id, note: 'Booking confirmed by Esther' },
        { bookingId: booking.id, fromState: 'BT_CONFIRMED', toState: 'GT_REVIEW', actorId: btUser.id, note: 'Submitted to Ground Team for review' },
      ],
    })

    // Tour Agenda
    const agenda = await prisma.tourAgenda.create({
      data: { bookingId: booking.id },
    })

    const agendaItems = await Promise.all([
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-18'), location: 'Hanoi',
          fromPoint: 'Noi Bai Airport', toPoint: 'La Siesta Trendy Hotel',
          details: 'PVT Airport Transfer · Arrival Flight VJ1926 at 14:15', mealPlan: 'D',
          meetingTime: '14:30', serviceType: 'PVT_TRANSFER', sortOrder: 0,
        },
      }),
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-18'), location: 'Hanoi',
          fromPoint: 'Hotel', toPoint: 'Hoan Kiem Lake & Old Quarter Tour',
          details: 'Half-day Hanoi City Tour', mealPlan: null,
          meetingTime: '15:30', serviceType: 'SIC_TRANSFER', sortOrder: 1,
        },
      }),
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-20'), location: 'Sa Pa',
          fromPoint: null, toPoint: 'Free Day / Own Arrangement',
          details: 'Optional Fansipan Cable Car or trekking', mealPlan: 'B',
          serviceType: 'OWN_ARRANGEMENT', sortOrder: 2,
        },
      }),
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-22'), location: 'Da Nang',
          fromPoint: 'Hilton Da Nang', toPoint: 'Hoi An Ancient Town Full Day',
          details: 'SIC day tour including boat ride on Thu Bon River', mealPlan: 'BL',
          meetingTime: '08:00', serviceType: 'SIC_TRANSFER', sortOrder: 3,
        },
      }),
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-23'), location: 'Da Nang → HCMC',
          fromPoint: 'Hilton Da Nang', toPoint: 'Tan Son Nhat Airport (VJ637)',
          details: 'PVT Airport Transfer · Departure 12:00', mealPlan: 'B',
          meetingTime: '10:30', serviceType: 'PVT_TRANSFER', sortOrder: 4,
        },
      }),
      prisma.agendaItem.create({
        data: {
          agendaId: agenda.id, date: new Date('2026-05-24'), location: 'Ho Chi Minh City',
          fromPoint: 'Rex Hotel Saigon', toPoint: 'Cu Chi Tunnels Half Day + City Tour',
          details: '5-Star Ha Long Cruise style day excursion', mealPlan: 'BL',
          meetingTime: '08:30', serviceType: 'SIC_TRANSFER', sortOrder: 5,
        },
      }),
    ])

    // Add driver assignment to first PVT item
    await prisma.assignment.create({
      data: {
        agendaItemId: agendaItems[0].id,
        driverName: 'Nguyen Van Minh',
        driverPhone: '+84-905-123456',
        vehicleType: 'Toyota Hiace 7-seater',
        vehiclePlate: '30A-12345',
        notes: 'Will hold name board at arrivals',
      },
    })

    // P&L
    const pnl = await prisma.pNL.create({
      data: { bookingId: booking.id, paxAdults: 2, paxChildren: 0 },
    })

    await prisma.pNLLineItem.createMany({
      data: [
        { pnlId: pnl.id, activity: 'Arrival / Departure Airport Transfer (PVT)', category: 'TRANSPORT', mmtRate: 60, sicRate: 0, pvtRatePP: 25, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 0 },
        { pnlId: pnl.id, activity: 'Hanoi City Half Day Tour (SIC)', category: 'GUIDES', mmtRate: 30, sicRate: 12, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 1 },
        { pnlId: pnl.id, activity: 'Overnight Train Hanoi–Lao Cai (PVT Cabin)', category: 'TRANSPORT', mmtRate: 50, sicRate: 0, pvtRatePP: 18, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 2 },
        { pnlId: pnl.id, activity: 'Hotel La Siesta Trendy (1N BB)', category: 'HOTEL', mmtRate: 80, sicRate: 0, pvtRatePP: 55, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 3 },
        { pnlId: pnl.id, activity: 'Sapa Elegance Hotel (2N BB)', category: 'HOTEL', mmtRate: 100, sicRate: 0, pvtRatePP: 70, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 4 },
        { pnlId: pnl.id, activity: 'Full Day Shared Trip 5-Star Ha Long Cruise', category: 'CRUISE', mmtRate: 120, sicRate: 45, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 5 },
        { pnlId: pnl.id, activity: 'Hoi An Full Day SIC Tour', category: 'GUIDES', mmtRate: 40, sicRate: 15, pvtRatePP: 0, adEntrance: 3, chEntrance: 1.5, otherRate: 0, sortOrder: 6 },
        { pnlId: pnl.id, activity: 'Cu Chi Tunnels Half Day + HCMC Tour', category: 'TICKETS', mmtRate: 50, sicRate: 18, pvtRatePP: 0, adEntrance: 5, chEntrance: 3, otherRate: 0, sortOrder: 7 },
        { pnlId: pnl.id, activity: 'Hilton Da Nang (2N BB)', category: 'HOTEL', mmtRate: 0, sicRate: 0, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 8 },
        { pnlId: pnl.id, activity: 'Rex Hotel HCMC (2N BB)', category: 'HOTEL', mmtRate: 0, sicRate: 0, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 0, sortOrder: 9 },
        { pnlId: pnl.id, activity: 'Bottled Water & Misc', category: 'WATER', mmtRate: 50, sicRate: 0, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 8, sortOrder: 10 },
      ],
    })

    // Draft ticket
    await prisma.ticket.create({
      data: {
        bookingId: booking.id,
        agendaItemId: agendaItems[3].id,
        type: 'Hoi An Ancient Town Entry Pass',
        qty: 2,
        supplier: 'Hoi An Heritage Centre',
        costPerUnit: 3.00,
        totalCost: 6.00,
        currency: 'USD',
        status: 'DRAFT',
      },
    })

    // Change request (resolved)
    await prisma.changeRequest.create({
      data: {
        bookingId: booking.id,
        raisedById: gtUser.id,
        notes: 'Please verify the Ha Long Cruise date — booking confirms it as Day 5 but agenda shows Day 6',
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedNote: 'Corrected — Cruise is on Day 6 (22 May). Agenda updated.',
      },
    })

    console.log('✅ Booking VN19005 created with agenda, P&L, tickets')
  } else {
    console.log('ℹ️  Booking VN19005 already exists, skipping')
  }

  // ─── Second demo booking ─────────────────────────────────────────────
  const existingVN19006 = await prisma.booking.findUnique({ where: { bookingRef: 'VN19006' } })

  if (!existingVN19006) {
    const booking2 = await prisma.booking.create({
      data: {
        bookingRef: 'VN19006',
        agentBookingId: 'MMT-9876543',
        agent: 'Make My Trip',
        fileHandler: 'ESTHER',
        status: 'DRAFT',
        arrivalDate: new Date('2026-07-10'),
        departureDate: new Date('2026-07-17'),
        paxAdults: 4,
        paxChildren: 2,
        quotedTotal: 1850.00,
        currency: 'USD',
        cancellationDeadline: new Date('2026-06-19'),
        createdById: btUser.id,
        passengers: {
          create: [
            { name: 'Rahul Sharma', type: 'ADULT', age: 38, isLead: true, nationality: 'Indian' },
            { name: 'Priya Sharma', type: 'ADULT', age: 35, isLead: false, nationality: 'Indian' },
            { name: 'Anil Kumar', type: 'ADULT', age: 42, isLead: false, nationality: 'Indian' },
            { name: 'Sunita Kumar', type: 'ADULT', age: 39, isLead: false, nationality: 'Indian' },
            { name: 'Rohan Sharma', type: 'CHILD', age: 10, isLead: false, nationality: 'Indian' },
            { name: 'Meera Sharma', type: 'CHILD', age: 8, isLead: false, nationality: 'Indian' },
          ],
        },
        flights: {
          create: [
            { flightNo: 'AI201', date: new Date('2026-07-10'), fromApt: 'BOM', depTime: '08:00', toApt: 'HAN', arrTime: '16:30', airline: 'Air India' },
            { flightNo: 'AI202', date: new Date('2026-07-17'), fromApt: 'SGN', depTime: '20:00', toApt: 'BOM', arrTime: '23:59', airline: 'Air India' },
          ],
        },
        accommodations: {
          create: [
            { city: 'Hanoi', hotel: 'Sofitel Legend Metropole', checkIn: new Date('2026-07-10'), checkOut: new Date('2026-07-12'), nights: 2, roomType: 'Heritage Wing', mealType: 'BB' },
            { city: 'Ha Long Bay', hotel: 'Paradise Elegance Cruise', checkIn: new Date('2026-07-12'), checkOut: new Date('2026-07-13'), nights: 1, roomType: 'Deluxe Cabin', mealType: 'Full Board' },
            { city: 'Ho Chi Minh City', hotel: 'Park Hyatt Saigon', checkIn: new Date('2026-07-13'), checkOut: new Date('2026-07-17'), nights: 4, roomType: 'King', mealType: 'BB' },
          ],
        },
        emergencyContacts: {
          create: [
            { name: 'Helen', phone: '+84-902-222222', role: 'Travel Coordinator' },
          ],
        },
      },
    })

    await prisma.statusEvent.create({
      data: { bookingId: booking2.id, toState: 'DRAFT', actorId: btUser.id, note: 'New booking created' },
    })

    console.log('✅ Booking VN19006 created (DRAFT)')
  }

  console.log('\n🎉 Seed complete!')
  console.log('\nDemo credentials (all use password: password123):')
  console.log('  admin@apple.com     — Super Admin')
  console.log('  bt@apple.com        — Booking Team')
  console.log('  gt@apple.com        — Ground Team')
  console.log('  te@apple.com        — Travel Experience')
  console.log('  ac@apple.com        — Accounts Team')
  console.log('  client@apple.com    — Client Portal')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
