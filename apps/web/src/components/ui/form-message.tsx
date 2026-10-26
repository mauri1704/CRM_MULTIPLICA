import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function FormMessage({
  error,
  success,
  className,
}: {
  error?: string | null;
  success?: string | null;
  className?: string;
}) {
  if (!error && !success) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        error
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-success/40 bg-success/10 text-success',
        className,
      )}
    >
      {error ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <span>{error ?? success}</span>
    </div>
  );
}
