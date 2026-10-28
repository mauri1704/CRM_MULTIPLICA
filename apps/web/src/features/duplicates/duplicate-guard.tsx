import type { DuplicateEntity } from '@crm/shared';
import { DUPLICATE_ENTITY_LABELS } from '@crm/shared';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormMessage } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import type { DuplicateHit } from '@/lib/types';

export const DUPLICATE_PATHS: Record<DuplicateEntity, string> = {
  CONTACT: '/contactos',
  COMPANY: '/companias',
  PRODUCT: '/productos',
  LEAD: '/prospectos',
  DEAL: '/negociaciones',
  PROJECT: '/proyectos',
};

/**
 * Aviso al guardar (D-15): antes de crear un registro se consulta si ya existe uno parecido; la
 * persona decide si continúa. Las reglas «Impedir guardar» no permiten continuar (la API también
 * las rechaza). Si la consulta falla, el guardado sigue: el aviso nunca debe estorbar.
 */
export function useDuplicateGuard(entityType: DuplicateEntity) {
  const [pending, setPending] = useState<{
    hits: DuplicateHit[];
    resolve: (proceed: boolean) => void;
  } | null>(null);

  const confirm = async (values: Record<string, unknown>, excludeId?: string): Promise<boolean> => {
    let hits: DuplicateHit[];
    try {
      hits = await api.post<DuplicateHit[]>('/duplicates/check', { entityType, values, excludeId });
    } catch {
      return true;
    }
    if (hits.length === 0) return true;
    return new Promise<boolean>((resolve) => setPending({ hits, resolve }));
  };

  const answer = (proceed: boolean) => {
    pending?.resolve(proceed);
    setPending(null);
  };

  const dialog: ReactNode = pending && (
    <WarningDialog entityType={entityType} hits={pending.hits} onAnswer={answer} />
  );
  return { confirm, dialog };
}

function WarningDialog({
  entityType,
  hits,
  onAnswer,
}: {
  entityType: DuplicateEntity;
  hits: DuplicateHit[];
  onAnswer: (proceed: boolean) => void;
}) {
  const blocking = hits.some((h) => h.blocking);
  const label = DUPLICATE_ENTITY_LABELS[entityType].singular.toLowerCase();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onAnswer(false)}
      title="Posibles duplicados"
      description={`Ya existe${hits.length > 1 ? 'n' : ''} ${hits.length} ${label}${hits.length > 1 ? 's' : ''} parecido${hits.length > 1 ? 's' : ''}.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onAnswer(false)} autoFocus>
            Volver y revisar
          </Button>
          <Button disabled={blocking} onClick={() => onAnswer(true)}>
            Guardar de todas formas
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {blocking && (
          <FormMessage error="Una regla de su organización impide guardar un registro duplicado." />
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {hits.map((h, i) => (
            <li key={h.id ?? i} className="flex items-start gap-3 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                {h.visible && h.id ? (
                  <a
                    href={`${DUPLICATE_PATHS[entityType]}?id=${h.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {[h.code, h.name].filter(Boolean).join(' · ')}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  <p className="font-medium">Existe un registro parecido al que no tiene acceso.</p>
                )}
                <p className="text-xs text-fg-muted">
                  Coincide por: {h.rules.map((r) => r.name).join(', ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-fg-muted">
          Si es la misma persona o empresa, conviene usar el registro existente en vez de crear
          otro.
        </p>
      </div>
    </Dialog>
  );
}
