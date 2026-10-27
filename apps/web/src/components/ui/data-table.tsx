import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  rowKey: (row: T) => string;
  /** Paginación del servidor. */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  rowClassName?: (row: T) => string | undefined;
  /** Columnas ocultas (id → false). Ver `ColumnsMenu`. */
  columnVisibility?: VisibilityState;
  /** Orden del servidor: si se indica, el orden se pide a la API en lugar de ordenar la página. */
  serverSort?: {
    sort: string;
    dir: 'asc' | 'desc';
    onChange: (sort: string, dir: 'asc' | 'desc') => void;
  };
}

/** Tabla con orden por columna (en la página actual) y paginación del servidor. */
export function DataTable<T>({
  data,
  columns,
  onRowClick,
  empty,
  rowKey,
  pagination,
  rowClassName,
  columnVisibility,
  serverSort,
}: DataTableProps<T>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sorting: SortingState = serverSort
    ? [{ id: serverSort.sort, desc: serverSort.dir === 'desc' }]
    : localSorting;
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility: columnVisibility ?? {} },
    manualSorting: !!serverSort,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      if (!serverSort) return setLocalSorting(next);
      const first = next[0];
      if (first) serverSort.onChange(first.id, first.desc ? 'desc' : 'asc');
      else serverSort.onChange(serverSort.sort, serverSort.dir === 'asc' ? 'desc' : 'asc');
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: rowKey,
  });
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-fg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      className="whitespace-nowrap px-4 py-2.5 font-medium"
                      aria-sort={
                        dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
                      }
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-fg"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === 'asc' ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : dir === 'desc' ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row.original);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-muted/60',
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && empty}
      </div>
      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm text-fg-muted">
          <span>
            {pagination.total} registros · página {pagination.page} de {pages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Página anterior"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Página siguiente"
              disabled={pagination.page >= pages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
