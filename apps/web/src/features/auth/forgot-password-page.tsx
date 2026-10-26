import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordInput, type ForgotPasswordInput } from '@crm/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { AuthShell } from './auth-shell';

export function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordInput),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', values);
      setSent(res.message);
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Le enviaremos un enlace para definir una nueva."
    >
      {sent ? (
        <div className="space-y-4">
          <FormMessage success={sent} />
          <Link to="/login" className="block text-center text-sm text-primary hover:underline">
            Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormMessage error={error} />
          <Field label="Correo" error={form.formState.errors.email?.message} required>
            <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
          </Field>
          <Button
            type="submit"
            className="w-full justify-center"
            loading={form.formState.isSubmitting}
          >
            Enviar enlace
          </Button>
          <Link to="/login" className="block text-center text-sm text-primary hover:underline">
            Volver al inicio de sesión
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
