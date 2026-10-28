import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CUSTOM_PREFIX,
  DEFAULT_THRESHOLD,
  DUPLICATE_FIELDS,
  can,
  type DuplicateCondition,
  type DuplicateEntity,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { AppError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { ENTITIES, draftValue, normalizeFor } from './duplicate-entities';

const PAIR_LIMIT = 2000;
const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,49}$/;

export type CandidateSource = 'SCAN' | 'SAVE' | 'IMPORT';

interface Rule {
  id: string;
  entityType: DuplicateEntity;
  name: string;
  action: 'WARN' | 'BLOCK';
  conditions: DuplicateCondition[];
}
interface Pair {
  a: string;
  b: string;
  score: number;
}
interface Found {
  rule: Rule;
  score: number;
  fields: string[];
}

const raw = (s: string) => Prisma.raw(s);

/**
 * Motor de detección (Fase 5, D-10/D-15). Evalúa las reglas activas con SQL parametrizado: exacta
 * (valor idéntico), normalizada (columnas `*_norm`) y aproximada (pg_trgm). Nunca elimina ni
 * fusiona nada: solo registra candidatos para que una persona los revise.
 */
@Injectable()
export class DuplicateDetectionService {
  private readonly origin = new AsyncLocalStorage<{ source: CandidateSource; created: number }>();

  constructor(
    private readonly db: Db,
    private readonly scope: RecordScopeService,
  ) {}

  /**
   * Ejecuta `fn` marcando los candidatos que se registren con ese origen (p. ej. importación) y
   * devuelve además cuántos candidatos nuevos se registraron.
   */
  async runAs<T>(
    source: CandidateSource,
    fn: () => Promise<T>,
  ): Promise<{ result: T; created: number }> {
    const store = { source, created: 0 };
    const result = await this.origin.run(store, fn);
    return { result, created: store.created };
  }

  // --- Reglas ---------------------------------------------------------------------------------

  async activeRules(entity?: DuplicateEntity): Promise<Rule[]> {
    const rows = await this.db.tx.duplicateRule.findMany({
      where: {
        organizationId: this.db.organizationId,
        active: true,
        ...(entity ? { entityType: entity } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as DuplicateEntity,
      name: r.name,
      action: r.action as 'WARN' | 'BLOCK',
      conditions: r.conditions as unknown as DuplicateCondition[],
    }));
  }

  // --- SQL ------------------------------------------------------------------------------------

  /** Columna comparable de una condición para el alias dado. */
  private column(
    entity: DuplicateEntity,
    c: DuplicateCondition,
    alias: string,
  ): { sql: Prisma.Sql; custom: string | null } | null {
    if (c.field.startsWith(CUSTOM_PREFIX)) {
      const key = c.field.slice(CUSTOM_PREFIX.length);
      if (!CUSTOM_KEY.test(key)) return null;
      const base = Prisma.sql`(${raw(alias)}.custom_fields ->> ${key})`;
      return {
        sql: c.mode === 'NORMALIZED' ? Prisma.sql`lower(btrim(${base}))` : base,
        custom: key,
      };
    }
    const col = ENTITIES[entity].fields[c.field];
    if (!col) return null;
    return { sql: raw(`${alias}.${c.mode === 'EXACT' ? col.raw : col.norm}`), custom: null };
  }

  private threshold(c: DuplicateCondition) {
    return c.threshold ?? DEFAULT_THRESHOLD;
  }

  /** Condición entre dos registros (alias a y b). */
  private pairCondition(entity: DuplicateEntity, c: DuplicateCondition) {
    const l = this.column(entity, c, 'a');
    const r = this.column(entity, c, 'b');
    if (!l || !r) return null;
    if (c.mode === 'FUZZY') {
      return {
        where: Prisma.sql`(${l.sql} <> '' AND ${r.sql} <> '' AND ${l.sql} % ${r.sql} AND similarity(${l.sql}, ${r.sql}) >= ${this.threshold(c)})`,
        score: Prisma.sql`similarity(${l.sql}, ${r.sql})::numeric`,
      };
    }
    return {
      where: Prisma.sql`(${l.sql} IS NOT NULL AND ${l.sql}::text <> '' AND ${l.sql} = ${r.sql})`,
      score: Prisma.sql`1::numeric`,
    };
  }

  private fieldLabel(entity: DuplicateEntity, field: string) {
    if (field.startsWith(CUSTOM_PREFIX)) return field.slice(CUSTOM_PREFIX.length);
    return DUPLICATE_FIELDS[entity].find((x) => x.key === field)?.label ?? field;
  }

  private async setSimilarity(rule: Rule) {
    const t = Math.min(
      ...rule.conditions.filter((c) => c.mode === 'FUZZY').map((c) => this.threshold(c)),
      1,
    );
    // Local a la transacción: el operador % usa este umbral y el índice trigram.
    await this.db.tx
      .$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(t)}, true)`;
  }

  /**
   * Pares que cumplen la regla. Con `only` se buscan solo los pares donde participa ese registro;
   * si no, todos los pares de la organización (a < b).
   */
  private async pairs(rule: Rule, only?: string): Promise<{ pairs: Pair[]; truncated: boolean }> {
    const meta = ENTITIES[rule.entityType];
    const conds = rule.conditions.map((c) => this.pairCondition(rule.entityType, c));
    if (conds.some((c) => c === null) || conds.length === 0) return { pairs: [], truncated: false };
    const ok = conds as NonNullable<(typeof conds)[number]>[];
    await this.setSimilarity(rule);
    const org = this.db.organizationId;
    const link = only ? Prisma.sql`a.id = ${only}::uuid AND b.id <> a.id` : Prisma.sql`a.id < b.id`;
    const rows = await this.db.tx.$queryRaw<
      { a_id: string; b_id: string; score: string }[]
    >(Prisma.sql`
      SELECT a.id AS a_id, b.id AS b_id, LEAST(${Prisma.join(
        ok.map((c) => c.score),
        ', ',
      )}) AS score
      FROM ${raw(meta.table)} a
      JOIN ${raw(meta.table)} b ON b.organization_id = a.organization_id AND ${link}
      WHERE a.organization_id = ${org}::uuid AND a.deleted_at IS NULL AND b.deleted_at IS NULL
        AND ${Prisma.join(
          ok.map((c) => c.where),
          ' AND ',
        )}
      LIMIT ${PAIR_LIMIT + 1}`);
    return {
      pairs: rows
        .slice(0, PAIR_LIMIT)
        .map((r) => ({ a: r.a_id, b: r.b_id, score: Number(r.score) })),
      truncated: rows.length > PAIR_LIMIT,
    };
  }

  private ordered(x: string, y: string): [string, string] {
    return x < y ? [x, y] : [y, x];
  }

  // --- Candidatos -----------------------------------------------------------------------------

  private async register(
    entity: DuplicateEntity,
    found: Map<string, { a: string; b: string; items: Found[] }>,
    source: CandidateSource,
  ) {
    const org = this.db.organizationId;
    let created = 0;
    for (const { a, b, items } of found.values()) {
      const best = items.reduce((m, i) => Math.max(m, i.score), 0);
      const matched = items.map((i) => ({ rule: i.rule.name, fields: i.fields, score: i.score }));
      const existing = await this.db.tx.duplicateCandidate.findFirst({
        where: { organizationId: org, entityType: entity, recordAId: a, recordBId: b },
      });
      if (!existing) {
        await this.db.tx.duplicateCandidate.create({
          data: {
            organizationId: org,
            entityType: entity,
            recordAId: a,
            recordBId: b,
            ruleId: items[0]!.rule.id,
            score: best,
            matched,
            source,
          },
        });
        created++;
        const store = this.origin.getStore();
        if (store) store.created++;
      } else if (existing.status === 'OPEN') {
        await this.db.tx.duplicateCandidate.update({
          where: { id: existing.id },
          data: { score: best, matched, ruleId: items[0]!.rule.id },
        });
      }
      // Revisado o «conservar ambos»: el mismo par no vuelve a aparecer (Q-03).
    }
    return created;
  }

  private collect(
    rule: Rule,
    pairs: Pair[],
    into: Map<string, { a: string; b: string; items: Found[] }>,
  ) {
    for (const p of pairs) {
      const [a, b] = this.ordered(p.a, p.b);
      const key = `${a}|${b}`;
      const entry = into.get(key) ?? { a, b, items: [] };
      entry.items.push({
        rule,
        score: p.score,
        fields: rule.conditions.map((c) => this.fieldLabel(rule.entityType, c.field)),
      });
      into.set(key, entry);
    }
  }

  /**
   * Búsqueda bajo demanda («Buscar duplicados»). Registra candidatos nuevos y retira los abiertos
   * que ya no coinciden (porque se editó o eliminó alguno de los dos).
   */
  async scan(entities: readonly DuplicateEntity[]) {
    const out: {
      entityType: DuplicateEntity;
      rules: number;
      found: number;
      created: number;
      truncated: boolean;
    }[] = [];
    for (const entity of entities) {
      const rules = await this.activeRules(entity);
      const found = new Map<string, { a: string; b: string; items: Found[] }>();
      let truncated = false;
      for (const rule of rules) {
        const r = await this.pairs(rule);
        truncated ||= r.truncated;
        this.collect(rule, r.pairs, found);
      }
      const created = await this.register(entity, found, this.origin.getStore()?.source ?? 'SCAN');
      if (!truncated) {
        const open = await this.db.tx.duplicateCandidate.findMany({
          where: { organizationId: this.db.organizationId, entityType: entity, status: 'OPEN' },
          select: { id: true, recordAId: true, recordBId: true },
        });
        const stale = open
          .filter((c) => !found.has(`${c.recordAId}|${c.recordBId}`))
          .map((c) => c.id);
        if (stale.length > 0) {
          await this.db.tx.duplicateCandidate.deleteMany({
            where: { organizationId: this.db.organizationId, id: { in: stale } },
          });
        }
      }
      out.push({ entityType: entity, rules: rules.length, found: found.size, created, truncated });
    }
    return out;
  }

  /**
   * Tras guardar un registro: lo compara con los demás y registra los candidatos (origen guardado
   * o importación). Nunca falla el guardado por un problema de detección.
   */
  async onSaved(entity: DuplicateEntity, id: string): Promise<void> {
    const rules = await this.activeRules(entity);
    const found = new Map<string, { a: string; b: string; items: Found[] }>();
    for (const rule of rules) this.collect(rule, (await this.pairs(rule, id)).pairs, found);
    await this.register(entity, found, this.origin.getStore()?.source ?? 'SAVE');
    // Retira los abiertos de este registro que ya no coinciden con ninguna regla.
    const open = await this.db.tx.duplicateCandidate.findMany({
      where: {
        organizationId: this.db.organizationId,
        entityType: entity,
        status: 'OPEN',
        OR: [{ recordAId: id }, { recordBId: id }],
      },
      select: { id: true, recordAId: true, recordBId: true },
    });
    const stale = open.filter((c) => !found.has(`${c.recordAId}|${c.recordBId}`)).map((c) => c.id);
    if (stale.length > 0) {
      await this.db.tx.duplicateCandidate.deleteMany({
        where: { organizationId: this.db.organizationId, id: { in: stale } },
      });
    }
  }

  // --- Al guardar (aviso o bloqueo) -----------------------------------------------------------

  /** Condición contra valores de un formulario (alias b = registros existentes). */
  private draftCondition(
    entity: DuplicateEntity,
    c: DuplicateCondition,
    values: Record<string, unknown>,
  ): Prisma.Sql | null {
    const r = this.column(entity, c, 'b');
    if (!r) return null;
    let value: string | null;
    if (c.field.startsWith(CUSTOM_PREFIX)) {
      const cf = (values.customFields ?? {}) as Record<string, unknown>;
      const v = cf[c.field.slice(CUSTOM_PREFIX.length)];
      const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
      value = s ? (c.mode === 'NORMALIZED' ? s.toLowerCase() : s) : null;
    } else {
      const col = ENTITIES[entity].fields[c.field];
      if (!col) return null;
      const v = draftValue(entity, c.field, values);
      value = c.mode === 'EXACT' ? v : normalizeFor(col.kind, v);
    }
    if (value === null) return null;
    const isId =
      !c.field.startsWith(CUSTOM_PREFIX) && ENTITIES[entity].fields[c.field]?.kind === 'id';
    if (isId) return Prisma.sql`${r.sql} = ${value}::uuid`;
    if (c.mode === 'FUZZY') {
      return Prisma.sql`(${r.sql} <> '' AND ${r.sql} % ${value} AND similarity(${r.sql}, ${value}) >= ${this.threshold(c)})`;
    }
    return Prisma.sql`${r.sql} = ${value}`;
  }

  /** Registros existentes que coinciden con los valores de un formulario, por regla. */
  private async hits(entity: DuplicateEntity, values: Record<string, unknown>, excludeId?: string) {
    const meta = ENTITIES[entity];
    const rules = await this.activeRules(entity);
    const hits = new Map<
      string,
      { id: string; ownerId: string | null; rules: { name: string; action: 'WARN' | 'BLOCK' }[] }
    >();
    for (const rule of rules) {
      const parts = rule.conditions.map((c) => this.draftCondition(entity, c, values));
      // Una regla solo aplica si el formulario trae todos los valores que compara.
      if (parts.some((p) => p === null)) continue;
      await this.setSimilarity(rule);
      const ownerSel = meta.ownerColumn ? raw(`b.${meta.ownerColumn}`) : Prisma.sql`NULL::uuid`;
      const rows = await this.db.tx.$queryRaw<{ id: string; owner_id: string | null }[]>(Prisma.sql`
        SELECT b.id, ${ownerSel} AS owner_id
        FROM ${raw(meta.table)} b
        WHERE b.organization_id = ${this.db.organizationId}::uuid AND b.deleted_at IS NULL
          ${excludeId ? Prisma.sql`AND b.id <> ${excludeId}::uuid` : Prisma.empty}
          AND ${Prisma.join(parts as Prisma.Sql[], ' AND ')}
        LIMIT 10`);
      for (const r of rows) {
        const h = hits.get(r.id) ?? { id: r.id, ownerId: r.owner_id, rules: [] };
        h.rules.push({ name: rule.name, action: rule.action });
        hits.set(r.id, h);
      }
    }
    return hits;
  }

  /**
   * Para el aviso al guardar. Solo detalla (código y nombre) los que el usuario puede ver; de los
   * demás informa únicamente que existen, para no revelar registros fuera de su alcance.
   */
  async check(
    user: AuthUser,
    entity: DuplicateEntity,
    values: Record<string, unknown>,
    excludeId?: string,
  ) {
    const meta = ENTITIES[entity];
    const hits = await this.hits(entity, values, excludeId);
    if (hits.size === 0) return [];
    const labels = await this.labels(entity, [...hits.keys()]);
    const out = [];
    for (const h of hits.values()) {
      const visible =
        can(user.permissions, meta.module, 'view') &&
        (await this.scope.allows(
          user,
          meta.module,
          'view',
          meta.ownerColumn ? h.ownerId : user.id,
        ));
      out.push({
        id: visible ? h.id : null,
        code: visible ? (labels.get(h.id)?.code ?? null) : null,
        name: visible ? (labels.get(h.id)?.name ?? null) : null,
        visible,
        rules: h.rules,
        blocking: h.rules.some((r) => r.action === 'BLOCK'),
      });
    }
    return out;
  }

  /**
   * Reglas «Impedir guardar»: si hay coincidencia, el guardado se rechaza (409). El mensaje no
   * nombra el registro existente: podría estar fuera del alcance de quien guarda.
   */
  async assertNoBlocking(
    entity: DuplicateEntity,
    values: Record<string, unknown>,
    excludeId?: string,
  ) {
    for (const h of (await this.hits(entity, values, excludeId)).values()) {
      const rule = h.rules.find((r) => r.action === 'BLOCK');
      if (!rule) continue;
      throw new AppError(
        HttpStatus.CONFLICT,
        'DUPLICATE_BLOCKED',
        `No se puede guardar: ya existe un registro que coincide con la regla «${rule.name}». Revise si es el mismo antes de crear otro.`,
        { duplicate: rule.name },
      );
    }
  }

  /** Código y nombre para mostrar de registros de una entidad. */
  async labels(entity: DuplicateEntity, ids: string[]) {
    const org = this.db.organizationId;
    const where = { organizationId: org, id: { in: ids } };
    const out = new Map<
      string,
      {
        code: string | null;
        name: string;
        ownerId: string | null;
        createdAt: Date;
        deletedAt: Date | null;
      }
    >();
    switch (entity) {
      case 'CONTACT':
        for (const r of await this.db.tx.contact.findMany({ where }))
          out.set(r.id, {
            code: r.code,
            name: [r.firstName, r.lastName].filter(Boolean).join(' '),
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
      case 'COMPANY':
        for (const r of await this.db.tx.company.findMany({ where }))
          out.set(r.id, {
            code: r.code,
            name: r.legalName,
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
      case 'PRODUCT':
        for (const r of await this.db.tx.product.findMany({ where }))
          out.set(r.id, {
            code: r.sku,
            name: r.name,
            ownerId: null,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
      case 'LEAD':
        for (const r of await this.db.tx.lead.findMany({ where }))
          out.set(r.id, {
            code: r.code,
            name: r.title,
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
      case 'DEAL':
        for (const r of await this.db.tx.deal.findMany({ where }))
          out.set(r.id, {
            code: r.code,
            name: r.title,
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
      case 'PROJECT':
        for (const r of await this.db.tx.project.findMany({ where }))
          out.set(r.id, {
            code: r.code,
            name: r.name,
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            deletedAt: r.deletedAt,
          });
        break;
    }
    return out;
  }
}
