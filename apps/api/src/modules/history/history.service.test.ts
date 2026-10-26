import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { diff } from './history.service';

describe('diff', () => {
  it('devuelve solo los campos que cambiaron, normalizando fechas y decimales', () => {
    const before = {
      a: 1,
      b: 'x',
      c: new Date('2026-01-01T00:00:00Z'),
      d: new Prisma.Decimal('1.50'),
      e: null,
    };
    const after = {
      a: 1,
      b: 'y',
      c: new Date('2026-01-02T00:00:00Z'),
      d: new Prisma.Decimal('1.5'),
      e: undefined,
    };
    expect(diff(before, after, ['a', 'b', 'c', 'd', 'e'])).toEqual({
      b: { from: 'x', to: 'y' },
      c: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
    });
  });

  it('ignora campos que no vienen en la actualización', () => {
    expect(diff({ a: 1, b: 2 }, { b: 3 }, ['a', 'b'])).toEqual({ b: { from: 2, to: 3 } });
  });
});
