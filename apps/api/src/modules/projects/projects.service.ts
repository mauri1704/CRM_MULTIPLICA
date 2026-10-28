import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  normalizeText,
  type ProjectInput,
  type ProjectStatus,
  type ProjectUpdate,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion } from '../access/versioning';
import { DuplicateDetectionService } from '../duplicates/duplicate-detection.service';
import { HistoryService, diff } from '../history/history.service';
import { SequenceService } from '../sequences/sequence.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';

export interface ProjectQuery {
  q?: string;
  status?: ProjectStatus;
  ownerId?: string;
  sort?: 'createdAt' | 'name' | 'code' | 'endDate';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const projectInclude = {
  owner: { select: { id: true, name: true } },
} satisfies Prisma.ProjectInclude;
type Row = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v ? new Date(`${v}T00:00:00Z`) : null;

export const projectDto = (p: Row, counts?: { open: number; done: number }) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description,
  owner: p.owner,
  ownerId: p.ownerId,
  status: p.status as ProjectStatus,
  startDate: day(p.startDate),
  endDate: day(p.endDate),
  version: p.version,
  createdAt: p.createdAt,
  ...(counts ? { tasks: counts } : {}),
});
export type ProjectDto = ReturnType<typeof projectDto>;

const FIELDS = ['name', 'description', 'ownerId', 'status', 'startDate', 'endDate'] as const;

/** Proyectos básicos (T-04): catálogo para agrupar tareas. */
@Injectable()
export class ProjectsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'PROJECT' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly duplicates: DuplicateDetectionService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async where(
    user: AuthUser,
    q: Pick<ProjectQuery, 'q' | 'status' | 'ownerId'>,
    action: 'view' | 'export' = 'view',
  ) {
    const norm = normalizeText(q.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(await this.scope.ownerWhere(user, 'projects', action)),
      ...(q.ownerId ? { AND: [{ ownerId: q.ownerId }] } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(norm
        ? { OR: [{ nameNorm: { contains: norm } }, { code: { contains: norm.toUpperCase() } }] }
        : {}),
    } satisfies Prisma.ProjectWhereInput;
  }

  private async counts(ids: string[]) {
    const rows = await this.db.tx.task.groupBy({
      by: ['projectId', 'completedAt'],
      where: { organizationId: this.db.organizationId, projectId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    });
    const out = new Map<string, { open: number; done: number }>();
    for (const r of rows) {
      const c = out.get(r.projectId!) ?? { open: 0, done: 0 };
      if (r.completedAt) c.done += r._count._all;
      else c.open += r._count._all;
      out.set(r.projectId!, c);
    }
    return out;
  }

  async list(user: AuthUser, q: ProjectQuery) {
    const where = await this.where(user, q);
    const [items, total] = await Promise.all([
      this.db.tx.project.findMany({
        where,
        include: projectInclude,
        orderBy: { [q.sort ?? 'createdAt']: q.dir ?? 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.project.count({ where }),
    ]);
    const counts = await this.counts(items.map((i) => i.id));
    return {
      items: items.map((p) => projectDto(p, counts.get(p.id) ?? { open: 0, done: 0 })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  listRaw(where: Prisma.ProjectWhereInput, limit: number) {
    return this.db.tx.project.findMany({
      where,
      include: projectInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async findAlive(id: string) {
    const p = await this.db.tx.project.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include: projectInclude,
    });
    if (!p) throw notFound('El proyecto');
    return p;
  }

  async get(user: AuthUser, id: string) {
    const p = await this.findAlive(id);
    await this.scope.assert(user, 'projects', 'view', p.ownerId);
    return projectDto(p, (await this.counts([id])).get(id) ?? { open: 0, done: 0 });
  }

  /** Para asociar una tarea: el proyecto existe y está vigente (no exige alcance sobre él). */
  async assertUsable(id: string) {
    const p = await this.db.tx.project.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!p) throw validationError({ projectId: 'El proyecto no existe o está en la papelera.' });
    return p;
  }

  async create(user: AuthUser, input: ProjectInput) {
    const ownerId = await this.scope.resolveOwner(user, 'projects', 'create', input.ownerId);
    await this.duplicates.assertNoBlocking('PROJECT', { name: input.name });
    const code = await this.sequences.next('PROJECT');
    const p = await this.db.tx.project.create({
      data: {
        organizationId: user.organizationId,
        code,
        name: input.name,
        nameNorm: normalizeText(input.name),
        description: input.description ?? null,
        ownerId,
        status: input.status,
        startDate: toDate(input.startDate) ?? null,
        endDate: toDate(input.endDate) ?? null,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.history.record('PROJECT', p.id, 'CREATE', user.id, { code, name: p.name, ownerId });
    await this.duplicates.onSaved('PROJECT', p.id);
    return this.get(user, p.id);
  }

  async update(user: AuthUser, id: string, input: ProjectUpdate) {
    const before = await this.findAlive(id);
    await this.scope.assert(user, 'projects', 'edit', before.ownerId);
    const { version, ...fields } = input;
    if (fields.ownerId !== undefined && fields.ownerId !== before.ownerId) {
      fields.ownerId = await this.scope.resolveOwner(user, 'projects', 'edit', fields.ownerId);
    }
    const start = fields.startDate !== undefined ? fields.startDate : day(before.startDate);
    const end = fields.endDate !== undefined ? fields.endDate : day(before.endDate);
    if (start && end && end < start) {
      throw validationError({ endDate: 'La fecha de fin no puede ser anterior a la de inicio.' });
    }
    const changes = diff(
      { ...before, startDate: day(before.startDate), endDate: day(before.endDate) },
      fields,
      FIELDS,
    );
    if (Object.keys(changes).length === 0) return this.get(user, id);
    const res = await this.db.tx.project.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: {
        ...fields,
        ...(fields.name ? { nameNorm: normalizeText(fields.name) } : {}),
        startDate: toDate(fields.startDate),
        endDate: toDate(fields.endDate),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    await this.history.record('PROJECT', id, 'UPDATE', user.id, changes);
    await this.duplicates.onSaved('PROJECT', id);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string, actor: Actor) {
    const p = await this.findAlive(id);
    await this.scope.assert(user, 'projects', 'delete', p.ownerId);
    const open = await this.db.tx.task.count({
      where: { organizationId: user.organizationId, projectId: id, deletedAt: null },
    });
    await this.db.tx.project.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.trash.add(
      'PROJECT',
      {
        id,
        displayName: p.name,
        code: p.code,
        ownerId: p.ownerId,
        relations: open > 0 ? { tareas: open } : {},
      },
      actor,
    );
  }

  // --- Papelera -------------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const p = await this.db.tx.project.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
    });
    return p ? [] : ['El proyecto ya no existe.'];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.project.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  /** Las tareas vigentes impiden la eliminación definitiva: perderían su proyecto. */
  async purgeBlockers(entityId: string): Promise<string[]> {
    const n = await this.db.tx.task.count({
      where: { organizationId: this.db.organizationId, projectId: entityId, deletedAt: null },
    });
    return n > 0 ? [`Tiene ${n} tarea(s) vigente(s): muévalas o envíelas a la papelera.`] : [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.project.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
