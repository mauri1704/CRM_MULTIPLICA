import {
  CANDIDATE_STATUSES,
  CANDIDATE_STATUS_LABELS,
  DUPLICATE_ENTITIES,
  DUPLICATE_ENTITY_LABELS,
  type CandidateStatus,
  type DuplicateEntity,
} from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyCheck, ScanSearch, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { DuplicateCandidate, Page } from '@/lib/types';

const PAGE_SIZE = 25;
const SOURCE_LABELS = { SCAN: 'Búsqueda', SAVE: 'Al guardar', IMPORT: 'Importación' } as const;

interface ScanResult {
  entityType: DuplicateEntity;
  found: number;
  created: number;
  truncated: boolean;
}

export function DuplicatesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [entity, setEntity] = useState<DuplicateEntity>('CONTACT');
  const [status, setStatus] = useState<CandidateStatus>('OPEN');
  const [page, setPage] = useState(1);
  const entities = DUPLICATE_ENTITIES.filter((e) => can(MODULE[e], 'view'));
  const active = entities.includes(entity) ? entity : entities[0];

  const counts = useQuery({
    queryKey: ['duplicates', 'counts'],
    queryFn: () => api.get<Record<string, number>>('/duplicates/counts'),
  });
  const list = useQuery({
    queryKey: ['duplicates', 'list', active, status, page],
    queryFn: () =>
      api.get<Page<DuplicateCandidate>>('/duplicates/candidates', {
        entityType: active,
        status,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!active,
    placeholderData: (prev) => prev,
  });
  const scan = useMutation({
    mutationFn: () => api.post<ScanResult[]>('/duplicates/scan', { entityType: active }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['duplicates'] });
      const one = r[0];
      toast.success(
        one && one.found > 0
          ? `Se encontraron ${one.found} coincidencia(s) (${one.created} nueva(s)).${one.truncated ? ' Hay más: acote con las reglas.' : ''}`
          : 'No se encontraron coincidencias.',
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = useMemo<ColumnDef<DuplicateCandidate, unknown>[]>(
    () => [
      {
        id: 'records',
        header: 'Registros',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            {[row.original.a, row.original.b].map((s) => (
              <p key={s.id} className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.code && <span className="text-xs text-fg-muted">{s.code}</span>}
                {s.deleted && <Badge>En papelera</Badge>}
              </p>
            ))}
          </div>
        ),
      },
      {
        id: 'score',
        header: 'Parecido',
        cell: ({ row }) => (
          <span className="font-medium">{Math.round(row.original.score * 100)} %</span>
        ),
      },
      {
        id: 'rules',
        header: 'Coincide por',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            {row.original.matched.map((m) => (
              <p key={m.rule}>
                {m.rule} <span className="text-xs text-fg-muted">({m.fields.join(' + ')})</span>
              </p>
            ))}
          </div>
        ),
      },
      {
        id: 'source',
        header: 'Origen',
        cell: ({ row }) => SOURCE_LABELS[row.original.source],
      },
      {
        id: 'createdAt',
        header: 'Detectada',
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Duplicados"
        description="Registros que podrían ser el mismo. Nada se elimina ni se fusiona solo: usted decide."
        actions={
          <>
            {can('duplicates', 'manage') && (
              <Link to="/duplicados/reglas">
                <Button variant="secondary">
                  <Settings2 className="h-4 w-4" aria-hidden />
                  Reglas
                </Button>
              </Link>
            )}
            <Button onClick={() => scan.mutate()} loading={scan.isPending} disabled={!active}>
              <ScanSearch className="h-4 w-4" aria-hidden />
              Buscar duplicados
            </Button>
          </>
        }
      />
      <div role="tablist" aria-label="Módulo" className="mb-3 flex flex-wrap gap-1">
        {entities.map((e) => (
          <Button
            key={e}
            role="tab"
            aria-selected={active === e}
            size="sm"
            variant={active === e ? 'primary' : 'secondary'}
            onClick={() => {
              setEntity(e);
              setPage(1);
            }}
          >
            {DUPLICATE_ENTITY_LABELS[e].plural}
            {(counts.data?.[e] ?? 0) > 0 && (
              <span
                className="ml-1 rounded-full bg-surface/30 px-1.5 text-xs"
                aria-label={`${counts.data?.[e]} por revisar`}
              >
                {counts.data?.[e]}
              </span>
            )}
          </Button>
        ))}
      </div>
      <Card>
        <div className="flex items-center gap-3 border-b border-border p-3">
          <Select
            aria-label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CandidateStatus);
              setPage(1);
            }}
            className="w-56"
          >
            {CANDIDATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CANDIDATE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => void navigate(`/duplicados/${r.id}`)}
            empty={
              <EmptyState
                icon={CopyCheck}
                title={
                  status === 'OPEN'
                    ? 'Sin coincidencias por revisar'
                    : 'Sin registros en este estado'
                }
              >
                {status === 'OPEN' &&
                  'Use «Buscar duplicados» para revisar todo el módulo con las reglas activas.'}
              </EmptyState>
            }
            pagination={
              list.data
                ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
    </div>
  );
}

const MODULE = {
  CONTACT: 'contacts',
  COMPANY: 'companies',
  PRODUCT: 'products',
  LEAD: 'leads',
  DEAL: 'deals',
  PROJECT: 'projects',
} as const;
