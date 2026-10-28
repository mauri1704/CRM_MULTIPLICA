import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACTIVITY_TYPE_LABELS, type ActivityType, type ReportFilter } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { Db } from '../../infra/db';
import { dateOnly, limaDay, ownerWhere, type ReportContext } from './report-context';
import { ReportsContextService, dealAmount } from './reports.service';

const ZERO = new Prisma.Decimal(0);
const CLOSED_TASK = ['DONE', 'CANCELED'];
const dayMs = 86_400_000;

/** Lunes de la semana de una fecha aaaa-mm-dd (día calendario, sin zona horaria). */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * dayMs).toISOString().slice(0, 10);
}
const fmt = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Dashboard comercial (sección 3 de la definición): datos reales, con alcance y moneda elegida. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: Db,
    private readonly ctxs: ReportsContextService,
  ) {}

  private buckets(ctx: ReportContext) {
    const from = ctx.fromDay!;
    const to = ctx.toDay!;
    const days =
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / dayMs + 1;
    const monthly = days > 120;
    const keyOf = (day: string) => (monthly ? day.slice(0, 7) : weekStart(day));
    const order: string[] = [];
    for (
      let t = new Date(`${from}T00:00:00Z`).getTime();
      t <= new Date(`${to}T00:00:00Z`).getTime();
      t += dayMs
    ) {
      const k = keyOf(new Date(t).toISOString().slice(0, 10));
      if (order[order.length - 1] !== k) order.push(k);
    }
    const label = (k: string) => (monthly ? `${k.slice(5, 7)}/${k.slice(0, 4)}` : fmt(k));
    return { keyOf, order, label, monthly };
  }

  async get(user: AuthUser, filter: ReportFilter) {
    const ctx = await this.ctxs.context(user, 'dashboard', filter);
    const org = this.db.organizationId;
    const own = ownerWhere(ctx);
    const created = this.ctxs.range(ctx);
    const closed = this.ctxs.dayRange(ctx);
    const leadScope = {
      organizationId: org,
      deletedAt: null,
      ...own,
      ...(ctx.leadPipelineId ? { pipelineId: ctx.leadPipelineId } : {}),
    };
    const dealScope = {
      organizationId: org,
      deletedAt: null,
      ...own,
      ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
    };
    const taskScope = {
      organizationId: org,
      deletedAt: null,
      ...(ctx.ownerIds === null ? {} : { responsibleId: { in: ctx.ownerIds } }),
      status: { category: { notIn: CLOSED_TASK } },
    };
    const dealSel = {
      id: true,
      ownerId: true,
      currencyCode: true,
      total: true,
      estimatedValue: true,
      finalValue: true,
      status: true,
      closedAt: true,
    } as const;

    const [
      activeLeads,
      newLeads,
      openDeals,
      closedDeals,
      pendingTasks,
      overdueTasks,
      activeByOwner,
      newLeadRows,
    ] = await Promise.all([
      this.db.tx.lead.count({ where: { ...leadScope, stage: { kind: 'OPEN' } } }),
      this.db.tx.lead.count({
        where: { ...leadScope, ...(created ? { createdAt: created } : {}) },
      }),
      this.db.tx.deal.findMany({
        where: { ...dealScope, status: 'OPEN' },
        select: dealSel,
        take: 20_000,
      }),
      this.db.tx.deal.findMany({
        where: {
          ...dealScope,
          status: { in: ['WON', 'LOST'] },
          ...(closed ? { closedAt: closed } : {}),
        },
        select: dealSel,
        take: 20_000,
      }),
      this.db.tx.task.count({ where: taskScope }),
      this.db.tx.task.count({ where: { ...taskScope, dueAt: { lt: ctx.now } } }),
      this.db.tx.lead.groupBy({
        by: ['ownerId'],
        where: { ...leadScope, stage: { kind: 'OPEN' } },
        _count: { _all: true },
      }),
      this.db.tx.lead.findMany({
        where: { ...leadScope, ...(created ? { createdAt: created } : {}) },
        select: { createdAt: true },
        take: 20_000,
      }),
    ]);

    // Importes consolidados en la moneda elegida.
    let pipelineValue = ZERO;
    let closedSales = ZERO;
    type Owner = {
      openDeals: number;
      pipelineValue: Prisma.Decimal;
      activeLeads: number;
      wonValue: Prisma.Decimal;
      won: number;
    };
    const owners = new Map<string, Owner>();
    const owner = (id: string | null) => {
      const k = id ?? '';
      const e = owners.get(k) ?? {
        openDeals: 0,
        pipelineValue: ZERO,
        activeLeads: 0,
        wonValue: ZERO,
        won: 0,
      };
      owners.set(k, e);
      return e;
    };
    for (const d of openDeals) {
      const v = await ctx.money.convert(dealAmount(d), d.currencyCode, null, d.id);
      const e = owner(d.ownerId);
      e.openDeals++;
      if (v) {
        pipelineValue = pipelineValue.plus(v);
        e.pipelineValue = e.pipelineValue.plus(v);
      }
    }
    let wonDeals = 0;
    let lostDeals = 0;
    const buckets = this.buckets(
      ctx.fromDay
        ? ctx
        : {
            ...ctx,
            fromDay: limaDay(new Date(Date.now() - 29 * dayMs)),
            toDay: limaDay(new Date()),
          },
    );
    const evo = new Map(
      buckets.order.map((k) => [
        k,
        {
          key: k,
          label: buckets.label(k),
          leadsCreated: 0,
          dealsWon: 0,
          dealsLost: 0,
          wonValue: ZERO,
        },
      ]),
    );
    for (const d of closedDeals) {
      const day = d.closedAt ? dateOnly(d.closedAt) : null;
      const bucket = day ? evo.get(buckets.keyOf(day)) : undefined;
      if (d.status === 'WON') {
        wonDeals++;
        const v = await ctx.money.convert(dealAmount(d), d.currencyCode, day, d.id);
        const e = owner(d.ownerId);
        e.won++;
        if (v) {
          closedSales = closedSales.plus(v);
          e.wonValue = e.wonValue.plus(v);
          if (bucket) bucket.wonValue = bucket.wonValue.plus(v);
        }
        if (bucket) bucket.dealsWon++;
      } else {
        lostDeals++;
        if (bucket) bucket.dealsLost++;
      }
    }
    for (const l of newLeadRows) {
      const bucket = evo.get(buckets.keyOf(limaDay(l.createdAt)));
      if (bucket) bucket.leadsCreated++;
    }
    for (const g of activeByOwner) owner(g.ownerId).activeLeads = g._count._all;

    const names = new Map(
      (
        await this.db.q.user.findMany({
          where: { organizationId: org, id: { in: [...owners.keys()].filter(Boolean) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const distribution = [...owners.entries()]
      .map(([id, e]) => ({
        owner: id ? (names.get(id) ?? '—') : 'Sin responsable',
        activeLeads: e.activeLeads,
        openDeals: e.openDeals,
        pipelineValue: ctx.money.round(e.pipelineValue),
        won: e.won,
        wonValue: ctx.money.round(e.wonValue),
      }))
      .sort((a, b) => b.pipelineValue - a.pipelineValue || b.activeLeads - a.activeLeads);

    return {
      meta: this.ctxs.meta(ctx, {
        note: 'Prospectos activos, negociaciones abiertas, pipeline y tareas son el estado de hoy; nuevos, ganadas, perdidas y ventas cerradas corresponden al rango de fechas.',
      }),
      kpis: {
        activeLeads,
        newLeads,
        openDeals: openDeals.length,
        wonDeals,
        lostDeals,
        pipelineValue: ctx.money.round(pipelineValue),
        closedSales: ctx.money.round(closedSales),
        pendingTasks,
        overdueTasks,
      },
      ownerDistribution: distribution,
      evolution: [...evo.values()].map((e) => ({ ...e, wonValue: ctx.money.round(e.wonValue) })),
      evolutionUnit: buckets.monthly ? 'month' : 'week',
      recentActivity: await this.recent(ctx),
    };
  }

  /** Últimos movimientos comerciales de las personas dentro del alcance. */
  private async recent(ctx: ReportContext) {
    const org = this.db.organizationId;
    const actor = ctx.ownerIds === null ? {} : { in: ctx.ownerIds };
    const [history, activities] = await Promise.all([
      this.db.tx.recordHistory.findMany({
        where: {
          organizationId: org,
          OR: [
            { entityType: { in: ['LEAD', 'DEAL'] }, action: { in: ['CREATE', 'STAGE_CHANGE'] } },
            { entityType: 'LEAD', action: 'CONVERT' },
          ],
          ...(ctx.ownerIds === null ? {} : { userId: actor }),
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.tx.activity.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          ...(ctx.ownerIds === null ? {} : { authorId: actor }),
        },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
    ]);
    const leadIds = [
      ...new Set([
        ...history.filter((h) => h.entityType === 'LEAD').map((h) => h.entityId),
        ...activities.map((a) => a.leadId).filter((x): x is string => !!x),
      ]),
    ];
    const dealIds = [
      ...new Set([
        ...history.filter((h) => h.entityType === 'DEAL').map((h) => h.entityId),
        ...activities.map((a) => a.dealId).filter((x): x is string => !!x),
      ]),
    ];
    const contactIds = [
      ...new Set(activities.map((a) => a.contactId).filter((x): x is string => !!x)),
    ];
    const companyIds = [
      ...new Set(activities.map((a) => a.companyId).filter((x): x is string => !!x)),
    ];
    const where = (ids: string[]) => ({ organizationId: org, id: { in: ids } });
    const [leads, deals, contacts, companies, users] = await Promise.all([
      this.db.tx.lead.findMany({ where: where(leadIds), select: { id: true, title: true } }),
      this.db.tx.deal.findMany({ where: where(dealIds), select: { id: true, title: true } }),
      this.db.tx.contact.findMany({
        where: where(contactIds),
        select: { id: true, firstName: true, lastName: true },
      }),
      this.db.tx.company.findMany({
        where: where(companyIds),
        select: { id: true, legalName: true },
      }),
      this.db.q.user.findMany({
        where: {
          organizationId: org,
          id: {
            in: [
              ...new Set(
                [...history.map((h) => h.userId), ...activities.map((a) => a.authorId)].filter(
                  (x): x is string => !!x,
                ),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      }),
    ]);
    const title = new Map<string, string>([
      ...leads.map((l) => [l.id, l.title] as const),
      ...deals.map((d) => [d.id, d.title] as const),
      ...contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')] as const),
      ...companies.map((c) => [c.id, c.legalName] as const),
    ]);
    const who = new Map(users.map((u) => [u.id, u.name]));
    type Item = {
      at: string;
      who: string;
      text: string;
      link: { type: 'LEAD' | 'DEAL' | 'CONTACT' | 'COMPANY'; id: string } | null;
    };
    const items: Item[] = [];
    for (const h of history) {
      const t = title.get(h.entityId) ?? 'un registro';
      const kind = h.entityType === 'LEAD' ? 'prospecto' : 'negociación';
      const stage = (h.changes as { stage?: { from?: string; to?: string } } | null)?.stage;
      const text =
        h.action === 'CREATE'
          ? `creó el ${kind} «${t}»`
          : h.action === 'CONVERT'
            ? `convirtió el prospecto «${t}» en negociación`
            : `movió «${t}» de ${stage?.from ?? '—'} a ${stage?.to ?? '—'}`;
      items.push({
        at: h.createdAt.toISOString(),
        who: h.userId ? (who.get(h.userId) ?? '—') : 'Sistema',
        text,
        link: { type: h.entityType === 'LEAD' ? 'LEAD' : 'DEAL', id: h.entityId },
      });
    }
    for (const a of activities) {
      const target = a.leadId ?? a.dealId ?? a.contactId ?? a.companyId;
      const link = a.leadId
        ? ({ type: 'LEAD', id: a.leadId } as const)
        : a.dealId
          ? ({ type: 'DEAL', id: a.dealId } as const)
          : a.contactId
            ? ({ type: 'CONTACT', id: a.contactId } as const)
            : a.companyId
              ? ({ type: 'COMPANY', id: a.companyId } as const)
              : null;
      items.push({
        at: a.occurredAt.toISOString(),
        who: who.get(a.authorId) ?? '—',
        text: `registró ${ACTIVITY_TYPE_LABELS[a.type as ActivityType].toLowerCase()}: ${a.subject}${target && title.get(target) ? ` (${title.get(target)})` : ''}`,
        link,
      });
    }
    return items.sort((x, y) => y.at.localeCompare(x.at)).slice(0, 15);
  }
}
