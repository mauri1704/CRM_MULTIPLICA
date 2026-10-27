import { zodResolver } from '@hookform/resolvers/zod';
import { contactInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Contact as ContactIcon, Trash2, UserPlus, X } from 'lucide-react';
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
import { EntityPicker, type PickerOption } from '@/components/ui/entity-picker';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { ApiError, api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { useCatalog, useCustomFields, useLocalPref, useUserOptions } from '@/lib/hooks';
import { searchCompanies } from '@/lib/pickers';
import type { Contact, Page } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';

const PAGE_SIZE = 25;

export function ContactsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'firstName', dir: 'asc' as 'asc' | 'desc' });
  const [hidden, setHidden] = useLocalPref<Record<string, boolean>>('contacts.columns', {});
  const [openId, setOpenId] = useRecordParam();
  const users = useUserOptions();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = { q: debounced, ownerId, companyId: company?.id };
  const { data, isLoading } = useQuery({
    queryKey: ['contacts', filters, page, sort],
    queryFn: () =>
      api.get<Page<Contact>>('/contacts', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        id: 'firstName',
        header: 'Nombre',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.fullName}</p>
            <p className="text-xs text-fg-muted">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: 'company',
        header: 'Compañía',
        enableSorting: false,
        cell: ({ row }) => row.original.company?.legalName ?? '—',
      },
      {
        id: 'jobTitle',
        header: 'Cargo',
        enableSorting: false,
        cell: ({ row }) => row.original.jobTitle ?? '—',
      },
      {
        id: 'email',
        header: 'Correo',
        enableSorting: false,
        cell: ({ row }) => row.original.email ?? '—',
      },
      {
        id: 'phone',
        header: 'Teléfono',
        enableSorting: false,
        cell: ({ row }) => row.original.phone ?? '—',
      },
      {
        id: 'document',
        header: 'Documento',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.documentNumber
            ? `${row.original.documentType?.code ?? ''} ${row.original.documentNumber}`
            : '—',
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
        title="Contactos"
        description="Personas con las que su organización mantiene relación comercial."
        actions={
          <>
            <DataActions entity="contacts" module="contacts" filters={filters} />
            {can('contacts', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <UserPlus className="h-4 w-4" aria-hidden />
                Nuevo contacto
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center">
          <Input
            type="search"
            placeholder="Buscar por nombre, correo, documento o código…"
            aria-label="Buscar contactos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-sm"
          />
          <div className="lg:w-64">
            <EntityPicker
              value={company}
              onChange={(c) => {
                setCompany(c);
                setPage(1);
              }}
              search={searchCompanies}
              queryKey="companies"
              placeholder="Filtrar por compañía"
            />
          </div>
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
                .filter((c) => c.id !== 'firstName')
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
            empty={<EmptyState icon={ContactIcon} title="No hay contactos con esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {openId && (
        <ContactDrawer id={openId === 'nuevo' ? null : openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

type FormIn = z.input<typeof contactInput>;
type FormOut = z.output<typeof contactInput>;

function ContactDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: contact, error: loadError } = useQuery({
    queryKey: ['contacts', 'detail', id],
    queryFn: () => api.get<Contact>(`/contacts/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('CONTACT');
  const docTypes = useCatalog('document-types');
  const users = useUserOptions();
  // Los selects se montan con sus opciones ya cargadas para mostrar el valor actual.
  const ready = !!defs.data && !!docTypes.data && !!users.data;
  if (id && loadError) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Contacto">
        <FormMessage
          error={
            loadError instanceof ApiError ? loadError.message : 'No se pudo cargar el contacto.'
          }
        />
      </Drawer>
    );
  }
  if ((id && !contact) || !ready) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Contacto">
        <Spinner />
      </Drawer>
    );
  }
  return <ContactForm contact={contact ?? null} onClose={onClose} />;
}

function ContactForm({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const users = useUserOptions();
  const docTypes = useCatalog('document-types');
  const defs = useCustomFields('CONTACT');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [company, setCompany] = useState<PickerOption | null>(
    contact?.company ? { id: contact.company.id, label: contact.company.legalName } : null,
  );
  const [related, setRelated] = useState<PickerOption[]>(
    contact?.relatedCompanies.map((c) => ({ id: c.id, label: c.legalName })) ?? [],
  );
  // Optimista: con alcance "equipo" la API confirma si el responsable es de su equipo.
  const editable = contact
    ? can('contacts', 'edit', contact.ownerId === me.id ? 'OWN' : 'TEAM')
    : true;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(contactInput),
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      documentTypeId: contact?.documentTypeId ?? '',
      documentNumber: contact?.documentNumber ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      jobTitle: contact?.jobTitle ?? '',
      companyId: contact?.companyId ?? '',
      ownerId: contact?.ownerId ?? me.id,
      notes: contact?.notes ?? '',
      customFields: customDefaults(defs.data, contact?.customFields),
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      companyId: company?.id ?? null,
      relatedCompanyIds: related.map((r) => r.id),
      customFields: cleanCustom(values.customFields as Record<string, unknown>),
    };
    try {
      if (contact)
        await api.patch(`/contacts/${contact.id}`, { ...body, version: contact.version });
      else await api.post('/contacts', body);
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(contact ? 'Contacto actualizado.' : 'Contacto creado.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={contact ? contact.fullName : 'Nuevo contacto'}
      description={
        contact
          ? `${contact.code}${contact.owner ? ` · Responsable: ${contact.owner.name}` : ''}`
          : undefined
      }
      confirmClose={form.formState.isDirty}
      footer={
        editable && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="contact-form" loading={form.formState.isSubmitting}>
              {contact ? 'Guardar cambios' : 'Crear contacto'}
            </Button>
          </>
        )
      }
    >
      {contact && (
        <div className="mb-4 flex flex-wrap gap-2">
          <HistoryButton entityType="CONTACT" entityId={contact.id} title={contact.fullName} />
          {can('contacts', 'delete') && editable && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Enviar a papelera
            </Button>
          )}
        </div>
      )}
      <form id="contact-form" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormMessage error={error} />
        <fieldset disabled={!editable} className="space-y-5">
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Datos personales</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" error={e.firstName?.message} required>
                <Input autoComplete="off" {...form.register('firstName')} />
              </Field>
              <Field label="Apellidos" error={e.lastName?.message}>
                <Input autoComplete="off" {...form.register('lastName')} />
              </Field>
              <Field label="Tipo de documento" error={e.documentTypeId?.message}>
                <Select {...form.register('documentTypeId')}>
                  <option value="">—</option>
                  {docTypes.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Número de documento" error={e.documentNumber?.message}>
                <Input autoComplete="off" {...form.register('documentNumber')} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Contacto y empresa</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Correo" error={e.email?.message}>
                <Input type="email" autoComplete="off" {...form.register('email')} />
              </Field>
              <Field label="Teléfono" error={e.phone?.message}>
                <Input type="tel" autoComplete="off" {...form.register('phone')} />
              </Field>
              <Field label="Compañía principal" error={e.companyId?.message}>
                <EntityPicker
                  value={company}
                  onChange={setCompany}
                  search={searchCompanies}
                  queryKey="companies"
                  placeholder="Buscar compañía…"
                />
              </Field>
              <Field label="Cargo" error={e.jobTitle?.message}>
                <Input {...form.register('jobTitle')} />
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Compañías relacionadas</p>
              <ul className="mb-2 flex flex-wrap gap-2">
                {related.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
                  >
                    <Link to={`/companias?id=${r.id}`} className="hover:underline">
                      {r.label}
                    </Link>
                    <button
                      type="button"
                      aria-label={`Quitar ${r.label}`}
                      onClick={() => setRelated(related.filter((x) => x.id !== r.id))}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <EntityPicker
                value={null}
                onChange={(c) =>
                  c && !related.some((r) => r.id === c.id) && setRelated([...related, c])
                }
                search={searchCompanies}
                queryKey="companies"
                placeholder="Agregar compañía relacionada…"
              />
            </div>
          </fieldset>
          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">Gestión</legend>
            <Field label="Responsable" error={e.ownerId?.message}>
              <Select {...form.register('ownerId')}>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observaciones" error={e.notes?.message}>
              <Textarea rows={3} {...form.register('notes')} />
            </Field>
          </fieldset>
          <CustomFieldInputs
            entityType="CONTACT"
            register={form.register}
            errors={form.formState.errors}
          />
        </fieldset>
      </form>
      {contact && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Enviar contacto a la papelera"
          confirmLabel="Enviar a papelera"
          danger
          onConfirm={async () => {
            await api.delete(`/contacts/${contact.id}`);
            await qc.invalidateQueries({ queryKey: ['contacts'] });
            toast.success('Contacto enviado a la papelera.');
            onClose();
          }}
        >
          «{contact.fullName}» dejará de aparecer en listas y búsquedas. Podrá restaurarlo desde la
          papelera.
        </ConfirmDialog>
      )}
    </Drawer>
  );
}
