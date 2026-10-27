/**
 * Travel Quote GPT office teams — mirrors `WORK_TEAMS` / `WORK_TEAM_LABEL` in
 * the n8n-project's auth/roles.js. Dependency-free so the schedule store and
 * the dashboard can both import it.
 */
export const SALES_TEAMS = {
  bangalore_b2b: 'Bangalore B2B Team',
  airline_ticketing: 'Airline Ticketing Team',
  sri_lanka_b2b_b2c: 'Sri Lanka B2B & B2C Team',
  madurai_b2b: 'Madurai B2B Team',
} as const
export type SalesTeam = keyof typeof SALES_TEAMS

export function normalizeSalesTeam(v: unknown): SalesTeam | null {
  const t = String(v ?? '').trim().toLowerCase()
  return t in SALES_TEAMS ? (t as SalesTeam) : null
}

export function teamLabel(t: string | null | undefined): string {
  return t && t in SALES_TEAMS ? SALES_TEAMS[t as SalesTeam] : 'No team'
}
