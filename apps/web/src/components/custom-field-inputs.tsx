import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { useCustomFields, useUserOptions } from '@/lib/hooks';
import type { CustomFieldDef } from '@/lib/types';

/** Valores iniciales del formulario para los campos personalizados. */
export function customDefaults(
  defs: CustomFieldDef[] | undefined,
  values: Record<string, unknown> = {},
) {
  const out: Record<string, unknown> = {};
  for (const d of defs ?? []) {
    const v = values[d.key];
    if (d.type === 'BOOLEAN') out[d.key] = v === true;
    else if (d.type === 'MULTISELECT') out[d.key] = Array.isArray(v) ? v : [];
    else out[d.key] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** Quita los vacíos antes de enviar: la API valida obligatorios y formatos. */
export function cleanCustom(values: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  );
}

interface Props<T extends FieldValues> {
  entityType: string;
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
}

/** Campos personalizados activos del módulo, agrupados por sección. */
export function CustomFieldInputs<T extends FieldValues>({
  entityType,
  register,
  errors,
}: Props<T>) {
  const { data: defs } = useCustomFields(entityType);
  const users = useUserOptions();
  if (!defs || defs.length === 0) return null;
  const sections = [...new Set(defs.map((d) => d.section ?? 'Campos adicionales'))];
  const errorOf = (key: string) => {
    const group = (errors as Record<string, unknown>).customFields as
      | Record<string, { message?: string }>
      | undefined;
    return group?.[key]?.message;
  };
  return (
    <>
      {sections.map((section) => (
        <fieldset key={section} className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{section}</legend>
          {defs
            .filter((d) => (d.section ?? 'Campos adicionales') === section)
            .map((d) => {
              const name = `customFields.${d.key}` as Path<T>;
              if (d.type === 'BOOLEAN') {
                return (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox {...register(name)} />
                    {d.label}
                  </label>
                );
              }
              if (d.type === 'MULTISELECT') {
                return (
                  <fieldset key={d.id}>
                    <legend className="mb-1.5 text-sm font-medium">
                      {d.label}
                      {d.required && <span className="ml-0.5 text-danger">*</span>}
                    </legend>
                    <div className="flex flex-wrap gap-3">
                      {d.options.map((o) => (
                        <label key={o.value} className="flex items-center gap-1.5 text-sm">
                          <Checkbox value={o.value} {...register(name)} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    {errorOf(d.key) && <p className="mt-1 text-xs text-danger">{errorOf(d.key)}</p>}
                  </fieldset>
                );
              }
              const control =
                d.type === 'TEXTAREA' ? (
                  <Textarea rows={3} {...register(name)} />
                ) : d.type === 'SELECT' ? (
                  <Select {...register(name)}>
                    <option value="">—</option>
                    {d.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : d.type === 'USER' ? (
                  <Select {...register(name)}>
                    <option value="">—</option>
                    {users.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    type={
                      d.type === 'NUMBER' || d.type === 'MONEY'
                        ? 'number'
                        : d.type === 'DATE'
                          ? 'date'
                          : d.type === 'EMAIL'
                            ? 'email'
                            : d.type === 'URL'
                              ? 'url'
                              : d.type === 'PHONE'
                                ? 'tel'
                                : 'text'
                    }
                    step={d.type === 'MONEY' ? '0.01' : d.type === 'NUMBER' ? 'any' : undefined}
                    {...register(name)}
                  />
                );
              return (
                <Field
                  key={d.id}
                  label={d.label}
                  required={d.required}
                  hint={d.helpText ?? undefined}
                  error={errorOf(d.key)}
                >
                  {control}
                </Field>
              );
            })}
        </fieldset>
      ))}
    </>
  );
}
