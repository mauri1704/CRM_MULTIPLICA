import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Package, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EntityPicker, type PickerOption } from '@/components/ui/entity-picker';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useMoney } from '@/lib/money';
import type { Line, Page, Product } from '@/lib/types';

const RATE_LABEL: Record<Line['rateSource'], string> = {
  NONE: '',
  MASTER: 'Tasa del maestro',
  INVERSE: 'Tasa inversa',
  MANUAL: 'Tasa manual',
};

interface LinesEditorProps {
  /** `/leads/:id` o `/deals/:id` */
  basePath: string;
  currencyCode: string;
  lines: Line[];
  totals: { subtotal: string; discount: string; total: string };
  editable: boolean;
  /** Mensaje cuando no se puede editar (convertido, cerrada…). */
  lockedReason?: string;
  /** Claves de consulta a refrescar tras un cambio. */
  invalidate: unknown[][];
  onRefreshRates?: () => Promise<void>;
}

const searchProducts = async (q: string): Promise<(PickerOption & { product: Product })[]> =>
  (await api.get<Page<Product>>('/products', { q, pageSize: 20, active: 'true' })).items.map(
    (p) => ({
      id: p.id,
      label: `${p.name}`,
      sublabel: `${p.sku} · ${p.currencyCode} ${Number(p.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      product: p,
    }),
  );

/**
 * Productos asociados. Los importes los calcula la API (decimal exacto, redondeo por línea) y se
 * muestran tal cual; aquí no se hacen cuentas de dinero.
 */
export function LinesEditor({
  basePath,
  currencyCode,
  lines,
  totals,
  editable,
  lockedReason,
  invalidate,
  onRefreshRates,
}: LinesEditorProps) {
  const money = useMoney();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [removing, setRemoving] = useState<Line | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    for (const k of invalidate) await qc.invalidateQueries({ queryKey: k });
  };
  const hasForeign = lines.some((l) => l.currencyCode !== currencyCode);

  return (
    <div className="space-y-3">
      {lockedReason && <FormMessage error={lockedReason} />}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            Agregar producto
          </Button>
          {onRefreshRates && hasForeign && (
            <Button
              size="sm"
              variant="secondary"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefreshRates();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Actualizar tasas
            </Button>
          )}
        </div>
      )}
      {lines.length === 0 ? (
        <EmptyState icon={Package} title="Sin productos asociados" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Producto
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Cant.
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Precio
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Descuento
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Total ({currencyCode})
                </th>
                {editable && (
                  <th scope="col" className="w-20 px-3 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{l.description}</p>
                    <p className="text-xs text-fg-muted">
                      {l.sku}
                      {l.currencyCode !== currencyCode &&
                        ` · ${RATE_LABEL[l.rateSource]} ${Number(l.exchangeRate).toLocaleString('en-US', { maximumFractionDigits: 6 })}${l.exchangeRateDate ? ` (${formatDate(`${l.exchangeRateDate}T12:00:00`)})` : ''}`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {Number(l.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {money(l.unitPrice, l.currencyCode)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {Number(l.discountValue) === 0
                      ? '—'
                      : l.discountType === 'PERCENT'
                        ? `${Number(l.discountValue)}%`
                        : money(l.discountValue, l.currencyCode)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {money(l.lineTotal, currencyCode, { code: false })}
                  </td>
                  {editable && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${l.description}`}
                          onClick={() => setEditing(l)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar ${l.description}`}
                          onClick={() => setRemoving(l)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-fg-muted">Subtotal</dt>
          <dd>{money(totals.subtotal, currencyCode)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-fg-muted">Descuento</dt>
          <dd>− {money(totals.discount, currencyCode)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd>{money(totals.total, currencyCode)}</dd>
        </div>
      </dl>
      {editing && (
        <LineDialog
          basePath={basePath}
          currencyCode={currencyCode}
          line={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Quitar producto"
          confirmLabel="Quitar"
          danger
          onConfirm={async () => {
            await api.delete(`${basePath}/products/${removing.id}`);
            await refresh();
            toast.success('Producto quitado.');
          }}
        >
          Se quitará «{removing.description}» y se recalcularán los totales.
        </ConfirmDialog>
      )}
    </div>
  );
}

function LineDialog({
  basePath,
  currencyCode,
  line,
  onClose,
  onSaved,
}: {
  basePath: string;
  currencyCode: string;
  line: Line | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [product, setProduct] = useState<(PickerOption & { product?: Product }) | null>(
    line ? { id: line.productId, label: line.description } : null,
  );
  const [v, setV] = useState({
    description: line?.description ?? '',
    quantity: line ? String(Number(line.quantity)) : '1',
    unitPrice: line ? String(Number(line.unitPrice)) : '',
    discountType: line?.discountType ?? 'PERCENT',
    discountValue: line ? String(Number(line.discountValue)) : '0',
    manualRate: '',
    manualRateReason: '',
  });
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((p) => ({ ...p, ...patch }));
  const productCurrency = line?.currencyCode ?? product?.product?.currencyCode;

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    try {
      if (line) {
        await api.patch(`${basePath}/products/${line.id}`, {
          description: v.description,
          quantity: v.quantity,
          unitPrice: v.unitPrice,
          discountType: v.discountType,
          discountValue: v.discountValue || '0',
        });
      } else {
        await api.post(`${basePath}/products`, {
          productId: product?.id,
          description: v.description || undefined,
          quantity: v.quantity,
          unitPrice: v.unitPrice || undefined,
          discountType: v.discountType,
          discountValue: v.discountValue || '0',
          ...(needsRate && v.manualRate
            ? { manualRate: v.manualRate, manualRateReason: v.manualRateReason }
            : {}),
        });
      }
      await onSaved();
      toast.success(line ? 'Producto actualizado.' : 'Producto agregado.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setDetails(e.details);
        if (e.code === 'MISSING_EXCHANGE_RATE') setNeedsRate(e.message);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={line ? `Editar ${line.description}` : 'Agregar producto'}
      description={line ? 'La tasa de cambio registrada en la línea se conserva.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save} disabled={!product}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!needsRate && <FormMessage error={error} />}
        {!line && (
          <Field label="Producto" error={details.productId} required>
            <EntityPicker
              value={product}
              onChange={(p) => {
                const full = p as (PickerOption & { product?: Product }) | null;
                setProduct(full);
                if (full?.product)
                  set({
                    unitPrice: String(Number(full.product.price)),
                    description: full.product.name,
                  });
              }}
              search={searchProducts}
              queryKey="products"
              placeholder="Buscar producto activo…"
            />
          </Field>
        )}
        <Field label="Descripción comercial" error={details.description}>
          <Input value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cantidad" error={details.quantity} required>
            <Input
              inputMode="decimal"
              value={v.quantity}
              onChange={(e) => set({ quantity: e.target.value.replace(',', '.') })}
            />
          </Field>
          <Field
            label={`Precio unitario${productCurrency ? ` (${productCurrency})` : ''}`}
            error={details.unitPrice}
          >
            <Input
              inputMode="decimal"
              value={v.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value.replace(',', '.') })}
            />
          </Field>
          <Field label="Tipo de descuento">
            <Select
              value={v.discountType}
              onChange={(e) => set({ discountType: e.target.value as 'AMOUNT' | 'PERCENT' })}
            >
              <option value="PERCENT">Porcentaje (%)</option>
              <option value="AMOUNT">Importe fijo</option>
            </Select>
          </Field>
          <Field
            label="Descuento"
            error={details.discountValue}
            hint={
              product?.product
                ? `Máximo permitido: ${Number(product.product.maxDiscountPct)}%`
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={v.discountValue}
              onChange={(e) => set({ discountValue: e.target.value.replace(',', '.') })}
            />
          </Field>
        </div>
        {productCurrency && productCurrency !== currencyCode && !line && (
          <p className="text-xs text-fg-muted">
            El precio está en {productCurrency}: se convertirá a {currencyCode} con la tasa vigente
            de hoy y la tasa quedará guardada en la línea.
          </p>
        )}
        {needsRate && (
          <div className="space-y-3 rounded-md border border-warning/50 bg-warning/10 p-3">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {needsRate}
            </p>
            {can('exchange_rates', 'manage') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Tasa manual (1 ${productCurrency} = ? ${currencyCode})`}
                  error={details.manualRate}
                >
                  <Input
                    inputMode="decimal"
                    value={v.manualRate}
                    onChange={(e) => set({ manualRate: e.target.value.replace(',', '.') })}
                  />
                </Field>
                <Field label="Motivo" error={details.manualRateReason}>
                  <Input
                    value={v.manualRateReason}
                    onChange={(e) => set({ manualRateReason: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
