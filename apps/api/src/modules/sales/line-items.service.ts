import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can, type DiscountType, type LineInput, type LineUpdate } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { AppError, conflict, forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { ExchangeRatesService, type ResolvedRate } from '../exchange-rates/exchange-rates.service';
import { HistoryService } from '../history/history.service';
import { OrganizationSettingsService } from '../organization/organization-settings.service';
import { computeLine, discountPercent, sumTotals, todayIn } from './line-math';

const D = Prisma.Decimal;

export type ParentKind = 'LEAD' | 'DEAL';

/** Registro dueño de las líneas: prospecto o negociación. */
export interface LineParent {
  kind: ParentKind;
  id: string;
  currencyCode: string;
}

type LineRow = Prisma.LeadProductGetPayload<object> | Prisma.DealProductGetPayload<object>;

export const lineDto = (l: LineRow) => ({
  id: l.id,
  productId: l.productId,
  position: l.position,
  sku: l.sku,
  description: l.description,
  quantity: l.quantity.toFixed(4),
  unitPrice: l.unitPrice.toFixed(4),
  currencyCode: l.currencyCode,
  discountType: l.discountType as DiscountType,
  discountValue: l.discountValue.toFixed(4),
  exchangeRate: l.exchangeRate.toFixed(10),
  exchangeRateDate: l.exchangeRateDate ? l.exchangeRateDate.toISOString().slice(0, 10) : null,
  rateSource: l.rateSource,
  rateReason: l.rateReason,
  lineSubtotal: l.lineSubtotal.toFixed(4),
  lineDiscount: l.lineDiscount.toFixed(4),
  lineTotal: l.lineTotal.toFixed(4),
});
export type LineDto = ReturnType<typeof lineDto>;

/** Tasa a usar en una línea: guardada con su fecha y origen (D-05, D-06). */
export interface AppliedRate {
  rate: Prisma.Decimal;
  date: string | null;
  exchangeRateId: string | null;
  source: 'NONE' | 'MASTER' | 'INVERSE' | 'MANUAL';
  reason: string | null;
}

export const missingRate = (from: string, to: string, date: string) =>
  new AppError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MISSING_EXCHANGE_RATE',
    `No hay un tipo de cambio ${from}→${to} válido para el ${date}. Registre la tasa del día en «Tipos de cambio» o, si está autorizado, indique una tasa manual con su motivo.`,
    { manualRate: `Falta tasa ${from}→${to}` },
  );

/**
 * Productos asociados a prospectos y negociaciones. Cada línea guarda una copia de los valores
 * comerciales (SKU, descripción, precio, moneda, descuento, tasa e importes): cambiar el catálogo o
 * el maestro de tasas no altera lo ya registrado.
 */
@Injectable()
export class LineItemsService {
  constructor(
    private readonly db: Db,
    private readonly currencies: CurrenciesService,
    private readonly rates: ExchangeRatesService,
    private readonly settings: OrganizationSettingsService,
    private readonly history: HistoryService,
    private readonly audit: AuditService,
  ) {}

  private module(kind: ParentKind) {
    return kind === 'LEAD' ? ('leads' as const) : ('deals' as const);
  }

  async list(parent: { kind: ParentKind; id: string }): Promise<LineDto[]> {
    const where = {
      organizationId: this.db.organizationId,
      ...(parent.kind === 'LEAD' ? { leadId: parent.id } : { dealId: parent.id }),
    };
    const rows =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.findMany({
            where,
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          })
        : await this.db.tx.dealProduct.findMany({
            where,
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          });
    return rows.map(lineDto);
  }

  async today(): Promise<string> {
    return todayIn((await this.settings.get()).timezone);
  }

  /** Resuelve la tasa para una línea; con tasa manual exige permiso de administrar tipos de cambio. */
  async resolveRate(
    user: AuthUser,
    from: string,
    to: string,
    manual?: { rate?: string; reason?: string },
  ): Promise<AppliedRate> {
    const date = await this.today();
    if (from === to)
      return { rate: new D(1), date: null, exchangeRateId: null, source: 'NONE', reason: null };
    if (manual?.rate) {
      if (!can(user.permissions, 'exchange_rates', 'manage')) {
        throw forbidden('Solo quien administra los tipos de cambio puede indicar una tasa manual.');
      }
      return {
        rate: new D(manual.rate),
        date,
        exchangeRateId: null,
        source: 'MANUAL',
        reason: manual.reason ?? null,
      };
    }
    const r: ResolvedRate | null = await this.rates.resolve(from, to, date);
    if (!r) throw missingRate(from, to, date);
    return {
      rate: new D(r.rate),
      date: r.rateDate,
      exchangeRateId: r.exchangeRateId,
      source: r.inverse ? 'INVERSE' : 'MASTER',
      reason: null,
    };
  }

  private async decimalsOf(code: string): Promise<number> {
    return (await this.currencies.findByCode(code))?.decimals ?? 2;
  }

  /**
   * Calcula y valida una línea (descuento ≤ bruto; tope de descuento del producto salvo permiso
   * de equipo o superior para editar, D-25).
   */
  private async amounts(
    user: AuthUser,
    kind: ParentKind,
    v: {
      quantity: string;
      unitPrice: string;
      discountType: DiscountType;
      discountValue: string;
      maxDiscountPct: Prisma.Decimal;
    },
    rate: Prisma.Decimal,
    targetCurrency: string,
  ) {
    const a = computeLine({ ...v, rate, decimals: await this.decimalsOf(targetCurrency) });
    if (a.discountOriginal.greaterThan(a.grossOriginal)) {
      throw validationError({
        discountValue: 'El descuento no puede superar el importe de la línea.',
      });
    }
    const pct = discountPercent(a);
    if (
      pct.greaterThan(v.maxDiscountPct) &&
      !can(user.permissions, this.module(kind), 'edit', 'TEAM')
    ) {
      throw validationError({
        discountValue: `El descuento (${pct.toDecimalPlaces(2).toString()}%) supera el máximo permitido para este producto (${v.maxDiscountPct.toString()}%). Solicite autorización a su supervisor.`,
      });
    }
    return a;
  }

  async add(user: AuthUser, parent: LineParent, input: LineInput): Promise<LineDto> {
    const product = await this.db.tx.product.findFirst({
      where: { id: input.productId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!product) throw validationError({ productId: 'El producto no existe.' });
    if (!product.active)
      throw validationError({
        productId: `«${product.name}» está inactivo y no se puede agregar.`,
      });
    const rate = await this.resolveRate(user, product.currencyCode, parent.currencyCode, {
      rate: input.manualRate,
      reason: input.manualRateReason,
    });
    const unitPrice = input.unitPrice ?? product.price.toString();
    const a = await this.amounts(
      user,
      parent.kind,
      {
        quantity: input.quantity,
        unitPrice,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxDiscountPct: product.maxDiscountPct,
      },
      rate.rate,
      parent.currencyCode,
    );
    const data = {
      organizationId: user.organizationId,
      productId: product.id,
      position: (await this.list(parent)).length,
      sku: product.sku,
      description: input.description || product.name,
      quantity: new D(input.quantity),
      unitPrice: new D(unitPrice),
      currencyCode: product.currencyCode,
      discountType: input.discountType,
      discountValue: new D(input.discountValue),
      exchangeRate: rate.rate,
      exchangeRateDate: rate.date ? new Date(`${rate.date}T00:00:00.000Z`) : null,
      exchangeRateId: rate.exchangeRateId,
      rateSource: rate.source,
      rateReason: rate.reason,
      lineSubtotal: a.subtotal,
      lineDiscount: a.discount,
      lineTotal: a.total,
    };
    const row =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.create({ data: { ...data, leadId: parent.id } })
        : await this.db.tx.dealProduct.create({ data: { ...data, dealId: parent.id } });
    if (rate.source === 'MANUAL') {
      await this.audit.log('MANUAL_EXCHANGE_RATE', {
        userId: user.id,
        entityType: parent.kind,
        entityId: parent.id,
        details: {
          pair: `${product.currencyCode}→${parent.currencyCode}`,
          rate: rate.rate.toString(),
          reason: rate.reason,
        },
      });
    }
    await this.history.record(parent.kind, parent.id, 'UPDATE', user.id, {
      productos: { from: null, to: `+ ${product.sku} × ${input.quantity}` },
    });
    await this.recalcTotals(parent);
    return lineDto(row);
  }

  private async findLine(parent: LineParent, lineId: string) {
    const where = { id: lineId, organizationId: this.db.organizationId };
    const line =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.findFirst({
            where: { ...where, leadId: parent.id },
            include: { product: true },
          })
        : await this.db.tx.dealProduct.findFirst({
            where: { ...where, dealId: parent.id },
            include: { product: true },
          });
    if (!line) throw notFound('El producto asociado');
    return line;
  }

  /** Editar cantidad, precio o descuento conserva la tasa ya registrada en la línea (D-06). */
  async update(
    user: AuthUser,
    parent: LineParent,
    lineId: string,
    input: LineUpdate,
  ): Promise<LineDto> {
    const line = await this.findLine(parent, lineId);
    const merged = {
      quantity: input.quantity ?? line.quantity.toString(),
      unitPrice: input.unitPrice ?? line.unitPrice.toString(),
      discountType: (input.discountType ?? line.discountType) as DiscountType,
      discountValue: input.discountValue ?? line.discountValue.toString(),
      maxDiscountPct: line.product.maxDiscountPct,
    };
    if (merged.discountType === 'PERCENT' && new D(merged.discountValue).greaterThan(100)) {
      throw validationError({ discountValue: 'El porcentaje no puede superar 100.' });
    }
    const a = await this.amounts(user, parent.kind, merged, line.exchangeRate, parent.currencyCode);
    const data = {
      ...(input.description !== undefined
        ? { description: input.description || line.product.name }
        : {}),
      quantity: new D(merged.quantity),
      unitPrice: new D(merged.unitPrice),
      discountType: merged.discountType,
      discountValue: new D(merged.discountValue),
      lineSubtotal: a.subtotal,
      lineDiscount: a.discount,
      lineTotal: a.total,
    };
    const row =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.update({ where: { id: lineId }, data })
        : await this.db.tx.dealProduct.update({ where: { id: lineId }, data });
    await this.history.record(parent.kind, parent.id, 'UPDATE', user.id, {
      productos: {
        from: `${line.sku} × ${line.quantity.toString()} a ${line.unitPrice.toString()}`,
        to: `${line.sku} × ${merged.quantity} a ${merged.unitPrice}`,
      },
    });
    await this.recalcTotals(parent);
    return lineDto(row);
  }

  async remove(user: AuthUser, parent: LineParent, lineId: string): Promise<void> {
    const line = await this.findLine(parent, lineId);
    if (parent.kind === 'LEAD') await this.db.tx.leadProduct.delete({ where: { id: lineId } });
    else await this.db.tx.dealProduct.delete({ where: { id: lineId } });
    await this.history.record(parent.kind, parent.id, 'UPDATE', user.id, {
      productos: { from: `${line.sku} × ${line.quantity.toString()}`, to: null },
    });
    await this.recalcTotals(parent);
  }

  /**
   * Recalcula las líneas con la tasa vigente hoy y, opcionalmente, en otra moneda del registro
   * ("Actualizar tasas" o cambio de moneda; acción explícita del usuario, D-06).
   */
  async reprice(
    user: AuthUser,
    parent: LineParent,
    targetCurrency = parent.currencyCode,
  ): Promise<number> {
    const lines =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.findMany({
            where: { organizationId: user.organizationId, leadId: parent.id },
            include: { product: true },
          })
        : await this.db.tx.dealProduct.findMany({
            where: { organizationId: user.organizationId, dealId: parent.id },
            include: { product: true },
          });
    let changed = 0;
    for (const l of lines) {
      const rate = await this.resolveRate(user, l.currencyCode, targetCurrency);
      const a = computeLine({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountType: l.discountType as DiscountType,
        discountValue: l.discountValue,
        rate: rate.rate,
        decimals: await this.decimalsOf(targetCurrency),
      });
      const data = {
        exchangeRate: rate.rate,
        exchangeRateDate: rate.date ? new Date(`${rate.date}T00:00:00.000Z`) : null,
        exchangeRateId: rate.exchangeRateId,
        rateSource: rate.source,
        rateReason: null,
        lineSubtotal: a.subtotal,
        lineDiscount: a.discount,
        lineTotal: a.total,
      };
      if (!a.total.equals(l.lineTotal) || !rate.rate.equals(l.exchangeRate)) changed++;
      if (parent.kind === 'LEAD')
        await this.db.tx.leadProduct.update({ where: { id: l.id }, data });
      else await this.db.tx.dealProduct.update({ where: { id: l.id }, data });
    }
    await this.recalcTotals(parent);
    return changed;
  }

  /** Guarda subtotal, descuento y total en el registro (no se recalculan al leer). */
  async recalcTotals(parent: { kind: ParentKind; id: string }): Promise<void> {
    const where = { organizationId: this.db.organizationId };
    const select = { lineSubtotal: true, lineDiscount: true, lineTotal: true } as const;
    const lines =
      parent.kind === 'LEAD'
        ? await this.db.tx.leadProduct.findMany({ where: { ...where, leadId: parent.id }, select })
        : await this.db.tx.dealProduct.findMany({ where: { ...where, dealId: parent.id }, select });
    const t = sumTotals(lines);
    const data = {
      subtotal: t.subtotal,
      discount: t.discount,
      total: t.total,
      version: { increment: 1 },
    };
    if (parent.kind === 'LEAD') await this.db.tx.lead.update({ where: { id: parent.id }, data });
    else await this.db.tx.deal.update({ where: { id: parent.id }, data });
  }

  /** Impide usar el registro si está cerrado o convertido (lo valida el service dueño). */
  static assertEditable(condition: boolean, message: string): void {
    if (!condition) throw conflict(message);
  }
}
