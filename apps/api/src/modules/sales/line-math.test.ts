import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { computeLine, discountPercent, sumTotals, todayIn } from './line-math';

const s = (v: Prisma.Decimal) => v.toFixed(2);

describe('cálculo de líneas (D-24)', () => {
  it.each([
    // cantidad, precio, tipo, desc, tasa, decimales → subtotal, descuento, total
    ['1', '100', 'PERCENT', '0', '1', 2, '100.00', '0.00', '100.00'],
    ['3', '33.335', 'PERCENT', '0', '1', 2, '100.01', '0.00', '100.01'], // 100.005 → mitad hacia arriba
    ['2', '50', 'PERCENT', '10', '1', 2, '100.00', '10.00', '90.00'],
    ['1', '1200', 'PERCENT', '10', '3.7500', 2, '4500.00', '450.00', '4050.00'], // USD → PEN
    ['1', '1000', 'AMOUNT', '125.555', '1', 2, '1000.00', '125.56', '874.44'],
    ['2.5', '19.99', 'PERCENT', '0', '0.2666666667', 2, '13.33', '0.00', '13.33'], // PEN → USD (inversa)
    ['1', '0.10', 'PERCENT', '0', '1', 0, '0.00', '0.00', '0.00'], // moneda sin decimales
  ] as const)('%s × %s (%s %s) × %s → %s', (q, p, t, d, r, dec, sub, disc, tot) => {
    const a = computeLine({
      quantity: q,
      unitPrice: p,
      discountType: t,
      discountValue: d,
      rate: r,
      decimals: dec,
    });
    expect([s(a.subtotal), s(a.discount), s(a.total)]).toEqual([sub, disc, tot]);
  });

  it('el total del registro es la suma de líneas redondeadas', () => {
    const lines = ['33.335', '33.335', '33.335'].map((p) =>
      computeLine({
        quantity: '1',
        unitPrice: p,
        discountType: 'PERCENT',
        discountValue: '0',
        rate: '1',
        decimals: 2,
      }),
    );
    const totals = sumTotals(
      lines.map((l) => ({
        lineSubtotal: l.subtotal,
        lineDiscount: l.discount,
        lineTotal: l.total,
      })),
    );
    expect(s(totals.total)).toBe('100.02'); // 33.34 × 3, no round(100.005)
  });

  it('calcula el porcentaje equivalente de un descuento fijo', () => {
    const a = computeLine({
      quantity: '2',
      unitPrice: '50',
      discountType: 'AMOUNT',
      discountValue: '15',
      rate: '1',
      decimals: 2,
    });
    expect(discountPercent(a).toFixed(2)).toBe('15.00');
  });

  it('fecha de hoy según la zona horaria de la organización', () => {
    // 2026-01-02 03:00 UTC = 2026-01-01 22:00 en Lima
    expect(todayIn('America/Lima', new Date('2026-01-02T03:00:00Z'))).toBe('2026-01-01');
  });
});
