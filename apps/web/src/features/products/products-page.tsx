import { zodResolver } from '@hookform/resolvers/zod';
import { formatMoney, productInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Package, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CustomFieldInputs, cleanCustom, customDefaults } from '@/components/custom-field-inputs';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { useDuplicateGuard } from '@/features/duplicates/duplicate-guard';
import { ColumnsMenu } from '@/components/ui/columns-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { useCatalog, useCurrencies, useCustomFields, useLocalPref } from '@/lib/hooks';
import type { Currency, Page, Product } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';

const PAGE_SIZE = 25;

export function useMoney() {
  const { data } = useCurrencies(true);
  return (amount: string, code: string) => {
    const c: Pick<Currency, 'code' | 'symbol' | 'decimals' | 'symbolPosition'> = data?.find(
      (x) => x.code === code,
    ) ?? {
      code,
      symbol: code,
      decimals: 2,
      symbolPosition: 'BEFORE',
    };
    return `${formatMoney(amount, c)} ${code}`;
  };
}

export function ProductsPage() {
  const { can } = useAuth();
  const money = useMoney();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [active, setActive] = useState<'true' | 'false' | 'all'>('true');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'name', dir: 'asc' as 'asc' | 'desc' });
  const [hidden, setHidden] = useLocalPref<Record<string, boolean>>('products.columns', {});
  const [openId, setOpenId] = useRecordParam();
  const categories = useCatalog('product-categories');
  const currencies = useCurrencies();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = { q: debounced, categoryId, currencyCode, active };
  const { data, isLoading } = useQuery({
    queryKey: ['products', filters, page, sort],
    queryFn: () =>
      api.get<Page<Product>>('/products', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      {
        id: 'sku',
        header: 'SKU',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
      },
      {
        id: 'name',
        header: 'Nombre',
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'category',
        header: 'Categoría',
        enableSorting: false,
        cell: ({ row }) => row.original.category?.name ?? '—',
      },
      {
        id: 'price',
        header: 'Precio',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {money(row.original.price, row.original.currencyCode)}
          </span>
        ),
      },
      {
        id: 'maxDiscountPct',
        header: 'Desc. máx.',
        enableSorting: false,
        cell: ({ row }) => `${Number(row.original.maxDiscountPct)}%`,
      },
      {
        id: 'active',
        header: 'Estado',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.active ? (
            <Badge tone="success" icon={CheckCircle2}>
              Activo
            </Badge>
          ) : (
            <Badge icon={XCircle}>Inactivo</Badge>
          ),
      },
    ],
    [money],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Productos"
        description="Catálogo de productos y servicios. El precio es una referencia: cada negociación guarda su propia copia."
        actions={
          <>
            <DataActions entity="products" module="products" filters={filters} />
            {can('products', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <Plus className="h-4 w-4" aria-hidden />
                Nuevo producto
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center">
          <Input
            type="search"
            placeholder="Buscar por nombre o SKU…"
            aria-label="Buscar productos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-xs"
          />
          <Select
            aria-label="Categoría"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            className="lg:w-48"
          >
            <option value="">Todas las categorías</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Moneda"
            value={currencyCode}
            onChange={(e) => {
              setCurrencyCode(e.target.value);
              setPage(1);
            }}
            className="lg:w-40"
          >
            <option value="">Todas las monedas</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Estado"
            value={active}
            onChange={(e) => {
              setActive(e.target.value as typeof active);
              setPage(1);
            }}
            className="lg:w-36"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </Select>
          <div className="lg:ml-auto">
            <ColumnsMenu
              columns={columns
                .filter((c) => c.id !== 'name')
                .map((c) => ({ id: c.id!, label: String(c.header) }))}
              value={hidden}
              onChange={setHidden}
            />
          </div>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
            columnVisibility={hidden}
            serverSort={{ ...sort, onChange: (s, d) => setSort({ sort: s, dir: d }) }}
            empty={<EmptyState icon={Package} title="No hay productos con esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {openId && (
        <ProductDrawer id={openId === 'nuevo' ? null : openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ProductDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => api.get<Product>(`/products/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('PRODUCT');
  const categories = useCatalog('product-categories');
  const currencies = useCurrencies();
  if (id && error) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Producto">
        <FormMessage
          error={error instanceof ApiError ? error.message : 'No se pudo cargar el producto.'}
        />
      </Drawer>
    );
  }
  if ((id && !data) || !defs.data || !categories.data || !currencies.data) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Producto">
        <Spinner />
      </Drawer>
    );
  }
  return <ProductForm product={data ?? null} onClose={onClose} />;
}

const formSchema = productInput.extend({ active: z.boolean() });
type FormIn = z.input<typeof formSchema>;
type FormOut = z.output<typeof formSchema>;

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const categories = useCatalog('product-categories');
  const currencies = useCurrencies();
  const defs = useCustomFields('PRODUCT');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = product ? can('products', 'edit') : can('products', 'create');
  const base = currencies.data?.find((c) => c.isBase)?.code ?? 'PEN';

  const guard = useDuplicateGuard('PRODUCT');
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      description: product?.description ?? '',
      categoryId: product?.categoryId ?? '',
      price: product ? String(Number(product.price)) : '',
      currencyCode: product?.currencyCode ?? base,
      maxDiscountPct: product ? String(Number(product.maxDiscountPct)) : '0',
      active: product?.active ?? true,
      customFields: customDefaults(defs.data, product?.customFields),
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { active, ...rest } = values;
    const body = {
      ...rest,
      customFields: cleanCustom(values.customFields as Record<string, unknown>),
    };
    if (!product && !(await guard.confirm(body))) return;
    try {
      if (product)
        await api.patch(`/products/${product.id}`, { ...body, active, version: product.version });
      else {
        const created = await api.post<Product>('/products', body);
        if (!active) await api.patch(`/products/${created.id}`, { active: false });
      }
      await qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(product ? 'Producto actualizado.' : 'Producto creado.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={product ? product.name : 'Nuevo producto'}
      description={product?.sku}
      confirmClose={form.formState.isDirty}
      footer={
        editable && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="product-form" loading={form.formState.isSubmitting}>
              {product ? 'Guardar cambios' : 'Crear producto'}
            </Button>
          </>
        )
      }
    >
      {product && (
        <div className="mb-4 flex flex-wrap gap-2">
          <HistoryButton entityType="PRODUCT" entityId={product.id} title={product.name} />
          {can('products', 'delete') && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Enviar a papelera
            </Button>
          )}
        </div>
      )}
      <form id="product-form" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormMessage error={error} />
        <fieldset disabled={!editable} className="space-y-5">
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Producto</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU" error={e.sku?.message} required>
                <Input className="font-mono" {...form.register('sku')} />
              </Field>
              <Field label="Categoría" error={e.categoryId?.message}>
                <Select {...form.register('categoryId')}>
                  <option value="">—</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Nombre" error={e.name?.message} required>
              <Input {...form.register('name')} />
            </Field>
            <Field label="Descripción" error={e.description?.message}>
              <Textarea rows={3} {...form.register('description')} />
            </Field>
          </fieldset>
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Precio</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Precio" error={e.price?.message} required>
                <Input inputMode="decimal" {...form.register('price')} />
              </Field>
              <Field label="Moneda" error={e.currencyCode?.message} required>
                <Select {...form.register('currencyCode')}>
                  {currencies.data?.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Descuento máximo (%)" error={e.maxDiscountPct?.message}>
                <Input inputMode="decimal" {...form.register('maxDiscountPct')} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" {...form.register('active')} />
              Activo (los inactivos no se ofrecen en prospectos y negociaciones nuevas)
            </label>
          </fieldset>
          <CustomFieldInputs
            entityType="PRODUCT"
            register={form.register}
            errors={form.formState.errors}
          />
        </fieldset>
      </form>
      {product && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Enviar producto a la papelera"
          confirmLabel="Enviar a papelera"
          danger
          onConfirm={async () => {
            await api.delete(`/products/${product.id}`);
            await qc.invalidateQueries({ queryKey: ['products'] });
            toast.success('Producto enviado a la papelera.');
            onClose();
          }}
        >
          «{product.name}» dejará de aparecer en el catálogo. Si solo quiere dejar de ofrecerlo,
          desactívelo.
        </ConfirmDialog>
      )}
      {guard.dialog}
    </Drawer>
  );
}
