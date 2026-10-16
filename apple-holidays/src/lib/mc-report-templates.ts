/**
 * Saved MC Report templates — server side.
 *
 * Each template is one `system_settings` row, `mc_report_template:<id>`, holding
 * JSON. Deliberately no new table: the live DB carries drift and must not be
 * pushed to, and a template is a small document read only by Report Studio.
 *
 * A template is private to its owner unless shared, in which case everyone who
 * can open the MC Report sees it. Only the owner (or an admin) changes it.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sanitizeConfig, type McReportTemplate } from '@/lib/mc-report-pdf'
import type { UserRole } from '@prisma/client'

export const TEMPLATE_PREFIX = 'mc_report_template:'
export const MAX_TEMPLATES_PER_USER = 60

export const MC_REPORT_ROLES: UserRole[] = [
  'TE_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'BT_USER', 'AC_USER',
  'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export interface TemplateActor { id: string; name: string | null; role: UserRole }

function parse(value: string, updatedAt: Date): McReportTemplate | null {
  try {
    const v = JSON.parse(value) as McReportTemplate
    if (!v?.id || !v.name) return null
    return { ...v, config: sanitizeConfig(v.config), updatedAt: v.updatedAt ?? updatedAt.toISOString() }
  } catch {
    return null
  }
}

export function canEdit(t: McReportTemplate, actor: TemplateActor): boolean {
  return t.ownerId === actor.id || ADMIN_ROLES.includes(actor.role)
}

export async function listTemplates(actor: TemplateActor): Promise<McReportTemplate[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: TEMPLATE_PREFIX } } })
  return rows
    .map(r => parse(r.value, r.updatedAt))
    .filter((t): t is McReportTemplate => !!t && (t.ownerId === actor.id || !!t.shared))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export async function getTemplate(id: string): Promise<McReportTemplate | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: `${TEMPLATE_PREFIX}${id}` } })
  return row ? parse(row.value, row.updatedAt) : null
}

export interface TemplateInput { name?: unknown; description?: unknown; emoji?: unknown; shared?: unknown; config?: unknown }

function clean(input: TemplateInput, fallback?: McReportTemplate) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : fallback?.name ?? ''
  return {
    name,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 240) : fallback?.description ?? '',
    emoji: typeof input.emoji === 'string' && input.emoji.trim() ? Array.from(input.emoji.trim()).slice(0, 2).join('') : fallback?.emoji ?? '📄',
    shared: typeof input.shared === 'boolean' ? input.shared : fallback?.shared ?? false,
    config: input.config !== undefined ? sanitizeConfig(input.config) : fallback?.config ?? sanitizeConfig({}),
  }
}

async function write(t: McReportTemplate) {
  const key = `${TEMPLATE_PREFIX}${t.id}`
  const value = JSON.stringify(t)
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export class TemplateError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function createTemplate(input: TemplateInput, actor: TemplateActor): Promise<McReportTemplate> {
  const c = clean(input)
  if (!c.name) throw new TemplateError('Give the template a name')
  const mine = (await listTemplates(actor)).filter(t => t.ownerId === actor.id)
  if (mine.length >= MAX_TEMPLATES_PER_USER) throw new TemplateError(`You already have ${MAX_TEMPLATES_PER_USER} templates — delete one first`)
  const t: McReportTemplate = {
    id: randomUUID(), ...c, ownerId: actor.id, ownerName: actor.name, updatedAt: new Date().toISOString(),
  }
  await write(t)
  return t
}

export async function updateTemplate(id: string, input: TemplateInput, actor: TemplateActor): Promise<McReportTemplate> {
  const existing = await getTemplate(id)
  if (!existing) throw new TemplateError('Template not found', 404)
  if (!canEdit(existing, actor)) throw new TemplateError('Only the person who made this template can change it', 403)
  const c = clean(input, existing)
  if (!c.name) throw new TemplateError('Give the template a name')
  const t: McReportTemplate = { ...existing, ...c, updatedAt: new Date().toISOString() }
  await write(t)
  return t
}

export async function deleteTemplate(id: string, actor: TemplateActor): Promise<void> {
  const existing = await getTemplate(id)
  if (!existing) throw new TemplateError('Template not found', 404)
  if (!canEdit(existing, actor)) throw new TemplateError('Only the person who made this template can delete it', 403)
  await prisma.systemSetting.delete({ where: { key: `${TEMPLATE_PREFIX}${id}` } })
}
