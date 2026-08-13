/** Shared contact-field validation used by the UI and API routes. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const MOBILE_REGEX = /^\+?[0-9]{7,15}$/

export function normalizeMobile(value: string): string {
  return value.trim().replace(/[\s().-]/g, '')
}