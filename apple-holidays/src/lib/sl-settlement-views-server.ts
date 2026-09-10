/**
 * Where a person's register layouts are kept.
 *
 * ---- Why `SystemSetting` and not a table ----
 *
 * A saved view is a preference, not a record: it holds no money, nothing is
 * audited against it, and losing one costs a minute of re-ticking boxes. It
 * also has to work on a production database that has drifted from the schema,
 * where adding a table is a deliberate, hand-run operation rather than a
 * migration. One JSON row per user in `system_settings` buys the same
 * behaviour — layouts that follow the person between the office desktop and a
 * phone — at no schema risk at all. It is the same trade `driver_log_{ref}`
 * made before it earned its own table, and if views ever grow sharing, an
 * owner and an audit trail, they should earn one too.
 *
 * ---- Scope ----
 *
 * Per user, always. The key is the user id, so two people on the same screen
 * keep their own columns, and nothing here is readable by anyone else. Reads
 * never throw: a settings row that will not parse costs the user their saved
 * layouts, and the register — a money screen — must still open on the shipped
 * one.
 */

import { prisma } from './prisma'
import { MAX_VIEWS, normaliseViews, type RegisterView } from './sl-settlement-columns'

const keyFor = (userId: string) => `sl_settlement_views:${userId}`

/** Everything this user has saved, or an empty list. Never throws. */
export async function loadRegisterViews(userId: string): Promise<RegisterView[]> {
  if (!userId) return []
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: keyFor(userId) } })
    if (!row?.value) return []
    return normaliseViews(JSON.parse(row.value))
  } catch (err) {
    console.error('[sl-settlement-views] read', err)
    return []
  }
}

/**
 * Replace this user's saved set.
 *
 * Whole-set writes rather than per-view ones: the list is tiny, the client
 * always holds all of it, and one write means the "exactly one default" rule is
 * settled in `normaliseViews` instead of being maintained across three
 * endpoints. Returns what was actually stored, which is what the client should
 * render — its own copy may have held a name too long or a column since retired.
 */
export async function saveRegisterViews(
  userId: string,
  views: unknown,
): Promise<RegisterView[]> {
  const clean = normaliseViews(views).slice(0, MAX_VIEWS)
  const stamped = clean.map(v => ({ ...v, updatedAt: v.updatedAt ?? new Date().toISOString() }))
  const value = JSON.stringify(stamped)

  await prisma.systemSetting.upsert({
    where:  { key: keyFor(userId) },
    update: { value },
    create: { key: keyFor(userId), value },
  })

  return stamped
}
