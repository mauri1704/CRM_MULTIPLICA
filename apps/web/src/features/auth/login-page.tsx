import { zodResolver } from '@hookform/resolvers/zod';
import { loginInput, type LoginInput } from '@crm/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { AuthShell } from './auth-shell';

export function LoginPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInput),
    defaultValues: { email: '', password: '' },
  });

  if (user) return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      await refresh();
      navigate(from, { replace: true });
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <AuthShell
      title="CRM Multiplica"
      subtitle="Gestiona tus prospectos y negociaciones en un solo lugar."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormMessage error={error} />
        <Field label="Correo" error={form.formState.errors.email?.message} required>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Contraseña" error={form.formState.errors.password?.message} required>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button
          type="submit"
          className="w-full justify-center"
          loading={form.formState.isSubmitting}
        >
          Ingresar
        </Button>
        <p className="text-center text-sm">
          <Link to="/recuperar-clave" className="text-primary hover:underline">
            ¿Olvidó su contraseña?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
