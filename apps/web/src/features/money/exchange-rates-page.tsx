import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, CheckCircle2, History, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useCurrencies } from '@/lib/hooks';
import type { ExchangeRate, ExchangeRateHistoryEntry, Page } from '@/lib/types';

const PAGE_SIZE = 50;
const todayLima = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const showDate = (iso: string) => formatDate(`${iso}T12:00:00`);

export function ExchangeRatesPage() {
  const { can } = useAuth();
  const manage = can('exchange_rates', 'manage');
  const currencies = useCurrencies();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ExchangeRate | 'new' | null>(null);
  const [historyOf, setHistoryOf] = useState<ExchangeRate | null>(null);
  const filters = { from, to, currency, status };
  const { data, isLoading } = useQuery({
    queryKey: ['exchange-rates', filters, page],
    queryFn: () =>
      api.get<Page<ExchangeRate>>('/exchange-rates', { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const columns: ColumnDef<ExchangeRate, unknown>[] = [
    {
      accessorKey: 'rateDate',
      header: 'Fecha',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{showDate(row.original.rateDate)}</span>
      ),
    },
    {
      id: 'pair',
      header: 'Par',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.fromCurrency} → {row.original.toCurrency}
        </span>
      ),
    },
    {
      accessorKey: 'rate',
      header: 'Tipo de cambio',
      cell: ({ row }) => <span className="font-mono">{row.original.rate}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'ACTIVE' ? (
          <Badge tone="success" icon={CheckCircle2}>
            Activo
          </Badge>
        ) : (
          <Badge icon={XCircle}>Inactivo</Badge>
        ),
    },
    {
      accessorKey: 'source',
      header: 'Origen',
      cell: ({ row }) => (row.original.source === 'IMPORT' ? 'Importación' : 'Manual'),
    },
    {
      id: 'updated',
      header: 'Última modificación',
      enableSorting: false,
      cell: ({ row }) =>
        `${formatDateTime(row.original.updatedAt)} · ${row.original.updatedByName ?? '—'}`,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOf(row.original)}>
            <History className="h-4 w-4" aria-hidden />
            Historial
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Tipos de cambio"
        description="Maestro diario. 1 unidad de la moneda origen = tasa en la moneda destino. Sin servicios externos: se registran o importan aquí."
        actions={
          <>
            <DataActions
              entity="exchange-rates"
              module="exchange_rates"
              filters={filters}
              importAction="manage"
              updateAction="manage"
            />
            {manage && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Registrar tasa
              </Button>
            )}
          </>
        }
      />
      <RateFinder />
      <Card>
        <div className="grid gap-3 border-b border-border p-3 sm:grid-cols-4">
          <Field label="Desde">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Moneda">
            <Select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {currencies.data?.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos</option>
            </Select>
          </Field>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={manage ? (r) => setEditing(r) : undefined}
            rowClassName={(r) => (r.status === 'ACTIVE' ? undefined : 'opacity-60')}
            empty={
              <EmptyState
                icon={ArrowRightLeft}
                title="No hay tasas registradas para esos filtros"
              />
            }
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {editing && (
        <RateDialog rate={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {historyOf && <RateHistory rate={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

/** Consulta la tasa aplicable con la regla de selección configurada (D-05). */
function RateFinder() {
  const currencies = useCurrencies();
  const [q, setQ] = useState({ from: 'USD', to: 'PEN', date: todayLima(), amount: '1' });
  const { data, isFetching, error } = useQuery({
    queryKey: ['exchange-rates', 'resolve', q],
    queryFn: () =>
      api.get<{
        found: boolean;
        message?: string;
        rate?: string;
        rateDate?: string;
        inverse?: boolean;
        ageDays?: number;
        converted?: string;
      }>('/exchange-rates/resolve', q),
    enabled: q.from !== '' && q.to !== '' && q.date !== '' && /^\d+(\.\d{1,4})?$/.test(q.amount),
  });
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 text-sm font-semibold">Tasa aplicable</h2>
      <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <Field label="Importe">
          <Input
            inputMode="decimal"
            value={q.amount}
            onChange={(e) => setQ({ ...q, amount: e.target.value.replace(',', '.') })}
          />
        </Field>
        <Field label="De">
          <Select value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })}>
            {currencies.data?.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="A">
          <Select value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })}>
            {currencies.data?.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha">
          <Input
            type="date"
            value={q.date}
            onChange={(e) => setQ({ ...q, date: e.target.value })}
          />
        </Field>
        <div className="text-sm" aria-live="polite">
          {isFetching ? (
            <span className="text-fg-muted">Calculando…</span>
          ) : error ? (
            <span className="text-danger">{errorMessage(error)}</span>
          ) : data?.found ? (
            <div>
              <p className="text-lg font-semibold">
                {data.converted} {q.to}
              </p>
              <p className="text-xs text-fg-muted">
                Tasa {data.rate?.replace(/0+$/, '').replace(/\.$/, '')} del{' '}
                {data.rateDate && showDate(data.rateDate)}
                {data.inverse ? ' (inversa)' : ''}
                {data.ageDays ? ` · ${data.ageDays} día(s) de antigüedad` : ''}
              </p>
            </div>
          ) : data ? (
            <span className="text-danger">{data.message}</span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function RateDialog({ rate, onClose }: { rate: ExchangeRate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const currencies = useCurrencies();
  const [v, setV] = useState({
    date: rate?.rateDate ?? todayLima(),
    fromCurrency: rate?.fromCurrency ?? 'USD',
    toCurrency: rate?.toCurrency ?? currencies.data?.find((c) => c.isBase)?.code ?? 'PEN',
    rate: rate?.rate ?? '',
    active: rate ? rate.status === 'ACTIVE' : true,
    reason: '',
  });
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    try {
      if (rate)
        await api.patch(`/exchange-rates/${rate.id}`, {
          rate: v.rate,
          active: v.active,
          reason: v.reason,
        });
      else
        await api.post('/exchange-rates', {
          date: v.date,
          fromCurrency: v.fromCurrency,
          toCurrency: v.toCurrency,
          rate: v.rate,
        });
      await qc.invalidateQueries({ queryKey: ['exchange-rates'] });
      toast.success(rate ? 'Tasa actualizada.' : 'Tasa registrada.');
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
      title={
        rate
          ? `Editar tasa ${rate.fromCurrency}→${rate.toCurrency} del ${showDate(rate.rateDate)}`
          : 'Registrar tipo de cambio'
      }
      description={
        rate
          ? 'El cambio queda en el historial. Los importes ya guardados no se modifican.'
          : undefined
      }
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
        {!rate && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fecha de vigencia" error={details.date} required>
              <Input
                type="date"
                value={v.date}
                onChange={(e) => setV({ ...v, date: e.target.value })}
              />
            </Field>
            <Field label="Moneda origen" error={details.fromCurrency} required>
              <Select
                value={v.fromCurrency}
                onChange={(e) => setV({ ...v, fromCurrency: e.target.value })}
              >
                {currencies.data?.map((c) => (
                  <option key={c.code}>{c.code}</option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda destino" error={details.toCurrency} required>
              <Select
                value={v.toCurrency}
                onChange={(e) => setV({ ...v, toCurrency: e.target.value })}
              >
                {currencies.data?.map((c) => (
                  <option key={c.code}>{c.code}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field
          label="Tipo de cambio"
          error={details.rate}
          required
          hint={`1 ${v.fromCurrency} = ? ${v.toCurrency}`}
        >
          <Input
            inputMode="decimal"
            value={v.rate}
            onChange={(e) => setV({ ...v, rate: e.target.value.replace(',', '.') })}
          />
        </Field>
        {rate && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.active}
                onChange={(e) => setV({ ...v, active: e.target.checked })}
              />
              Activa (solo las activas se usan para convertir)
            </label>
            <Field label="Motivo del cambio" error={details.reason} required>
              <Input
                value={v.reason}
                onChange={(e) => setV({ ...v, reason: e.target.value })}
                placeholder="Ej.: corrección según SBS"
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function RateHistory({ rate, onClose }: { rate: ExchangeRate; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['exchange-rates', 'history', rate.id],
    queryFn: () => api.get<ExchangeRateHistoryEntry[]>(`/exchange-rates/${rate.id}/history`),
  });
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Historial ${rate.fromCurrency}→${rate.toCurrency}`}
      description={showDate(rate.rateDate)}
    >
      {!data ? (
        <Spinner />
      ) : (
        <ol className="space-y-4">
          {data.map((h) => (
            <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="font-medium">{h.reason}</p>
              <p className="text-xs text-fg-muted">
                {formatDateTime(h.createdAt)} · {h.userName ?? 'Sistema'}
              </p>
              <p className="mt-1 text-xs">
                {h.oldRate !== null &&
                  h.oldRate !== h.newRate &&
                  `Tasa: ${h.oldRate} → ${h.newRate}. `}
                {h.oldRate === null && `Tasa: ${h.newRate}. `}
                {h.oldStatus &&
                  h.oldStatus !== h.newStatus &&
                  `Estado: ${h.oldStatus === 'ACTIVE' ? 'activa' : 'inactiva'} → ${h.newStatus === 'ACTIVE' ? 'activa' : 'inactiva'}.`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
