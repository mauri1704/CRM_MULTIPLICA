import { zodResolver } from '@hookform/resolvers/zod';
import { password } from '@crm/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { AuthShell } from './auth-shell';

const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, {
  path: ['confirm'],
  message: 'Las contraseñas no coinciden.',
});

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      setDone(true);
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <AuthShell title="Definir nueva contraseña">
      {done ? (
        <div className="space-y-4">
          <FormMessage success="Su contraseña se actualizó. Ya puede iniciar sesión." />
          <Link to="/login" className="block text-center text-sm text-primary hover:underline">
            Ir al inicio de sesión
          </Link>
        </div>
      ) : !token ? (
        <FormMessage error="El enlace no es válido. Solicite uno nuevo desde «¿Olvidó su contraseña?»." />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormMessage error={error} />
          <Field
            label="Nueva contraseña"
            hint="Mínimo 10 caracteres, con letras y números."
            error={form.formState.errors.password?.message}
            required
          >
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              {...form.register('password')}
            />
          </Field>
          <Field
            label="Repita la contraseña"
            error={form.formState.errors.confirm?.message}
            required
          >
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button
            type="submit"
            className="w-full justify-center"
            loading={form.formState.isSubmitting}
          >
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
