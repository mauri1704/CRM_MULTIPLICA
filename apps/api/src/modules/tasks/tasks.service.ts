import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  normalizeText,
  type CrmRef,
  type MoveTaskInput,
  type PermissionAction,
  type RescheduleTaskInput,
  type TaskCrmType,
  type TaskInput,
  type TaskRelation,
  type TaskRole,
  type TaskUpdate,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { CRM_FIELD, CRM_MODULE, CrmRecordsService } from '../access/crm-records.service';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion, customValues } from '../access/versioning';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { HistoryService, diff } from '../history/history.service';
import { NotificationsService, type NewNotification } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { positionAt } from '../sales/board';
import { StagesService } from '../sales/stages';
import { SequenceService } from '../sequences/sequence.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';

export interface TaskFilters {
  q?: string;
  rel?: TaskRelation;
  responsibleId?: string;
  priorityId?: string;
  statusId?: string;
  projectId?: string;
  contactId?: string;
  companyId?: string;
  leadId?: string;
  dealId?: string;
  /** true = solo abiertas (sin completar ni cancelar). */
  open?: boolean;
  overdue?: boolean;
}
export interface TaskQuery extends TaskFilters {
  sort?: 'dueAt' | 'createdAt' | 'title' | 'code';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const taskInclude = {
  responsible: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, color: true, icon: true, rank: true } },
  status: { select: { id: true, name: true, color: true, category: true } },
  project: { select: { id: true, code: true, name: true, deletedAt: true } },
  contact: { select: { id: true, code: true, firstName: true, lastName: true, deletedAt: true } },
  company: { select: { id: true, code: true, legalName: true, deletedAt: true } },
  lead: { select: { id: true, code: true, title: true, deletedAt: true } },
  deal: { select: { id: true, code: true, title: true, deletedAt: true } },
  members: {
    select: { userId: true, role: true, user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TaskInclude;
type Row = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const CLOSED = ['DONE', 'CANCELED'];
function crmOf(t: Row) {
  if (t.contact && !t.contact.deletedAt)
    return {
      type: 'CONTACT' as const,
      id: t.contact.id,
      code: t.contact.code,
      name: [t.contact.firstName, t.contact.lastName].filter(Boolean).join(' '),
    };
  if (t.company && !t.company.deletedAt)
    return {
      type: 'COMPANY' as const,
      id: t.company.id,
      code: t.company.code,
      name: t.company.legalName,
    };
  if (t.lead && !t.lead.deletedAt)
    return { type: 'LEAD' as const, id: t.lead.id, code: t.lead.code, name: t.lead.title };
  if (t.deal && !t.deal.deletedAt)
    return { type: 'DEAL' as const, id: t.deal.id, code: t.deal.code, name: t.deal.title };
  return null;
}

/** Alcance de una acción: null = todos, lista = responsables permitidos, 'none' = sin permiso. */
type Ids = string[] | null | 'none';
const inIds = (ids: Ids, id: string) => ids !== 'none' && (ids === null || ids.includes(id));

export interface Permits {
  edit: Ids;
  delete: Ids;
}

export function taskDto(t: Row, userId: string, permits?: Permits) {
  const member = t.members.find((m) => m.userId === userId);
  const role: TaskRole | null =
    t.responsibleId === userId ? 'RESPONSIBLE' : ((member?.role as TaskRole | undefined) ?? null);
  const closed = CLOSED.includes(t.status.category);
  const canEdit = permits ? inIds(permits.edit, t.responsibleId) : false;
  return {
    id: t.id,
    code: t.code,
    title: t.title,
    description: t.description,
    responsible: t.responsible,
    responsibleId: t.responsibleId,
    participants: t.members.filter((m) => m.role === 'PARTICIPANT').map((m) => m.user),
    observers: t.members.filter((m) => m.role === 'OBSERVER').map((m) => m.user),
    startAt: t.startAt,
    dueAt: t.dueAt,
    priority: t.priority,
    priorityId: t.priorityId,
    status: t.status,
    statusId: t.statusId,
    project:
      t.project && !t.project.deletedAt
        ? { id: t.project.id, code: t.project.code, name: t.project.name }
        : null,
    projectId: t.projectId,
    crm: crmOf(t),
    completedAt: t.completedAt,
    overdue: !closed && !!t.dueAt && t.dueAt.getTime() < Date.now(),
    customFields: customValues(t.customFields),
    version: t.version,
    createdAt: t.createdAt,
    myRole: role,
    can: {
      edit: canEdit,
      // T-02: el participante cambia el estado; el observador solo ve y comenta.
      status: canEdit || (role === 'PARTICIPANT' && permits?.edit !== 'none'),
      delete: permits ? inIds(permits.delete, t.responsibleId) : false,
    },
  };
}
export type TaskDto = ReturnType<typeof taskDto>;

const FIELDS = [
  'title',
  'description',
  'responsibleId',
  'startAt',
  'dueAt',
  'priorityId',
  'statusId',
  'projectId',
  'contactId',
  'companyId',
  'leadId',
  'dealId',
  'customFields',
] as const;

/**
 * Tareas (Fase 4). El alcance del rol se aplica sobre el responsable; además, cada usuario ve las
 * tareas donde participa u observa. Editar = responsable (o alcance de equipo/todos); el
 * participante solo cambia el estado; el observador ve y comenta (T-02).
 */
@Injectable()
export class TasksService implements OnModuleInit, TrashHandler {
  readonly entityType = 'TASK' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly customFields: CustomFieldsService,
    private readonly notifications: NotificationsService,
    private readonly stages: StagesService,
    private readonly projects: ProjectsService,
    private readonly crmRecords: CrmRecordsService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  private async ids(user: AuthUser, action: PermissionAction): Promise<Ids> {
    try {
      return await this.scope.ownerIds(user, 'tasks', action);
    } catch {
      return 'none';
    }
  }

  async permits(user: AuthUser): Promise<Permits> {
    const [edit, del] = await Promise.all([this.ids(user, 'edit'), this.ids(user, 'delete')]);
    return { edit, delete: del };
  }

  /** Tareas visibles: las del alcance (por responsable) y aquellas donde participa u observa. */
  async where(user: AuthUser, f: TaskFilters, action: 'view' | 'export' = 'view') {
    const ids = await this.scope.ownerIds(user, 'tasks', action);
    const and: Prisma.TaskWhereInput[] = [];
    if (ids !== null) {
      and.push({
        OR: [{ responsibleId: { in: ids } }, { members: { some: { userId: user.id } } }],
      });
    }
    if (f.rel === 'mine') and.push({ responsibleId: user.id });
    if (f.rel === 'participant')
      and.push({ members: { some: { userId: user.id, role: 'PARTICIPANT' } } });
    if (f.rel === 'observer')
      and.push({ members: { some: { userId: user.id, role: 'OBSERVER' } } });
    if (f.responsibleId) and.push({ responsibleId: f.responsibleId });
    if (f.open) and.push({ status: { category: { notIn: CLOSED } } });
    if (f.overdue) and.push({ status: { category: { notIn: CLOSED } }, dueAt: { lt: new Date() } });
    const norm = normalizeText(f.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(f.priorityId ? { priorityId: f.priorityId } : {}),
      ...(f.statusId ? { statusId: f.statusId } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.contactId ? { contactId: f.contactId } : {}),
      ...(f.companyId ? { companyId: f.companyId } : {}),
      ...(f.leadId ? { leadId: f.leadId } : {}),
      ...(f.dealId ? { dealId: f.dealId } : {}),
      ...(norm ? { searchNorm: { contains: norm } } : {}),
      ...(and.length ? { AND: and } : {}),
    } satisfies Prisma.TaskWhereInput;
  }

  async list(user: AuthUser, q: TaskQuery) {
    const where = await this.where(user, q);
    const sort = q.sort ?? 'dueAt';
    const [items, total, permits] = await Promise.all([
      this.db.tx.task.findMany({
        where,
        include: taskInclude,
        orderBy: [
          sort === 'dueAt'
            ? { dueAt: { sort: q.dir ?? 'asc', nulls: 'last' } }
            : { [sort]: q.dir ?? 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.task.count({ where }),
      this.permits(user),
    ]);
    return {
      items: items.map((t) => taskDto(t, user.id, permits)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  listRaw(where: Prisma.TaskWhereInput, limit: number) {
    return this.db.tx.task.findMany({
      where,
      include: taskInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Kanban por estado (T-05). */
  async board(user: AuthUser, f: TaskFilters) {
    const statuses = await this.db.tx.taskStatus.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { position: 'asc' },
    });
    const [items, permits] = await Promise.all([
      this.db.tx.task.findMany({
        where: await this.where(user, f),
        include: taskInclude,
        orderBy: [{ statusPosition: 'asc' }, { id: 'asc' }],
        take: 1000,
      }),
      this.permits(user),
    ]);
    return {
      truncated: items.length === 1000,
      columns: statuses.map((s) => {
        const cards = items.filter((i) => i.statusId === s.id);
        return {
          stage: { id: s.id, name: s.name, kind: s.category, color: s.color },
          count: cards.length,
          sums: [],
          items: cards.map((t) => taskDto(t, user.id, permits)),
        };
      }),
    };
  }

  /** Calendario: tareas con inicio o vencimiento dentro del rango visible. */
  async calendar(user: AuthUser, f: TaskFilters & { from: Date; to: Date }) {
    const where = await this.where(user, f);
    const range = { gte: f.from, lt: f.to };
    const [items, permits] = await Promise.all([
      this.db.tx.task.findMany({
        where: {
          ...where,
          OR: [
            { dueAt: range },
            { startAt: range },
            { startAt: { lt: f.from }, dueAt: { gte: f.to } },
          ],
        },
        include: taskInclude,
        orderBy: { dueAt: 'asc' },
        take: 2000,
      }),
      this.permits(user),
    ]);
    return items.map((t) => taskDto(t, user.id, permits));
  }

  private async findAlive(id: string) {
    const t = await this.db.tx.task.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include: taskInclude,
    });
    if (!t) throw notFound('La tarea');
    return t;
  }

  private async assertCan(user: AuthUser, t: Row, what: 'view' | 'edit' | 'status' | 'delete') {
    if (what === 'view') {
      const ids = await this.ids(user, 'view');
      if (inIds(ids, t.responsibleId) || t.members.some((m) => m.userId === user.id)) return;
      throw forbidden('Esta tarea no está dentro de su alcance.');
    }
    const dto = taskDto(t, user.id, await this.permits(user));
    if (dto.can[what]) return;
    if (dto.myRole === 'OBSERVER') {
      throw forbidden('Como observador puede ver y comentar la tarea, pero no modificarla.');
    }
    if (dto.myRole === 'PARTICIPANT' && what === 'edit') {
      throw forbidden('Como participante solo puede cambiar el estado y comentar.');
    }
    throw forbidden('Esta tarea no está dentro de su alcance para esta acción.');
  }

  async get(user: AuthUser, id: string) {
    const t = await this.findAlive(id);
    await this.assertCan(user, t, 'view');
    return taskDto(t, user.id, await this.permits(user));
  }

  /** Comprueba que la tarea existe y se puede ver; para comentarios. Devuelve su nombre. */
  async assertVisible(user: AuthUser, id: string) {
    const t = await this.findAlive(id);
    await this.assertCan(user, t, 'view');
    return {
      name: `${t.code} ${t.title}`,
      people: [t.responsibleId, ...t.members.map((m) => m.userId)],
    };
  }

  // --- Validaciones ---------------------------------------------------------------------------

  private async status(id: string | null | undefined) {
    const s = id
      ? await this.db.tx.taskStatus.findFirst({
          where: { id, organizationId: this.db.organizationId, active: true },
        })
      : await this.db.tx.taskStatus.findFirst({
          where: { organizationId: this.db.organizationId, active: true, category: 'OPEN' },
          orderBy: { position: 'asc' },
        });
    if (!s) throw validationError({ statusId: 'El estado no existe o está inactivo.' });
    return s;
  }

  /** El elemento CRM existe, está vigente y el usuario lo puede ver. */
  private async crm(user: AuthUser, ref: CrmRef | null | undefined) {
    const out = { contactId: null, companyId: null, leadId: null, dealId: null } as Record<
      (typeof CRM_FIELD)[TaskCrmType],
      string | null
    >;
    if (!ref) return { fields: out, name: null as string | null };
    const rec = await this.crmRecords.find(ref.type, ref.id);
    if (!rec)
      throw validationError({ crm: 'El elemento asociado no existe o está en la papelera.' });
    if (!(await this.scope.allows(user, CRM_MODULE[ref.type], 'view', rec.ownerId))) {
      throw validationError({ crm: 'El elemento asociado no está dentro de su alcance.' });
    }
    out[CRM_FIELD[ref.type]] = ref.id;
    return { fields: out, name: rec.code };
  }

  private async assertUsers(ids: string[], field: string) {
    if (ids.length === 0) return;
    const n = await this.db.q.user.count({
      where: { id: { in: ids }, organizationId: this.db.organizationId, active: true },
    });
    if (n !== new Set(ids).size)
      throw validationError({ [field]: 'Algún usuario no existe o está inactivo.' });
  }

  private search(t: { code: string; title: string }, crmCode?: string | null) {
    return normalizeText([t.code, t.title, crmCode].filter(Boolean).join(' '));
  }

  private assignNotices(
    user: AuthUser,
    task: { id: string; code: string; title: string },
    people: { userId: string; role: TaskRole }[],
  ): NewNotification[] {
    const text: Record<TaskRole, string> = {
      RESPONSIBLE: 'le asignó la tarea',
      PARTICIPANT: 'lo agregó como participante en',
      OBSERVER: 'lo agregó como observador en',
    };
    return people
      .filter((p) => p.userId !== user.id)
      .map((p) => ({
        userId: p.userId,
        type: p.role === 'RESPONSIBLE' ? 'TASK_ASSIGNED' : 'TASK_MEMBER',
        title: `${user.name} ${text[p.role]} ${task.code} ${task.title}`,
        link: `/tareas?id=${task.id}`,
        entityType: 'TASK' as const,
        entityId: task.id,
      }));
  }

  // --- Escritura ------------------------------------------------------------------------------

  async create(user: AuthUser, input: TaskInput) {
    const responsibleId = await this.scope.resolveOwner(
      user,
      'tasks',
      'create',
      input.responsibleId,
    );
    await this.assertUsers([...input.participantIds, ...input.observerIds], 'participantIds');
    const status = await this.status(input.statusId);
    if (input.priorityId) await this.stages.assertPriority(input.priorityId);
    if (input.projectId) await this.projects.assertUsable(input.projectId);
    const crm = await this.crm(user, input.crm);
    const custom = await this.customFields.validate('TASK', input.customFields);
    const code = await this.sequences.next('TASK');
    const top = await this.db.tx.task.aggregate({
      where: { organizationId: user.organizationId, statusId: status.id, deletedAt: null },
      _min: { statusPosition: true },
    });
    const participants = input.participantIds.filter((id) => id !== responsibleId);
    const observers = input.observerIds.filter((id) => id !== responsibleId);
    const t = await this.db.tx.task.create({
      data: {
        organizationId: user.organizationId,
        code,
        title: input.title,
        description: input.description ?? null,
        responsibleId,
        startAt: input.startAt ? new Date(input.startAt) : null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priorityId: input.priorityId ?? (await this.stages.defaultPriorityId()),
        statusId: status.id,
        statusPosition: (top._min.statusPosition ?? 1000) - 1000,
        projectId: input.projectId ?? null,
        completedAt: status.category === 'DONE' ? new Date() : null,
        ...crm.fields,
        customFields: custom as Prisma.InputJsonValue,
        searchNorm: this.search({ code, title: input.title }, crm.name),
        createdById: user.id,
        updatedById: user.id,
        members: {
          create: [
            ...participants.map((userId) => ({
              organizationId: user.organizationId,
              userId,
              role: 'PARTICIPANT',
            })),
            ...observers.map((userId) => ({
              organizationId: user.organizationId,
              userId,
              role: 'OBSERVER',
            })),
          ],
        },
      },
    });
    await this.history.record('TASK', t.id, 'CREATE', user.id, {
      code,
      title: t.title,
      responsibleId,
      status: status.name,
    });
    await this.notifications.notify(
      this.assignNotices(user, t, [
        { userId: responsibleId, role: 'RESPONSIBLE' },
        ...participants.map((userId) => ({ userId, role: 'PARTICIPANT' as const })),
        ...observers.map((userId) => ({ userId, role: 'OBSERVER' as const })),
      ]),
    );
    return this.get(user, t.id);
  }

  async update(user: AuthUser, id: string, input: TaskUpdate) {
    const before = await this.findAlive(id);
    await this.assertCan(user, before, 'edit');
    const {
      version,
      customFields,
      participantIds,
      observerIds,
      crm: crmInput,
      statusId,
      ...rest
    } = input;
    const fields: Record<string, unknown> = { ...rest };
    if (rest.responsibleId !== undefined && rest.responsibleId !== before.responsibleId) {
      fields.responsibleId = await this.scope.resolveOwner(
        user,
        'tasks',
        'edit',
        rest.responsibleId,
      );
    } else delete fields.responsibleId;
    const responsibleId = (fields.responsibleId as string | undefined) ?? before.responsibleId;
    if (rest.priorityId) await this.stages.assertPriority(rest.priorityId);
    if (rest.projectId) await this.projects.assertUsable(rest.projectId);
    let crmName: string | null | undefined;
    if (crmInput !== undefined) {
      const crm = await this.crm(user, crmInput);
      Object.assign(fields, crm.fields);
      crmName = crm.name;
    }
    let completedAt: Date | null | undefined;
    if (statusId && statusId !== before.statusId) {
      const s = await this.status(statusId);
      fields.statusId = s.id;
      completedAt = s.category === 'DONE' ? new Date() : null;
    }
    for (const k of ['startAt', 'dueAt'] as const) {
      if (rest[k] !== undefined) fields[k] = rest[k] ? new Date(rest[k]) : null;
    }
    const start = rest.startAt !== undefined ? (fields.startAt as Date | null) : before.startAt;
    const due = rest.dueAt !== undefined ? (fields.dueAt as Date | null) : before.dueAt;
    if (start && due && due < start) {
      throw validationError({ dueAt: 'El vencimiento no puede ser anterior al inicio.' });
    }
    const custom =
      customFields !== undefined
        ? await this.customFields.validate('TASK', customFields, customValues(before.customFields))
        : undefined;
    const changes = diff(
      { ...before, customFields: customValues(before.customFields) },
      { ...fields, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );

    // Participantes y observadores: se reemplazan las listas que vengan.
    const current = new Map(before.members.map((m) => [m.userId, m.role]));
    const nextMembers = new Map(current);
    if (participantIds !== undefined || observerIds !== undefined) {
      const parts =
        participantIds ??
        before.members.filter((m) => m.role === 'PARTICIPANT').map((m) => m.userId);
      const obs =
        observerIds ?? before.members.filter((m) => m.role === 'OBSERVER').map((m) => m.userId);
      if (parts.some((p) => obs.includes(p))) {
        throw validationError({
          observerIds: 'Un usuario no puede ser participante y observador a la vez.',
        });
      }
      await this.assertUsers([...parts, ...obs], 'participantIds');
      nextMembers.clear();
      for (const p of parts) nextMembers.set(p, 'PARTICIPANT');
      for (const o of obs) nextMembers.set(o, 'OBSERVER');
    }
    nextMembers.delete(responsibleId);
    const added = [...nextMembers].filter(([u, r]) => current.get(u) !== r);
    const removed = [...current.keys()].filter((u) => !nextMembers.has(u));
    const membersChanged = added.length > 0 || removed.length > 0;
    if (membersChanged) {
      const names = await this.db.q.user.findMany({
        where: { id: { in: [...current.keys(), ...nextMembers.keys()] } },
        select: { id: true, name: true },
      });
      const label = (m: Map<string, string>, role: string) =>
        [...m].filter(([, r]) => r === role).map(([u]) => names.find((n) => n.id === u)?.name ?? u);
      changes.participants = {
        from: label(current, 'PARTICIPANT'),
        to: label(nextMembers, 'PARTICIPANT'),
      };
      changes.observers = { from: label(current, 'OBSERVER'), to: label(nextMembers, 'OBSERVER') };
    }
    if (Object.keys(changes).length === 0) return this.get(user, id);

    const res = await this.db.tx.task.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: {
        ...(fields as Prisma.TaskUncheckedUpdateManyInput),
        ...(completedAt !== undefined ? { completedAt } : {}),
        ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
        ...(rest.title !== undefined || crmName !== undefined
          ? {
              searchNorm: this.search(
                { code: before.code, title: rest.title ?? before.title },
                crmName !== undefined ? crmName : crmOf(before)?.code,
              ),
            }
          : {}),
        // Cambiar el vencimiento vuelve a habilitar el aviso de vencida.
        ...(rest.dueAt !== undefined ? { overdueNotifiedAt: null } : {}),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (membersChanged) {
      await this.db.tx.taskMember.deleteMany({
        where: {
          organizationId: user.organizationId,
          taskId: id,
          userId: { in: [...removed, ...added.map(([u]) => u)] },
        },
      });
      await this.db.tx.taskMember.createMany({
        data: added.map(([userId, role]) => ({
          organizationId: user.organizationId,
          taskId: id,
          userId,
          role,
        })),
      });
    }
    await this.history.record('TASK', id, 'UPDATE', user.id, changes);
    await this.notifications.notify(
      this.assignNotices(user, { id, code: before.code, title: rest.title ?? before.title }, [
        ...(responsibleId !== before.responsibleId
          ? [{ userId: responsibleId, role: 'RESPONSIBLE' as const }]
          : []),
        ...added.map(([userId, role]) => ({ userId, role: role as TaskRole })),
      ]),
    );
    return this.get(user, id);
  }

  /** Cambiar de estado o de posición en el Kanban. */
  async move(user: AuthUser, id: string, input: MoveTaskInput) {
    const t = await this.findAlive(id);
    await this.assertCan(user, t, 'status');
    const status = await this.status(input.statusId);
    const others = await this.db.tx.task.findMany({
      where: {
        organizationId: user.organizationId,
        statusId: status.id,
        deletedAt: null,
        id: { not: id },
      },
      orderBy: { statusPosition: 'asc' },
      select: { statusPosition: true },
    });
    const changed = status.id !== t.statusId;
    const res = await this.db.tx.task.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(input.version !== undefined ? { version: input.version } : {}),
      },
      data: {
        statusId: status.id,
        statusPosition: positionAt(
          others.map((o) => o.statusPosition),
          input.index,
        ),
        ...(changed ? { completedAt: status.category === 'DONE' ? new Date() : null } : {}),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (changed) {
      await this.history.record('TASK', id, 'STATUS_CHANGE', user.id, {
        status: { from: t.status.name, to: status.name },
      });
    }
    return this.get(user, id);
  }

  /** Calendario: arrastrar o estirar cambia las fechas. */
  async reschedule(user: AuthUser, id: string, input: RescheduleTaskInput) {
    const t = await this.findAlive(id);
    await this.assertCan(user, t, 'edit');
    const startAt = input.startAt ? new Date(input.startAt) : null;
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    const changes = diff(t, { startAt, dueAt }, ['startAt', 'dueAt'] as const);
    if (Object.keys(changes).length === 0) return this.get(user, id);
    const res = await this.db.tx.task.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(input.version !== undefined ? { version: input.version } : {}),
      },
      data: {
        startAt,
        dueAt,
        overdueNotifiedAt: null,
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    await this.history.record('TASK', id, 'UPDATE', user.id, changes);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string, actor: Actor) {
    const t = await this.findAlive(id);
    await this.assertCan(user, t, 'delete');
    await this.db.tx.task.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    const crm = crmOf(t);
    await this.trash.add(
      'TASK',
      {
        id,
        displayName: t.title,
        code: t.code,
        ownerId: t.responsibleId,
        relations: {
          ...(t.project ? { proyecto: t.project.name } : {}),
          ...(crm ? { asociado: `${crm.code} ${crm.name}` } : {}),
        },
      },
      actor,
    );
  }

  /** Recalcula el texto de búsqueda (el código del elemento asociado cambió por una fusión). */
  async reindex(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db.tx.task.findMany({
      where: { organizationId: this.db.organizationId, id: { in: ids } },
      include: taskInclude,
    });
    for (const t of rows) {
      await this.db.tx.task.updateMany({
        where: { id: t.id, organizationId: this.db.organizationId },
        data: { searchNorm: this.search(t, crmOf(t)?.code) },
      });
    }
  }

  /** Al convertir un prospecto, sus tareas abiertas pasan a la negociación (regla 04 §4). */
  async moveOpenFromLeadToDeal(
    user: AuthUser,
    leadId: string,
    dealId: string,
    correlationId: string,
  ) {
    const open = await this.db.tx.task.findMany({
      where: {
        organizationId: user.organizationId,
        leadId,
        deletedAt: null,
        status: { category: { notIn: CLOSED } },
      },
      select: { id: true, code: true, title: true },
    });
    if (open.length === 0) return 0;
    const deal = await this.db.tx.deal.findFirstOrThrow({
      where: { id: dealId, organizationId: user.organizationId },
      select: { code: true },
    });
    for (const t of open) {
      await this.db.tx.task.updateMany({
        where: { id: t.id, organizationId: user.organizationId },
        data: {
          leadId: null,
          dealId,
          searchNorm: this.search(t, deal.code),
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      await this.history.record(
        'TASK',
        t.id,
        'UPDATE',
        user.id,
        { asociado: { from: 'prospecto', to: deal.code } },
        correlationId,
      );
    }
    return open.length;
  }

  /**
   * Aviso diario de tareas vencidas al responsable (D-16). Idempotente: una tarea se avisa una
   * vez por día como máximo. Debe llamarse dentro de withOrg.
   */
  async notifyOverdue(now = new Date()): Promise<number> {
    const org = this.db.organizationId;
    const due = await this.db.tx.task.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        completedAt: null,
        dueAt: { lt: now },
        status: { category: { notIn: CLOSED } },
        OR: [
          { overdueNotifiedAt: null },
          { overdueNotifiedAt: { lt: new Date(now.getTime() - 20 * 3600_000) } },
        ],
      },
      select: { id: true, code: true, title: true, responsibleId: true },
      take: 5000,
    });
    if (due.length === 0) return 0;
    await this.notifications.notify(
      due.map((t) => ({
        userId: t.responsibleId,
        type: 'TASK_OVERDUE',
        title: `Tarea vencida: ${t.code} ${t.title}`,
        link: `/tareas?id=${t.id}`,
        entityType: 'TASK' as const,
        entityId: t.id,
      })),
    );
    await this.db.tx.task.updateMany({
      where: { organizationId: org, id: { in: due.map((t) => t.id) } },
      data: { overdueNotifiedAt: now },
    });
    return due.length;
  }

  // --- Papelera -------------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const t = await this.db.tx.task.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
      select: { id: true },
    });
    return t ? [] : ['La tarea ya no existe.'];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.task.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  async purgeBlockers(): Promise<string[]> {
    return [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.task.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
