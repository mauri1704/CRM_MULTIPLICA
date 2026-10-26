import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  ENTITY_LABELS,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CustomFieldDef } from '@/lib/types';

export function CustomFieldsPage() {
  const { can } = useAuth();
  const manage = can('settings', 'manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [entity, setEntity] = useState<CustomFieldEntity>('CONTACT');
  const [editing, setEditing] = useState<CustomFieldDef | 'new' | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['custom-fields', entity, 'all'],
    queryFn: () =>
      api.get<CustomFieldDef[]>('/custom-fields', { entityType: entity, includeInactive: true }),
  });

  const toggle = async (f: CustomFieldDef) => {
    try {
      await api.patch(`/custom-fields/${f.id}`, { active: !f.active });
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: ColumnDef<CustomFieldDef, unknown>[] = [
    {
      accessorKey: 'label',
      header: 'Campo',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">
            {row.original.label}
            {row.original.required && (
              <span className="ml-1 text-danger" aria-label="obligatorio">
                *
              </span>
            )}
          </p>
          <p className="font-mono text-xs text-fg-muted">{row.original.key}</p>
        </div>
      ),
    },
    {
      accessorKey: 'type',
      header: 'Tipo',
      cell: ({ row }) => CUSTOM_FIELD_TYPE_LABELS[row.original.type as CustomFieldType],
    },
    { accessorKey: 'section', header: 'Sección', cell: ({ row }) => row.original.section ?? '—' },
    { accessorKey: 'position', header: 'Orden' },
    {
      accessorKey: 'active',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.active ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) =>
        manage && (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="sm" onClick={() => void toggle(row.original)}>
              {row.original.active ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Campos personalizados"
        description="Campos adicionales por módulo. Aparecen en formularios, listas, filtros, importación y exportación."
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo campo
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <Select
            aria-label="Módulo"
            value={entity}
            onChange={(e) => setEntity(e.target.value as CustomFieldEntity)}
            className="sm:w-60"
          >
            {CUSTOM_FIELD_ENTITIES.map((en) => (
              <option key={en} value={en}>
                {ENTITY_LABELS[en]}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={manage ? (r) => setEditing(r) : undefined}
            rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
            empty={
              <EmptyState
                icon={SlidersHorizontal}
                title={`${ENTITY_LABELS[entity]}: sin campos personalizados`}
              />
            }
          />
        )}
      </Card>
      {editing && (
        <FieldDialog
          entity={entity}
          field={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FieldDialog({
  entity,
  field,
  onClose,
}: {
  entity: CustomFieldEntity;
  field: CustomFieldDef | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(field?.label ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [type, setType] = useState<CustomFieldType>((field?.type as CustomFieldType) ?? 'TEXT');
  const [required, setRequired] = useState(field?.required ?? false);
  const [section, setSection] = useState(field?.section ?? '');
  const [helpText, setHelpText] = useState(field?.helpText ?? '');
  const [position, setPosition] = useState(String(field?.position ?? 0));
  const [options, setOptions] = useState(field?.options ?? []);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const usesOptions = type === 'SELECT' || type === 'MULTISELECT';

  const suggestKey = (l: string) =>
    l
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    const common = {
      label,
      required,
      section: section || null,
      helpText: helpText || null,
      position: Number(position) || 0,
      options: usesOptions ? options : [],
    };
    try {
      if (field) await api.patch(`/custom-fields/${field.id}`, common);
      else await api.post('/custom-fields', { ...common, entityType: entity, key, type });
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
      toast.success('Campo guardado.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        field ? `Editar ${field.label}` : `Nuevo campo de ${ENTITY_LABELS[entity].toLowerCase()}`
      }
      description={
        field ? 'La clave y el tipo no cambian para proteger los datos ya guardados.' : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} />
        <Field label="Etiqueta" error={details.label} required>
          <Input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (!field && (key === '' || key === suggestKey(label)))
                setKey(suggestKey(e.target.value));
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Clave"
            hint="Identificador interno (importación/exportación)."
            error={details.key}
            required
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!!field}
              className="font-mono"
            />
          </Field>
          <Field label="Tipo" error={details.type} required>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              disabled={!!field}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOM_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sección del formulario" error={details.section}>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Ej.: Datos adicionales"
            />
          </Field>
          <Field label="Orden" error={details.position}>
            <Input
              type="number"
              min={0}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Texto de ayuda" error={details.helpText}>
          <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Obligatorio
        </label>
        {usesOptions && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Opciones</legend>
            {details.options && <p className="mb-1 text-xs text-danger">{details.options}</p>}
            <ul className="space-y-2">
              {options.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <Input
                    aria-label={`Texto de la opción ${i + 1}`}
                    placeholder="Texto visible"
                    value={o.label}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? {
                                label: e.target.value,
                                value: x.value || suggestKey(e.target.value),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`Valor de la opción ${i + 1}`}
                    placeholder="valor"
                    className="w-40 font-mono"
                    value={o.value}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar opción ${i + 1}`}
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setOptions((prev) => [...prev, { value: '', label: '' }])}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar opción
            </Button>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
