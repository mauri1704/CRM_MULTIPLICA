import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { pickPipeline, usePipelines } from '@/features/sales/sales-shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useCurrencies } from '@/lib/hooks';
import { useMoney } from '@/lib/money';
import type { Lead, Line } from '@/lib/types';

interface Preview {
  currencyCode: string;
  products: (Line & { missingRate: boolean })[];
  total: string;
  missingRates: boolean;
  customFields: { key: string; label: string; value: unknown }[];
}

/**
 * Convertir un prospecto en negociación (D-07): se muestra antes qué se copiará y con qué tasas.
 * La API vuelve a calcular todo al confirmar; esta vista es solo informativa.
 */
export function ConvertDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const money = useMoney();
  const pipelines = usePipelines('DEAL');
  const currencies = useCurrencies();
  const [title, setTitle] = useState(lead.title);
  const [currencyCode, setCurrencyCode] = useState(lead.currencyCode);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const pipeline = pickPipeline(pipelines.data, pipelineId);
  const openStages = pipeline?.stages.filter((s) => s.kind === 'OPEN' && s.active) ?? [];
  const stage = openStages.find((s) => s.id === stageId) ?? openStages[0];

  const preview = useQuery({
    queryKey: ['leads', 'conversion-preview', lead.id, currencyCode],
    queryFn: () => api.get<Preview>(`/leads/${lead.id}/conversion-preview`, { currencyCode }),
    retry: false,
  });

  const submit = async () => {
    if (!pipeline || !stage) return;
    setBusy(true);
    setError(null);
    setDetails({});
    try {
      const r = await api.post<{ dealId: string; dealCode: string }>(`/leads/${lead.id}/convert`, {
        title,
        pipelineId: pipeline.id,
        stageId: stage.id,
        currencyCode,
        expectedCloseDate,
      });
      await qc.invalidateQueries({ queryKey: ['leads'] });
      await qc.invalidateQueries({ queryKey: ['deals'] });
      toast.success(`Negociación ${r.dealCode} creada.`);
      onClose();
      void navigate(`/negociaciones?id=${r.dealId}`);
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const p = preview.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Convertir en negociación"
      description={`${lead.code} — ${lead.title}`}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!stage || !p || p.missingRates} onClick={submit}>
            Convertir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Título de la negociación"
            error={details.title}
            className="sm:col-span-2"
            required
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {(pipelines.data?.length ?? 0) > 1 && (
            <Field label="Pipeline" error={details.pipelineId}>
              <Select
                value={pipeline?.id ?? ''}
                onChange={(e) => {
                  setPipelineId(e.target.value);
                  setStageId('');
                }}
              >
                {pipelines.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Etapa inicial" error={details.stageId}>
            <Select value={stage?.id ?? ''} onChange={(e) => setStageId(e.target.value)}>
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Moneda" error={details.currencyCode}>
            <Select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
              {currencies.data?.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cierre estimado" error={details.expectedCloseDate}>
            <Input
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
            />
          </Field>
        </div>

        <section
          aria-label="Qué se copiará"
          className="rounded-md border border-border p-3 text-sm"
        >
          <p className="mb-2 font-semibold">Se copiará</p>
          <ul className="mb-3 list-inside list-disc text-fg-muted">
            <li>Contacto (como principal), compañía, responsable y prioridad.</li>
            <li>
              Valor estimado
              {lead.estimatedValue
                ? `: ${money(lead.estimatedValue, lead.currencyCode)}`
                : ' (sin valor)'}
              {lead.currencyCode !== currencyCode &&
                ' — se conserva en su moneda original como referencia'}
              .
            </li>
            {p && p.customFields.length > 0 && (
              <li>Campos personalizados: {p.customFields.map((c) => c.label).join(', ')}.</li>
            )}
          </ul>
          {preview.isLoading ? (
            <Spinner />
          ) : preview.error ? (
            <FormMessage error={errorMessage(preview.error)} />
          ) : p && p.products.length > 0 ? (
            <>
              <table className="w-full text-sm">
                <caption className="sr-only">Productos y totales en {p.currencyCode}</caption>
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">
                      Producto
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Tasa
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Total ({p.currencyCode})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.products.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5">
                        {l.description}
                        <span className="block text-xs text-fg-muted">
                          {Number(l.quantity)} × {money(l.unitPrice, l.currencyCode)}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        {l.missingRate ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <AlertTriangle className="h-4 w-4" aria-hidden /> Sin tasa
                          </span>
                        ) : l.currencyCode === p.currencyCode ? (
                          '—'
                        ) : (
                          Number(l.exchangeRate).toLocaleString('en-US', {
                            maximumFractionDigits: 6,
                          })
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {l.missingRate ? '—' : money(l.lineTotal, p.currencyCode, { code: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={2} className="pt-2 text-right">
                      Total
                    </td>
                    <td className="pt-2 text-right">{money(p.total, p.currencyCode)}</td>
                  </tr>
                </tfoot>
              </table>
              {p.missingRates && (
                <FormMessage
                  className="mt-3"
                  error={`Falta el tipo de cambio de algunas monedas a ${p.currencyCode}. Regístrelo en Tipos de cambio o elija otra moneda.`}
                />
              )}
            </>
          ) : (
            <p className="text-fg-muted">Sin productos asociados.</p>
          )}
        </section>
        <p className="text-xs text-fg-muted">
          El prospecto quedará como «Convertido», en solo lectura y enlazado a la nueva negociación.
        </p>
      </div>
    </Dialog>
  );
}
