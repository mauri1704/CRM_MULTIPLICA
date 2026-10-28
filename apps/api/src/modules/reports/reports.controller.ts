import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CONVERSION_CRITERIA_LABELS,
  REPORT_INFO,
  REPORT_KEYS,
  can,
  exportReportQuery,
  reportFilter,
  type ReportFilter,
  type ReportKey,
} from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { TxTimeout } from '../../common/tx-timeout';
import { ZodQuery } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { writeSpreadsheet, type ExportColumn } from '../import-export/spreadsheet';
import { todayLima } from './report-context';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

const exportQuery = reportFilter.and(exportReportQuery);

function keyOf(v: string): ReportKey {
  if (!(REPORT_KEYS as readonly string[]).includes(v)) throw notFound('El reporte');
  return v as ReportKey;
}

/** Sin rango, el dashboard muestra los últimos 30 días. */
function withDefaultRange(f: ReportFilter): ReportFilter {
  if (f.from || f.to) return f;
  const today = todayLima();
  const from = new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { ...f, from, to: today };
}

@ApiTags('Dashboard y reportes')
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly dashboard: DashboardService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @RequirePermission('dashboard', 'view')
  @TxTimeout(60_000)
  @ZodQuery(reportFilter)
  dash(@CurrentUser() user: AuthUser, @Query() q: ReportFilter) {
    return this.dashboard.get(user, withDefaultRange(q));
  }

  /** Índice de reportes disponibles para el usuario. */
  @Get('reports')
  @RequirePermission('reports', 'view')
  index(@CurrentUser() user: AuthUser) {
    const allowed = (k: ReportKey) =>
      k === 'duplicates'
        ? can(user.permissions, 'duplicates', 'view')
        : k === 'trash'
          ? can(user.permissions, 'trash', 'view')
          : true;
    return {
      reports: REPORT_KEYS.filter(allowed).map((key) => ({ key, ...REPORT_INFO[key] })),
      criteria: Object.entries(CONVERSION_CRITERIA_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      canExport: can(user.permissions, 'reports', 'export'),
    };
  }

  @Get('reports/:key')
  @RequirePermission('reports', 'view')
  @TxTimeout(60_000)
  @ZodQuery(reportFilter)
  run(@CurrentUser() user: AuthUser, @Param('key') key: string, @Query() q: ReportFilter) {
    return this.reports.run(user, keyOf(key), q);
  }

  @Get('reports/:key/export')
  @RequirePermission('reports', 'export')
  @TxTimeout(120_000)
  @ZodQuery(exportQuery)
  async export(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('key') key: string,
    @Query() q: z.infer<typeof exportQuery>,
  ) {
    const { format, ...filter } = q;
    const result = await this.reports.run(user, keyOf(key), filter);
    type Row = Record<string, string | number | null>;
    const fmtOf = {
      money: '#,##0.00',
      percent: '0.0',
      number: '#,##0.##',
      text: undefined,
      date: undefined,
    } as const;
    const columns: ExportColumn<Row>[] = result.columns.map((c) => ({
      key: c.key,
      label: c.label,
      value: (r) => r[c.key] ?? null,
      numFmt: fmtOf[c.type],
    }));
    const first = result.columns[0]!.key;
    const info: Row[] = [
      ...(result.totals ? [{ ...result.totals, [first]: result.totals[first] ?? 'Total' }] : []),
      {},
      {
        [first]: `Moneda: ${result.meta.currency} · ${CONVERSION_CRITERIA_LABELS[result.meta.criterion]} · corte ${result.meta.cutoffDate}`,
      },
      ...(result.meta.from || result.meta.to
        ? [{ [first]: `Período: ${result.meta.from ?? '…'} a ${result.meta.to ?? '…'}` }]
        : []),
      ...(result.meta.excluded.length > 0
        ? [
            {
              [first]: `Excluido por falta de tipo de cambio: ${result.meta.excluded.map((e) => `${e.count} registro(s) en ${e.currency}`).join(', ')}`,
            },
          ]
        : []),
      ...(result.meta.note ? [{ [first]: result.meta.note }] : []),
    ];
    const buffer = await writeSpreadsheet(format, result.title, columns, [...result.rows, ...info]);
    await this.audit.log('EXPORT', {
      userId: user.id,
      ip,
      details: { report: key, format, rows: result.rows.length, filters: filter },
    });
    const name = `reporte-${key}-${todayLima()}.${format}`;
    return new StreamableFile(buffer, {
      type:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${name}"`,
      length: buffer.length,
    });
  }
}
