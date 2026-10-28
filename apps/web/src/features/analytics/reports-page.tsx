import { REPORT_INFO, type ReportKey, type ReportResult } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useMoney } from '@/lib/money';
import type { ReportIndex } from '@/lib/types';
import { BarsChart, PieBreakdown } from './charts';
import { FiltersBar } from './filters-bar';
import { MetaNote } from './meta-note';
import { useAnalyticsFilters } from './use-filters';

/** Índice de reportes agrupado por tema. */
export function ReportsIndexPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'index'],
    queryFn: () => api.get<ReportIndex>('/reports'),
  });
  const groups = [...new Set(data?.reports.map((r) => r.group))];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Reportes"
        description="Datos reales, con el alcance de su rol. Todos se pueden filtrar y exportar a Excel o CSV."
      />
      {isLoading ? (
        <Spinner />
      ) : (
        groups.map((g) => (
          <section key={g} className="mb-6" aria-label={g}>
            <h2 className="mb-2 text-sm font-semibold text-fg-muted">{g}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data!.reports
                .filter((r) => r.group === g)
                .map((r) => (
                  <li key={r.key}>
                    <Link
                      to={`/reportes/${r.key}`}
                      className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:bg-muted/40"
                    >
                      <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span className="block font-medium">{r.title}</span>
                        <span className="block text-sm text-fg-muted">{r.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

/** Detalle de un reporte: filtros, criterio de conversión, gráfico, tabla y exportación. */
export function ReportPage() {
  const key = useParams().key as ReportKey;
  const { can } = useAuth();
  const toast = useToast();
  const money = useMoney();
  const f = useAnalyticsFilters(false);
  const [busy, setBusy] = useState<string | null>(null);
  const known = key in REPORT_INFO;
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', key, f.query],
    queryFn: () => api.get<ReportResult>(`/reports/${key}`, f.query),
    enabled: known,
    placeholderData: (prev) => prev,
  });

  const exportAs = async (format: 'xlsx' | 'csv') => {
    setBusy(format);
    try {
      await api.download(`/reports/${key}/export`, { ...f.query, format });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!known) return <EmptyState icon={BarChart3} title="Ese reporte no existe" />;
  const info = REPORT_INFO[key];
  const cell = (type: string, v: string | number | null) => {
    if (v === null || v === undefined || v === '') return '—';
    if (type === 'money') return money(v as number, data!.meta.currency, { code: false });
    if (type === 'percent')
      return `${Number(v).toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`;
    if (type === 'number') return Number(v).toLocaleString('es-PE', { maximumFractionDigits: 2 });
    if (type === 'date' && typeof v === 'string')
      return dayRe.test(v)
        ? formatDate(`${v}T12:00:00-05:00`)
        : `${formatDate(`${v.slice(0, 10)}T12:00:00-05:00`)} ${v.slice(11)}`;
    return String(v);
  };
  const chart = data?.chart;
  const fmtMoney = (v: number) => money(v, data!.meta.currency);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={info.title}
        description={info.description}
        actions={
          <>
            <Link to="/reportes">
              <Button variant="secondary">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Reportes
              </Button>
            </Link>
            {can('reports', 'export') && (
              <>
                <Button
                  variant="secondary"
                  loading={busy === 'csv'}
                  onClick={() => void exportAs('csv')}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  CSV
                </Button>
                <Button loading={busy === 'xlsx'} onClick={() => void exportAs('xlsx')}>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  Excel
                </Button>
              </>
            )}
          </>
        }
      />
      <FiltersBar value={f.value} onChange={f.set} onReset={f.reset} />
      {error && <FormMessage error={errorMessage(error)} />}
      {isLoading && !data && <Spinner />}
      {data && (
        <>
          <MetaNote meta={data.meta} />
          {chart && chart.data.length > 0 && (
            <Card className="mb-4 p-4">
              {chart.type === 'pie' ? (
                <PieBreakdown
                  title={info.title}
                  data={chart.data}
                  x={chart.x}
                  series={chart.series}
                />
              ) : (
                <BarsChart
                  title={info.title}
                  data={chart.data}
                  x={chart.x}
                  series={chart.series}
                  format={
                    chart.series.some((s) => /Importe|Pipeline|Ponderado|Ventas/.test(s.label))
                      ? fmtMoney
                      : undefined
                  }
                />
              )}
            </Card>
          )}
          <Card>
            {data.rows.length === 0 ? (
              <EmptyState icon={BarChart3} title="Sin datos para estos filtros" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">{info.title}</caption>
                  <thead className="bg-muted/50 text-left text-xs text-fg-muted">
                    <tr>
                      {data.columns.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className={`px-3 py-2 font-medium ${c.type === 'text' || c.type === 'date' ? '' : 'text-right'}`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.rows.map((r, i) => (
                      <tr key={i}>
                        {data.columns.map((c) => (
                          <td
                            key={c.key}
                            className={`px-3 py-2 ${c.type === 'text' || c.type === 'date' ? '' : 'whitespace-nowrap text-right'}`}
                          >
                            {cell(c.type, r[c.key] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {data.totals && (
                    <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
                      <tr>
                        {data.columns.map((c, i) => (
                          <td
                            key={c.key}
                            className={`px-3 py-2 ${c.type === 'text' || c.type === 'date' ? '' : 'whitespace-nowrap text-right'}`}
                          >
                            {data.totals![c.key] !== undefined && data.totals![c.key] !== null
                              ? cell(c.type, data.totals![c.key]!)
                              : i === 0
                                ? 'Total'
                                : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
