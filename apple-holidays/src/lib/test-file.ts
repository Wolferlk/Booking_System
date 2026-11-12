/**
 * "Is this a test booking?" — the same rule the Ops Board uses
 * (`detectTestFile` in reports/ops-day-data.ts): the word "test" / "testing"
 * in the lead guest's name or in one of the booking's free-text notes.
 * Matches "TEST-BOOKING", "test file"; not "latest" or "contest".
 */
const TEST_WORD = /\btest(?:ing)?\b/i

export function isTestText(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && TEST_WORD.test(t))
}
