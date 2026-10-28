import { zodResolver } from '@hookform/resolvers/zod';
import { companyInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { CustomFieldInputs, cleanCustom, customDefaults } from '@/components/custom-field-inputs';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ColumnsMenu } from '@/components/ui/columns-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ActivitiesPanel } from '@/features/activities/activities-panel';
import { RelatedTasks } from '@/features/tasks/related-tasks';
import { CommentsPanel } from '@/features/sales/comments-panel';
import { DataActions } from '@/features/import-export/data-actions';
import { ApiError, api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { useCatalog, useCustomFields, useLocalPref, useUserOptions } from '@/lib/hooks';
import type { Company, CompanyDetail, ContactBrief, Page } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';

const PAGE_SIZE = 25;

export function CompaniesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'legalName', dir: 'asc' as 'asc' | 'desc' });
  const [hidden, setHidden] = useLocalPref<Record<string, boolean>>('companies.columns', {});
  const [openId, setOpenId] = useRecordParam();
  const sectors = useCatalog('economic-sectors');
  const users = useUserOptions();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = { q: debounced, sectorId, ownerId };
  const { data, isLoading } = useQuery({
    queryKey: ['companies', filters, page, sort],
    queryFn: () =>
      api.get<Page<Company>>('/companies', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<Company, unknown>[]>(
    () => [
      {
        id: 'legalName',
        header: 'Razón social',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.legalName}</p>
            <p className="text-xs text-fg-muted">
              {row.original.code}
              {row.original.tradeName ? ` · ${row.original.tradeName}` : ''}
            </p>
          </div>
        ),
      },
      {
        id: 'taxId',
        header: 'RUC / ID',
        enableSorting: false,
        cell: ({ row }) => row.original.taxId ?? '—',
      },
      {
        id: 'sector',
        header: 'Sector',
        enableSorting: false,
        cell: ({ row }) => row.original.sector?.name ?? '—',
      },
      { id: 'city', header: 'Ciudad', cell: ({ row }) => row.original.city ?? '—' },
      {
        id: 'contactCount',
        header: 'Contactos',
        enableSorting: false,
        cell: ({ row }) => row.original.contactCount,
      },
      {
        id: 'owner',
        header: 'Responsable',
        enableSorting: false,
        cell: ({ row }) => row.original.owner?.name ?? '—',
      },
      {
        id: 'createdAt',
        header: 'Creación',
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Compañías"
        description="Empresas clientes y prospectos con sus contactos."
        actions={
          <>
            <DataActions entity="companies" module="companies" filters={filters} />
            {can('companies', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <Plus className="h-4 w-4" aria-hidden />
                Nueva compañía
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center">
          <Input
            type="search"
            placeholder="Buscar por razón social, RUC o código…"
            aria-label="Buscar compañías"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-sm"
          />
          <Select
            aria-label="Sector"
            value={sectorId}
            onChange={(e) => {
              setSectorId(e.target.value);
              setPage(1);
            }}
            className="lg:w-56"
          >
            <option value="">Todos los sectores</option>
            {sectors.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Responsable"
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setPage(1);
            }}
            className="lg:w-52"
          >
            <option value="">Todos los responsables</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <div className="lg:ml-auto">
            <ColumnsMenu
              columns={columns
                .filter((c) => c.id !== 'legalName')
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
            columnVisibility={hidden}
            serverSort={{ ...sort, onChange: (s, d) => setSort({ sort: s, dir: d }) }}
            empty={<EmptyState icon={Building2} title="No hay compañías con esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {openId && (
        <CompanyDrawer id={openId === 'nuevo' ? null : openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function CompanyDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useQuery({
    queryKey: ['companies', 'detail', id],
    queryFn: () => api.get<CompanyDetail>(`/companies/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('COMPANY');
  const docTypes = useCatalog('document-types');
  const users = useUserOptions();
  const sectors = useCatalog('economic-sectors');
  // Los selects se montan con sus opciones ya cargadas para mostrar el valor actual.
  const ready = !!defs.data && !!docTypes.data && !!users.data && !!sectors.data;
  if (id && error) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Compañía">
        <FormMessage
          error={error instanceof ApiError ? error.message : 'No se pudo cargar la compañía.'}
        />
      </Drawer>
    );
  }
  if ((id && !data) || !ready) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Compañía">
        <Spinner />
      </Drawer>
    );
  }
  return <CompanyForm company={data ?? null} onClose={onClose} />;
}

type FormIn = z.input<typeof companyInput>;
type FormOut = z.output<typeof companyInput>;

function CompanyForm({ company, onClose }: { company: CompanyDetail | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const users = useUserOptions();
  const docTypes = useCatalog('document-types');
  const sectors = useCatalog('economic-sectors');
  const defs = useCustomFields('COMPANY');
  const [tab, setTab] = useState('datos');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = company
    ? can('companies', 'edit', company.ownerId === me.id ? 'OWN' : 'TEAM')
    : true;
  const rucId = docTypes.data?.find((d) => d.code === 'RUC')?.id ?? '';

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(companyInput),
    defaultValues: {
      legalName: company?.legalName ?? '',
      tradeName: company?.tradeName ?? '',
      taxIdTypeId: company?.taxIdTypeId ?? rucId,
      taxId: company?.taxId ?? '',
      sectorId: company?.sectorId ?? '',
      address: company?.address ?? '',
      city: company?.city ?? '',
      country: company?.country ?? 'PE',
      email: company?.email ?? '',
      phone: company?.phone ?? '',
      website: company?.website ?? '',
      ownerId: company?.ownerId ?? me.id,
      notes: company?.notes ?? '',
      customFields: customDefaults(defs.data, company?.customFields),
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      customFields: cleanCustom(values.customFields as Record<string, unknown>),
    };
    try {
      if (company)
        await api.patch(`/companies/${company.id}`, { ...body, version: company.version });
      else await api.post('/companies', body);
      await qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success(company ? 'Compañía actualizada.' : 'Compañía creada.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
      setTab('datos');
    }
  });

  const formBody = (
    <form id="company-form" onSubmit={onSubmit} noValidate className="space-y-5">
      <FormMessage error={error} />
      <fieldset disabled={!editable} className="space-y-5">
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Identificación</legend>
          <Field label="Razón social" error={e.legalName?.message} required>
            <Input {...form.register('legalName')} />
          </Field>
          <Field label="Nombre comercial" error={e.tradeName?.message}>
            <Input {...form.register('tradeName')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de identificador" error={e.taxIdTypeId?.message}>
              <Select {...form.register('taxIdTypeId')}>
                <option value="">—</option>
                {docTypes.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="RUC / identificador"
              error={e.taxId?.message}
              hint="El RUC se valida con su dígito verificador."
            >
              <Input inputMode="numeric" {...form.register('taxId')} />
            </Field>
            <Field label="Sector económico" error={e.sectorId?.message}>
              <Select {...form.register('sectorId')}>
                <option value="">—</option>
                {sectors.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsable comercial" error={e.ownerId?.message}>
              <Select {...form.register('ownerId')}>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Ubicación y contacto</legend>
          <Field label="Dirección" error={e.address?.message}>
            <Input {...form.register('address')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ciudad" error={e.city?.message}>
              <Input {...form.register('city')} />
            </Field>
            <Field label="País" error={e.country?.message} hint="Código de 2 letras (PE, CL, CO…)">
              <Input maxLength={2} {...form.register('country')} />
            </Field>
            <Field label="Correo" error={e.email?.message}>
              <Input type="email" {...form.register('email')} />
            </Field>
            <Field label="Teléfono" error={e.phone?.message}>
              <Input type="tel" {...form.register('phone')} />
            </Field>
          </div>
          <Field label="Sitio web" error={e.website?.message}>
            <Input {...form.register('website')} placeholder="www.empresa.pe" />
          </Field>
          <Field label="Observaciones" error={e.notes?.message}>
            <Textarea rows={3} {...form.register('notes')} />
          </Field>
        </fieldset>
        <CustomFieldInputs
          entityType="COMPANY"
          register={form.register}
          errors={form.formState.errors}
        />
      </fieldset>
    </form>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? company.legalName : 'Nueva compañía'}
      description={
        company ? `${company.code}${company.taxId ? ` · ${company.taxId}` : ''}` : undefined
      }
      confirmClose={form.formState.isDirty}
      footer={
        editable &&
        tab === 'datos' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="company-form" loading={form.formState.isSubmitting}>
              {company ? 'Guardar cambios' : 'Crear compañía'}
            </Button>
          </>
        )
      }
    >
      {company ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <HistoryButton entityType="COMPANY" entityId={company.id} title={company.legalName} />
            {can('companies', 'delete') && editable && (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Enviar a papelera
              </Button>
            )}
          </div>
          <Tabs
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'datos', label: 'Datos' },
              {
                value: 'contactos',
                label: `Contactos (${company.contacts.length + company.relatedContacts.length})`,
              },
              { value: 'tareas', label: 'Tareas' },
              { value: 'actividad', label: 'Actividad' },
              { value: 'comentarios', label: 'Comentarios' },
            ]}
          >
            <TabPanel value="datos" forceMount hidden={tab !== 'datos'}>
              {formBody}
            </TabPanel>
            <TabPanel value="contactos">
              <ContactList title="Compañía principal" contacts={company.contacts} />
              <ContactList title="Relacionados" contacts={company.relatedContacts} />
              {can('contacts', 'create') && (
                <p className="mt-4 text-sm text-fg-muted">
                  Para agregar un contacto, créelo desde{' '}
                  <Link to="/contactos?id=nuevo" className="text-primary hover:underline">
                    Contactos
                  </Link>{' '}
                  y elija esta compañía.
                </p>
              )}
            </TabPanel>
            <TabPanel value="tareas">
              {tab === 'tareas' && (
                <RelatedTasks
                  target={{ type: 'COMPANY', id: company.id, name: company.legalName }}
                />
              )}
            </TabPanel>
            <TabPanel value="actividad">
              {tab === 'actividad' && <ActivitiesPanel type="COMPANY" id={company.id} />}
            </TabPanel>
            <TabPanel value="comentarios">
              {tab === 'comentarios' && <CommentsPanel type="COMPANY" id={company.id} />}
            </TabPanel>
          </Tabs>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Enviar compañía a la papelera"
            confirmLabel="Enviar a papelera"
            danger
            onConfirm={async () => {
              await api.delete(`/companies/${company.id}`);
              await qc.invalidateQueries({ queryKey: ['companies'] });
              toast.success('Compañía enviada a la papelera.');
              onClose();
            }}
          >
            «{company.legalName}» dejará de aparecer en listas y búsquedas.
            {company.contactCount > 0 &&
              ` Sus ${company.contactCount} contacto(s) no se eliminan: quedarán sin compañía principal visible hasta que la restaure.`}
          </ConfirmDialog>
        </>
      ) : (
        formBody
      )}
    </Drawer>
  );
}

function ContactList({ title, contacts }: { title: string; contacts: ContactBrief[] }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {contacts.length === 0 ? (
        <p className="text-sm text-fg-muted">Ninguno.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                to={`/contactos?id=${c.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted"
              >
                <span className="flex-1">
                  <span className="block font-medium">
                    {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {[c.jobTitle, c.email, c.phone].filter(Boolean).join(' · ') || c.code}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
