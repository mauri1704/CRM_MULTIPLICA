import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** Registro abierto en el panel lateral, en la URL (`?id=` o `?id=nuevo`) para poder enlazarlo. */
export function useRecordParam(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const set = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set('id', next);
          else p.delete('id');
          return p;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  return [id, set];
}
