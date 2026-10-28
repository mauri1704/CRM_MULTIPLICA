import { z } from 'zod';
import { uuid } from './common';

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
const version = z.number().int().min(0).optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato aaaa-mm-dd.')
  .or(z.literal('').transform(() => null))
  .nullish();
/** Fecha y hora ISO 8601 con zona (`2026-10-28T15:00:00.000Z`); vacío = sin fecha. */
const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Fecha y hora no válidas.' })
  .or(z.literal('').transform(() => null))
  .nullish();

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'CLOSED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  ACTIVE: 'En curso',
  ON_HOLD: 'En pausa',
  CLOSED: 'Cerrado',
};

const projectBase = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre del proyecto.').max(200),
  description: text(5000),
  ownerId: optionalUuid,
  status: z.enum(PROJECT_STATUSES).default('PLANNED'),
  startDate: isoDate,
  endDate: isoDate,
});
const projectDates = (v: { startDate?: string | null; endDate?: string | null }) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;
const projectDatesError = {
  path: ['endDate'],
  message: 'La fecha de fin no puede ser anterior a la de inicio.',
};

export const projectInput = projectBase.refine(projectDates, projectDatesError);
export type ProjectInput = z.infer<typeof projectInput>;
export const projectUpdate = projectBase
  .partial()
  .extend({ version })
  .refine(projectDates, projectDatesError);
export type ProjectUpdate = z.infer<typeof projectUpdate>;

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

/** Elemento CRM al que se asocia una tarea (como máximo uno, D-26). */
export const TASK_CRM_TYPES = ['CONTACT', 'COMPANY', 'LEAD', 'DEAL'] as const;
export type TaskCrmType = (typeof TASK_CRM_TYPES)[number];
export const crmRef = z.object({ type: z.enum(TASK_CRM_TYPES), id: uuid });
export type CrmRef = z.infer<typeof crmRef>;

export const TASK_MEMBER_ROLES = ['PARTICIPANT', 'OBSERVER'] as const;
export type TaskMemberRole = (typeof TASK_MEMBER_ROLES)[number];
/** Rol del usuario en una tarea (T-02). */
export type TaskRole = 'RESPONSIBLE' | TaskMemberRole;
export const TASK_ROLE_LABELS: Record<TaskRole, string> = {
  RESPONSIBLE: 'Responsable',
  PARTICIPANT: 'Participante',
  OBSERVER: 'Observador',
};

/** Filtro de la lista: Mis tareas, Participo, Observo, Todas (las del alcance). */
export const TASK_RELATIONS = ['mine', 'participant', 'observer', 'all'] as const;
export type TaskRelation = (typeof TASK_RELATIONS)[number];

const taskDates = (v: { startAt?: string | null; dueAt?: string | null }) =>
  !v.startAt || !v.dueAt || new Date(v.dueAt) >= new Date(v.startAt);
const taskDatesError = {
  path: ['dueAt'],
  message: 'El vencimiento no puede ser anterior al inicio.',
};
const members = (v: { participantIds?: string[]; observerIds?: string[] }) =>
  !(v.participantIds ?? []).some((id) => (v.observerIds ?? []).includes(id));
const membersError = {
  path: ['observerIds'],
  message: 'Un usuario no puede ser participante y observador a la vez.',
};

const taskBase = z.object({
  title: z.string().trim().min(2, 'Ingrese el título de la tarea.').max(200),
  description: text(10000),
  responsibleId: optionalUuid,
  participantIds: z.array(uuid).max(30).default([]),
  observerIds: z.array(uuid).max(30).default([]),
  startAt: isoDateTime,
  dueAt: isoDateTime,
  priorityId: optionalUuid,
  statusId: optionalUuid,
  projectId: optionalUuid,
  crm: crmRef.nullish(),
  customFields: z.record(z.unknown()).optional(),
});

export const taskInput = taskBase.refine(taskDates, taskDatesError).refine(members, membersError);
export type TaskInput = z.infer<typeof taskInput>;
export const taskUpdate = taskBase
  .partial()
  .extend({
    participantIds: z.array(uuid).max(30).optional(),
    observerIds: z.array(uuid).max(30).optional(),
    version,
  })
  .refine(taskDates, taskDatesError)
  .refine(members, membersError);
export type TaskUpdate = z.infer<typeof taskUpdate>;

/** Kanban de tareas: mover a otro estado (también lo puede hacer un participante). */
export const moveTaskInput = z.object({
  statusId: uuid,
  index: z.number().int().min(0).default(0),
  version,
});
export type MoveTaskInput = z.infer<typeof moveTaskInput>;

/** Calendario: arrastrar o estirar cambia las fechas. */
export const rescheduleTaskInput = z
  .object({ startAt: isoDateTime, dueAt: isoDateTime, version })
  .refine(taskDates, taskDatesError);
export type RescheduleTaskInput = z.infer<typeof rescheduleTaskInput>;

// ---------------------------------------------------------------------------
// Actividades (D-23): interacciones registradas a mano en la ficha.
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'NOTE'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: 'Llamada',
  MEETING: 'Reunión',
  EMAIL: 'Correo',
  NOTE: 'Nota',
};
export const ACTIVITY_TARGETS = ['LEAD', 'DEAL', 'CONTACT', 'COMPANY'] as const;
export type ActivityTarget = (typeof ACTIVITY_TARGETS)[number];

export const activityInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(2, 'Indique el asunto.').max(200),
  notes: text(5000),
  occurredAt: z
    .string()
    .datetime({ offset: true, message: 'Fecha y hora no válidas.' })
    .refine(
      (v) => new Date(v).getTime() <= Date.now() + 5 * 60_000,
      'La fecha no puede ser futura.',
    ),
});
export type ActivityInput = z.infer<typeof activityInput>;
export const activityUpdate = activityInput.partial();
export type ActivityUpdate = z.infer<typeof activityUpdate>;
