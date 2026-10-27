import { z } from 'zod';
import { uuid } from './common';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Ingrese un correo válido.')
  .transform((v) => (v === '' ? null : v))
  .nullish();
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === '' || /^\+?[0-9 ()-]{6,25}$/.test(v), 'Teléfono no válido.')
  .transform((v) => (v === '' ? null : v))
  .nullish();
const optionalUuid = z
  .union([uuid, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullish();
const customFields = z.record(z.unknown()).optional();
/** Versión leída por el usuario: si otro la cambió entretanto, la API responde 409. */
const version = z.number().int().min(0).optional();

// ---------------------------------------------------------------------------
// Compañías
// ---------------------------------------------------------------------------

export const companyInput = z.object({
  legalName: z.string().trim().min(2, 'Ingrese la razón social.').max(200),
  tradeName: text(200),
  taxIdTypeId: optionalUuid,
  taxId: text(20),
  sectorId: optionalUuid,
  address: text(300),
  city: text(100),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Código de país de 2 letras (ej.: PE).')
    .default('PE'),
  email: optionalEmail,
  phone,
  website: z
    .string()
    .trim()
    .max(200)
    .refine(
      (v) => v === '' || /^https?:\/\/\S+\.\S+$/.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v),
      'Sitio web no válido.',
    )
    .transform((v) => (v === '' ? null : /^https?:\/\//.test(v) ? v : `https://${v}`))
    .nullish(),
  ownerId: optionalUuid,
  notes: text(5000),
  customFields,
});
export type CompanyInput = z.infer<typeof companyInput>;
export const companyUpdate = companyInput.partial().extend({ version });
export type CompanyUpdate = z.infer<typeof companyUpdate>;

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

export const contactInput = z.object({
  firstName: z.string().trim().min(1, 'Ingrese el nombre.').max(100),
  lastName: text(100),
  documentTypeId: optionalUuid,
  documentNumber: text(30),
  phone,
  email: optionalEmail,
  jobTitle: text(100),
  companyId: optionalUuid,
  /** Compañías relacionadas además de la principal. */
  relatedCompanyIds: z.array(uuid).max(50).optional(),
  ownerId: optionalUuid,
  notes: text(5000),
  customFields,
});
export type ContactInput = z.infer<typeof contactInput>;
export const contactUpdate = contactInput.partial().extend({ version });
export type ContactUpdate = z.infer<typeof contactUpdate>;

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

/** Importe decimal como texto ("1234.5") para no perder precisión. Hasta 4 decimales. */
export const decimalString = (opts: { min?: number; max?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(',', '.'))
    .refine(
      (v) => /^-?\d{1,16}(\.\d{1,4})?$/.test(v),
      `${opts.label ?? 'El importe'} debe ser un número con hasta 4 decimales.`,
    )
    .refine(
      (v) => opts.min === undefined || Number(v) >= opts.min,
      `${opts.label ?? 'El importe'} debe ser mayor o igual a ${opts.min}.`,
    )
    .refine(
      (v) => opts.max === undefined || Number(v) <= opts.max,
      `${opts.label ?? 'El importe'} debe ser menor o igual a ${opts.max}.`,
    );

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras (ej.: PEN).');

export const productInput = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'Ingrese el SKU.')
    .max(60)
    .regex(/^[A-Za-z0-9._\-/]+$/, 'Use letras, números, punto, guion, barra o guion bajo.'),
  name: z.string().trim().min(2, 'Ingrese el nombre.').max(200),
  description: text(5000),
  categoryId: optionalUuid,
  price: decimalString({ min: 0, label: 'El precio' }),
  currencyCode,
  maxDiscountPct: decimalString({ min: 0, max: 100, label: 'El descuento' }).default('0'),
  customFields,
});
export type ProductInput = z.infer<typeof productInput>;
export const productUpdate = productInput
  .partial()
  .extend({ version, active: z.boolean().optional() });
export type ProductUpdate = z.infer<typeof productUpdate>;
