import { Prisma } from '@prisma/client';
import type { DiscountType } from '@crm/shared';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface LineAmounts {
  /** cantidad × precio, en la moneda del producto */
  grossOriginal: Dec;
  /** descuento en la moneda del producto */
  discountOriginal: Dec;
  /** En la moneda del registro, redondeados a sus decimales (D-24) */
  subtotal: Dec;
  discount: Dec;
  total: Dec;
}

/**
 * Cálculo de una línea (docs/plan/04-reglas-negocio.md §1, D-24):
 * - bruto = cantidad × precio; descuento = importe fijo o bruto × % / 100 (en la moneda del producto);
 * - se convierten con la tasa de la línea y se redondean mitad hacia arriba a los decimales de la
 *   moneda del registro; total = subtotal − descuento.
 * Se redondea por línea y luego se suma, así el total siempre coincide con la suma visible.
 */
export function computeLine(input: {
  quantity: Dec | string;
  unitPrice: Dec | string;
  discountType: DiscountType;
  discountValue: Dec | string;
  rate: Dec | string;
  decimals: number;
}): LineAmounts {
  const qty = new D(input.quantity);
  const price = new D(input.unitPrice);
  const rate = new D(input.rate);
  const grossOriginal = qty.mul(price);
  const discountOriginal =
    input.discountType === 'PERCENT'
      ? grossOriginal.mul(new D(input.discountValue)).div(100)
      : new D(input.discountValue);
  const round = (v: Dec) => v.toDecimalPlaces(input.decimals, D.ROUND_HALF_UP);
  const subtotal = round(grossOriginal.mul(rate));
  const discount = round(discountOriginal.mul(rate));
  return { grossOriginal, discountOriginal, subtotal, discount, total: subtotal.minus(discount) };
}

/** Porcentaje de descuento equivalente (para comparar con el máximo del producto). */
export function discountPercent(a: Pick<LineAmounts, 'grossOriginal' | 'discountOriginal'>): Dec {
  return a.grossOriginal.isZero() ? new D(0) : a.discountOriginal.div(a.grossOriginal).mul(100);
}

export function sumTotals(lines: { lineSubtotal: Dec; lineDiscount: Dec; lineTotal: Dec }[]) {
  return lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal.plus(l.lineSubtotal),
      discount: acc.discount.plus(l.lineDiscount),
      total: acc.total.plus(l.lineTotal),
    }),
    { subtotal: new D(0), discount: new D(0), total: new D(0) },
  );
}

/** Fecha de hoy (aaaa-mm-dd) en la zona horaria de la organización. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
