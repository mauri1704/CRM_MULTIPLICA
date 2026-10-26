import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordInput, type ChangePasswordInput } from '@crm/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordInput),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const close = (o: boolean) => {
    if (!o) {
      form.reset();
      setError(null);
    }
    onOpenChange(o);
  };
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/change-password', values);
      toast.success('Contraseña actualizada. Se cerraron sus otras sesiones.');
      close(false);
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Cambiar contraseña"
      confirmClose={form.formState.isDirty}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="change-password" loading={form.formState.isSubmitting}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="change-password" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormMessage error={error} />
        <Field
          label="Contraseña actual"
          error={form.formState.errors.currentPassword?.message}
          required
        >
          <Input
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </Field>
        <Field
          label="Nueva contraseña"
          hint="Mínimo 10 caracteres, con letras y números."
          error={form.formState.errors.newPassword?.message}
          required
        >
          <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
      </form>
    </Dialog>
  );
}
