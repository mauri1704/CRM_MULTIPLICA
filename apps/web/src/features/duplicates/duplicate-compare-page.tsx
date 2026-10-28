import { CANDIDATE_STATUS_LABELS, DUPLICATE_ENTITY_LABELS, type MergeChoice } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, GitMerge, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { DuplicateCompare, DuplicateSide } from '@/lib/types';
import { DUPLICATE_PATHS } from './duplicate-guard';

type Side = 'A' | 'B' | 'BOTH';

/** Comparación lado a lado y fusión segura (D-10). */
export function DuplicateComparePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Side>>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['duplicates', 'compare', id],
    queryFn: () => api.get<DuplicateCompare>(`/duplicates/candidates/${id}`),
  });

  const done = async (message: string) => {
    await qc.invalidateQueries();
    toast.success(message);
    void navigate('/duplicados');
  };
  const resolve = useMutation({
    mutationFn: (kind: 'keep-both' | 'reviewed') =>
      api.post(`/duplicates/candidates/${id}/${kind}`, {}),
    onSuccess: (_r, kind) =>
      done(kind === 'keep-both' ? 'Se conservarán ambos registros.' : 'Marcado como revisado.'),
    onError: (e) => setError(errorMessage(e)),
  });

  const merge = useMutation({
    mutationFn: (v: { survivorId: string; choices: Record<string, MergeChoice> }) =>
      api.post('/duplicates/merge', { candidateId: id, ...v }),
  });

  if (isLoading) return <Spinner />;
  if (loadError || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <FormMessage
          error={
            loadError instanceof ApiError ? loadError.message : 'No se pudo cargar la coincidencia.'
          }
        />
        <Link to="/duplicados" className="mt-3 inline-block underline">
          Volver a duplicados
        </Link>
      </div>
    );
  }

  const open = data.candidate.status === 'OPEN';
  const survivor = survivorId ?? data.suggestedSurvivorId;
  const survivorSide: 'A' | 'B' = survivor === data.a.id ? 'A' : 'B';
  const absorbed = survivorSide === 'A' ? data.b : data.a;
  const keep = survivorSide === 'A' ? data.a : data.b;
  const text = (f: DuplicateCompare['fields'][number], s: 'A' | 'B') => (s === 'A' ? f.a : f.b);

  // Por omisión se conserva el valor del principal; si está vacío y el otro no, el del otro.
  const sideOf = (f: DuplicateCompare['fields'][number]): Side =>
    picked[f.key] ??
    (text(f, survivorSide) === null && text(f, survivorSide === 'A' ? 'B' : 'A') !== null
      ? survivorSide === 'A'
        ? 'B'
        : 'A'
      : survivorSide);

  const choices = (): Record<string, MergeChoice> =>
    Object.fromEntries(
      data.fields
        .filter((f) => f.differs)
        .map((f) => {
          const s = sideOf(f);
          return [
            f.key,
            s === 'BOTH' ? 'BOTH' : s === survivorSide ? 'SURVIVOR' : 'ABSORBED',
          ] as const;
        }),
    );

  const movedTotal = data.relations.reduce((n, r) => n + (survivorSide === 'A' ? r.b : r.a), 0);

  const diffCount = data.fields.filter((f) => f.differs).length;
  const blocked = data.restrictions.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Comparar ${DUPLICATE_ENTITY_LABELS[data.entityType].plural.toLowerCase()}`}
        description={`${Math.round(data.candidate.score * 100)} % de parecido · ${data.candidate.matched.map((m) => m.rule).join(', ')}`}
        actions={
          <Link to="/duplicados">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver
            </Button>
          </Link>
        }
      />
      {!open && (
        <p className="mb-4 rounded-md bg-muted p-3 text-sm">
          Esta coincidencia está en estado{' '}
          <strong>{CANDIDATE_STATUS_LABELS[data.candidate.status]}</strong>
          {data.candidate.reviewedAt ? ` desde el ${formatDate(data.candidate.reviewedAt)}` : ''}.
        </p>
      )}
      <FormMessage error={error} className="mb-4" />
      {open && blocked && <FormMessage error={data.restrictions.join(' ')} className="mb-4" />}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {(
          [
            ['A', data.a],
            ['B', data.b],
          ] as const
        ).map(([s, rec]) => (
          <RecordCard
            key={s}
            label={`Registro ${s}`}
            rec={rec}
            path={DUPLICATE_PATHS[data.entityType]}
            selectable={open}
            selected={survivor === rec.id}
            onSelect={() => {
              setSurvivorId(rec.id);
              setPicked({});
            }}
          />
        ))}
      </div>

      <Card className="mb-4">
        <table className="w-full text-sm">
          <caption className="sr-only">Comparación campo por campo</caption>
          <thead className="bg-muted/50 text-left text-xs text-fg-muted">
            <tr>
              <th scope="col" className="w-1/5 px-3 py-2 font-medium">
                Campo
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Registro A{survivorSide === 'A' && open ? ' (se conserva)' : ''}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Registro B{survivorSide === 'B' && open ? ' (se conserva)' : ''}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.fields.map((f) => {
              const side = sideOf(f);
              return (
                <tr key={f.key} className={f.differs ? 'bg-warning/5' : undefined}>
                  <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                    {f.label}
                    {f.differs && <Badge tone="warning">Distinto</Badge>}
                  </th>
                  {(['A', 'B'] as const).map((s) => (
                    <td key={s} className="px-3 py-2 align-top">
                      {f.differs && open ? (
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name={`f-${f.key}`}
                            className="mt-1"
                            checked={side === s}
                            onChange={() => setPicked({ ...picked, [f.key]: s })}
                            aria-label={`${f.label}: usar el valor del registro ${s}`}
                          />
                          <span
                            className={
                              side === s || side === 'BOTH' ? 'font-medium' : 'text-fg-muted'
                            }
                          >
                            {text(f, s) ?? '—'}
                          </span>
                        </label>
                      ) : (
                        <span className={f.differs ? '' : 'text-fg-muted'}>
                          {text(f, s) ?? '—'}
                        </span>
                      )}
                      {s === 'B' && f.differs && f.long && open && (
                        <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                          <input
                            type="checkbox"
                            checked={side === 'BOTH'}
                            onChange={(e) => {
                              const next = { ...picked };
                              if (e.target.checked) next[f.key] = 'BOTH';
                              else delete next[f.key];
                              setPicked(next);
                            }}
                          />
                          Combinar ambos textos
                        </label>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="mb-6 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" aria-hidden />
          Relaciones que pasan al registro conservado
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Relación
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Registro A
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Registro B
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.relations.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5">{r.label}</td>
                <td
                  className={`py-1.5 text-right ${open && survivorSide === 'B' && r.a > 0 ? 'font-semibold text-primary' : ''}`}
                >
                  {r.a}
                </td>
                <td
                  className={`py-1.5 text-right ${open && survivorSide === 'A' && r.b > 0 ? 'font-semibold text-primary' : ''}`}
                >
                  {r.b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {open && (
          <p className="mt-2 text-xs text-fg-muted">
            En azul, lo que se moverá desde «{absorbed.name}». No se elimina ninguna relación.
          </p>
        )}
      </Card>

      {open && (
        <div className="flex flex-wrap justify-end gap-2">
          {can('duplicates', 'merge') && (
            <>
              <Button
                variant="secondary"
                loading={resolve.isPending}
                onClick={() => resolve.mutate('keep-both')}
              >
                Conservar ambos
              </Button>
              <Button
                variant="secondary"
                loading={resolve.isPending}
                onClick={() => resolve.mutate('reviewed')}
              >
                <CheckCheck className="h-4 w-4" aria-hidden />
                Marcar como revisado
              </Button>
              <Button disabled={blocked} onClick={() => setConfirming(true)}>
                <GitMerge className="h-4 w-4" aria-hidden />
                Fusionar…
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Fusionar registros"
        confirmLabel="Fusionar"
        danger
        onConfirm={async () => {
          setError(null);
          try {
            await merge.mutateAsync({ survivorId: survivor, choices: choices() });
            await done(
              `Fusionado: «${absorbed.name}» pasó a la papelera y sus relaciones a «${keep.name}».`,
            );
          } catch (e) {
            setError(errorMessage(e));
            setConfirming(false);
          }
        }}
      >
        Se conservará <strong>«{keep.name}»</strong> con{' '}
        {diffCount === 0
          ? 'sus mismos datos'
          : `los valores que eligió (${diffCount} campo(s) distinto(s))`}
        . <strong>«{absorbed.name}»</strong> irá a la papelera marcado como fusionado
        {movedTotal > 0 ? ` y ${movedTotal} relación(es) pasarán al registro conservado` : ''}. La
        fusión no se deshace automáticamente.
      </ConfirmDialog>
    </div>
  );
}

function RecordCard({
  label,
  rec,
  path,
  selectable,
  selected,
  onSelect,
}: {
  label: string;
  rec: DuplicateSide;
  path: string;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card className={`p-4 ${selected && selectable ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{label}</p>
          <p className="truncate font-semibold">{rec.name}</p>
          <p className="text-xs text-fg-muted">
            {[
              rec.code,
              rec.ownerName,
              rec.createdAt ? `creado el ${formatDate(rec.createdAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {!rec.deleted && (
            <a
              href={`${path}?id=${rec.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline"
            >
              Abrir ficha
            </a>
          )}
        </div>
        {selectable && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" name="survivor" checked={selected} onChange={onSelect} />
            Conservar este
          </label>
        )}
      </div>
    </Card>
  );
}
