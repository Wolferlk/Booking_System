import prisma from './prisma'

export async function logActivity(params: {
  userId: string
  action: string
  entityType?: string
  entityId?: string
  details?: Record<string, unknown>
  ipAddress?: string
}) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        details: params.details ? JSON.stringify(params.details) : null,
        ipAddress: params.ipAddress ?? null,
      },
    })
  } catch {
    // Non-critical — never let logging break the main flow
  }
}

export const ACTION = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_UPDATED: 'BOOKING_UPDATED',
  BOOKING_DELETED: 'BOOKING_DELETED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  TICKET_PURCHASED: 'TICKET_PURCHASED',
  TICKET_FILE_UPLOADED: 'TICKET_FILE_UPLOADED',
  PNL_LINE_CONFIRMED: 'PNL_LINE_CONFIRMED',
  PNL_LINE_REJECTED: 'PNL_LINE_REJECTED',
  DRIVER_CREATED: 'DRIVER_CREATED',
  DRIVER_UPDATED: 'DRIVER_UPDATED',
  DRIVER_PAYMENT_ADDED: 'DRIVER_PAYMENT_ADDED',
  CHANGE_REQUEST_RAISED: 'CHANGE_REQUEST_RAISED',
  CHANGE_REQUEST_RESOLVED: 'CHANGE_REQUEST_RESOLVED',
  USER_LOGIN: 'USER_LOGIN',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
} as const
