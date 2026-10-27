import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Coins, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { formatMoney } from '@crm/shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCurrencies } from '@/lib/hooks';
import type { Currency } from '@/lib/types';
import { HistoryButton } from '@/components/history-drawer';

export function CurrenciesPage() {
  const { can } = useAuth();
  const manage = can('currencies', 'manage');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useCurrencies(true);
  const [editing, setEditing] = useState<Currency | 'new' | null>(null);
  const [makeBase, setMakeBase] = useState<Currency | null>(null);

  const toggle = async (c: Currency) => {
    try {
      await api.patch(`/currencies/${c.id}`, { active: !c.active });
      await qc.invalidateQueries({ queryKey: ['currencies'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: ColumnDef<Currency, unknown>[] = [
    {
      accessorKey: 'code',
      header: 'Moneda',
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span className="font-mono font-semibold">{row.original.code}</span>
          {row.original.name}
          {row.original.isBase && (
            <Badge tone="primary" icon={Star}>
              Principal
            </Badge>
          )}
        </span>
      ),
    },
    { accessorKey: 'symbol', header: 'Símbolo' },
    { accessorKey: 'decimals', header: 'Decimales' },
    {
      id: 'example',
      header: 'Ejemplo',
      enableSorting: false,
      cell: ({ row }) => formatMoney('1234.5', row.original),
    },
    {
      accessorKey: 'active',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.active ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <HistoryButton
            entityType="CURRENCY"
            entityId={row.original.id}
            title={row.original.code}
          />
          {manage && !row.original.isBase && (
            <>
              {row.original.active && (
                <Button variant="secondary" size="sm" onClick={() => setMakeBase(row.original)}>
                  Hacer principal
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void toggle(row.original)}>
                {row.original.active ? 'Desactivar' : 'Activar'}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Monedas"
        description="Monedas que se usan en productos, prospectos y negociaciones. La principal es la de los reportes consolidados."
        actions={
          <>
            <DataActions
              entity="currencies"
              module="currencies"
              filters={{}}
              importAction="manage"
              updateAction="manage"
            />
            {manage && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Nueva moneda
              </Button>
            )}
          </>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={manage ? (r) => setEditing(r) : undefined}
            rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
            empty={<EmptyState icon={Coins} title="Sin monedas" />}
          />
        )}
      </Card>
      {editing && (
        <CurrencyDialog
          currency={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {makeBase && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setMakeBase(null)}
          title={`Hacer ${makeBase.code} la moneda principal`}
          confirmLabel="Cambiar moneda principal"
          onConfirm={async () => {
            await api.post(`/currencies/${makeBase.id}/base`);
            await qc.invalidateQueries({ queryKey: ['currencies'] });
            await qc.invalidateQueries({ queryKey: ['organization'] });
            toast.success(`${makeBase.code} es ahora la moneda principal.`);
          }}
        >
          Los importes ya registrados conservan su moneda. Los reportes consolidados usarán{' '}
          {makeBase.code} por defecto.
        </ConfirmDialog>
      )}
    </div>
  );
}

function CurrencyDialog({ currency, onClose }: { currency: Currency | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    code: currency?.code ?? '',
    name: currency?.name ?? '',
    symbol: currency?.symbol ?? '',
    decimals: String(currency?.decimals ?? 2),
    symbolPosition: currency?.symbolPosition ?? 'BEFORE',
  });
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    const body = {
      name: v.name,
      symbol: v.symbol,
      decimals: Number(v.decimals),
      symbolPosition: v.symbolPosition,
    };
    try {
      if (currency) await api.patch(`/currencies/${currency.id}`, body);
      else await api.post('/currencies', { ...body, code: v.code });
      await qc.invalidateQueries({ queryKey: ['currencies'] });
      toast.success('Moneda guardada.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={currency ? `Editar ${currency.code}` : 'Nueva moneda'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código ISO" error={details.code} required hint="3 letras (ej.: EUR)">
            <Input
              maxLength={3}
              value={v.code}
              disabled={!!currency}
              onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Nombre" error={details.name} required>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Símbolo" error={details.symbol} required>
            <Input
              maxLength={5}
              value={v.symbol}
              onChange={(e) => setV({ ...v, symbol: e.target.value })}
            />
          </Field>
          <Field label="Decimales" error={details.decimals} required>
            <Select value={v.decimals} onChange={(e) => setV({ ...v, decimals: e.target.value })}>
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Posición del símbolo" error={details.symbolPosition}>
            <Select
              value={v.symbolPosition}
              onChange={(e) => setV({ ...v, symbolPosition: e.target.value as 'BEFORE' | 'AFTER' })}
            >
              <option value="BEFORE">Antes del importe</option>
              <option value="AFTER">Después del importe</option>
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">Vista previa</p>
            <p className="text-lg">
              {formatMoney('1234.5', {
                code: v.code,
                symbol: v.symbol || '¤',
                decimals: Number(v.decimals),
                symbolPosition: v.symbolPosition,
              })}
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
