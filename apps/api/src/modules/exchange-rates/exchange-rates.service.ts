import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ExchangeRateInput, ExchangeRateUpdate } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { HistoryService } from '../history/history.service';
import { OrganizationSettingsService } from '../organization/organization-settings.service';

export interface RateQuery {
  from?: string;
  to?: string;
  currency?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  page: number;
  pageSize: number;
}

export interface ResolvedRate {
  /** 1 unidad de `from` = `rate` unidades de `to` (texto decimal, 10 decimales). */
  rate: string;
  /** Fecha de vigencia de la tasa usada (aaaa-mm-dd). */
  rateDate: string;
  exchangeRateId: string | null;
  inverse: boolean;
  /** Días entre la fecha pedida y la de la tasa (0 = tasa del día). */
  ageDays: number;
}

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Maestro diario de tipos de cambio (sin servicios externos) y regla de selección (D-05). */
@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly db: Db,
    private readonly currencies: CurrenciesService,
    private readonly history: HistoryService,
    private readonly audit: AuditService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  private toDto(r: Prisma.ExchangeRateGetPayload<object>) {
    return { ...r, rateDate: isoOf(r.rateDate), rate: r.rate.toFixed(10).replace(/\.?0+$/, '') };
  }

  async list(q: RateQuery) {
    const where: Prisma.ExchangeRateWhereInput = {
      organizationId: this.db.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            rateDate: {
              gte: q.from ? toDate(q.from) : undefined,
              lte: q.to ? toDate(q.to) : undefined,
            },
          }
        : {}),
      ...(q.currency ? { OR: [{ fromCurrency: q.currency }, { toCurrency: q.currency }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tx.exchangeRate.findMany({
        where,
        orderBy: [{ rateDate: 'desc' }, { fromCurrency: 'asc' }, { toCurrency: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.exchangeRate.count({ where }),
    ]);
    const userIds = [
      ...new Set(items.map((i) => i.updatedById ?? i.createdById).filter((u): u is string => !!u)),
    ];
    const users = await this.db.q.user.findMany({
      where: { id: { in: userIds }, organizationId: this.db.organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: items.map((i) => ({
        ...this.toDto(i),
        updatedByName: names.get(i.updatedById ?? i.createdById ?? '') ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(id: string) {
    const r = await this.db.tx.exchangeRate.findFirst({
      where: { id, organizationId: this.db.organizationId },
    });
    if (!r) throw notFound('El tipo de cambio');
    return r;
  }

  private async findActive(date: string, from: string, to: string, exceptId?: string) {
    return this.db.tx.exchangeRate.findFirst({
      where: {
        organizationId: this.db.organizationId,
        rateDate: toDate(date),
        fromCurrency: from,
        toCurrency: to,
        status: 'ACTIVE',
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }

  async create(input: ExchangeRateInput, actor: Actor, source: 'MANUAL' | 'IMPORT' = 'MANUAL') {
    await this.currencies.assertActive(input.fromCurrency, 'fromCurrency');
    await this.currencies.assertActive(input.toCurrency, 'toCurrency');
    if (await this.findActive(input.date, input.fromCurrency, input.toCurrency)) {
      throw conflict(
        `Ya existe una tasa activa ${input.fromCurrency}→${input.toCurrency} para el ${input.date}. Edítela o desactívela.`,
        { date: 'Ya hay una tasa activa para esta fecha y par.' },
      );
    }
    const r = await this.db.tx.exchangeRate.create({
      data: {
        organizationId: actor.organizationId,
        rateDate: toDate(input.date),
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: new Prisma.Decimal(input.rate),
        source,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.db.tx.exchangeRateHistory.create({
      data: {
        organizationId: actor.organizationId,
        exchangeRateId: r.id,
        newRate: r.rate,
        newStatus: r.status,
        reason: source === 'IMPORT' ? 'Importación' : 'Registro',
        userId: actor.userId,
      },
    });
    await this.history.record(
      'EXCHANGE_RATE',
      r.id,
      source === 'IMPORT' ? 'IMPORT' : 'CREATE',
      actor.userId,
      {
        date: input.date,
        pair: `${input.fromCurrency}→${input.toCurrency}`,
        rate: input.rate,
      },
    );
    return this.toDto(r);
  }

  /** Cambiar o desactivar una tasa no altera importes ya guardados (cada línea guardó su tasa). */
  async update(id: string, input: ExchangeRateUpdate, actor: Actor) {
    const before = await this.get(id);
    const newRate = input.rate !== undefined ? new Prisma.Decimal(input.rate) : before.rate;
    const newStatus =
      input.active === undefined ? before.status : input.active ? 'ACTIVE' : 'INACTIVE';
    if (newRate.equals(before.rate) && newStatus === before.status) return this.toDto(before);
    if (newStatus === 'ACTIVE' && before.status !== 'ACTIVE') {
      const clash = await this.findActive(
        isoOf(before.rateDate),
        before.fromCurrency,
        before.toCurrency,
        id,
      );
      if (clash)
        throw conflict('Ya hay otra tasa activa para esa fecha y par. Desactívela primero.');
    }
    const r = await this.db.tx.exchangeRate.update({
      where: { id },
      data: { rate: newRate, status: newStatus, updatedById: actor.userId },
    });
    await this.db.tx.exchangeRateHistory.create({
      data: {
        organizationId: actor.organizationId,
        exchangeRateId: id,
        oldRate: before.rate,
        newRate,
        oldStatus: before.status,
        newStatus,
        reason: input.reason,
        userId: actor.userId,
      },
    });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (!newRate.equals(before.rate))
      changes.rate = { from: before.rate.toString(), to: newRate.toString() };
    if (newStatus !== before.status) changes.status = { from: before.status, to: newStatus };
    await this.history.record('EXCHANGE_RATE', id, 'UPDATE', actor.userId, {
      ...changes,
      reason: input.reason,
    });
    await this.audit.log('EXCHANGE_RATE_CHANGED', {
      userId: actor.userId,
      entityType: 'EXCHANGE_RATE',
      entityId: id,
      ip: actor.ip,
      details: {
        date: isoOf(before.rateDate),
        pair: `${before.fromCurrency}→${before.toCurrency}`,
        changes,
        reason: input.reason,
      },
    });
    return this.toDto(r);
  }

  async historyOf(id: string) {
    await this.get(id);
    const rows = await this.db.tx.exchangeRateHistory.findMany({
      where: { organizationId: this.db.organizationId, exchangeRateId: id },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.db.q.user.findMany({
      where: {
        id: { in: rows.map((r) => r.userId).filter((u): u is string => !!u) },
        organizationId: this.db.organizationId,
      },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      oldRate: r.oldRate?.toString() ?? null,
      newRate: r.newRate?.toString() ?? null,
      userName: r.userId ? (names.get(r.userId) ?? null) : null,
    }));
  }

  /**
   * Regla de selección (D-05):
   * 1. tasa activa del día;
   * 2. si no hay, la más reciente anterior dentro de `exchangeRateMaxAgeDays`;
   * 3. si se permite y falta el par directo, la inversa (1/tasa) con el mismo criterio;
   * 4. si no hay ninguna, null: nunca se inventa una tasa.
   */
  async resolve(from: string, to: string, date: string): Promise<ResolvedRate | null> {
    if (from === to)
      return { rate: '1', rateDate: date, exchangeRateId: null, inverse: false, ageDays: 0 };
    const settings = await this.settings.get();
    const target = toDate(date);
    const oldest = new Date(target.getTime() - settings.exchangeRateMaxAgeDays * DAY_MS);
    const find = (f: string, t: string) =>
      this.db.tx.exchangeRate.findFirst({
        where: {
          organizationId: this.db.organizationId,
          fromCurrency: f,
          toCurrency: t,
          status: 'ACTIVE',
          rateDate: { lte: target, gte: oldest },
        },
        orderBy: { rateDate: 'desc' },
      });
    const age = (d: Date) => Math.round((target.getTime() - d.getTime()) / DAY_MS);

    const direct = await find(from, to);
    const inverse = settings.exchangeRateAllowInverse ? await find(to, from) : null;
    // La directa gana salvo que la inversa sea más reciente.
    if (direct && (!inverse || direct.rateDate >= inverse.rateDate)) {
      return {
        rate: direct.rate.toFixed(10),
        rateDate: isoOf(direct.rateDate),
        exchangeRateId: direct.id,
        inverse: false,
        ageDays: age(direct.rateDate),
      };
    }
    if (inverse) {
      return {
        rate: new Prisma.Decimal(1)
          .div(inverse.rate)
          .toDecimalPlaces(10, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(10),
        rateDate: isoOf(inverse.rateDate),
        exchangeRateId: inverse.id,
        inverse: true,
        ageDays: age(inverse.rateDate),
      };
    }
    return null;
  }
}
