import { Injectable } from '@nestjs/common';
import {
  companyInput,
  contactInput,
  dealInput,
  leadInput,
  currencyInput,
  exchangeRateInput,
  normalizeEmail,
  normalizeIdentifier,
  productInput,
  projectInput,
  taskInput,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  normalizeText,
  type ProjectInput,
  type TaskCrmType,
  type TaskInput,
  type CompanyInput,
  type ContactInput,
  type DealInput,
  type LeadInput,
  type CurrencyInput,
  type CustomFieldEntity,
  type ExchangeRateInput,
  type ImportEntity,
  type ProductInput,
} from '@crm/shared';
import type { ZodTypeAny } from 'zod';
import { toActor } from '../../common/auth.types';
import { AppError } from '../../common/errors';
import { zodDetails } from '../../common/http-exception.filter';
import { Db } from '../../infra/db';
import { companyQuery } from '../companies/companies.controller';
import { dealQuery } from '../deals/deals.controller';
import { DealsService, dealDto } from '../deals/deals.service';
import { leadQuery } from '../leads/leads.controller';
import { LeadsService, leadDto } from '../leads/leads.service';
import { CompaniesService, companyDto } from '../companies/companies.service';
import { contactQuery } from '../contacts/contacts.controller';
import { rateListQuery } from '../exchange-rates/exchange-rates.controller';
import { productQuery } from '../products/products.controller';
import { ContactsService, contactDto } from '../contacts/contacts.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ProductsService, productDto } from '../products/products.service';
import { projectQuery } from '../projects/projects.controller';
import { ProjectsService, projectDto } from '../projects/projects.service';
import { taskQuery } from '../tasks/tasks.controller';
import { TasksService, taskDto } from '../tasks/tasks.service';
import {
  CF_PREFIX,
  customCellValue,
  customFieldInfos,
  parseBoolCell,
  parseDateCell,
  parseDateTimeCell,
  parseNumberCell,
  type FieldErrors,
  type ImportExportDefinition,
  type ParsedRow,
} from './definitions';
import type { ExportColumn } from './spreadsheet';

type CfDef = Awaited<ReturnType<CustomFieldsService['list']>>[number];

function memo<T>(fn: (k: string) => Promise<T>): (k: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (k) => {
    let p = cache.get(k);
    if (!p) {
      p = fn(k);
      cache.set(k, p);
    }
    return p;
  };
}

function validate<T>(schema: ZodTypeAny, value: unknown, errors: FieldErrors): T | null {
  const r = schema.safeParse(value);
  if (!r.success) {
    Object.assign(errors, zodDetails(r.error));
    return null;
  }
  return r.data as T;
}

const blank = (v: string | undefined) =>
  v === undefined || v.trim() === '' ? undefined : v.trim();
const cfColumns = <R extends { customFields: Record<string, unknown> }>(
  defs: CfDef[],
): ExportColumn<R>[] =>
  defs.map((d) => ({
    key: `${CF_PREFIX}${d.key}`,
    label: d.label,
    value: (r) => {
      const v = r.customFields[d.key];
      if (v === undefined || v === null) return null;
      if (Array.isArray(v)) return v.join('; ');
      if (typeof v === 'boolean') return v ? 'Sí' : 'No';
      return typeof v === 'number' ? v : String(v);
    },
  }));

/** Fábrica de definiciones: cada análisis/importación usa una instancia nueva (cachés propias). */
@Injectable()
export class ImportExportRegistry {
  constructor(
    private readonly db: Db,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly products: ProductsService,
    private readonly currencies: CurrenciesService,
    private readonly rates: ExchangeRatesService,
    private readonly customFields: CustomFieldsService,
    private readonly leads: LeadsService,
    private readonly deals: DealsService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  // Búsquedas por valores "humanos" de las celdas -------------------------------------------

  private lookups() {
    const org = this.db.organizationId;
    return {
      docType: memo((code) =>
        this.db.tx.documentType.findFirst({
          where: { organizationId: org, code: code.toUpperCase() },
          select: { id: true },
        }),
      ),
      sector: memo((name) =>
        this.db.tx.economicSector.findFirst({
          where: { organizationId: org, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }),
      ),
      category: memo((name) =>
        this.db.tx.productCategory.findFirst({
          where: { organizationId: org, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }),
      ),
      pipeline: memo((key) => {
        const [entityType, name] = key.split('|') as [string, string];
        return this.db.tx.pipeline.findFirst({
          where: {
            organizationId: org,
            entityType,
            name: { equals: name, mode: 'insensitive' },
            active: true,
          },
          select: { id: true },
        });
      }),
      stage: memo((key) => {
        const [entityType, pipelineId, name] = key.split('|') as [string, string, string];
        return this.db.tx.stage.findFirst({
          where: {
            organizationId: org,
            name: { equals: name, mode: 'insensitive' },
            active: true,
            pipeline: {
              entityType,
              active: true,
              ...(pipelineId ? { id: pipelineId } : { isDefault: true }),
            },
          },
          select: { id: true, pipelineId: true, kind: true },
        });
      }),
      leadSource: memo((name) =>
        this.db.tx.leadSource.findFirst({
          where: { organizationId: org, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }),
      ),
      priority: memo((name) =>
        this.db.tx.priority.findFirst({
          where: { organizationId: org, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }),
      ),
      contactByEmail: memo((email) =>
        this.db.tx.contact.findFirst({
          where: { organizationId: org, deletedAt: null, emailNorm: email.trim().toLowerCase() },
          select: { id: true },
        }),
      ),
      taskStatus: memo((name) =>
        this.db.tx.taskStatus.findFirst({
          where: { organizationId: org, active: true, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        }),
      ),
      /** Código (PRY-…) o nombre exacto. */
      project: memo((v) =>
        this.db.tx.project.findFirst({
          where: {
            organizationId: org,
            deletedAt: null,
            OR: [{ code: v.toUpperCase() }, { nameNorm: normalizeText(v) }],
          },
          select: { id: true },
        }),
      ),
      /** Elemento CRM por su código: CON-, CIA-, PRO- o NEG-. */
      crmByCode: memo(async (v): Promise<{ type: TaskCrmType; id: string } | null> => {
        const code = v.trim().toUpperCase();
        const where = { organizationId: org, deletedAt: null, code };
        const prefix = code.slice(0, 4);
        const found =
          prefix === 'CON-'
            ? await this.db.tx.contact.findFirst({ where, select: { id: true } })
            : prefix === 'CIA-'
              ? await this.db.tx.company.findFirst({ where, select: { id: true } })
              : prefix === 'PRO-'
                ? await this.db.tx.lead.findFirst({ where, select: { id: true } })
                : prefix === 'NEG-'
                  ? await this.db.tx.deal.findFirst({ where, select: { id: true } })
                  : null;
        const type = (
          { 'CON-': 'CONTACT', 'CIA-': 'COMPANY', 'PRO-': 'LEAD', 'NEG-': 'DEAL' } as const
        )[prefix as 'CON-'];
        return found && type ? { type, id: found.id } : null;
      }),
      user: memo((email) =>
        this.db.q.user.findFirst({
          where: { organizationId: org, email: email.toLowerCase(), active: true },
          select: { id: true },
        }),
      ),
      /** RUC/identificador, código (CIA-…) o razón social exacta. */
      company: memo(async (v) => {
        const ident = normalizeIdentifier(v);
        return this.db.tx.company.findFirst({
          where: {
            organizationId: org,
            deletedAt: null,
            OR: [
              ...(ident ? [{ taxIdNorm: ident }, { code: v.toUpperCase() }] : []),
              { legalName: { equals: v, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
      }),
    };
  }

  private async customDefs(entity: CustomFieldEntity) {
    return this.customFields.list(entity);
  }

  private customInput(defs: CfDef[], values: Record<string, string>) {
    const out: Record<string, unknown> = {};
    for (const d of defs) {
      const v = values[`${CF_PREFIX}${d.key}`];
      if (v !== undefined) {
        const parsed = customCellValue(d.type, v);
        if (parsed !== undefined) out[d.key] = parsed;
      }
    }
    return out;
  }

  /** Errores de negocio de los services (AppError con detalle) → errores por campo. */
  static toFieldErrors(e: unknown): FieldErrors {
    if (e instanceof AppError) {
      return e.details && Object.keys(e.details).length > 0
        ? Object.fromEntries(
            Object.entries(e.details).map(([k, v]) => [k.replace(/^customFields\./, CF_PREFIX), v]),
          )
        : { _: e.message };
    }
    throw e;
  }

  async create(entity: ImportEntity): Promise<ImportExportDefinition<unknown, unknown>> {
    switch (entity) {
      case 'leads':
        return (await this.leadsDef()) as ImportExportDefinition<unknown, unknown>;
      case 'deals':
        return (await this.dealsDef()) as ImportExportDefinition<unknown, unknown>;
      case 'contacts':
        return (await this.contactsDef()) as ImportExportDefinition<unknown, unknown>;
      case 'companies':
        return (await this.companiesDef()) as ImportExportDefinition<unknown, unknown>;
      case 'products':
        return (await this.productsDef()) as ImportExportDefinition<unknown, unknown>;
      case 'currencies':
        return this.currenciesDef() as ImportExportDefinition<unknown, unknown>;
      case 'exchange-rates':
        return this.ratesDef() as ImportExportDefinition<unknown, unknown>;
      case 'tasks':
        return (await this.tasksDef()) as ImportExportDefinition<unknown, unknown>;
      case 'projects':
        return this.projectsDef() as ImportExportDefinition<unknown, unknown>;
    }
  }

  /** Pipeline/etapa por nombre (vacío = por defecto). Solo etapas en curso para registros nuevos. */
  private async pipelineStage(
    lk: ReturnType<ImportExportRegistry['lookups']>,
    entity: 'LEAD' | 'DEAL',
    v: Record<string, string>,
    errors: FieldErrors,
  ) {
    let pipelineId: string | undefined;
    if (blank(v.pipeline)) {
      pipelineId = (await lk.pipeline(`${entity}|${v.pipeline!.trim()}`))?.id;
      if (!pipelineId) errors.pipeline = `Pipeline «${v.pipeline}» no existe o está inactivo.`;
    }
    let stageId: string | undefined;
    if (blank(v.stage) && !errors.pipeline) {
      const st = await lk.stage(`${entity}|${pipelineId ?? ''}|${v.stage!.trim()}`);
      if (!st) errors.stage = `Etapa «${v.stage}» no existe en el pipeline.`;
      else if (st.kind !== 'OPEN') errors.stage = 'Solo se importa a etapas en curso.';
      else stageId = st.id;
    }
    return { pipelineId, stageId };
  }

  private async commonRefs(
    lk: ReturnType<ImportExportRegistry['lookups']>,
    v: Record<string, string>,
    errors: FieldErrors,
  ) {
    let companyId: string | undefined;
    if (blank(v.company)) {
      companyId = (await lk.company(v.company!.trim()))?.id;
      if (!companyId) errors.company = `No se encontró la compañía «${v.company}».`;
    }
    let ownerId: string | undefined;
    if (blank(v.owner)) {
      ownerId = (await lk.user(v.owner!.trim()))?.id;
      if (!ownerId) errors.owner = `No hay un usuario activo con el correo ${v.owner}.`;
    }
    let priorityId: string | undefined;
    if (blank(v.priority)) {
      priorityId = (await lk.priority(v.priority!.trim()))?.id;
      if (!priorityId) errors.priority = `Prioridad «${v.priority}» no existe.`;
    }
    let estimatedValue: string | undefined;
    if (blank(v.estimatedValue)) {
      estimatedValue = parseNumberCell(v.estimatedValue!) ?? undefined;
      if (estimatedValue === undefined) errors.estimatedValue = 'Valor no válido.';
    }
    return { companyId, ownerId, priorityId, estimatedValue };
  }

  /** Varios correos de usuario separados por «;» o «,». */
  private async users(
    lk: ReturnType<ImportExportRegistry['lookups']>,
    raw: string | undefined,
    field: string,
    errors: FieldErrors,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const email of (raw ?? '')
      .split(/[;,]/)
      .map((e) => e.trim())
      .filter(Boolean)) {
      const u = await lk.user(email);
      if (u) out.push(u.id);
      else errors[field] = `No hay un usuario activo con el correo ${email}.`;
    }
    return out;
  }

  // --- Tareas ---------------------------------------------------------------------------------

  private async tasksDef(): Promise<
    ImportExportDefinition<TaskInput & { code?: string }, ReturnType<typeof taskDto>>
  > {
    const lk = this.lookups();
    const defs = await this.customDefs('TASK');
    const org = this.db.organizationId;
    return {
      entity: 'tasks',
      module: 'tasks',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Tareas',
      fields: async () => [
        {
          key: 'code',
          label: 'Código',
          required: false,
          hint: 'TAR-… para actualizar una tarea existente',
        },
        { key: 'title', label: 'Título', required: true },
        { key: 'description', label: 'Descripción', required: false },
        { key: 'responsible', label: 'Responsable', required: false, hint: 'Correo del usuario' },
        {
          key: 'participants',
          label: 'Participantes',
          required: false,
          hint: 'Correos separados por ;',
        },
        {
          key: 'observers',
          label: 'Observadores',
          required: false,
          hint: 'Correos separados por ;',
        },
        { key: 'startAt', label: 'Inicio', required: false, hint: 'dd/mm/aaaa o dd/mm/aaaa hh:mm' },
        {
          key: 'dueAt',
          label: 'Vencimiento',
          required: false,
          hint: 'dd/mm/aaaa o dd/mm/aaaa hh:mm',
        },
        { key: 'priority', label: 'Prioridad', required: false },
        {
          key: 'status',
          label: 'Estado',
          required: false,
          hint: 'Vacío = primer estado pendiente',
        },
        { key: 'project', label: 'Proyecto', required: false, hint: 'Código PRY-… o nombre' },
        {
          key: 'related',
          label: 'Asociado a',
          required: false,
          hint: 'Código CON-, CIA-, PRO- o NEG-',
        },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        code: '',
        title: 'Llamar para confirmar la propuesta',
        description: '',
        responsible: '',
        participants: '',
        observers: '',
        startAt: '',
        dueAt: '15/11/2026 10:00',
        priority: 'Alta',
        status: '',
        project: '',
        related: 'NEG-000001',
      }),
      parse: async (v): Promise<ParsedRow<TaskInput & { code?: string }>> => {
        const errors: FieldErrors = {};
        const date = (key: 'startAt' | 'dueAt') => {
          if (!blank(v[key])) return undefined;
          const iso = parseDateTimeCell(v[key]!);
          if (!iso) errors[key] = 'Fecha no válida (dd/mm/aaaa o dd/mm/aaaa hh:mm).';
          return iso ?? undefined;
        };
        let responsibleId: string | undefined;
        if (blank(v.responsible)) {
          responsibleId = (await lk.user(v.responsible!.trim()))?.id;
          if (!responsibleId)
            errors.responsible = `No hay un usuario activo con el correo ${v.responsible}.`;
        }
        const participantIds = await this.users(lk, v.participants, 'participants', errors);
        const observerIds = await this.users(lk, v.observers, 'observers', errors);
        let priorityId: string | undefined;
        if (blank(v.priority)) {
          priorityId = (await lk.priority(v.priority!.trim()))?.id;
          if (!priorityId) errors.priority = `Prioridad «${v.priority}» no existe.`;
        }
        let statusId: string | undefined;
        if (blank(v.status)) {
          statusId = (await lk.taskStatus(v.status!.trim()))?.id;
          if (!statusId) errors.status = `Estado «${v.status}» no existe.`;
        }
        let projectId: string | undefined;
        if (blank(v.project)) {
          projectId = (await lk.project(v.project!.trim()))?.id;
          if (!projectId) errors.project = `No se encontró el proyecto «${v.project}».`;
        }
        let crm: { type: TaskCrmType; id: string } | undefined;
        if (blank(v.related)) {
          crm = (await lk.crmByCode(v.related!)) ?? undefined;
          if (!crm) errors.related = `No se encontró el registro «${v.related}».`;
        }
        const data = validate<TaskInput>(
          taskInput,
          {
            title: v.title ?? '',
            description: v.description,
            responsibleId,
            participantIds,
            observerIds,
            startAt: date('startAt'),
            dueAt: date('dueAt'),
            priorityId,
            statusId,
            projectId,
            crm,
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        const code = blank(v.code)?.toUpperCase();
        return { ok: true, data: { ...data, code }, key: code ? `task:${code}` : null };
      },
      findExisting: async (d) =>
        d.code
          ? this.db.tx.task
              .findFirst({
                where: { organizationId: org, deletedAt: null, code: d.code },
                select: { id: true, responsibleId: true },
              })
              .then((t) => t && { id: t.id, ownerId: t.responsibleId })
          : null,
      check: async (d) => {
        await this.customFields.validate('TASK', d.customFields);
      },
      create: async (user, { code: _c, ...d }) => {
        await this.tasks.create(user, d);
      },
      update: async (user, existing, { code: _c, ...d }) => {
        await this.tasks.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'title', label: 'Título', value: (r) => r.title },
        { key: 'description', label: 'Descripción', value: (r) => r.description },
        { key: 'responsible', label: 'Responsable', value: (r) => r.responsible.name },
        {
          key: 'participants',
          label: 'Participantes',
          value: (r) => r.participants.map((p) => p.name).join('; '),
        },
        {
          key: 'observers',
          label: 'Observadores',
          value: (r) => r.observers.map((p) => p.name).join('; '),
        },
        { key: 'startAt', label: 'Inicio', value: (r) => r.startAt },
        { key: 'dueAt', label: 'Vencimiento', value: (r) => r.dueAt },
        { key: 'priority', label: 'Prioridad', value: (r) => r.priority?.name },
        { key: 'status', label: 'Estado', value: (r) => r.status.name },
        { key: 'completedAt', label: 'Completada', value: (r) => r.completedAt },
        { key: 'project', label: 'Proyecto', value: (r) => r.project?.name },
        {
          key: 'related',
          label: 'Asociado a',
          value: (r) => (r.crm ? `${r.crm.code} ${r.crm.name}` : null),
        },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
        ...cfColumns<ReturnType<typeof taskDto>>(defs),
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.tasks.where(user, taskQuery.parse(query), 'export');
        return (await this.tasks.listRaw(where, limit)).map((t) => taskDto(t, user.id));
      },
    };
  }

  // --- Proyectos ------------------------------------------------------------------------------

  private projectsDef(): ImportExportDefinition<ProjectInput, ReturnType<typeof projectDto>> {
    const lk = this.lookups();
    const org = this.db.organizationId;
    const statusByLabel = new Map<string, (typeof PROJECT_STATUSES)[number]>(
      PROJECT_STATUSES.flatMap((s) => [
        [s.toLowerCase(), s],
        [normalizeText(PROJECT_STATUS_LABELS[s]), s],
      ]),
    );
    return {
      entity: 'projects',
      module: 'projects',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Proyectos',
      fields: async () => [
        { key: 'name', label: 'Nombre', required: true, hint: 'Clave de correspondencia' },
        { key: 'description', label: 'Descripción', required: false },
        { key: 'owner', label: 'Responsable', required: false, hint: 'Correo del usuario' },
        {
          key: 'status',
          label: 'Estado',
          required: false,
          hint: Object.values(PROJECT_STATUS_LABELS).join(', '),
        },
        { key: 'startDate', label: 'Inicio', required: false, hint: 'dd/mm/aaaa' },
        { key: 'endDate', label: 'Fin', required: false, hint: 'dd/mm/aaaa' },
      ],
      example: () => ({
        name: 'Implementación CRM sede norte',
        description: '',
        owner: '',
        status: 'En curso',
        startDate: '01/11/2026',
        endDate: '31/12/2026',
      }),
      parse: async (v): Promise<ParsedRow<ProjectInput>> => {
        const errors: FieldErrors = {};
        let ownerId: string | undefined;
        if (blank(v.owner)) {
          ownerId = (await lk.user(v.owner!.trim()))?.id;
          if (!ownerId) errors.owner = `No hay un usuario activo con el correo ${v.owner}.`;
        }
        let status: (typeof PROJECT_STATUSES)[number] | undefined;
        if (blank(v.status)) {
          status =
            statusByLabel.get(normalizeText(v.status)) ??
            statusByLabel.get(v.status!.trim().toLowerCase());
          if (!status) errors.status = `Estado «${v.status}» no válido.`;
        }
        const date = (key: 'startDate' | 'endDate') => {
          if (!blank(v[key])) return undefined;
          const d = parseDateCell(v[key]!);
          if (!d) errors[key] = 'Fecha no válida.';
          return d ?? undefined;
        };
        const data = validate<ProjectInput>(
          projectInput,
          {
            name: v.name ?? '',
            description: v.description,
            ownerId,
            status,
            startDate: date('startDate'),
            endDate: date('endDate'),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        return { ok: true, data, key: `project:${normalizeText(data.name)}` };
      },
      findExisting: async (d) =>
        this.db.tx.project.findFirst({
          where: { organizationId: org, deletedAt: null, nameNorm: normalizeText(d.name) },
          select: { id: true, ownerId: true },
        }),
      check: async () => {},
      create: async (user, d) => {
        await this.projects.create(user, d);
      },
      update: async (user, existing, { name: _n, ...d }) => {
        await this.projects.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'name', label: 'Nombre', value: (r) => r.name },
        { key: 'description', label: 'Descripción', value: (r) => r.description },
        { key: 'owner', label: 'Responsable', value: (r) => r.owner?.name },
        { key: 'status', label: 'Estado', value: (r) => PROJECT_STATUS_LABELS[r.status] },
        { key: 'startDate', label: 'Inicio', value: (r) => r.startDate },
        { key: 'endDate', label: 'Fin', value: (r) => r.endDate },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.projects.where(user, projectQuery.parse(query), 'export');
        return (await this.projects.listRaw(where, limit)).map((p) => projectDto(p));
      },
    };
  }

  // --- Prospectos -----------------------------------------------------------------------------

  private async leadsDef(): Promise<ImportExportDefinition<LeadInput, ReturnType<typeof leadDto>>> {
    const lk = this.lookups();
    const defs = await this.customDefs('LEAD');
    return {
      entity: 'leads',
      module: 'leads',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Prospectos',
      fields: async () => [
        { key: 'title', label: 'Nombre o título', required: true },
        {
          key: 'contact',
          label: 'Contacto',
          required: false,
          hint: 'Correo de un contacto existente',
        },
        { key: 'company', label: 'Compañía', required: false, hint: 'RUC, código o razón social' },
        { key: 'phone', label: 'Teléfono', required: false },
        {
          key: 'email',
          label: 'Correo',
          required: false,
          hint: 'Correo + compañía = clave de correspondencia',
        },
        { key: 'source', label: 'Origen', required: false },
        { key: 'pipeline', label: 'Pipeline', required: false, hint: 'Vacío = por defecto' },
        { key: 'stage', label: 'Etapa', required: false, hint: 'Vacío = primera etapa' },
        { key: 'owner', label: 'Responsable', required: false, hint: 'Correo del usuario' },
        { key: 'priority', label: 'Prioridad', required: false },
        { key: 'currencyCode', label: 'Moneda', required: false, hint: 'Vacío = moneda principal' },
        { key: 'estimatedValue', label: 'Valor estimado', required: false },
        { key: 'notes', label: 'Observaciones', required: false },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        title: 'Renovación de flota 2027',
        contact: 'lucia.paredes@andes.pe',
        company: '20100047218',
        phone: '',
        email: 'compras@andes.pe',
        source: 'Referido',
        pipeline: '',
        stage: '',
        owner: '',
        priority: 'Alta',
        currencyCode: 'USD',
        estimatedValue: '25000',
        notes: '',
      }),
      parse: async (v): Promise<ParsedRow<LeadInput>> => {
        const errors: FieldErrors = {};
        const refs = await this.commonRefs(lk, v, errors);
        const ps = await this.pipelineStage(lk, 'LEAD', v, errors);
        let contactId: string | undefined;
        if (blank(v.contact)) {
          contactId = (await lk.contactByEmail(v.contact!))?.id;
          if (!contactId) errors.contact = `No hay un contacto con el correo ${v.contact}.`;
        }
        let sourceId: string | undefined;
        if (blank(v.source)) {
          sourceId = (await lk.leadSource(v.source!.trim()))?.id;
          if (!sourceId) errors.source = `Origen «${v.source}» no existe.`;
        }
        const data = validate<LeadInput>(
          leadInput,
          {
            title: v.title ?? '',
            contactId,
            companyId: refs.companyId,
            phone: v.phone,
            email: v.email,
            sourceId,
            ...ps,
            ownerId: refs.ownerId,
            priorityId: refs.priorityId,
            currencyCode: blank(v.currencyCode),
            estimatedValue: refs.estimatedValue,
            notes: v.notes,
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        const key = data.email
          ? `lead:${normalizeEmail(data.email)}:${data.companyId ?? ''}`
          : null;
        return { ok: true, data, key };
      },
      findExisting: async (d) =>
        d.email
          ? this.db.tx.lead.findFirst({
              where: {
                organizationId: this.db.organizationId,
                deletedAt: null,
                emailNorm: normalizeEmail(d.email),
                companyId: d.companyId ?? null,
              },
              select: { id: true, ownerId: true },
            })
          : null,
      check: async (d) => {
        await this.leads.check(d);
        await this.customFields.validate('LEAD', d.customFields);
      },
      create: async (user, d) => {
        await this.leads.create(user, d);
      },
      update: async (user, existing, { pipelineId: _p, stageId: _s, ...d }) => {
        await this.leads.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'title', label: 'Nombre o título', value: (r) => r.title },
        { key: 'contact', label: 'Contacto', value: (r) => r.contact?.name },
        { key: 'company', label: 'Compañía', value: (r) => r.company?.legalName },
        { key: 'phone', label: 'Teléfono', value: (r) => r.phone },
        { key: 'email', label: 'Correo', value: (r) => r.email },
        { key: 'source', label: 'Origen', value: (r) => r.source?.name },
        { key: 'pipeline', label: 'Pipeline', value: (r) => r.pipeline.name },
        { key: 'stage', label: 'Etapa', value: (r) => r.stage.name },
        { key: 'owner', label: 'Responsable', value: (r) => r.owner?.name },
        { key: 'priority', label: 'Prioridad', value: (r) => r.priority?.name },
        { key: 'currencyCode', label: 'Moneda', value: (r) => r.currencyCode },
        {
          key: 'estimatedValue',
          label: 'Valor estimado',
          value: (r) => (r.estimatedValue ? Number(r.estimatedValue) : null),
          numFmt: '#,##0.00',
        },
        {
          key: 'total',
          label: 'Total productos',
          value: (r) => Number(r.total),
          numFmt: '#,##0.00',
        },
        { key: 'lossReason', label: 'Motivo de pérdida', value: (r) => r.lossReason?.name },
        { key: 'deal', label: 'Negociación', value: (r) => r.deal?.code },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
        { key: 'notes', label: 'Observaciones', value: (r) => r.notes },
        ...cfColumns<ReturnType<typeof leadDto>>(defs),
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.leads.where(user, leadQuery.parse(query), 'export');
        return (await this.leads.listRaw(where, limit)).map(leadDto);
      },
    };
  }

  // --- Negociaciones --------------------------------------------------------------------------

  private async dealsDef(): Promise<ImportExportDefinition<DealInput, ReturnType<typeof dealDto>>> {
    const lk = this.lookups();
    const defs = await this.customDefs('DEAL');
    return {
      entity: 'deals',
      module: 'deals',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Negociaciones',
      fields: async () => [
        {
          key: 'title',
          label: 'Título',
          required: true,
          hint: 'Compañía + título = clave de correspondencia',
        },
        { key: 'company', label: 'Compañía', required: false, hint: 'RUC, código o razón social' },
        {
          key: 'contact',
          label: 'Contacto principal',
          required: false,
          hint: 'Correo de un contacto existente',
        },
        { key: 'pipeline', label: 'Pipeline', required: false },
        { key: 'stage', label: 'Etapa', required: false },
        { key: 'owner', label: 'Responsable', required: false, hint: 'Correo del usuario' },
        { key: 'priority', label: 'Prioridad', required: false },
        { key: 'currencyCode', label: 'Moneda', required: false },
        { key: 'estimatedValue', label: 'Valor estimado', required: false },
        { key: 'probability', label: 'Probabilidad (%)', required: false },
        {
          key: 'expectedCloseDate',
          label: 'Fecha estimada de cierre',
          required: false,
          hint: 'dd/mm/aaaa',
        },
        { key: 'notes', label: 'Observaciones', required: false },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        title: 'Implementación CRM sede Arequipa',
        company: '20131312955',
        contact: 'jsalas@pacifico.pe',
        pipeline: '',
        stage: '',
        owner: '',
        priority: 'Media',
        currencyCode: 'PEN',
        estimatedValue: '45000',
        probability: '40',
        expectedCloseDate: '30/12/2026',
        notes: '',
      }),
      parse: async (v): Promise<ParsedRow<DealInput>> => {
        const errors: FieldErrors = {};
        const refs = await this.commonRefs(lk, v, errors);
        const ps = await this.pipelineStage(lk, 'DEAL', v, errors);
        let contactId: string | undefined;
        if (blank(v.contact)) {
          contactId = (await lk.contactByEmail(v.contact!))?.id;
          if (!contactId) errors.contact = `No hay un contacto con el correo ${v.contact}.`;
        }
        let probability: number | undefined;
        if (blank(v.probability)) {
          probability = Number(parseNumberCell(v.probability!));
          if (!Number.isInteger(probability) || probability < 0 || probability > 100)
            errors.probability = 'Entero entre 0 y 100.';
        }
        let expectedCloseDate: string | undefined;
        if (blank(v.expectedCloseDate)) {
          expectedCloseDate = parseDateCell(v.expectedCloseDate!) ?? undefined;
          if (!expectedCloseDate) errors.expectedCloseDate = 'Fecha no válida.';
        }
        const data = validate<DealInput>(
          dealInput,
          {
            title: v.title ?? '',
            companyId: refs.companyId,
            primaryContactId: contactId,
            ...ps,
            ownerId: refs.ownerId,
            priorityId: refs.priorityId,
            currencyCode: blank(v.currencyCode),
            estimatedValue: refs.estimatedValue,
            probability,
            expectedCloseDate,
            notes: v.notes,
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        return { ok: true, data, key: `deal:${data.companyId ?? ''}:${data.title.toLowerCase()}` };
      },
      findExisting: async (d) =>
        this.db.tx.deal.findFirst({
          where: {
            organizationId: this.db.organizationId,
            deletedAt: null,
            companyId: d.companyId ?? null,
            title: { equals: d.title, mode: 'insensitive' },
          },
          select: { id: true, ownerId: true },
        }),
      check: async (d) => {
        await this.deals.check(d);
        await this.customFields.validate('DEAL', d.customFields);
      },
      create: async (user, d) => {
        await this.deals.create(user, d);
      },
      update: async (user, existing, { pipelineId: _p, stageId: _s, ...d }) => {
        await this.deals.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'title', label: 'Título', value: (r) => r.title },
        { key: 'company', label: 'Compañía', value: (r) => r.company?.legalName },
        { key: 'contact', label: 'Contacto principal', value: (r) => r.contacts[0]?.name },
        { key: 'pipeline', label: 'Pipeline', value: (r) => r.pipeline.name },
        { key: 'stage', label: 'Etapa', value: (r) => r.stage.name },
        {
          key: 'status',
          label: 'Estado',
          value: (r) => ({ OPEN: 'Abierta', WON: 'Ganada', LOST: 'Perdida' })[r.status],
        },
        { key: 'owner', label: 'Responsable', value: (r) => r.owner?.name },
        { key: 'priority', label: 'Prioridad', value: (r) => r.priority?.name },
        { key: 'currencyCode', label: 'Moneda', value: (r) => r.currencyCode },
        {
          key: 'estimatedValue',
          label: 'Valor estimado',
          value: (r) => (r.estimatedValue ? Number(r.estimatedValue) : null),
          numFmt: '#,##0.00',
        },
        {
          key: 'subtotal',
          label: 'Subtotal',
          value: (r) => Number(r.subtotal),
          numFmt: '#,##0.00',
        },
        {
          key: 'discount',
          label: 'Descuento',
          value: (r) => Number(r.discount),
          numFmt: '#,##0.00',
        },
        { key: 'total', label: 'Total', value: (r) => Number(r.total), numFmt: '#,##0.00' },
        {
          key: 'finalValue',
          label: 'Valor final',
          value: (r) => (r.finalValue ? Number(r.finalValue) : null),
          numFmt: '#,##0.00',
        },
        { key: 'probability', label: 'Probabilidad (%)', value: (r) => r.probability },
        {
          key: 'expectedCloseDate',
          label: 'Fecha estimada de cierre',
          value: (r) => r.expectedCloseDate,
        },
        { key: 'closedAt', label: 'Fecha de cierre', value: (r) => r.closedAt },
        { key: 'lossReason', label: 'Motivo de pérdida', value: (r) => r.lossReason?.name },
        { key: 'sourceLead', label: 'Prospecto de origen', value: (r) => r.sourceLead?.code },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
        ...cfColumns<ReturnType<typeof dealDto>>(defs),
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.deals.where(user, dealQuery.parse(query), 'export');
        return (await this.deals.listRaw(where, limit)).map(dealDto);
      },
    };
  }

  // --- Contactos ------------------------------------------------------------------------------

  private async contactsDef(): Promise<
    ImportExportDefinition<ContactInput, ReturnType<typeof contactDto>>
  > {
    const lk = this.lookups();
    const defs = await this.customDefs('CONTACT');
    return {
      entity: 'contacts',
      module: 'contacts',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Contactos',
      fields: async () => [
        { key: 'firstName', label: 'Nombre', required: true },
        { key: 'lastName', label: 'Apellidos', required: false },
        {
          key: 'documentType',
          label: 'Tipo de documento',
          required: false,
          hint: 'Código: DNI, RUC, CE, PAS',
        },
        { key: 'documentNumber', label: 'Número de documento', required: false },
        { key: 'phone', label: 'Teléfono', required: false },
        {
          key: 'email',
          label: 'Correo',
          required: false,
          hint: 'Clave de correspondencia (o el documento)',
        },
        { key: 'jobTitle', label: 'Cargo', required: false },
        {
          key: 'company',
          label: 'Compañía',
          required: false,
          hint: 'RUC, código (CIA-…) o razón social exacta',
        },
        {
          key: 'owner',
          label: 'Responsable',
          required: false,
          hint: 'Correo del usuario; vacío = quien importa',
        },
        { key: 'notes', label: 'Observaciones', required: false },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        firstName: 'Ana',
        lastName: 'Torres Ruiz',
        documentType: 'DNI',
        documentNumber: '45879632',
        phone: '987654321',
        email: 'ana.torres@empresa.pe',
        jobTitle: 'Gerente de Compras',
        company: '20131312955',
        owner: '',
        notes: '',
      }),
      parse: async (v): Promise<ParsedRow<ContactInput>> => {
        const errors: FieldErrors = {};
        let documentTypeId: string | undefined;
        if (blank(v.documentType)) {
          documentTypeId = (await lk.docType(v.documentType!.trim()))?.id;
          if (!documentTypeId)
            errors.documentType = `Tipo de documento «${v.documentType}» no existe.`;
        }
        let companyId: string | undefined;
        if (blank(v.company)) {
          companyId = (await lk.company(v.company!.trim()))?.id;
          if (!companyId) errors.company = `No se encontró la compañía «${v.company}».`;
        }
        let ownerId: string | undefined;
        if (blank(v.owner)) {
          ownerId = (await lk.user(v.owner!.trim()))?.id;
          if (!ownerId) errors.owner = `No hay un usuario activo con el correo ${v.owner}.`;
        }
        const data = validate<ContactInput>(
          contactInput,
          {
            firstName: v.firstName ?? '',
            lastName: v.lastName,
            documentTypeId,
            documentNumber: v.documentNumber,
            phone: v.phone,
            email: v.email,
            jobTitle: v.jobTitle,
            companyId,
            ownerId,
            notes: v.notes,
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        const key = normalizeEmail(data.email)
          ? `email:${normalizeEmail(data.email)}`
          : data.documentNumber
            ? `doc:${normalizeIdentifier(data.documentNumber)}`
            : null;
        return { ok: true, data, key };
      },
      findExisting: async (_d, key) => {
        const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        return this.db.tx.contact.findFirst({
          where: {
            organizationId: this.db.organizationId,
            deletedAt: null,
            ...(kind === 'email' ? { emailNorm: value } : { documentNorm: value }),
          },
          select: { id: true, ownerId: true },
        });
      },
      check: async (d) => {
        await this.contacts.check(d);
        await this.customFields.validate('CONTACT', d.customFields);
      },
      create: async (user, d) => {
        await this.contacts.create(user, d);
      },
      update: async (user, existing, d) => {
        await this.contacts.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'firstName', label: 'Nombre', value: (r) => r.firstName },
        { key: 'lastName', label: 'Apellidos', value: (r) => r.lastName },
        { key: 'documentType', label: 'Tipo de documento', value: (r) => r.documentType?.code },
        { key: 'documentNumber', label: 'Número de documento', value: (r) => r.documentNumber },
        { key: 'phone', label: 'Teléfono', value: (r) => r.phone },
        { key: 'email', label: 'Correo', value: (r) => r.email },
        { key: 'jobTitle', label: 'Cargo', value: (r) => r.jobTitle },
        { key: 'company', label: 'Compañía', value: (r) => r.company?.legalName },
        { key: 'owner', label: 'Responsable', value: (r) => r.owner?.name },
        { key: 'notes', label: 'Observaciones', value: (r) => r.notes },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
        ...cfColumns<ReturnType<typeof contactDto>>(defs),
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.contacts.where(user, contactQuery.parse(query), 'export');
        return (await this.contacts.listRaw(where, limit)).map(contactDto);
      },
    };
  }

  // --- Compañías ------------------------------------------------------------------------------

  private async companiesDef(): Promise<
    ImportExportDefinition<CompanyInput, ReturnType<typeof companyDto>>
  > {
    const lk = this.lookups();
    const defs = await this.customDefs('COMPANY');
    return {
      entity: 'companies',
      module: 'companies',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Compañías',
      fields: async () => [
        { key: 'legalName', label: 'Razón social', required: true },
        { key: 'tradeName', label: 'Nombre comercial', required: false },
        {
          key: 'taxIdType',
          label: 'Tipo de identificador',
          required: false,
          hint: 'Código; vacío = RUC',
        },
        {
          key: 'taxId',
          label: 'RUC / identificador',
          required: false,
          hint: 'Clave de correspondencia',
        },
        { key: 'sector', label: 'Sector económico', required: false },
        { key: 'address', label: 'Dirección', required: false },
        { key: 'city', label: 'Ciudad', required: false },
        { key: 'country', label: 'País', required: false, hint: 'Código de 2 letras; vacío = PE' },
        { key: 'email', label: 'Correo', required: false },
        { key: 'phone', label: 'Teléfono', required: false },
        { key: 'website', label: 'Sitio web', required: false },
        {
          key: 'owner',
          label: 'Responsable comercial',
          required: false,
          hint: 'Correo del usuario',
        },
        { key: 'notes', label: 'Observaciones', required: false },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        legalName: 'Superintendencia Nacional de Aduanas y de Administración Tributaria',
        tradeName: 'SUNAT',
        taxIdType: 'RUC',
        taxId: '20131312955',
        sector: 'Servicios profesionales',
        address: 'Av. Garcilaso de la Vega 1472',
        city: 'Lima',
        country: 'PE',
        email: '',
        phone: '',
        website: 'www.sunat.gob.pe',
        owner: '',
        notes: '',
      }),
      parse: async (v): Promise<ParsedRow<CompanyInput>> => {
        const errors: FieldErrors = {};
        let taxIdTypeId: string | undefined;
        const typeCode = blank(v.taxIdType) ?? (blank(v.taxId) ? 'RUC' : undefined);
        if (typeCode) {
          taxIdTypeId = (await lk.docType(typeCode))?.id;
          if (!taxIdTypeId) errors.taxIdType = `Tipo «${typeCode}» no existe.`;
        }
        let sectorId: string | undefined;
        if (blank(v.sector)) {
          sectorId = (await lk.sector(v.sector!.trim()))?.id;
          if (!sectorId) errors.sector = `Sector «${v.sector}» no existe.`;
        }
        let ownerId: string | undefined;
        if (blank(v.owner)) {
          ownerId = (await lk.user(v.owner!.trim()))?.id;
          if (!ownerId) errors.owner = `No hay un usuario activo con el correo ${v.owner}.`;
        }
        const data = validate<CompanyInput>(
          companyInput,
          {
            legalName: v.legalName ?? '',
            tradeName: v.tradeName,
            taxIdTypeId,
            taxId: blank(v.taxId)?.replace(/[\s.-]/g, ''),
            sectorId,
            address: v.address,
            city: v.city,
            country: blank(v.country) ?? 'PE',
            email: v.email,
            phone: v.phone,
            website: v.website,
            ownerId,
            notes: v.notes,
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        const norm = normalizeIdentifier(data.taxId);
        return { ok: true, data, key: norm ? `tax:${norm}` : null };
      },
      findExisting: async (_d, key) =>
        this.db.tx.company.findFirst({
          where: {
            organizationId: this.db.organizationId,
            deletedAt: null,
            taxIdNorm: key.slice(4),
          },
          select: { id: true, ownerId: true, taxIdTypeId: true, taxId: true },
        }),
      check: async (d, existing) => {
        const current = existing
          ? await this.db.tx.company.findFirst({
              where: { id: existing.id },
              select: { id: true, taxIdTypeId: true, taxId: true },
            })
          : undefined;
        await this.companies.check(
          await this.companies.withDefaultTaxType(d, current?.taxIdTypeId ?? null),
          current ?? undefined,
        );
        await this.customFields.validate('COMPANY', d.customFields);
      },
      create: async (user, d) => {
        await this.companies.create(user, d);
      },
      update: async (user, existing, d) => {
        await this.companies.update(user, existing.id, d);
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código', value: (r) => r.code },
        { key: 'legalName', label: 'Razón social', value: (r) => r.legalName },
        { key: 'tradeName', label: 'Nombre comercial', value: (r) => r.tradeName },
        { key: 'taxIdType', label: 'Tipo de identificador', value: (r) => r.taxIdType?.code },
        { key: 'taxId', label: 'RUC / identificador', value: (r) => r.taxId },
        { key: 'sector', label: 'Sector económico', value: (r) => r.sector?.name },
        { key: 'address', label: 'Dirección', value: (r) => r.address },
        { key: 'city', label: 'Ciudad', value: (r) => r.city },
        { key: 'country', label: 'País', value: (r) => r.country },
        { key: 'email', label: 'Correo', value: (r) => r.email },
        { key: 'phone', label: 'Teléfono', value: (r) => r.phone },
        { key: 'website', label: 'Sitio web', value: (r) => r.website },
        { key: 'owner', label: 'Responsable comercial', value: (r) => r.owner?.name },
        { key: 'contactCount', label: 'Contactos', value: (r) => r.contactCount },
        { key: 'notes', label: 'Observaciones', value: (r) => r.notes },
        { key: 'createdAt', label: 'Fecha de creación', value: (r) => r.createdAt },
        ...cfColumns<ReturnType<typeof companyDto>>(defs),
      ],
      exportRows: async (user, query, limit) => {
        const where = await this.companies.where(user, companyQuery.parse(query), 'export');
        return (await this.companies.listRaw(where, limit)).map(companyDto);
      },
    };
  }

  // --- Productos ------------------------------------------------------------------------------

  private async productsDef(): Promise<
    ImportExportDefinition<ProductInput & { active?: boolean }, ReturnType<typeof productDto>>
  > {
    const lk = this.lookups();
    const defs = await this.customDefs('PRODUCT');
    return {
      entity: 'products',
      module: 'products',
      createAction: 'create',
      updateAction: 'edit',
      sheetName: 'Productos',
      fields: async () => [
        { key: 'sku', label: 'SKU', required: true, hint: 'Clave de correspondencia' },
        { key: 'name', label: 'Nombre', required: true },
        { key: 'description', label: 'Descripción', required: false },
        { key: 'category', label: 'Categoría', required: false },
        { key: 'price', label: 'Precio', required: true },
        { key: 'currencyCode', label: 'Moneda', required: true, hint: 'Código ISO: PEN, USD…' },
        { key: 'maxDiscountPct', label: 'Descuento máximo (%)', required: false },
        { key: 'active', label: 'Activo', required: false, hint: 'Sí / No; vacío = Sí' },
        ...customFieldInfos(defs),
      ],
      example: () => ({
        sku: 'LIC-CRM-01',
        name: 'Licencia CRM anual',
        description: 'Licencia por usuario',
        category: 'Licencias',
        price: '1200.00',
        currencyCode: 'USD',
        maxDiscountPct: '10',
        active: 'Sí',
      }),
      parse: async (v) => {
        const errors: FieldErrors = {};
        let categoryId: string | undefined;
        if (blank(v.category)) {
          categoryId = (await lk.category(v.category!.trim()))?.id;
          if (!categoryId) errors.category = `Categoría «${v.category}» no existe.`;
        }
        const price = blank(v.price) ? parseNumberCell(v.price!) : '';
        if (price === null) errors.price = 'Precio no válido.';
        const discount = blank(v.maxDiscountPct) ? parseNumberCell(v.maxDiscountPct!) : '0';
        if (discount === null) errors.maxDiscountPct = 'Descuento no válido.';
        const active = blank(v.active) ? parseBoolCell(v.active!) : true;
        if (active === null) errors.active = 'Use Sí o No.';
        const data = validate<ProductInput>(
          productInput,
          {
            sku: v.sku ?? '',
            name: v.name ?? '',
            description: v.description,
            categoryId,
            price: price ?? '',
            currencyCode: v.currencyCode ?? '',
            maxDiscountPct: discount ?? '',
            customFields: this.customInput(defs, v),
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        return {
          ok: true,
          data: { ...data, active: active ?? true },
          key: `sku:${normalizeIdentifier(data.sku)}`,
        };
      },
      findExisting: async (d) => {
        const p = await this.products.findBySku(d.sku);
        return p ? { id: p.id } : null;
      },
      check: async (d, existing) => {
        await this.products.check(d, existing?.id);
        await this.customFields.validate('PRODUCT', d.customFields);
      },
      create: async (user, { active, ...d }) => {
        const p = await this.products.create(d, toActor(user));
        if (active === false) await this.products.update(p.id, { active: false }, toActor(user));
      },
      // La clave (SKU) no se reescribe: el archivo puede traerla con otro formato (p-1 / P-1).
      update: async (user, existing, { sku: _sku, ...d }) => {
        await this.products.update(existing.id, d, toActor(user));
      },
      exportColumns: async () => [
        { key: 'sku', label: 'SKU', value: (r) => r.sku },
        { key: 'name', label: 'Nombre', value: (r) => r.name },
        { key: 'description', label: 'Descripción', value: (r) => r.description },
        { key: 'category', label: 'Categoría', value: (r) => r.category?.name },
        { key: 'price', label: 'Precio', value: (r) => Number(r.price), numFmt: '#,##0.00##' },
        { key: 'currencyCode', label: 'Moneda', value: (r) => r.currencyCode },
        {
          key: 'maxDiscountPct',
          label: 'Descuento máximo (%)',
          value: (r) => Number(r.maxDiscountPct),
          numFmt: '0.00',
        },
        { key: 'active', label: 'Activo', value: (r) => (r.active ? 'Sí' : 'No') },
        ...cfColumns<ReturnType<typeof productDto>>(defs),
      ],
      exportRows: async (_user, query, limit) =>
        (await this.products.listRaw(this.products.where(productQuery.parse(query)), limit)).map(
          productDto,
        ),
    };
  }

  // --- Monedas --------------------------------------------------------------------------------

  private currenciesDef(): ImportExportDefinition<
    CurrencyInput,
    Awaited<ReturnType<CurrenciesService['list']>>[number]
  > {
    return {
      entity: 'currencies',
      module: 'currencies',
      createAction: 'manage',
      updateAction: 'manage',
      sheetName: 'Monedas',
      fields: async () => [
        { key: 'code', label: 'Código ISO', required: true, hint: 'Clave de correspondencia' },
        { key: 'name', label: 'Nombre', required: true },
        { key: 'symbol', label: 'Símbolo', required: true },
        { key: 'decimals', label: 'Decimales', required: true },
        {
          key: 'symbolPosition',
          label: 'Posición del símbolo',
          required: false,
          hint: 'Antes / Después',
        },
      ],
      example: () => ({
        code: 'EUR',
        name: 'Euro',
        symbol: '€',
        decimals: '2',
        symbolPosition: 'Antes',
      }),
      parse: async (v) => {
        const errors: FieldErrors = {};
        const pos = (v.symbolPosition ?? '').trim().toLowerCase();
        const data = validate<CurrencyInput>(
          currencyInput,
          {
            code: v.code ?? '',
            name: v.name ?? '',
            symbol: v.symbol ?? '',
            decimals: Number(v.decimals),
            symbolPosition: pos.startsWith('d') || pos === 'after' ? 'AFTER' : 'BEFORE',
          },
          errors,
        );
        if (!data) return { ok: false, errors };
        return { ok: true, data, key: `code:${data.code}` };
      },
      findExisting: async (d) => {
        const c = await this.currencies.findByCode(d.code);
        return c ? { id: c.id } : null;
      },
      check: async () => undefined,
      create: async (user, d) => {
        await this.currencies.create(d, toActor(user));
      },
      update: async (user, existing, { code: _c, ...d }) => {
        await this.currencies.update(existing.id, d, toActor(user));
      },
      exportColumns: async () => [
        { key: 'code', label: 'Código ISO', value: (r) => r.code },
        { key: 'name', label: 'Nombre', value: (r) => r.name },
        { key: 'symbol', label: 'Símbolo', value: (r) => r.symbol },
        { key: 'decimals', label: 'Decimales', value: (r) => r.decimals },
        {
          key: 'symbolPosition',
          label: 'Posición del símbolo',
          value: (r) => (r.symbolPosition === 'AFTER' ? 'Después' : 'Antes'),
        },
        { key: 'isBase', label: 'Principal', value: (r) => (r.isBase ? 'Sí' : 'No') },
        { key: 'active', label: 'Activa', value: (r) => (r.active ? 'Sí' : 'No') },
      ],
      exportRows: async () => this.currencies.list(true),
    };
  }

  // --- Tipos de cambio ------------------------------------------------------------------------

  private ratesDef(): ImportExportDefinition<
    ExchangeRateInput,
    Awaited<ReturnType<ExchangeRatesService['list']>>['items'][number]
  > {
    return {
      entity: 'exchange-rates',
      module: 'exchange_rates',
      createAction: 'manage',
      updateAction: 'manage',
      sheetName: 'Tipos de cambio',
      fields: async () => [
        { key: 'date', label: 'Fecha', required: true, hint: 'dd/mm/aaaa o aaaa-mm-dd' },
        { key: 'fromCurrency', label: 'Moneda origen', required: true },
        { key: 'toCurrency', label: 'Moneda destino', required: true },
        { key: 'rate', label: 'Tipo de cambio', required: true, hint: '1 origen = tasa destino' },
      ],
      example: () => ({
        date: new Date().toISOString().slice(0, 10),
        fromCurrency: 'USD',
        toCurrency: 'PEN',
        rate: '3.7520',
      }),
      parse: async (v) => {
        const errors: FieldErrors = {};
        const date = parseDateCell(v.date ?? '');
        if (!date) errors.date = 'Fecha no válida (dd/mm/aaaa o aaaa-mm-dd).';
        const rate = parseNumberCell(v.rate ?? '');
        if (rate === null) errors.rate = 'Tasa no válida.';
        const data = validate<ExchangeRateInput>(
          exchangeRateInput,
          {
            date: date ?? '',
            fromCurrency: v.fromCurrency ?? '',
            toCurrency: v.toCurrency ?? '',
            rate: rate ?? '',
          },
          errors,
        );
        if (!data || Object.keys(errors).length > 0) return { ok: false, errors };
        return { ok: true, data, key: `rate:${data.date}:${data.fromCurrency}:${data.toCurrency}` };
      },
      findExisting: async (d) =>
        this.db.tx.exchangeRate.findFirst({
          where: {
            organizationId: this.db.organizationId,
            rateDate: new Date(`${d.date}T00:00:00.000Z`),
            fromCurrency: d.fromCurrency,
            toCurrency: d.toCurrency,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
      check: async (d) => {
        await this.currencies.assertActive(d.fromCurrency, 'fromCurrency');
        await this.currencies.assertActive(d.toCurrency, 'toCurrency');
      },
      create: async (user, d) => {
        await this.rates.create(d, toActor(user), 'IMPORT');
      },
      update: async (user, existing, d) => {
        await this.rates.update(
          existing.id,
          { rate: d.rate, reason: 'Actualizado por importación' },
          toActor(user),
        );
      },
      exportColumns: async () => [
        { key: 'date', label: 'Fecha', value: (r) => r.rateDate },
        { key: 'fromCurrency', label: 'Moneda origen', value: (r) => r.fromCurrency },
        { key: 'toCurrency', label: 'Moneda destino', value: (r) => r.toCurrency },
        {
          key: 'rate',
          label: 'Tipo de cambio',
          value: (r) => Number(r.rate),
          numFmt: '0.0000######',
        },
        {
          key: 'status',
          label: 'Estado',
          value: (r) => (r.status === 'ACTIVE' ? 'Activo' : 'Inactivo'),
        },
        {
          key: 'source',
          label: 'Origen',
          value: (r) => (r.source === 'IMPORT' ? 'Importación' : 'Manual'),
        },
        { key: 'updatedBy', label: 'Modificado por', value: (r) => r.updatedByName },
        { key: 'updatedAt', label: 'Fecha de modificación', value: (r) => r.updatedAt },
      ],
      exportRows: async (_user, query, limit) =>
        (await this.rates.list({ ...rateListQuery.parse(query), page: 1, pageSize: limit })).items,
    };
  }
}
