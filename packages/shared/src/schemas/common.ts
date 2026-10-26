import { z } from 'zod';

export const uuid = z.string().uuid('Identificador no válido.');
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Ingrese el correo.')
  .max(254)
  .email('Ingrese un correo válido.');

/** Color hexadecimal `#RRGGBB`. */
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido (#RRGGBB).');

export const MIN_PASSWORD_LENGTH = 10;
export const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(200, 'La contraseña es demasiado larga.')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Combine letras y números.');

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListQuery = z.infer<typeof listQuery>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Formato único de error de la API. */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}
