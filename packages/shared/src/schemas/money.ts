import { z } from 'zod';
import { currencyCode, decimalString } from './crm';

export const currencyInput = z.object({
  code: currencyCode,
  name: z.string().trim().min(2, 'Ingrese el nombre.').max(60),
  symbol: z.string().trim().min(1, 'Ingrese el símbolo.').max(5),
  decimals: z.number().int().min(0).max(4),
  symbolPosition: z.enum(['BEFORE', 'AFTER']).default('BEFORE'),
});
export type CurrencyInput = z.infer<typeof currencyInput>;
export const currencyUpdate = currencyInput
  .omit({ code: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export type CurrencyUpdate = z.infer<typeof currencyUpdate>;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato aaaa-mm-dd.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha no válida.');

export const exchangeRateInput = z
  .object({
    date: isoDate,
    fromCurrency: currencyCode,
    toCurrency: currencyCode,
    rate: decimalString({ label: 'La tasa' }).refine(
      (v) => Number(v) > 0,
      'La tasa debe ser mayor que cero.',
    ),
  })
  .refine((v) => v.fromCurrency !== v.toCurrency, {
    path: ['toCurrency'],
    message: 'Las monedas deben ser distintas.',
  });
export type ExchangeRateInput = z.infer<typeof exchangeRateInput>;

/** Editar una tasa exige motivo: queda en el historial (D-13). */
export const exchangeRateUpdate = z.object({
  rate: decimalString({ label: 'La tasa' })
    .refine((v) => Number(v) > 0, 'La tasa debe ser mayor que cero.')
    .optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(3, 'Indique el motivo del cambio.').max(300),
});
export type ExchangeRateUpdate = z.infer<typeof exchangeRateUpdate>;

/** Formatea un importe (texto decimal) según la moneda. */
export function formatMoney(
  amount: string | number,
  currency: { code: string; symbol: string; decimals: number; symbolPosition?: string },
  locale = 'en-US',
): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  const formatted = n.toLocaleString(locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
  return currency.symbolPosition === 'AFTER'
    ? `${formatted} ${currency.symbol}`
    : `${currency.symbol} ${formatted}`;
}
