import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'
import { STARTER_TEMPLATES } from '@/lib/mailbox/starter-templates'

export const dynamic = 'force-dynamic'

/**
 * Installs (or restores) the built-in templates. Upsert by `code`, so this is
 * both the first-run action and the way back from an edit that went wrong.
 * Nothing else in the table is touched — templates the desk wrote itself are
 * left exactly as they are.
 */
export async function POST() {
  const gate = await requireMailbox('manage')
  if ('error' in gate) return gate.error

  let created = 0
  let restored = 0

  for (const t of STARTER_TEMPLATES) {
    const existing = await prisma.mailTemplate.findUnique({ where: { code: t.code } })
    if (existing) {
      await prisma.mailTemplate.update({
        where: { code: t.code },
        data: {
          name: t.name, description: t.description, category: t.category,
          audience: t.audience, subject: t.subject, bodyHtml: t.bodyHtml,
          attachPdf: t.attachPdf, sortOrder: t.sortOrder, isActive: true,
          updatedBy: gate.actor.email,
        },
      })
      restored++
    } else {
      await prisma.mailTemplate.create({
        data: { ...t, isActive: true, createdBy: gate.actor.email, updatedBy: gate.actor.email },
      })
      created++
    }
  }

  return buildApiSuccess({ created, restored },
    `${created} template${created === 1 ? '' : 's'} added, ${restored} restored to the built-in version.`)
}
