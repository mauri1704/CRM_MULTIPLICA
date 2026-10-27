import { IMPORT_ENTITY_LABELS, type FileFormat, type ImportEntity } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

type Filters = Record<string, string | number | boolean | undefined | null>;

/** Exportar a Excel o CSV: todos los registros autorizados o solo los filtrados, con columnas a elección. */
export function ExportDialog({
  entity,
  open,
  onOpenChange,
  filters,
}: {
  entity: ImportEntity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Filtros activos de la lista. */
  filters: Filters;
}) {
  const toast = useToast();
  const { data: columns } = useQuery({
    queryKey: ['export-columns', entity],
    queryFn: () =>
      api.get<{ key: string; label: string }[]>(`/import-export/${entity}/export-columns`),
    enabled: open,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<FileFormat>('xlsx');
  const [delimiter, setDelimiter] = useState<',' | ';'>(',');
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null);

  useEffect(() => {
    if (columns) setSelected(new Set(columns.map((c) => c.key)));
  }, [columns]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.download(`/import-export/${entity}/export`, {
        format,
        delimiter: format === 'csv' ? delimiter : undefined,
        columns: [...selected].join(','),
        ...(scope === 'filtered' ? filters : {}),
      });
      toast.success('Archivo generado.');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Exportar ${IMPORT_ENTITY_LABELS[entity].toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={run} loading={busy} disabled={selected.size === 0}>
            <Download className="h-4 w-4" aria-hidden />
            Exportar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <FormMessage error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Formato">
            <Select value={format} onChange={(e) => setFormat(e.target.value as FileFormat)}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </Select>
          </Field>
          {format === 'csv' && (
            <Field label="Separador">
              <Select value={delimiter} onChange={(e) => setDelimiter(e.target.value as ',' | ';')}>
                <option value=",">Coma (,)</option>
                <option value=";">Punto y coma (;)</option>
              </Select>
            </Field>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 font-medium">Registros</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'filtered'}
              onChange={() => setScope('filtered')}
            />
            {hasFilters ? 'Solo los que cumplen los filtros actuales' : 'Los de la lista actual'}
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            Todos los que tengo autorizados
          </label>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 font-medium">Columnas</legend>
          {!columns ? (
            <Spinner />
          ) : (
            <>
              <div className="mb-2 flex gap-3 text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSelected(new Set(columns.map((c) => c.key)))}
                >
                  Todas
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Ninguna
                </button>
              </div>
              <div className="grid max-h-60 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2">
                    <Checkbox
                      checked={selected.has(c.key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(c.key);
                        else next.delete(c.key);
                        setSelected(next);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
