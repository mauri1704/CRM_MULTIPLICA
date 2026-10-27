import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from './api';
import type { CatalogItem, Currency, CustomFieldDef, UserOption } from './types';

export const useCurrencies = (includeInactive = false) =>
  useQuery({
    queryKey: ['currencies', includeInactive],
    queryFn: () => api.get<Currency[]>('/currencies', { includeInactive }),
    staleTime: 300_000,
  });

export const useCatalog = (kind: string) =>
  useQuery({
    queryKey: ['catalogs', kind],
    queryFn: () => api.get<CatalogItem[]>(`/catalogs/${kind}`),
    staleTime: 300_000,
  });

export const useUserOptions = () =>
  useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => api.get<UserOption[]>('/users/options'),
    staleTime: 300_000,
  });

export const useCustomFields = (entityType: string) =>
  useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () => api.get<CustomFieldDef[]>('/custom-fields', { entityType }),
    staleTime: 300_000,
  });

/** Preferencia por usuario guardada en el navegador (columnas visibles, etc.). */
export function useLocalPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const storageKey = `crm-pref:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(storageKey, JSON.stringify(v));
      } catch {
        // Sin almacenamiento local: la preferencia dura solo esta sesión.
      }
    },
    [storageKey],
  );
  return [value, set];
}
