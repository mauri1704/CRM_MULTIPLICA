import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Handshake,
  ListTodo,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { Card, Spinner } from '@/components/ui/misc';
import { FormMessage } from '@/components/ui/form-message';
import { api, errorMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useMoney } from '@/lib/money';
import type { DashboardData } from '@/lib/types';
import { BarsChart, LinesChart } from './charts';
import { FiltersBar } from './filters-bar';
import { MetaNote } from './meta-note';
import { useAnalyticsFilters } from './use-filters';

const LINK = {
  LEAD: '/prospectos',
  DEAL: '/negociaciones',
  CONTACT: '/contactos',
  COMPANY: '/companias',
} as const;

interface Kpi {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  to: string;
  hint?: string;
  alert?: boolean;
}

/** Dashboard comercial: indicadores, distribución por responsable, evolución y actividad reciente. */
export function Dashboard() {
  const f = useAnalyticsFilters(true);
  const money = useMoney();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', f.query],
    queryFn: () => api.get<DashboardData>('/dashboard', f.query),
    placeholderData: (prev) => prev,
  });

  const cur = data?.meta.currency ?? '';
  const kpis: Kpi[] = data
    ? [
        {
          key: 'activeLeads',
          label: 'Prospectos activos',
          value: String(data.kpis.activeLeads),
          icon: Target,
          to: '/prospectos',
          hint: 'hoy',
        },
        {
          key: 'newLeads',
          label: 'Prospectos nuevos',
          value: String(data.kpis.newLeads),
          icon: Sparkles,
          to: '/prospectos',
          hint: 'en el rango',
        },
        {
          key: 'openDeals',
          label: 'Negociaciones abiertas',
          value: String(data.kpis.openDeals),
          icon: Handshake,
          to: '/negociaciones',
          hint: 'hoy',
        },
        {
          key: 'wonDeals',
          label: 'Negociaciones ganadas',
          value: String(data.kpis.wonDeals),
          icon: CheckCircle2,
          to: '/reportes/won-sales',
          hint: 'en el rango',
        },
        {
          key: 'lostDeals',
          label: 'Negociaciones perdidas',
          value: String(data.kpis.lostDeals),
          icon: XCircle,
          to: '/reportes/lost-sales',
          hint: 'en el rango',
        },
        {
          key: 'pipeline',
          label: 'Valor del pipeline',
          value: money(data.kpis.pipelineValue, cur),
          icon: TrendingUp,
          to: '/reportes/pipeline-value',
          hint: 'negociaciones abiertas',
        },
        {
          key: 'closedSales',
          label: 'Ventas cerradas',
          value: money(data.kpis.closedSales, cur),
          icon: Banknote,
          to: '/reportes/won-sales',
          hint: 'en el rango',
        },
        {
          key: 'pendingTasks',
          label: 'Tareas pendientes',
          value: String(data.kpis.pendingTasks),
          icon: ListTodo,
          to: '/reportes/pending-tasks',
          hint: 'hoy',
        },
        {
          key: 'overdueTasks',
          label: 'Tareas vencidas',
          value: String(data.kpis.overdueTasks),
          icon: AlertTriangle,
          to: '/reportes/overdue-tasks',
          hint: 'hoy',
          alert: data.kpis.overdueTasks > 0,
        },
      ]
    : [];

  return (
    <section aria-labelledby="dash-title" className="mb-8">
      <h2 id="dash-title" className="mb-3 text-lg font-semibold">
        Dashboard comercial
      </h2>
      <FiltersBar value={f.value} onChange={f.set} onReset={f.reset} />
      {error && <FormMessage error={errorMessage(error)} />}
      {isLoading && !data && <Spinner />}
      {data && (
        <>
          <MetaNote meta={data.meta} />
          <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => (
              <li key={k.key}>
                <Link
                  to={k.to}
                  className={`flex h-full items-start gap-3 rounded-lg border bg-surface p-4 hover:border-primary/50 hover:bg-muted/40 ${k.alert ? 'border-danger/50' : 'border-border'}`}
                >
                  <k.icon
                    className={`mt-1 h-5 w-5 shrink-0 ${k.alert ? 'text-danger' : 'text-primary'}`}
                    aria-hidden
                  />
                  <span>
                    <span className="block text-sm text-fg-muted">{k.label}</span>
                    <span className="block text-2xl font-semibold">{k.value}</span>
                    <span className="block text-xs text-fg-muted">
                      {k.alert && 'Requieren atención · '}
                      {k.hint}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <LinesChart
                title={`Evolución de resultados (${data.evolutionUnit === 'month' ? 'por mes' : 'por semana'})`}
                data={data.evolution}
                x="label"
                series={[
                  { key: 'leadsCreated', label: 'Prospectos nuevos' },
                  { key: 'dealsWon', label: 'Ganadas' },
                  { key: 'dealsLost', label: 'Perdidas' },
                ]}
              />
            </Card>
            <Card className="p-4">
              <BarsChart
                title={`Ventas ganadas por período (${cur})`}
                data={data.evolution}
                x="label"
                series={[{ key: 'wonValue', label: `Ventas (${cur})` }]}
                format={(v) => money(v, cur)}
              />
            </Card>
          </div>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <BarsChart
                title={`Distribución por responsable (${cur})`}
                data={data.ownerDistribution}
                x="owner"
                series={[
                  { key: 'pipelineValue', label: 'Pipeline' },
                  { key: 'wonValue', label: 'Ganado en el rango' },
                ]}
                format={(v) => money(v, cur)}
              />
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-fg-muted">Ver tabla</summary>
                <table className="mt-2 w-full text-sm">
                  <thead className="text-left text-xs text-fg-muted">
                    <tr>
                      <th scope="col" className="py-1 font-medium">
                        Responsable
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Prospectos activos
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Negociaciones abiertas
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Pipeline
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.ownerDistribution.map((o) => (
                      <tr key={o.owner}>
                        <td className="py-1.5">{o.owner}</td>
                        <td className="py-1.5 text-right">{o.activeLeads}</td>
                        <td className="py-1.5 text-right">{o.openDeals}</td>
                        <td className="py-1.5 text-right">
                          {money(o.pipelineValue, cur, { code: false })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4" aria-hidden />
                Actividad comercial reciente
              </h3>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-fg-muted">Sin actividad reciente.</p>
              ) : (
                <ol className="max-h-80 space-y-2 overflow-y-auto text-sm">
                  {data.recentActivity.map((a, i) => (
                    <li key={i} className="flex flex-col">
                      <span>
                        <strong>{a.who}</strong> {a.text}
                        {a.link && (
                          <>
                            {' · '}
                            <Link
                              to={`${LINK[a.link.type]}?id=${a.link.id}`}
                              className="text-primary hover:underline"
                            >
                              abrir
                            </Link>
                          </>
                        )}
                      </span>
                      <span className="text-xs text-fg-muted">{relativeTime(a.at)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
