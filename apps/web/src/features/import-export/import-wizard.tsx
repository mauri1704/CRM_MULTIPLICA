import type { DuplicateMode, ImportEntity, ImportFieldInfo, ImportSummary } from '@crm/shared';
import { IMPORT_ENTITY_LABELS, MAX_IMPORT_ROWS } from '@crm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

interface UploadResult {
  jobId: string;
  fileName: string;
  totalRows: number;
  headers: string[];
  fields: ImportFieldInfo[];
  mapping: Record<string, string>;
  sample: Record<string, string>[];
}

type Result = ImportSummary & { created: number; updated: number; skipped: number };

const STEPS = ['Archivo', 'Columnas', 'Revisión', 'Resultado'];

/**
 * Asistente de importación: 1) archivo y plantilla, 2) mapeo de columnas y duplicados,
 * 3) vista previa con válidos/inválidos (no escribe), 4) confirmación y resultado.
 */
export function ImportWizard({
  entity,
  open,
  onOpenChange,
  canUpdate,
}: {
  entity: ImportEntity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canUpdate: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<DuplicateMode>('SKIP');
  const [atomic, setAtomic] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep(0);
    setFile(null);
    setUpload(null);
    setSummary(null);
    setResult(null);
    setError(null);
    setMode('SKIP');
    setAtomic(false);
  };
  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doUpload = () =>
    run(async () => {
      if (!file) return;
      const res = await api.upload<UploadResult>(`/import-export/${entity}/upload`, file);
      setUpload(res);
      setMapping(res.mapping);
      setStep(1);
    });
  const analyze = () =>
    run(async () => {
      if (!upload) return;
      setSummary(
        await api.post<ImportSummary>(`/import-export/jobs/${upload.jobId}/analyze`, {
          mapping,
          duplicateMode: mode,
          atomic,
        }),
      );
      setStep(2);
    });
  const confirm = () =>
    run(async () => {
      if (!upload) return;
      const res = await api.post<Result>(`/import-export/jobs/${upload.jobId}/confirm`, {
        mapping,
        duplicateMode: mode,
        atomic,
      });
      setResult(res);
      setStep(3);
      await qc.invalidateQueries();
      if (res.aborted) toast.error('No se importó nada: hay filas con errores.');
      else
        toast.success(
          `Importación terminada: ${res.created} creados, ${res.updated} actualizados.`,
        );
    });
  const errorsReport = () =>
    upload &&
    run(() => api.download(`/import-export/jobs/${upload.jobId}/errors`, { format: 'xlsx' }));

  const fieldLabel = (key: string) => upload?.fields.find((f) => f.key === key)?.label ?? key;
  const missing =
    upload?.fields.filter((f) => f.required && !Object.values(mapping).includes(f.key)) ?? [];
  const toImport = summary ? summary.toCreate + summary.toUpdate : 0;

  const footer = (
    <>
      <Button variant="secondary" onClick={() => close(false)}>
        {step === 3 ? 'Cerrar' : 'Cancelar'}
      </Button>
      {step === 0 && (
        <Button onClick={doUpload} disabled={!file} loading={busy}>
          <Upload className="h-4 w-4" aria-hidden />
          Subir y continuar
        </Button>
      )}
      {step === 1 && (
        <Button onClick={analyze} disabled={missing.length > 0} loading={busy}>
          Revisar datos
        </Button>
      )}
      {step === 2 && (
        <>
          <Button variant="secondary" onClick={() => setStep(1)} disabled={busy}>
            Volver
          </Button>
          <Button onClick={confirm} disabled={toImport === 0} loading={busy}>
            Importar {toImport} registro(s)
          </Button>
        </>
      )}
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      wide
      title={`Importar ${IMPORT_ENTITY_LABELS[entity].toLowerCase()}`}
      footer={footer}
    >
      <ol className="mb-5 flex gap-2 text-xs" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={cn(
              'flex-1 rounded border-b-2 px-2 py-1',
              i <= step ? 'border-primary font-medium text-fg' : 'border-border text-fg-muted',
            )}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <FormMessage error={error} className="mb-4" />

      {step === 0 && (
        <div className="space-y-4 text-sm">
          <p className="text-fg-muted">
            Suba un archivo Excel (.xlsx) o CSV con encabezados en la primera fila. Máximo{' '}
            {MAX_IMPORT_ROWS.toLocaleString('es-PE')} filas y 5 MB. Antes de guardar verá un resumen
            y podrá corregir errores.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void run(() =>
                  api.download(`/import-export/${entity}/template`, { format: 'xlsx' }),
                )
              }
            >
              <Download className="h-4 w-4" aria-hidden />
              Plantilla Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void run(() => api.download(`/import-export/${entity}/template`, { format: 'csv' }))
              }
            >
              <Download className="h-4 w-4" aria-hidden />
              Plantilla CSV
            </Button>
          </div>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center hover:border-primary/50">
            <FileSpreadsheet className="h-8 w-8 text-fg-muted" aria-hidden />
            <span className="font-medium">{file ? file.name : 'Elegir archivo'}</span>
            <span className="text-xs text-fg-muted">.xlsx o .csv</span>
            <input
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Archivo a importar"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      )}

      {step === 1 && upload && (
        <div className="space-y-4 text-sm">
          <p className="text-fg-muted">
            «{upload.fileName}»: {upload.totalRows} fila(s). Indique qué campo del CRM corresponde a
            cada columna.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    Columna del archivo
                  </th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    Ejemplo
                  </th>
                  <th scope="col" className="py-2 text-left font-medium">
                    Campo del CRM
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {upload.headers.map((h) => (
                  <tr key={h}>
                    <td className="py-1.5 pr-3 font-medium">{h}</td>
                    <td className="max-w-[180px] truncate py-1.5 pr-3 text-fg-muted">
                      {upload.sample[0]?.[h] || '—'}
                    </td>
                    <td className="py-1.5">
                      <Select
                        aria-label={`Campo para ${h}`}
                        value={mapping[h] ?? ''}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                        className="h-9"
                      >
                        <option value="">No importar</option>
                        {upload.fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? ' *' : ''}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <FormMessage error={`Falta asignar: ${missing.map((f) => f.label).join(', ')}.`} />
          )}
          <Field
            label="Si un registro ya existe"
            hint={upload.fields
              .filter((f) => f.hint?.includes('correspondencia'))
              .map((f) => `Se compara por ${f.label}.`)
              .join(' ')}
          >
            <Select value={mode} onChange={(e) => setMode(e.target.value as DuplicateMode)}>
              <option value="SKIP">Omitirlo (no cambiar el existente)</option>
              {canUpdate && <option value="UPDATE">Actualizarlo con los datos del archivo</option>}
              <option value="CREATE">
                Crear otro de todos modos (quedará por revisar como posible duplicado)
              </option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={atomic} onChange={(e) => setAtomic(e.target.checked)} />
            <span>
              <strong>Todo o nada.</strong> Si alguna fila tiene errores, no se guarda ninguna.
            </span>
          </label>
        </div>
      )}

      {step === 2 && summary && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Filas" value={summary.total} />
            <Stat label="Se crearán" value={summary.toCreate} tone="success" />
            <Stat
              label={
                mode === 'UPDATE'
                  ? 'Se actualizarán'
                  : mode === 'CREATE'
                    ? 'Coinciden con existentes'
                    : 'Duplicados omitidos'
              }
              value={
                mode === 'UPDATE'
                  ? summary.toUpdate
                  : mode === 'CREATE'
                    ? summary.duplicates
                    : summary.toSkip
              }
            />
            <Stat
              label="Con errores"
              value={summary.invalid}
              tone={summary.invalid > 0 ? 'danger' : undefined}
            />
          </dl>
          {summary.errors.length > 0 && (
            <ErrorTable errors={summary.errors} fieldLabel={fieldLabel} onDownload={errorsReport} />
          )}
          {summary.invalid > 0 && (
            <p className="flex items-start gap-2 text-fg-muted">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {atomic
                ? 'Con «Todo o nada» no se guardará ninguna fila mientras haya errores. Corrija el archivo y vuelva a subirlo.'
                : 'Las filas con errores no se importarán. Puede corregir el archivo y volver a subirlo, o importar ahora solo las válidas.'}
            </p>
          )}
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4 text-sm">
          {result.aborted ? (
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
              No se importó nada: hay filas con errores (modo «Todo o nada»)
            </p>
          ) : (
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
              Importación terminada
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Creados" value={result.created} tone="success" />
            <Stat label="Actualizados" value={result.updated} />
            <Stat label="Omitidos" value={result.skipped} />
            <Stat
              label="Con errores"
              value={result.invalid}
              tone={result.invalid > 0 ? 'danger' : undefined}
            />
          </dl>
          {(result.possibleDuplicates ?? 0) > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-muted p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                Se detectaron {result.possibleDuplicates} coincidencia(s) con registros existentes.{' '}
                <Link
                  to="/duplicados"
                  className="font-medium underline"
                  onClick={() => close(false)}
                >
                  Revisar duplicados
                </Link>
              </span>
            </p>
          )}
          {result.errors.length > 0 && (
            <ErrorTable errors={result.errors} fieldLabel={(k) => k} onDownload={errorsReport} />
          )}
        </div>
      )}
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd
        className={cn(
          'text-xl font-semibold',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ErrorTable({
  errors,
  fieldLabel,
  onDownload,
}: {
  errors: { row: number; field: string; message: string }[];
  fieldLabel: (k: string) => string;
  onDownload: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">
          Errores <Badge tone="danger">{errors.length}</Badge>
        </p>
        <Button variant="secondary" size="sm" onClick={onDownload}>
          <Download className="h-4 w-4" aria-hidden />
          Descargar reporte de errores
        </Button>
      </div>
      <div className="max-h-60 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-fg-muted">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Fila
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Campo
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Error
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {errors.map((e, i) => (
              <tr key={i}>
                <td className="px-2 py-1">{e.row}</td>
                <td className="px-2 py-1">{fieldLabel(e.field)}</td>
                <td className="px-2 py-1">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
