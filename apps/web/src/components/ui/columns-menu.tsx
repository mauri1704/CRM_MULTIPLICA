import * as Popover from '@radix-ui/react-popover';
import type { VisibilityState } from '@tanstack/react-table';
import { Columns3 } from 'lucide-react';
import { Button } from './button';
import { Checkbox } from './input';

/** Selector de columnas visibles de una lista (la preferencia se guarda por usuario en el navegador). */
export function ColumnsMenu({
  columns,
  value,
  onChange,
}: {
  columns: { id: string; label: string }[];
  value: VisibilityState;
  onChange: (v: VisibilityState) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 className="h-4 w-4" aria-hidden />
          Columnas
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <p className="px-2 pb-1 text-xs font-semibold text-fg-muted">Columnas visibles</p>
          <ul className="max-h-80 overflow-y-auto">
            {columns.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={value[c.id] !== false}
                    onChange={(e) => onChange({ ...value, [c.id]: e.target.checked })}
                  />
                  {c.label}
                </label>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
