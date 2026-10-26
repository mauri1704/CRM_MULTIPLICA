import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';

/**
 * Lleva los errores por campo que devuelve la API al formulario. Devuelve el mensaje general
 * para mostrarlo arriba del formulario.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string {
  if (error instanceof ApiError) {
    for (const [field, message] of Object.entries(error.details)) {
      setError(field as Path<T>, { type: 'server', message });
    }
  }
  return errorMessage(error);
}
