import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/misc';

export function NotFoundPage() {
  return (
    <EmptyState icon={SearchX} title="Página no encontrada">
      <Link to="/" className="text-primary hover:underline">
        Volver al inicio
      </Link>
    </EmptyState>
  );
}
