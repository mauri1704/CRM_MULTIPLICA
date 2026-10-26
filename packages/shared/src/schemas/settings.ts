import { z } from 'zod';

/** Parámetros generales de la organización (D-05, D-09, D-21, D-24). */
export const organizationSettingsSchema = z.object({
  timezone: z.string().min(1).max(60),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']),
  numberLocale: z.enum(['en-US', 'es-PE', 'es-ES']),
  trashRetentionDays: z.number().int().min(7, 'Mínimo 7 días.').max(3650),
  trashAutoPurge: z.boolean(),
  exchangeRateMaxAgeDays: z.number().int().min(0).max(30),
  exchangeRateAllowInverse: z.boolean(),
  roundingMode: z.literal('HALF_UP'),
  sessionIdleHours: z.number().int().min(1).max(24),
  taskOverdueNotifications: z.boolean(),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  timezone: 'America/Lima',
  dateFormat: 'dd/MM/yyyy',
  numberLocale: 'en-US',
  trashRetentionDays: 90,
  trashAutoPurge: true,
  exchangeRateMaxAgeDays: 3,
  exchangeRateAllowInverse: true,
  roundingMode: 'HALF_UP',
  sessionIdleHours: 8,
  taskOverdueNotifications: true,
};

export const updateOrganizationInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(200).nullish(),
  taxId: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El RUC debe tener 11 dígitos.')
    .nullish()
    .or(z.literal('').transform(() => null)),
  baseCurrencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras.')
    .optional(),
  settings: organizationSettingsSchema.partial().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInput>;
