import { CONVERSION_CRITERIA_LABELS, type ReportMeta } from '@crm/shared';
import { AlertTriangle, Info } from 'lucide-react';
import { formatDate } from '@/lib/format';

const day = (d: string) => formatDate(`${d}T12:00:00-05:00`);

/**
 * Siempre indica moneda base, fecha y criterio de conversión (D-14), lo que se excluyó por falta
 * de tipo de cambio y cómo se calcula el indicador.
 */
export function MetaNote({ meta }: { meta: ReportMeta }) {
  return (
    <div className="mb-4 space-y-2 text-sm">
      <p className="flex items-start gap-2 text-fg-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Importes en <strong className="text-fg">{meta.currency}</strong>.{' '}
          {CONVERSION_CRITERIA_LABELS[meta.criterion]}
          {meta.criterion === 'CUTOFF'
            ? ` (${day(meta.cutoffDate)})`
            : ' (la fecha de corte se usa para lo abierto)'}
          .{meta.note ? ` ${meta.note}` : ''}
        </span>
      </p>
      {meta.excluded.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>
            Sin tipo de cambio a {meta.currency}: se excluyó{' '}
            {meta.excluded
              .map(
                (e) =>
                  `${e.count} registro(s) por ${Number(e.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${e.currency}`,
              )
              .join(' y ')}
            . Registre la tasa en «Tipos de cambio» para incluirlos.
          </span>
        </p>
      )}
      {meta.truncated && (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          Hay demasiados registros: se muestran los primeros 20.000. Acote con los filtros.
        </p>
      )}
    </div>
  );
}
