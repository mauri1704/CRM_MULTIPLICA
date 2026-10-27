import { formatMoney } from '@crm/shared';
import { useCallback } from 'react';
import { useCurrencies } from './hooks';
import type { Currency } from './types';

/** Formatea importes con el símbolo y los decimales de su moneda, mostrando siempre el código. */
export function useMoney() {
  const { data } = useCurrencies(true);
  return useCallback(
    (amount: string | number | null | undefined, code: string, opts: { code?: boolean } = {}) => {
      if (amount === null || amount === undefined || amount === '') return '—';
      const c: Pick<Currency, 'code' | 'symbol' | 'decimals' | 'symbolPosition'> = data?.find(
        (x) => x.code === code,
      ) ?? {
        code,
        symbol: code,
        decimals: 2,
        symbolPosition: 'BEFORE',
      };
      return opts.code === false
        ? formatMoney(String(amount), c)
        : `${formatMoney(String(amount), c)} ${code}`;
    },
    [data],
  );
}
