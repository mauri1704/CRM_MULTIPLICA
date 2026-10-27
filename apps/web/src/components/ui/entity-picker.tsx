import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { Input } from './input';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface EntityPickerProps {
  /** Valor seleccionado (id) y su etiqueta, para mostrarla sin volver a buscar. */
  value: PickerOption | null;
  onChange: (v: PickerOption | null) => void;
  search: (q: string) => Promise<PickerOption[]>;
  queryKey: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Selector con búsqueda en el servidor (compañías, contactos…). Accesible por teclado. */
export function EntityPicker({
  value,
  onChange,
  search,
  queryKey,
  placeholder = 'Buscar…',
  id,
  disabled,
  ...aria
}: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ['picker', queryKey, debounced],
    queryFn: () => search(debounced),
    enabled: open,
  });
  const options = data ?? [];
  const pick = (o: PickerOption) => {
    onChange(o);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="flex gap-1">
        <Popover.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-sm disabled:opacity-60',
              aria['aria-invalid'] && 'border-danger',
            )}
            aria-haspopup="listbox"
            aria-describedby={aria['aria-describedby']}
          >
            <span className={cn('truncate', !value && 'text-fg-muted')}>
              {value ? value.label : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 text-fg-muted" aria-hidden />
          </button>
        </Popover.Trigger>
        {value && !disabled && (
          <button
            type="button"
            className="rounded-md px-2 text-fg-muted hover:bg-muted"
            aria-label="Quitar selección"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[260px] rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <Input
            autoFocus
            value={q}
            placeholder="Escriba para buscar…"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label="Buscar"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, options.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && options[active]) {
                e.preventDefault();
                pick(options[active]);
              }
            }}
          />
          <ul id={listId} role="listbox" className="mt-2 max-h-64 overflow-y-auto">
            {isFetching && (
              <li className="flex items-center gap-2 px-2 py-2 text-sm text-fg-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando…
              </li>
            )}
            {!isFetching && options.length === 0 && (
              <li className="px-2 py-2 text-sm text-fg-muted">Sin resultados.</li>
            )}
            {options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'cursor-pointer rounded px-2 py-1.5 text-sm',
                  i === active ? 'bg-primary/10' : 'hover:bg-muted',
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="block">{o.label}</span>
                {o.sublabel && <span className="block text-xs text-fg-muted">{o.sublabel}</span>}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
