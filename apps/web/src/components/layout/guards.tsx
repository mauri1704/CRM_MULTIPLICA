import type { PermissionAction, PermissionModule } from '@crm/shared';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';

/** Rutas privadas: sin sesión vuelve al login y recuerda a dónde iba. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** La API valida siempre; esto solo evita mostrar una pantalla que respondería 403. */
export function RequirePermission({
  module,
  action,
  children,
}: {
  module: PermissionModule;
  action: PermissionAction;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(module, action)) {
    return (
      <EmptyState icon={ShieldAlert} title="No tiene acceso a esta sección">
        Si lo necesita, pídale al administrador que revise los permisos de su rol.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
