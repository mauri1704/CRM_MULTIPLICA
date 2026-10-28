import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  REPORT_INFO,
  can,
  type ReportCell,
  type ReportColumn,
  type ReportFilter,
  type ReportKey,
  type ReportMeta,
  type ReportResult,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { DuplicatesService } from '../duplicates/duplicates.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { TrashService } from '../trash/trash.service';
import {
  MoneyConverter,
  dateOnly,
  intersect,
  limaDay,
  limaEnd,
  limaStart,
  ownerWhere,
  todayLima,
  type ReportContext,
} from './report-context';

const ROWS = 20_000;
const ZERO = new Prisma.Decimal(0);
const CLOSED_TASK = ['DONE', 'CANCELED'];
const KIND_LABEL: Record<string, string> = {
  OPEN: 'Abierta',
  WON: 'Ganada',
  LOST: 'Perdida',
  CONVERTED: 'Convertida',
};
const ENTITY_LABEL: Record<string, string> = {
  LEAD: 'Prospectos',
  DEAL: 'Negociaciones',
  CONTACT: 'Contactos',
  COMPANY: 'Compañías',
  PRODUCT: 'Productos',
  TASK: 'Tareas',
  PROJECT: 'Proyectos',
  TEAM: 'Equipos',
};
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const dateTime = (d: Date | null) =>
  d
    ? `${limaDay(d)} ${d.toLocaleTimeString('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' })}`
    : null;

const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({
  key,
  label,
  type,
});

/** Importe de un prospecto: el total de sus productos o, si no tiene, el valor estimado. */
export const leadAmount = (l: { total: Prisma.Decimal; estimatedValue: Prisma.Decimal | null }) =>
  l.total.gt(0) ? l.total : (l.estimatedValue ?? ZERO);
/** Importe de una negociación: valor final si se ganó; si no, el total de sus productos o el estimado. */
export const dealAmount = (d: {
  status: string;
  finalValue: Prisma.Decimal | null;
  total: Prisma.Decimal;
  estimatedValue: Prisma.Decimal | null;
}) =>
  d.status === 'WON' && d.finalValue
    ? d.finalValue
    : d.total.gt(0)
      ? d.total
      : (d.estimatedValue ?? ZERO);

/**
 * Contexto común de reportes y dashboard: alcance del usuario (propios / equipo / todos) más los
 * filtros de equipo y responsable, rango de fechas en hora de Lima y consolidación multimoneda.
 */
@Injectable()
export class ReportsContextService {
  constructor(
    private readonly db: Db,
    private readonly scope: RecordScopeService,
    private readonly currencies: CurrenciesService,
    private readonly rates: ExchangeRatesService,
  ) {}

  async context(
    user: AuthUser,
    module: 'reports' | 'dashboard',
    filter: ReportFilter,
  ): Promise<ReportContext> {
    const org = user.organizationId;
    const base = (await this.db.q.organization.findUniqueOrThrow({ where: { id: org } }))
      .baseCurrencyCode;
    const currency = filter.currency ?? base;
    const cur = await this.currencies.findByCode(currency);
    if (!cur) throw validationError({ currency: 'La moneda no existe.' });

    let teamIds: string[] | null = null;
    if (filter.teamId) {
      const team = await this.db.tx.team.findFirst({
        where: { id: filter.teamId, organizationId: org },
      });
      if (!team) throw notFound('El equipo');
      const members = await this.db.tx.teamMember.findMany({
        where: { organizationId: org, teamId: team.id },
        select: { userId: true },
      });
      teamIds = [
        ...new Set([
          ...members.map((m) => m.userId),
          ...(team.supervisorId ? [team.supervisorId] : []),
        ]),
      ];
    }
    const ownerIds = intersect(
      intersect(await this.scope.ownerIds(user, module, 'view'), teamIds),
      filter.ownerId ? [filter.ownerId] : null,
    );

    let leadPipelineId: string | null = null;
    let dealPipelineId: string | null = null;
    if (filter.pipelineId) {
      const p = await this.db.tx.pipeline.findFirst({
        where: { id: filter.pipelineId, organizationId: org },
      });
      if (!p) throw notFound('El pipeline');
      if (p.entityType === 'LEAD') leadPipelineId = p.id;
      else dealPipelineId = p.id;
    }

    const today = todayLima();
    const cutoff = filter.to && filter.to < today ? filter.to : today;
    return {
      filter,
      from: filter.from ? limaStart(filter.from) : null,
      to: filter.to ? limaEnd(filter.to) : null,
      fromDay: filter.from ?? null,
      toDay: filter.to ?? null,
      ownerIds,
      leadPipelineId,
      dealPipelineId,
      money: new MoneyConverter(this.rates, currency, cur.decimals, filter.criterion, cutoff),
      now: new Date(),
    };
  }

  meta(ctx: ReportContext, extra: { note?: string; truncated?: boolean } = {}): ReportMeta {
    return {
      currency: ctx.money.target,
      criterion: ctx.money.criterion,
      cutoffDate: ctx.money.cutoff,
      from: ctx.fromDay,
      to: ctx.toDay,
      excluded: ctx.money.excludedList(),
      truncated: extra.truncated ?? false,
      note: extra.note ?? null,
    };
  }

  /** Rango en una columna de fecha con hora. */
  range(ctx: ReportContext): { gte?: Date; lte?: Date } | undefined {
    if (!ctx.from && !ctx.to) return undefined;
    return { ...(ctx.from ? { gte: ctx.from } : {}), ...(ctx.to ? { lte: ctx.to } : {}) };
  }

  /** Rango en una columna `date` (cierre de negociaciones). */
  dayRange(ctx: ReportContext): { gte?: Date; lte?: Date } | undefined {
    if (!ctx.fromDay && !ctx.toDay) return undefined;
    return {
      ...(ctx.fromDay ? { gte: new Date(`${ctx.fromDay}T00:00:00.000Z`) } : {}),
      ...(ctx.toDay ? { lte: new Date(`${ctx.toDay}T00:00:00.000Z`) } : {}),
    };
  }
}

/** Los 13 reportes (sección 16 de la definición). Cada uno respeta el alcance del usuario. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly ctxs: ReportsContextService,
    private readonly duplicates: DuplicatesService,
    private readonly trash: TrashService,
  ) {}

  async run(user: AuthUser, key: ReportKey, filter: ReportFilter): Promise<ReportResult> {
    if (!(key in REPORT_INFO)) throw notFound('El reporte');
    const ctx = await this.ctxs.context(user, 'reports', filter);
    const result = await this.build(user, key, ctx);
    return { ...result, title: REPORT_INFO[key].title, key };
  }

  private build(
    user: AuthUser,
    key: ReportKey,
    ctx: ReportContext,
  ): Promise<Omit<ReportResult, 'title' | 'key'>> {
    switch (key) {
      case 'leads-by-stage':
        return this.byStage(ctx, 'LEAD');
      case 'deals-by-stage':
        return this.byStage(ctx, 'DEAL');
      case 'lead-conversion':
        return this.leadConversion(ctx);
      case 'won-sales':
        return this.closedDeals(ctx, 'WON');
      case 'lost-sales':
        return this.closedDeals(ctx, 'LOST');
      case 'loss-reasons':
        return this.lossReasons(ctx);
      case 'owner-performance':
        return this.ownerPerformance(ctx);
      case 'pending-tasks':
        return this.tasks(ctx, false);
      case 'overdue-tasks':
        return this.tasks(ctx, true);
      case 'products-sold':
        return this.productsSold(ctx);
      case 'pipeline-value':
        return this.pipelineValue(ctx);
      case 'duplicates':
        return this.duplicatesReport(user, ctx);
      case 'trash':
        return this.trashReport(user, ctx);
    }
  }

  private async userNames(ids: string[]) {
    const users = await this.db.q.user.findMany({
      where: { organizationId: this.db.organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  // --- Prospectos / negociaciones por etapa -----------------------------------------------------

  private async byStage(ctx: ReportContext, kind: 'LEAD' | 'DEAL') {
    const org = this.db.organizationId;
    const pipelineId = kind === 'LEAD' ? ctx.leadPipelineId : ctx.dealPipelineId;
    const stages = await this.db.tx.stage.findMany({
      where: {
        organizationId: org,
        active: true,
        pipeline: { entityType: kind, active: true, ...(pipelineId ? { id: pipelineId } : {}) },
      },
      include: { pipeline: { select: { name: true } } },
      orderBy: [{ pipelineId: 'asc' }, { position: 'asc' }],
    });
    const where = {
      organizationId: org,
      deletedAt: null,
      ...ownerWhere(ctx),
      ...(pipelineId ? { pipelineId } : {}),
    };
    const created = this.ctxs.range(ctx);
    type Row = {
      stageId: string;
      currencyCode: string;
      amount: Prisma.Decimal;
      id: string;
      date: string | null;
    };
    const rows: Row[] =
      kind === 'LEAD'
        ? (
            await this.db.tx.lead.findMany({
              where: { ...where, ...(created ? { createdAt: created } : {}) },
              select: {
                id: true,
                stageId: true,
                currencyCode: true,
                total: true,
                estimatedValue: true,
              },
              take: ROWS + 1,
            })
          ).map((l) => ({
            id: l.id,
            stageId: l.stageId,
            currencyCode: l.currencyCode,
            amount: leadAmount(l),
            date: null,
          }))
        : (
            await this.db.tx.deal.findMany({
              where: { ...where, ...(created ? { createdAt: created } : {}) },
              select: {
                id: true,
                stageId: true,
                currencyCode: true,
                total: true,
                estimatedValue: true,
                finalValue: true,
                status: true,
                closedAt: true,
              },
              take: ROWS + 1,
            })
          ).map((d) => ({
            id: d.id,
            stageId: d.stageId,
            currencyCode: d.currencyCode,
            amount: dealAmount(d),
            date: d.closedAt ? dateOnly(d.closedAt) : null,
          }));
    const truncated = rows.length > ROWS;
    const count = new Map<string, number>();
    const value = new Map<string, Prisma.Decimal>();
    for (const r of rows.slice(0, ROWS)) {
      const v = await ctx.money.convert(r.amount, r.currencyCode, r.date, r.id);
      count.set(r.stageId, (count.get(r.stageId) ?? 0) + 1);
      if (v) value.set(r.stageId, (value.get(r.stageId) ?? ZERO).plus(v));
    }
    const total = [...count.values()].reduce((a, b) => a + b, 0);
    const out = stages.map((s) => ({
      pipeline: s.pipeline.name,
      stage: s.name,
      kind: KIND_LABEL[s.kind] ?? s.kind,
      count: count.get(s.id) ?? 0,
      value: ctx.money.round(value.get(s.id) ?? ZERO),
      share: pct(count.get(s.id) ?? 0, total),
    }));
    return {
      meta: this.ctxs.meta(ctx, {
        truncated,
        note: created ? 'Se cuentan los registros creados en el período.' : undefined,
      }),
      columns: [
        col('pipeline', 'Pipeline'),
        col('stage', 'Etapa'),
        col('kind', 'Tipo de etapa'),
        col('count', kind === 'LEAD' ? 'Prospectos' : 'Negociaciones', 'number'),
        col('value', 'Importe', 'money'),
        col('share', '% del total', 'percent'),
      ],
      rows: out,
      totals: {
        stage: 'Total',
        count: total,
        value: ctx.money.round([...value.values()].reduce((a, b) => a.plus(b), ZERO)),
        share: total ? 100 : null,
      },
      chart: {
        type: 'bar' as const,
        x: 'stage',
        series: [{ key: 'count', label: kind === 'LEAD' ? 'Prospectos' : 'Negociaciones' }],
        data: out,
      },
    };
  }

  // --- Conversión -------------------------------------------------------------------------------

  private async leadConversion(ctx: ReportContext) {
    const range = this.ctxs.range(ctx);
    const leads = await this.db.tx.lead.findMany({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        ...ownerWhere(ctx),
        ...(ctx.leadPipelineId ? { pipelineId: ctx.leadPipelineId } : {}),
        ...(range ? { createdAt: range } : {}),
      },
      select: {
        ownerId: true,
        createdAt: true,
        convertedAt: true,
        stage: { select: { kind: true } },
      },
      take: ROWS + 1,
    });
    const names = await this.userNames([
      ...new Set(leads.map((l) => l.ownerId).filter((x): x is string => !!x)),
    ]);
    const by = new Map<
      string,
      { created: number; converted: number; lost: number; days: number }
    >();
    for (const l of leads.slice(0, ROWS)) {
      const k = l.ownerId ?? '';
      const e = by.get(k) ?? { created: 0, converted: 0, lost: 0, days: 0 };
      e.created++;
      if (l.convertedAt) {
        e.converted++;
        e.days += (l.convertedAt.getTime() - l.createdAt.getTime()) / 86_400_000;
      } else if (l.stage.kind === 'LOST') e.lost++;
      by.set(k, e);
    }
    const mk = (
      name: string,
      e: { created: number; converted: number; lost: number; days: number },
    ) => ({
      owner: name,
      created: e.created,
      converted: e.converted,
      lost: e.lost,
      open: e.created - e.converted - e.lost,
      rate: pct(e.converted, e.created),
      avgDays: e.converted ? Math.round((e.days / e.converted) * 10) / 10 : null,
    });
    const rows = [...by.entries()]
      .map(([id, e]) => mk(id ? (names.get(id) ?? '—') : 'Sin responsable', e))
      .sort((a, b) => b.created - a.created);
    const sum = [...by.values()].reduce(
      (a, e) => ({
        created: a.created + e.created,
        converted: a.converted + e.converted,
        lost: a.lost + e.lost,
        days: a.days + e.days,
      }),
      { created: 0, converted: 0, lost: 0, days: 0 },
    );
    return {
      meta: this.ctxs.meta(ctx, {
        truncated: leads.length > ROWS,
        note: 'Criterio: de los prospectos creados en el período, cuántos figuran hoy como convertidos en negociación (conversión = convertidos ÷ creados).',
      }),
      columns: [
        col('owner', 'Responsable'),
        col('created', 'Creados', 'number'),
        col('converted', 'Convertidos', 'number'),
        col('lost', 'Descartados', 'number'),
        col('open', 'En curso', 'number'),
        col('rate', 'Conversión', 'percent'),
        col('avgDays', 'Días promedio a convertir', 'number'),
      ],
      rows,
      totals: mk('Total', sum),
      chart: {
        type: 'bar' as const,
        x: 'owner',
        series: [
          { key: 'created', label: 'Creados' },
          { key: 'converted', label: 'Convertidos' },
        ],
        data: rows,
      },
    };
  }

  // --- Ventas ganadas / perdidas ----------------------------------------------------------------

  private async closedDeals(ctx: ReportContext, status: 'WON' | 'LOST') {
    const closed = this.ctxs.dayRange(ctx);
    const deals = await this.db.tx.deal.findMany({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        status,
        ...ownerWhere(ctx),
        ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
        ...(closed ? { closedAt: closed } : {}),
      },
      include: {
        company: { select: { legalName: true } },
        owner: { select: { name: true } },
        lossReason: { select: { name: true } },
      },
      orderBy: { closedAt: 'desc' },
      take: ROWS + 1,
    });
    const rows: Record<string, ReportCell>[] = [];
    let total = ZERO;
    for (const d of deals.slice(0, ROWS)) {
      const orig = dealAmount(d);
      const v = await ctx.money.convert(
        orig,
        d.currencyCode,
        d.closedAt ? dateOnly(d.closedAt) : null,
        d.id,
      );
      if (v) total = total.plus(v);
      rows.push({
        code: d.code,
        title: d.title,
        company: d.company?.legalName ?? null,
        owner: d.owner?.name ?? null,
        closedAt: d.closedAt ? dateOnly(d.closedAt) : null,
        ...(status === 'LOST' ? { reason: d.lossReason?.name ?? null } : {}),
        currency: d.currencyCode,
        original: orig.toNumber(),
        amount: v ? ctx.money.round(v) : null,
      });
    }
    const byOwner = new Map<string, number>();
    for (const r of rows)
      byOwner.set(
        String(r.owner ?? 'Sin responsable'),
        (byOwner.get(String(r.owner ?? 'Sin responsable')) ?? 0) + Number(r.amount ?? 0),
      );
    const chart = [...byOwner.entries()]
      .map(([owner, amount]) => ({ owner, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);
    return {
      meta: this.ctxs.meta(ctx, {
        truncated: deals.length > ROWS,
        note:
          status === 'WON'
            ? 'Se listan las negociaciones cuyo cierre cae en el período, con su valor final.'
            : 'Se listan las negociaciones perdidas con cierre en el período; el importe es el de sus productos o su valor estimado.',
      }),
      columns: [
        col('code', 'Código'),
        col('title', 'Negociación'),
        col('company', 'Compañía'),
        col('owner', 'Responsable'),
        col('closedAt', 'Cierre', 'date'),
        ...(status === 'LOST' ? [col('reason', 'Motivo de pérdida')] : []),
        col('currency', 'Moneda'),
        col('original', 'Importe original', 'number'),
        col('amount', `Importe en ${ctx.money.target}`, 'money'),
      ],
      rows,
      totals: {
        title: 'Total',
        amount: ctx.money.round(total),
        code: String(rows.length) + ' negociaciones',
      },
      chart: {
        type: 'bar' as const,
        x: 'owner',
        series: [{ key: 'amount', label: `Importe (${ctx.money.target})` }],
        data: chart,
      },
    };
  }

  private async lossReasons(ctx: ReportContext) {
    const org = this.db.organizationId;
    const range = this.ctxs.range(ctx);
    const closed = this.ctxs.dayRange(ctx);
    const [leads, deals] = await Promise.all([
      this.db.tx.lead.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          stage: { kind: 'LOST' },
          ...ownerWhere(ctx),
          ...(ctx.leadPipelineId ? { pipelineId: ctx.leadPipelineId } : {}),
          ...(range ? { stageChangedAt: range } : {}),
        },
        select: { lossReason: { select: { name: true } } },
        take: ROWS,
      }),
      this.db.tx.deal.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          status: 'LOST',
          ...ownerWhere(ctx),
          ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
          ...(closed ? { closedAt: closed } : {}),
        },
        select: {
          id: true,
          currencyCode: true,
          closedAt: true,
          total: true,
          estimatedValue: true,
          finalValue: true,
          status: true,
          lossReason: { select: { name: true } },
        },
        take: ROWS,
      }),
    ]);
    const by = new Map<string, { leads: number; deals: number; value: Prisma.Decimal }>();
    const get = (name: string) => by.get(name) ?? { leads: 0, deals: 0, value: ZERO };
    for (const l of leads) {
      const n = l.lossReason?.name ?? 'Sin motivo';
      const e = get(n);
      e.leads++;
      by.set(n, e);
    }
    for (const d of deals) {
      const n = d.lossReason?.name ?? 'Sin motivo';
      const e = get(n);
      e.deals++;
      const v = await ctx.money.convert(
        dealAmount(d),
        d.currencyCode,
        d.closedAt ? dateOnly(d.closedAt) : null,
        d.id,
      );
      if (v) e.value = e.value.plus(v);
      by.set(n, e);
    }
    const rows = [...by.entries()]
      .map(([reason, e]) => ({
        reason,
        leads: e.leads,
        deals: e.deals,
        total: e.leads + e.deals,
        value: ctx.money.round(e.value),
      }))
      .sort((a, b) => b.total - a.total);
    return {
      meta: this.ctxs.meta(ctx, {
        note: 'Prospectos descartados y negociaciones perdidas en el período, por motivo.',
      }),
      columns: [
        col('reason', 'Motivo'),
        col('leads', 'Prospectos', 'number'),
        col('deals', 'Negociaciones', 'number'),
        col('total', 'Total', 'number'),
        col('value', 'Importe perdido', 'money'),
      ],
      rows,
      totals: {
        reason: 'Total',
        leads: rows.reduce((a, r) => a + r.leads, 0),
        deals: rows.reduce((a, r) => a + r.deals, 0),
        total: rows.reduce((a, r) => a + r.total, 0),
        value: Math.round(rows.reduce((a, r) => a + r.value, 0) * 100) / 100,
      },
      chart: {
        type: 'pie' as const,
        x: 'reason',
        series: [{ key: 'total', label: 'Casos' }],
        data: rows,
      },
    };
  }

  // --- Desempeño --------------------------------------------------------------------------------

  private async ownerPerformance(ctx: ReportContext) {
    const org = this.db.organizationId;
    const range = this.ctxs.range(ctx);
    const closed = this.ctxs.dayRange(ctx);
    const own = ownerWhere(ctx);
    const [leads, won, lost, open, doneTasks, overdue] = await Promise.all([
      this.db.tx.lead.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          ...own,
          ...(ctx.leadPipelineId ? { pipelineId: ctx.leadPipelineId } : {}),
          ...(range ? { createdAt: range } : {}),
        },
        select: { ownerId: true, convertedAt: true },
        take: ROWS,
      }),
      this.db.tx.deal.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          status: 'WON',
          ...own,
          ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
          ...(closed ? { closedAt: closed } : {}),
        },
        select: {
          id: true,
          ownerId: true,
          currencyCode: true,
          closedAt: true,
          total: true,
          estimatedValue: true,
          finalValue: true,
          status: true,
        },
        take: ROWS,
      }),
      this.db.tx.deal.groupBy({
        by: ['ownerId'],
        where: {
          organizationId: org,
          deletedAt: null,
          status: 'LOST',
          ...own,
          ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
          ...(closed ? { closedAt: closed } : {}),
        },
        _count: { _all: true },
      }),
      this.db.tx.deal.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
          status: 'OPEN',
          ...own,
          ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
        },
        select: {
          id: true,
          ownerId: true,
          currencyCode: true,
          total: true,
          estimatedValue: true,
          finalValue: true,
          status: true,
        },
        take: ROWS,
      }),
      this.db.tx.task.groupBy({
        by: ['responsibleId'],
        where: {
          organizationId: org,
          deletedAt: null,
          ...(ctx.ownerIds === null ? {} : { responsibleId: { in: ctx.ownerIds } }),
          completedAt: { not: null, ...(range ?? {}) },
        },
        _count: { _all: true },
      }),
      this.db.tx.task.groupBy({
        by: ['responsibleId'],
        where: {
          organizationId: org,
          deletedAt: null,
          ...(ctx.ownerIds === null ? {} : { responsibleId: { in: ctx.ownerIds } }),
          status: { category: { notIn: CLOSED_TASK } },
          dueAt: { lt: ctx.now },
        },
        _count: { _all: true },
      }),
    ]);
    type Acc = {
      leads: number;
      converted: number;
      won: number;
      wonValue: Prisma.Decimal;
      lost: number;
      open: number;
      openValue: Prisma.Decimal;
      done: number;
      overdue: number;
    };
    const by = new Map<string, Acc>();
    const acc = (id: string | null) => {
      const k = id ?? '';
      const e = by.get(k) ?? {
        leads: 0,
        converted: 0,
        won: 0,
        wonValue: ZERO,
        lost: 0,
        open: 0,
        openValue: ZERO,
        done: 0,
        overdue: 0,
      };
      by.set(k, e);
      return e;
    };
    for (const l of leads) {
      const e = acc(l.ownerId);
      e.leads++;
      if (l.convertedAt) e.converted++;
    }
    for (const d of won) {
      const e = acc(d.ownerId);
      e.won++;
      const v = await ctx.money.convert(
        dealAmount(d),
        d.currencyCode,
        d.closedAt ? dateOnly(d.closedAt) : null,
        d.id,
      );
      if (v) e.wonValue = e.wonValue.plus(v);
    }
    for (const g of lost) acc(g.ownerId).lost = g._count._all;
    for (const d of open) {
      const e = acc(d.ownerId);
      e.open++;
      const v = await ctx.money.convert(dealAmount(d), d.currencyCode, null, d.id);
      if (v) e.openValue = e.openValue.plus(v);
    }
    for (const g of doneTasks) acc(g.responsibleId).done = g._count._all;
    for (const g of overdue) acc(g.responsibleId).overdue = g._count._all;
    const names = await this.userNames([...by.keys()].filter(Boolean));
    const mk = (owner: string, e: Acc) => ({
      owner,
      leads: e.leads,
      converted: e.converted,
      won: e.won,
      wonValue: ctx.money.round(e.wonValue),
      lost: e.lost,
      winRate: pct(e.won, e.won + e.lost),
      open: e.open,
      openValue: ctx.money.round(e.openValue),
      done: e.done,
      overdue: e.overdue,
    });
    const rows = [...by.entries()]
      .map(([id, e]) => mk(id ? (names.get(id) ?? '—') : 'Sin responsable', e))
      .sort((a, b) => b.wonValue - a.wonValue || a.owner.localeCompare(b.owner));
    const totalAcc = [...by.values()].reduce(
      (a, e) => ({
        leads: a.leads + e.leads,
        converted: a.converted + e.converted,
        won: a.won + e.won,
        wonValue: a.wonValue.plus(e.wonValue),
        lost: a.lost + e.lost,
        open: a.open + e.open,
        openValue: a.openValue.plus(e.openValue),
        done: a.done + e.done,
        overdue: a.overdue + e.overdue,
      }),
      {
        leads: 0,
        converted: 0,
        won: 0,
        wonValue: ZERO,
        lost: 0,
        open: 0,
        openValue: ZERO,
        done: 0,
        overdue: 0,
      },
    );
    return {
      meta: this.ctxs.meta(ctx, {
        note: 'Prospectos y tareas completadas del período; ventas con cierre en el período; pipeline y tareas vencidas al día de hoy. Efectividad = ganadas ÷ (ganadas + perdidas).',
      }),
      columns: [
        col('owner', 'Responsable'),
        col('leads', 'Prospectos creados', 'number'),
        col('converted', 'Convertidos', 'number'),
        col('won', 'Ventas ganadas', 'number'),
        col('wonValue', `Importe ganado (${ctx.money.target})`, 'money'),
        col('lost', 'Perdidas', 'number'),
        col('winRate', 'Efectividad', 'percent'),
        col('open', 'Negociaciones abiertas', 'number'),
        col('openValue', `Pipeline (${ctx.money.target})`, 'money'),
        col('done', 'Tareas completadas', 'number'),
        col('overdue', 'Tareas vencidas', 'number'),
      ],
      rows,
      totals: mk('Total', totalAcc),
      chart: {
        type: 'bar' as const,
        x: 'owner',
        series: [
          { key: 'wonValue', label: `Importe ganado (${ctx.money.target})` },
          { key: 'openValue', label: `Pipeline (${ctx.money.target})` },
        ],
        data: rows,
      },
    };
  }

  // --- Tareas -----------------------------------------------------------------------------------

  private async tasks(ctx: ReportContext, overdueOnly: boolean) {
    const org = this.db.organizationId;
    const due = this.ctxs.range(ctx);
    const tasks = await this.db.tx.task.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        status: { category: { notIn: CLOSED_TASK } },
        ...(ctx.ownerIds === null ? {} : { responsibleId: { in: ctx.ownerIds } }),
        ...(overdueOnly
          ? { dueAt: { lt: ctx.now, ...(due?.gte ? { gte: due.gte } : {}) } }
          : due
            ? { dueAt: due }
            : {}),
      },
      include: {
        responsible: { select: { name: true } },
        status: { select: { name: true } },
        priority: { select: { name: true } },
        project: { select: { name: true } },
        contact: { select: { code: true, firstName: true, lastName: true } },
        company: { select: { code: true, legalName: true } },
        lead: { select: { code: true, title: true } },
        deal: { select: { code: true, title: true } },
      },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: ROWS + 1,
    });
    const rel = (t: (typeof tasks)[number]) =>
      t.contact
        ? `${t.contact.code} ${[t.contact.firstName, t.contact.lastName].filter(Boolean).join(' ')}`
        : t.company
          ? `${t.company.code} ${t.company.legalName}`
          : t.lead
            ? `${t.lead.code} ${t.lead.title}`
            : t.deal
              ? `${t.deal.code} ${t.deal.title}`
              : null;
    const rows = tasks.slice(0, ROWS).map((t) => ({
      code: t.code,
      title: t.title,
      responsible: t.responsible.name,
      status: t.status.name,
      priority: t.priority?.name ?? null,
      dueAt: dateTime(t.dueAt),
      ...(overdueOnly
        ? {
            daysLate: t.dueAt
              ? Math.max(1, Math.floor((ctx.now.getTime() - t.dueAt.getTime()) / 86_400_000))
              : null,
          }
        : {}),
      project: t.project?.name ?? null,
      related: rel(t),
    }));
    const byOwner = new Map<string, number>();
    for (const r of rows) byOwner.set(r.responsible, (byOwner.get(r.responsible) ?? 0) + 1);
    return {
      meta: this.ctxs.meta(ctx, {
        truncated: tasks.length > ROWS,
        note: overdueOnly
          ? 'Tareas abiertas con vencimiento anterior a hoy.'
          : 'Tareas abiertas (no completadas ni canceladas); el rango filtra por vencimiento.',
      }),
      columns: [
        col('code', 'Código'),
        col('title', 'Tarea'),
        col('responsible', 'Responsable'),
        col('status', 'Estado'),
        col('priority', 'Prioridad'),
        col('dueAt', 'Vencimiento', 'date'),
        ...(overdueOnly ? [col('daysLate', 'Días de atraso', 'number')] : []),
        col('project', 'Proyecto'),
        col('related', 'Asociada a'),
      ],
      rows,
      totals: { title: 'Total', code: String(rows.length) },
      chart: {
        type: 'bar' as const,
        x: 'responsible',
        series: [{ key: 'count', label: 'Tareas' }],
        data: [...byOwner.entries()]
          .map(([responsible, count]) => ({ responsible, count }))
          .sort((a, b) => b.count - a.count),
      },
    };
  }

  // --- Productos y pipeline ---------------------------------------------------------------------

  private async productsSold(ctx: ReportContext) {
    const closed = this.ctxs.dayRange(ctx);
    const lines = await this.db.tx.dealProduct.findMany({
      where: {
        organizationId: this.db.organizationId,
        deal: {
          deletedAt: null,
          status: 'WON',
          ...ownerWhere(ctx),
          ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
          ...(closed ? { closedAt: closed } : {}),
        },
      },
      select: {
        id: true,
        productId: true,
        sku: true,
        description: true,
        quantity: true,
        lineTotal: true,
        dealId: true,
        deal: { select: { currencyCode: true, closedAt: true } },
      },
      take: ROWS + 1,
    });
    const by = new Map<
      string,
      { sku: string; name: string; qty: Prisma.Decimal; deals: Set<string>; amount: Prisma.Decimal }
    >();
    for (const l of lines.slice(0, ROWS)) {
      const e = by.get(l.productId) ?? {
        sku: l.sku,
        name: l.description,
        qty: ZERO,
        deals: new Set<string>(),
        amount: ZERO,
      };
      e.qty = e.qty.plus(l.quantity);
      e.deals.add(l.dealId);
      const v = await ctx.money.convert(
        l.lineTotal,
        l.deal.currencyCode,
        l.deal.closedAt ? dateOnly(l.deal.closedAt) : null,
        l.id,
      );
      if (v) e.amount = e.amount.plus(v);
      by.set(l.productId, e);
    }
    const rows = [...by.values()]
      .map((e) => ({
        sku: e.sku,
        product: e.name,
        quantity: e.qty.toNumber(),
        deals: e.deals.size,
        amount: ctx.money.round(e.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
    return {
      meta: this.ctxs.meta(ctx, {
        truncated: lines.length > ROWS,
        note: 'Productos de las negociaciones ganadas con cierre en el período.',
      }),
      columns: [
        col('sku', 'SKU'),
        col('product', 'Producto'),
        col('quantity', 'Cantidad', 'number'),
        col('deals', 'Negociaciones', 'number'),
        col('amount', `Importe (${ctx.money.target})`, 'money'),
      ],
      rows,
      totals: {
        product: 'Total',
        quantity: rows.reduce((a, r) => a + r.quantity, 0),
        amount: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100,
      },
      chart: {
        type: 'bar' as const,
        x: 'product',
        series: [{ key: 'amount', label: `Importe (${ctx.money.target})` }],
        data: rows.slice(0, 10),
      },
    };
  }

  private async pipelineValue(ctx: ReportContext) {
    const deals = await this.db.tx.deal.findMany({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        status: 'OPEN',
        ...ownerWhere(ctx),
        ...(ctx.dealPipelineId ? { pipelineId: ctx.dealPipelineId } : {}),
      },
      select: {
        id: true,
        currencyCode: true,
        total: true,
        estimatedValue: true,
        finalValue: true,
        status: true,
        probability: true,
        stage: { select: { id: true, name: true, probability: true, position: true } },
        pipeline: { select: { name: true } },
      },
      take: ROWS + 1,
    });
    const by = new Map<
      string,
      {
        pipeline: string;
        stage: string;
        pos: number;
        count: number;
        value: Prisma.Decimal;
        weighted: Prisma.Decimal;
      }
    >();
    for (const d of deals.slice(0, ROWS)) {
      const e = by.get(d.stage.id) ?? {
        pipeline: d.pipeline.name,
        stage: d.stage.name,
        pos: d.stage.position,
        count: 0,
        value: ZERO,
        weighted: ZERO,
      };
      e.count++;
      const v = await ctx.money.convert(dealAmount(d), d.currencyCode, null, d.id);
      if (v) {
        e.value = e.value.plus(v);
        e.weighted = e.weighted.plus(v.mul(d.probability ?? d.stage.probability ?? 0).div(100));
      }
      by.set(d.stage.id, e);
    }
    const rows = [...by.values()]
      .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.pos - b.pos)
      .map((e) => ({
        pipeline: e.pipeline,
        stage: e.stage,
        count: e.count,
        value: ctx.money.round(e.value),
        weighted: ctx.money.round(e.weighted),
      }));
    return {
      meta: this.ctxs.meta(ctx, {
        truncated: deals.length > ROWS,
        note: 'Negociaciones abiertas al día de hoy. Ponderado = importe × probabilidad de la negociación (o, si no tiene, la de su etapa).',
      }),
      columns: [
        col('pipeline', 'Pipeline'),
        col('stage', 'Etapa'),
        col('count', 'Negociaciones', 'number'),
        col('value', `Importe (${ctx.money.target})`, 'money'),
        col('weighted', `Ponderado (${ctx.money.target})`, 'money'),
      ],
      rows,
      totals: {
        stage: 'Total',
        count: rows.reduce((a, r) => a + r.count, 0),
        value: Math.round(rows.reduce((a, r) => a + r.value, 0) * 100) / 100,
        weighted: Math.round(rows.reduce((a, r) => a + r.weighted, 0) * 100) / 100,
      },
      chart: {
        type: 'bar' as const,
        x: 'stage',
        series: [
          { key: 'value', label: 'Importe' },
          { key: 'weighted', label: 'Ponderado' },
        ],
        data: rows,
      },
    };
  }

  // --- Calidad de datos -------------------------------------------------------------------------

  private async duplicatesReport(user: AuthUser, ctx: ReportContext) {
    if (!can(user.permissions, 'duplicates', 'view')) throw forbidden();
    const stats = await this.duplicates.stats(user, ctx.from, ctx.to);
    const labels: Record<string, string> = {
      CONTACT: 'Contactos',
      COMPANY: 'Compañías',
      PRODUCT: 'Productos',
      LEAD: 'Prospectos',
      DEAL: 'Negociaciones',
      PROJECT: 'Proyectos',
    };
    const rows = stats.map((s) => ({
      module: labels[s.entityType] ?? s.entityType,
      detected: s.OPEN + s.KEPT_BOTH + s.REVIEWED + s.MERGED,
      open: s.OPEN,
      keptBoth: s.KEPT_BOTH,
      reviewed: s.REVIEWED,
      merged: s.MERGED,
      merges: s.merges,
    }));
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + Number(r[k]), 0);
    return {
      meta: this.ctxs.meta(ctx, {
        note: 'Coincidencias detectadas en el período y su estado actual; fusiones realizadas en el período.',
      }),
      columns: [
        col('module', 'Módulo'),
        col('detected', 'Detectadas', 'number'),
        col('open', 'Por revisar', 'number'),
        col('keptBoth', 'Se conservan ambos', 'number'),
        col('reviewed', 'Revisadas', 'number'),
        col('merged', 'Fusionadas', 'number'),
        col('merges', 'Fusiones en el período', 'number'),
      ],
      rows,
      totals: {
        module: 'Total',
        detected: sum('detected'),
        open: sum('open'),
        keptBoth: sum('keptBoth'),
        reviewed: sum('reviewed'),
        merged: sum('merged'),
        merges: sum('merges'),
      },
      chart: {
        type: 'bar' as const,
        x: 'module',
        series: [
          { key: 'open', label: 'Por revisar' },
          { key: 'merged', label: 'Fusionadas' },
        ],
        data: rows,
      },
    };
  }

  private async trashReport(user: AuthUser, ctx: ReportContext) {
    if (!can(user.permissions, 'trash', 'view')) throw forbidden();
    const stats = await this.trash.stats(user, ctx.from, ctx.to);
    const rows = stats.map((s) => ({
      module: ENTITY_LABEL[s.entityType] ?? s.entityType,
      deleted: s.deleted,
      restored: s.restored,
      purged: s.purged,
      inTrash: s.inTrash,
    }));
    const sum = (k: 'deleted' | 'restored' | 'purged' | 'inTrash') =>
      rows.reduce((a, r) => a + r[k], 0);
    return {
      meta: this.ctxs.meta(ctx, {
        note: 'Eliminados, restaurados y eliminados definitivamente en el período; «En papelera» es el saldo actual.',
      }),
      columns: [
        col('module', 'Módulo'),
        col('deleted', 'Enviados a papelera', 'number'),
        col('restored', 'Restaurados', 'number'),
        col('purged', 'Eliminados definitivamente', 'number'),
        col('inTrash', 'En papelera hoy', 'number'),
      ],
      rows,
      totals: {
        module: 'Total',
        deleted: sum('deleted'),
        restored: sum('restored'),
        purged: sum('purged'),
        inTrash: sum('inTrash'),
      },
      chart: {
        type: 'bar' as const,
        x: 'module',
        series: [
          { key: 'deleted', label: 'Enviados' },
          { key: 'restored', label: 'Restaurados' },
        ],
        data: rows,
      },
    };
  }
}
