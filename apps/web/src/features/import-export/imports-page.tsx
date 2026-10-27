import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { ImportJob } from '@/lib/types';

/** Historial de importaciones de la organización, con descarga del reporte de errores. */
export function ImportsPage() {
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['import-jobs'],
    queryFn: () => api.get<ImportJob[]>('/import-export/jobs'),
  });
  const columns: ColumnDef<ImportJob, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Fecha',
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    { accessorKey: 'entityLabel', header: 'Módulo' },
    { accessorKey: 'fileName', header: 'Archivo' },
    {
      accessorKey: 'createdByName',
      header: 'Usuario',
      cell: ({ row }) => row.original.createdByName ?? '—',
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'COMPLETED' ? (
          <Badge tone="success">Completada</Badge>
        ) : row.original.status === 'FAILED' ? (
          <Badge tone="danger">Fallida</Badge>
        ) : (
          <Badge tone="warning">Sin confirmar</Badge>
        ),
    },
    {
      id: 'counts',
      header: 'Resultado',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === 'COMPLETED'
          ? `${row.original.createdRows} creados · ${row.original.updatedRows} actualizados · ${row.original.skippedRows} omitidos · ${row.original.invalidRows} con error`
          : `${row.original.totalRows} filas`,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.invalidRows > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              api
                .download(`/import-export/jobs/${row.original.id}/errors`, { format: 'xlsx' })
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <Download className="h-4 w-4" aria-hidden />
            Errores
          </Button>
        ),
    },
  ];
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Importaciones"
        description="Historial de archivos importados. Para importar, use el botón «Importar» de cada módulo. Solo quien subió un archivo puede descargar su reporte."
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={FileSpreadsheet} title="Aún no hay importaciones" />}
          />
        )}
      </Card>
    </div>
  );
}
