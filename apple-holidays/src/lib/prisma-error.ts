import { buildApiError } from './utils'

type PrismaLikeError = {
  code?: string
  meta?: {
    target?: string[]
  }
}

function describeDuplicateTarget(error: PrismaLikeError): string | null {
  const target = error.meta?.target
  if (!Array.isArray(target) || target.length === 0) return null
  return target.join(', ')
}

export function handlePrismaApiError(
  error: unknown,
  fallbackMessage: string,
  duplicateMessage: string,
) {
  const prismaError = error as PrismaLikeError

  if (prismaError?.code === 'P2002') {
    const target = describeDuplicateTarget(prismaError)
    const message = target ? `${duplicateMessage} (${target})` : duplicateMessage
    return buildApiError(message, 409)
  }

  console.error(fallbackMessage, error)
  return buildApiError(fallbackMessage, 500)
}
