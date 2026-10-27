import { z } from 'zod';
import { uuid } from './common';
import { currencyCode, decimalString } from './crm';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const optionalUuid = z
  .union([uuid, z.literal('')])
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
const optionalDecimal = (label: string) =>
  z
    .union([decimalString({ min: 0, label }), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullish();
const version = z.number().int().min(0).optional();
const customFields = z.record(z.unknown()).optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato aaaa-mm-dd.')
  .or(z.literal('').transform(() => null))
  .nullish();

// ---------------------------------------------------------------------------
// Prospectos
// ---------------------------------------------------------------------------

export const leadInput = z.object({
  title: z.string().trim().min(2, 'Ingrese el nombre del prospecto.').max(200),
  contactId: optionalUuid,
  companyId: optionalUuid,
  phone,
  email: optionalEmail,
  sourceId: optionalUuid,
  pipelineId: optionalUuid,
  stageId: optionalUuid,
  ownerId: optionalUuid,
  priorityId: optionalUuid,
  currencyCode: currencyCode.optional(),
  estimatedValue: optionalDecimal('El valor estimado'),
  notes: text(5000),
  customFields,
});
export type LeadInput = z.infer<typeof leadInput>;
export const leadUpdate = leadInput.partial().extend({ version });
export type LeadUpdate = z.infer<typeof leadUpdate>;

// ---------------------------------------------------------------------------
// Negociaciones
// ---------------------------------------------------------------------------

export const dealInput = z.object({
  title: z.string().trim().min(2, 'Ingrese el título de la negociación.').max(200),
  companyId: optionalUuid,
  contactIds: z.array(uuid).max(50).optional(),
  primaryContactId: optionalUuid,
  pipelineId: optionalUuid,
  stageId: optionalUuid,
  ownerId: optionalUuid,
  priorityId: optionalUuid,
  currencyCode: currencyCode.optional(),
  estimatedValue: optionalDecimal('El valor estimado'),
  probability: z
    .union([z.number().int().min(0).max(100), z.literal('').transform(() => null)])
    .nullish(),
  expectedCloseDate: isoDate,
  notes: text(5000),
  customFields,
});
export type DealInput = z.infer<typeof dealInput>;
export const dealUpdate = dealInput.partial().extend({ version });
export type DealUpdate = z.infer<typeof dealUpdate>;

// ---------------------------------------------------------------------------
// Kanban: mover entre etapas
// ---------------------------------------------------------------------------

export const moveStageInput = z.object({
  stageId: uuid,
  /** Posición dentro de la columna destino (0 = arriba). */
  index: z.number().int().min(0).default(0),
  /** Obligatorio al mover a una etapa "Perdida". */
  lossReasonId: optionalUuid,
  lossNote: text(1000),
  /** Al ganar una negociación: valor final (por defecto, el total) y fecha de cierre. */
  finalValue: optionalDecimal('El valor final'),
  closedAt: isoDate,
  version,
});
export type MoveStageInput = z.infer<typeof moveStageInput>;

// ---------------------------------------------------------------------------
// Productos asociados (líneas)
// ---------------------------------------------------------------------------

export const DISCOUNT_TYPES = ['AMOUNT', 'PERCENT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const lineInput = z
  .object({
    productId: uuid,
    /** Descripción comercial: por defecto, el nombre del producto. */
    description: z.string().trim().max(500).optional(),
    quantity: decimalString({ min: 0, label: 'La cantidad' }).refine(
      (v) => Number(v) > 0,
      'La cantidad debe ser mayor que cero.',
    ),
    /** Por defecto, el precio del catálogo. */
    unitPrice: decimalString({ min: 0, label: 'El precio' }).optional(),
    discountType: z.enum(DISCOUNT_TYPES).default('PERCENT'),
    discountValue: decimalString({ min: 0, label: 'El descuento' }).default('0'),
    /** Tasa elegida a mano por un usuario autorizado cuando no hay una válida (D-05). */
    manualRate: decimalString({ label: 'La tasa' })
      .refine((v) => Number(v) > 0, 'La tasa debe ser mayor que cero.')
      .optional(),
    manualRateReason: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.discountType !== 'PERCENT' || Number(v.discountValue) <= 100, {
    path: ['discountValue'],
    message: 'El porcentaje no puede superar 100.',
  })
  .refine((v) => !v.manualRate || !!v.manualRateReason, {
    path: ['manualRateReason'],
    message: 'Indique el motivo de la tasa manual.',
  });
export type LineInput = z.infer<typeof lineInput>;

export const lineUpdate = z.object({
  description: z.string().trim().max(500).optional(),
  quantity: decimalString({ label: 'La cantidad' })
    .refine((v) => Number(v) > 0, 'La cantidad debe ser mayor que cero.')
    .optional(),
  unitPrice: decimalString({ min: 0, label: 'El precio' }).optional(),
  discountType: z.enum(DISCOUNT_TYPES).optional(),
  discountValue: decimalString({ min: 0, label: 'El descuento' }).optional(),
});
export type LineUpdate = z.infer<typeof lineUpdate>;

// ---------------------------------------------------------------------------
// Conversión de prospecto a negociación (D-07)
// ---------------------------------------------------------------------------

export const convertLeadInput = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  pipelineId: uuid,
  stageId: uuid,
  currencyCode: currencyCode.optional(),
  expectedCloseDate: isoDate,
});
export type ConvertLeadInput = z.infer<typeof convertLeadInput>;

// ---------------------------------------------------------------------------
// Comentarios
// ---------------------------------------------------------------------------

export const COMMENT_TARGETS = ['LEAD', 'DEAL', 'CONTACT', 'COMPANY'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export const commentInput = z.object({
  body: z.string().trim().min(1, 'Escriba el comentario.').max(5000),
  /** Usuarios a notificar. */
  mentions: z.array(uuid).max(20).default([]),
});
export type CommentInput = z.infer<typeof commentInput>;

export const DEAL_STATUS_LABELS = { OPEN: 'Abierta', WON: 'Ganada', LOST: 'Perdida' } as const;
