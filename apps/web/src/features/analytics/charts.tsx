import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Paleta distinguible también en modo oscuro; los gráficos llevan además tabla y etiquetas. */
export const PALETTE = [
  '#3b82f6',
  '#16a34a',
  '#f59e0b',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

type Datum = Record<string, string | number | null>;
interface Series {
  key: string;
  label: string;
}

const compact = new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });

function Frame({
  title,
  label,
  children,
  height,
}: {
  title: string;
  label: string;
  children: ReactNode;
  height: number;
}) {
  return (
    <figure className="text-fg-muted" role="img" aria-label={label}>
      <figcaption className="mb-2 text-sm font-semibold text-fg">{title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

const tooltipStyle = {
  background: 'rgb(var(--surface))',
  border: '1px solid rgb(var(--border))',
  borderRadius: 8,
  color: 'rgb(var(--fg))',
  fontSize: 12,
} as const;

export function BarsChart({
  title,
  data,
  x,
  series,
  height = 260,
  format,
}: {
  title: string;
  data: Datum[];
  x: string;
  series: Series[];
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <EmptyChart title={title} />;
  return (
    <Frame
      title={title}
      height={height}
      label={`${title}: ${data.map((d) => `${d[x]} ${series.map((s) => d[s.key]).join('/')}`).join('; ')}`}
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
        <XAxis
          dataKey={x}
          tick={{ fill: 'currentColor', fontSize: 12 }}
          interval={0}
          tickFormatter={(v: string) =>
            String(v).length > 14 ? `${String(v).slice(0, 13)}…` : String(v)
          }
        />
        <YAxis
          tick={{ fill: 'currentColor', fontSize: 12 }}
          tickFormatter={(v: number) => compact.format(v)}
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => (format ? format(Number(v)) : full.format(Number(v)))}
          cursor={{ fill: 'rgb(var(--muted))' }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={PALETTE[i % PALETTE.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </Frame>
  );
}

export function LinesChart({
  title,
  data,
  x,
  series,
  height = 260,
  format,
}: {
  title: string;
  data: Datum[];
  x: string;
  series: Series[];
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <EmptyChart title={title} />;
  return (
    <Frame
      title={title}
      height={height}
      label={`${title}: ${data.map((d) => `${d[x]} ${series.map((s) => `${s.label} ${d[s.key]}`).join(', ')}`).join('; ')}`}
    >
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
        <XAxis dataKey={x} tick={{ fill: 'currentColor', fontSize: 12 }} />
        <YAxis
          tick={{ fill: 'currentColor', fontSize: 12 }}
          allowDecimals={false}
          tickFormatter={(v: number) => compact.format(v)}
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => (format ? format(Number(v)) : full.format(Number(v)))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </Frame>
  );
}

export function PieBreakdown({
  title,
  data,
  x,
  series,
  height = 260,
}: {
  title: string;
  data: Datum[];
  x: string;
  series: Series[];
  height?: number;
}) {
  if (data.length === 0) return <EmptyChart title={title} />;
  const key = series[0]!.key;
  return (
    <Frame
      title={title}
      height={height}
      label={`${title}: ${data.map((d) => `${d[x]} ${d[key]}`).join('; ')}`}
    >
      <PieChart>
        <Pie
          data={data}
          dataKey={key}
          nameKey={x}
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
          label={(e: { name?: string; value?: number }) => `${e.name}: ${e.value}`}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </Frame>
  );
}

function EmptyChart({ title }: { title: string }) {
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold">{title}</figcaption>
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        Sin datos para estos filtros.
      </p>
    </figure>
  );
}
