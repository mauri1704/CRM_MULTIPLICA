import { zodResolver } from '@hookform/resolvers/zod';
import { organizationSettingsSchema, updateOrganizationInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import type { Organization } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre.').max(120),
  legalName: z.string().trim().max(200),
  taxId: z
    .string()
    .trim()
    .regex(/^(\d{11})?$/, 'El RUC debe tener 11 dígitos.'),
  baseCurrencyCode: z.string(),
  settings: organizationSettingsSchema,
});
type FormValues = z.infer<typeof schema>;

const TIMEZONES = [
  'America/Lima',
  'America/Bogota',
  'America/Santiago',
  'America/Mexico_City',
  'America/New_York',
  'Europe/Madrid',
];

export function OrganizationPage() {
  const { can } = useAuth();
  const editable = can('settings', 'manage');
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<Organization>('/organization'),
  });
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { register, formState } = form;
  const e = formState.errors;

  useEffect(() => {
    if (data) {
      form.reset({
        name: data.name,
        legalName: data.legalName ?? '',
        taxId: data.taxId ?? '',
        baseCurrencyCode: data.baseCurrencyCode,
        settings: data.settings,
      });
    }
  }, [data, form]);

  if (!data) return <Spinner />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const body = updateOrganizationInput.parse({
        ...values,
        legalName: values.legalName || null,
        taxId: values.taxId || null,
      });
      await api.patch('/organization', body);
      await qc.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Configuración guardada.');
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Organización"
        description="Datos de la empresa y parámetros generales del sistema."
        actions={<HistoryButton entityType="ORGANIZATION" entityId={data.id} title={data.name} />}
      />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormMessage error={error} />
        <fieldset disabled={!editable} className="space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Datos de la organización</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" error={e.name?.message} required>
                <Input {...register('name')} />
              </Field>
              <Field label="Razón social" error={e.legalName?.message}>
                <Input {...register('legalName')} />
              </Field>
              <Field label="RUC" error={e.taxId?.message}>
                <Input inputMode="numeric" maxLength={11} {...register('taxId')} />
              </Field>
              <Field
                label="Moneda principal"
                hint="El maestro de monedas se habilita en la Fase 2."
                error={e.baseCurrencyCode?.message}
              >
                <Select {...register('baseCurrencyCode')}>
                  <option value="PEN">PEN — Sol peruano</option>
                  <option value="USD">USD — Dólar estadounidense</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Regional</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zona horaria" error={e.settings?.timezone?.message}>
                <Select {...register('settings.timezone')}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Formato de fecha" error={e.settings?.dateFormat?.message}>
                <Select {...register('settings.dateFormat')}>
                  <option value="dd/MM/yyyy">dd/mm/aaaa</option>
                  <option value="MM/dd/yyyy">mm/dd/aaaa</option>
                  <option value="yyyy-MM-dd">aaaa-mm-dd</option>
                </Select>
              </Field>
              <Field label="Formato de números" error={e.settings?.numberLocale?.message}>
                <Select {...register('settings.numberLocale')}>
                  <option value="en-US">1,234.56</option>
                  <option value="es-PE">1,234.56 (es-PE)</option>
                  <option value="es-ES">1.234,56</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Papelera y seguridad</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Retención de la papelera (días)"
                hint="Pasado este plazo, lo eliminado se borra definitivamente."
                error={e.settings?.trashRetentionDays?.message}
              >
                <Input
                  type="number"
                  min={7}
                  max={3650}
                  {...register('settings.trashRetentionDays', { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Cierre de sesión por inactividad (horas)"
                error={e.settings?.sessionIdleHours?.message}
              >
                <Input
                  type="number"
                  min={1}
                  max={24}
                  {...register('settings.sessionIdleHours', { valueAsNumber: true })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('settings.trashAutoPurge')} />
              Purgar automáticamente lo vencido (solo registros sin dependencias)
            </label>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Tipos de cambio y tareas</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Antigüedad máxima de una tasa (días)"
                hint="Si no hay tasa del día, se usa la más reciente dentro de este plazo."
                error={e.settings?.exchangeRateMaxAgeDays?.message}
              >
                <Input
                  type="number"
                  min={0}
                  max={30}
                  {...register('settings.exchangeRateMaxAgeDays', { valueAsNumber: true })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('settings.exchangeRateAllowInverse')} />
              Permitir usar la tasa inversa (1/tasa) cuando falte el par
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('settings.taskOverdueNotifications')} />
              Avisar al responsable cuando una tarea vence
            </label>
          </Card>
        </fieldset>
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
              Guardar cambios
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
