import { Prisma } from '@prisma/client';
import type { ConversionCriterion, ReportFilter, ReportMeta } from '@crm/shared';
import type { ExchangeRatesService, ResolvedRate } from '../exchange-rates/exchange-rates.service';

const LIMA = 'America/Lima';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LIMA });

export const todayLima = () => dayFmt.format(new Date());
export const limaStart = (d: string) => new Date(`${d}T00:00:00.000-05:00`);
export const limaEnd = (d: string) => new Date(`${d}T23:59:59.999-05:00`);
export const limaDay = (d: Date | string) => dayFmt.format(new Date(d));
/** Columnas `date` de PostgreSQL llegan como medianoche UTC: su día es el de esa fecha UTC. */
export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Convierte importes a la moneda de presentación con la regla de tasas aprobada (D-05, D-14).
 * Lo que no tiene tasa válida se excluye y se informa: nunca se inventa una tasa.
 */
export class MoneyConverter {
  private readonly cache = new Map<string, Promise<ResolvedRate | null>>();
  private readonly excluded = new Map<string, { refs: Set<string>; amount: Prisma.Decimal }>();

  constructor(
    private readonly rates: ExchangeRatesService,
    readonly target: string,
    readonly decimals: number,
    readonly criterion: ConversionCriterion,
    readonly cutoff: string,
  ) {}

  /** `date` solo cuenta con el criterio «fecha de cierre»; si no, se usa la fecha de corte. */
  async convert(
    amount: Prisma.Decimal | null | undefined,
    from: string,
    date: string | null | undefined,
    ref: string,
  ): Promise<Prisma.Decimal | null> {
    const value = amount ?? new Prisma.Decimal(0);
    if (from === this.target || value.isZero()) return value;
    const day = this.criterion === 'CLOSE' && date ? date : this.cutoff;
    const key = `${from}|${day}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.rates.resolve(from, this.target, day);
      this.cache.set(key, p);
    }
    const rate = await p;
    if (!rate) {
      const e = this.excluded.get(from) ?? {
        refs: new Set<string>(),
        amount: new Prisma.Decimal(0),
      };
      if (!e.refs.has(ref)) {
        e.refs.add(ref);
        e.amount = e.amount.plus(value);
      }
      this.excluded.set(from, e);
      return null;
    }
    return value.mul(rate.rate);
  }

  round(v: Prisma.Decimal): number {
    return v.toDecimalPlaces(this.decimals, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  }

  excludedList(): ReportMeta['excluded'] {
    return [...this.excluded.entries()].map(([currency, e]) => ({
      currency,
      count: e.refs.size,
      amount: e.amount.toFixed(4),
    }));
  }
}

export interface ReportContext {
  filter: ReportFilter;
  from: Date | null;
  to: Date | null;
  fromDay: string | null;
  toDay: string | null;
  /** Responsables dentro del alcance y los filtros; null = sin restricción. */
  ownerIds: string[] | null;
  /** Pipeline pedido, según su tipo. */
  leadPipelineId: string | null;
  dealPipelineId: string | null;
  money: MoneyConverter;
  now: Date;
}

export const ownerWhere = (ctx: ReportContext) =>
  ctx.ownerIds === null ? {} : { ownerId: { in: ctx.ownerIds } };

export function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}
