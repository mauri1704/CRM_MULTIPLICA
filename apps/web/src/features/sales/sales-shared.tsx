import { useQuery } from '@tanstack/react-query';
import { CalendarDays, KanbanSquare, List } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PriorityBadge } from '@/components/priority-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCatalog, useUserOptions } from '@/lib/hooks';
import type { Pipeline, PriorityRef, StageRef } from '@/lib/types';
import { LossDialog, WinDialog, todayLima } from './stage-dialogs';
import { STAGE_KIND } from './stage-kind';

export type SalesView = 'kanban' | 'list';
export type WorkView = SalesView | 'calendar';

const VIEWS = {
  kanban: { label: 'Tablero', icon: KanbanSquare },
  list: { label: 'Lista', icon: List },
  calendar: { label: 'Calendario', icon: CalendarDays },
} as const;

export const usePipelines = (entityType: 'LEAD' | 'DEAL') =>
  useQuery({
    queryKey: ['pipelines', entityType],
    queryFn: () => api.get<Pipeline[]>('/pipelines', { entityType }),
    staleTime: 300_000,
  });

/** Pipeline elegido (o el predeterminado si el guardado ya no existe). */
export function pickPipeline(pipelines: Pipeline[] | undefined, saved: string) {
  return (
    pipelines?.find((p) => p.id === saved) ?? pipelines?.find((p) => p.isDefault) ?? pipelines?.[0]
  );
}

export function ViewToggle<V extends WorkView>({
  value,
  onChange,
  views = ['kanban', 'list'] as V[],
}: {
  value: V;
  onChange: (v: V) => void;
  views?: V[];
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border p-0.5"
      role="group"
      aria-label="Vista"
    >
      {views
        .map((v) => [v, VIEWS[v].label, VIEWS[v].icon] as const)
        .map(([v, label, Icon]) => (
          <Button
            key={v}
            size="sm"
            variant={value === v ? 'primary' : 'ghost'}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Button>
        ))}
    </div>
  );
}

/** Filtros comunes: responsable y prioridad. */
export function OwnerPriorityFilters({
  ownerId,
  priorityId,
  onOwner,
  onPriority,
}: {
  ownerId: string;
  priorityId: string;
  onOwner: (v: string) => void;
  onPriority: (v: string) => void;
}) {
  const users = useUserOptions();
  const priorities = useCatalog('priorities');
  return (
    <>
      <Select
        aria-label="Responsable"
        value={ownerId}
        onChange={(e) => onOwner(e.target.value)}
        className="lg:w-56"
      >
        <option value="">Todos los responsables</option>
        {users.data?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Prioridad"
        value={priorityId}
        onChange={(e) => onPriority(e.target.value)}
        className="lg:w-52"
      >
        <option value="">Todas las prioridades</option>
        {priorities.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </>
  );
}

export function Priority({ p }: { p: PriorityRef | null }) {
  return p ? <PriorityBadge name={p.name} color={p.color} icon={p.icon} /> : null;
}

type Pending =
  | {
      kind: 'loss';
      entity: 'LEAD' | 'DEAL';
      resolve: (v: { lossReasonId: string; lossNote: string } | null) => void;
    }
  | {
      kind: 'win';
      defaultValue: string;
      currencyCode: string;
      resolve: (v: { finalValue: string; closedAt: string } | null) => void;
    };

/**
 * Diálogos que se abren al mover a una etapa de cierre y devuelven lo que el usuario confirme
 * (o null si cancela), para usarlos con await dentro del movimiento del tablero.
 */
export function useCloseDialogs() {
  const [pending, setPending] = useState<Pending | null>(null);
  const askLoss = (entity: 'LEAD' | 'DEAL') =>
    new Promise<{ lossReasonId: string; lossNote: string } | null>((resolve) =>
      setPending({ kind: 'loss', entity, resolve }),
    );
  const askWin = (defaultValue: string, currencyCode: string) =>
    new Promise<{ finalValue: string; closedAt: string } | null>((resolve) =>
      setPending({ kind: 'win', defaultValue, currencyCode, resolve }),
    );
  let dialog: ReactNode = null;
  if (pending?.kind === 'loss')
    dialog = (
      <LossDialog
        entity={pending.entity}
        onDone={(v) => {
          setPending(null);
          pending.resolve(v);
        }}
      />
    );
  if (pending?.kind === 'win')
    dialog = (
      <WinDialog
        defaultValue={pending.defaultValue}
        currencyCode={pending.currencyCode}
        today={todayLima()}
        onDone={(v) => {
          setPending(null);
          pending.resolve(v);
        }}
      />
    );
  return { askLoss, askWin, dialog };
}

/** Etapa con texto + ícono + color según su tipo. */
export function StageBadge({ stage }: { stage: StageRef }) {
  const k = STAGE_KIND[stage.kind];
  return (
    <Badge tone={k.tone} icon={k.icon}>
      {stage.name}
    </Badge>
  );
}
