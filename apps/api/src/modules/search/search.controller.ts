import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { can, normalizeIdentifier, normalizeText } from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { ZodQuery } from '../../common/zod';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { TasksService } from '../tasks/tasks.service';

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });
const LIMIT = 6;

/**
 * Búsqueda global (barra superior). Solo devuelve lo que el usuario puede ver, con su alcance.
 */
@ApiTags('Búsqueda')
@Controller('search')
export class SearchController {
  constructor(
    private readonly db: Db,
    private readonly scope: RecordScopeService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @ZodQuery(searchQuery)
  async search(@CurrentUser() user: AuthUser, @Query() { q }: z.infer<typeof searchQuery>) {
    const norm = normalizeText(q);
    const ident = normalizeIdentifier(q) ?? norm;
    const org = user.organizationId;
    const [contacts, companies, products] = await Promise.all([
      can(user.permissions, 'contacts', 'view')
        ? this.scope.ownerWhere(user, 'contacts', 'view').then((w) =>
            this.db.tx.contact.findMany({
              where: { organizationId: org, deletedAt: null, ...w, searchNorm: { contains: norm } },
              select: {
                id: true,
                code: true,
                firstName: true,
                lastName: true,
                email: true,
                company: { select: { legalName: true } },
              },
              take: LIMIT,
              orderBy: { firstName: 'asc' },
            }),
          )
        : [],
      can(user.permissions, 'companies', 'view')
        ? this.scope.ownerWhere(user, 'companies', 'view').then((w) =>
            this.db.tx.company.findMany({
              where: { organizationId: org, deletedAt: null, ...w, searchNorm: { contains: norm } },
              select: { id: true, code: true, legalName: true, taxId: true },
              take: LIMIT,
              orderBy: { legalName: 'asc' },
            }),
          )
        : [],
      can(user.permissions, 'products', 'view')
        ? this.db.tx.product.findMany({
            where: {
              organizationId: org,
              deletedAt: null,
              OR: [{ nameNorm: { contains: norm } }, { skuNorm: { contains: ident } }],
            },
            select: { id: true, sku: true, name: true },
            take: LIMIT,
            orderBy: { name: 'asc' },
          })
        : [],
    ]);
    const [tasks, projects] = await Promise.all([
      can(user.permissions, 'tasks', 'view')
        ? this.tasks.where(user, {}).then((w) =>
            this.db.tx.task.findMany({
              where: { ...w, searchNorm: { contains: norm } },
              select: { id: true, code: true, title: true, status: { select: { name: true } } },
              take: LIMIT,
              orderBy: { createdAt: 'desc' },
            }),
          )
        : [],
      can(user.permissions, 'projects', 'view')
        ? this.scope.ownerWhere(user, 'projects', 'view').then((w) =>
            this.db.tx.project.findMany({
              where: {
                organizationId: org,
                deletedAt: null,
                ...w,
                OR: [{ nameNorm: { contains: norm } }, { code: { contains: q.toUpperCase() } }],
              },
              select: { id: true, code: true, name: true },
              take: LIMIT,
              orderBy: { createdAt: 'desc' },
            }),
          )
        : [],
    ]);
    const [leads, deals] = await Promise.all([
      can(user.permissions, 'leads', 'view')
        ? this.scope.ownerWhere(user, 'leads', 'view').then((w) =>
            this.db.tx.lead.findMany({
              where: { organizationId: org, deletedAt: null, ...w, searchNorm: { contains: norm } },
              select: { id: true, code: true, title: true, stage: { select: { name: true } } },
              take: LIMIT,
              orderBy: { createdAt: 'desc' },
            }),
          )
        : [],
      can(user.permissions, 'deals', 'view')
        ? this.scope.ownerWhere(user, 'deals', 'view').then((w) =>
            this.db.tx.deal.findMany({
              where: { organizationId: org, deletedAt: null, ...w, searchNorm: { contains: norm } },
              select: { id: true, code: true, title: true, stage: { select: { name: true } } },
              take: LIMIT,
              orderBy: { createdAt: 'desc' },
            }),
          )
        : [],
    ]);
    return {
      leads: leads.map((l) => ({
        id: l.id,
        title: l.title,
        subtitle: `${l.code} · ${l.stage.name}`,
      })),
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        subtitle: `${d.code} · ${d.stage.name}`,
      })),
      contacts: contacts.map((c) => ({
        id: c.id,
        title: [c.firstName, c.lastName].filter(Boolean).join(' '),
        subtitle: [c.code, c.company?.legalName, c.email].filter(Boolean).join(' · '),
      })),
      companies: companies.map((c) => ({
        id: c.id,
        title: c.legalName,
        subtitle: [c.code, c.taxId].filter(Boolean).join(' · '),
      })),
      products: products.map((p) => ({ id: p.id, title: p.name, subtitle: p.sku })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: `${t.code} · ${t.status.name}`,
      })),
      projects: projects.map((p) => ({ id: p.id, title: p.name, subtitle: p.code })),
    };
  }
}
