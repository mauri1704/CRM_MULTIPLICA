-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "name_norm" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "name_norm" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "name_norm" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "name_norm" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "duplicate_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(10) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "action" VARCHAR(5) NOT NULL DEFAULT 'WARN',
    "conditions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "duplicate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(10) NOT NULL,
    "record_a_id" UUID NOT NULL,
    "record_b_id" UUID NOT NULL,
    "rule_id" UUID,
    "score" DECIMAL(5,4) NOT NULL,
    "matched" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "source" VARCHAR(6) NOT NULL DEFAULT 'SCAN',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(10) NOT NULL,
    "survivor_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "choices" JSONB NOT NULL,
    "moved" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_rules_organization_id_entity_type_active_idx" ON "duplicate_rules"("organization_id", "entity_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_rules_organization_id_entity_type_name_key" ON "duplicate_rules"("organization_id", "entity_type", "name");

-- CreateIndex
CREATE INDEX "duplicate_candidates_organization_id_status_entity_type_sco_idx" ON "duplicate_candidates"("organization_id", "status", "entity_type", "score");

-- CreateIndex
CREATE INDEX "duplicate_candidates_organization_id_entity_type_record_a_i_idx" ON "duplicate_candidates"("organization_id", "entity_type", "record_a_id");

-- CreateIndex
CREATE INDEX "duplicate_candidates_organization_id_entity_type_record_b_i_idx" ON "duplicate_candidates"("organization_id", "entity_type", "record_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidates_organization_id_entity_type_record_a_i_key" ON "duplicate_candidates"("organization_id", "entity_type", "record_a_id", "record_b_id");

-- CreateIndex
CREATE INDEX "merge_history_organization_id_entity_type_survivor_id_idx" ON "merge_history"("organization_id", "entity_type", "survivor_id");

-- CreateIndex
CREATE INDEX "merge_history_organization_id_entity_type_merged_id_idx" ON "merge_history"("organization_id", "entity_type", "merged_id");

-- CreateIndex
CREATE INDEX "companies_name_trgm" ON "companies" USING GIN ("name_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contacts_name_trgm" ON "contacts" USING GIN ("name_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "deals_name_trgm" ON "deals" USING GIN ("name_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "leads_name_trgm" ON "leads" USING GIN ("name_norm" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "duplicate_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- Agregado a mano (revisado): restricciones, RLS, permisos, relleno y reglas iniciales.
-- ===========================================================================

ALTER TABLE "duplicate_rules" ADD CONSTRAINT "duplicate_rules_entity_check" CHECK ("entity_type" IN ('CONTACT', 'COMPANY', 'PRODUCT', 'LEAD', 'DEAL', 'PROJECT'));
ALTER TABLE "duplicate_rules" ADD CONSTRAINT "duplicate_rules_action_check" CHECK ("action" IN ('WARN', 'BLOCK'));
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_status_check" CHECK ("status" IN ('OPEN', 'KEPT_BOTH', 'REVIEWED', 'MERGED'));
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_source_check" CHECK ("source" IN ('SCAN', 'SAVE', 'IMPORT'));
-- Par ordenado: cada par se registra una sola vez.
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_order_check" CHECK ("record_a_id" < "record_b_id");

-- Nombre normalizado de los registros existentes (igual que normalizeName en TypeScript: sin puntos).
UPDATE "contacts" SET "name_norm" = btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(first_name || ' ' || coalesce(last_name, '')), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'), '[^a-z0-9@.\s]', ' ', 'g'), '\.', '', 'g'), '\s+', ' ', 'g'));
UPDATE "companies" SET "name_norm" = btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(legal_name), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'), '[^a-z0-9@.\s]', ' ', 'g'), '\.', '', 'g'), '\s+', ' ', 'g'));
UPDATE "leads" SET "name_norm" = btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(title), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'), '[^a-z0-9@.\s]', ' ', 'g'), '\.', '', 'g'), '\s+', ' ', 'g'));
UPDATE "deals" SET "name_norm" = btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(title), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'), '[^a-z0-9@.\s]', ' ', 'g'), '\.', '', 'g'), '\s+', ' ', 'g'));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['duplicate_rules', 'duplicate_candidates', 'merge_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING ("organization_id" = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)
         WITH CHECK ("organization_id" = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "duplicate_rules", "duplicate_candidates" TO crm_app;
    -- El historial de fusiones es de solo inserción, como el historial de cambios.
    GRANT SELECT, INSERT ON "merge_history" TO crm_app;
  END IF;
END $$;

-- Reglas iniciales para las organizaciones existentes (las nuevas las crea el alta de organización).
INSERT INTO "duplicate_rules" ("id", "organization_id", "entity_type", "name", "active", "action", "conditions", "updated_at")
SELECT gen_random_uuid(), o."id", r.entity_type, r.name, r.active, r.action, r.conditions, now()
FROM "organizations" o
CROSS JOIN (VALUES
    ('CONTACT', 'Mismo documento', true, 'WARN', '[{"field":"documentNumber","mode":"NORMALIZED"}]'::jsonb),
    ('CONTACT', 'Mismo correo', true, 'WARN', '[{"field":"email","mode":"NORMALIZED"}]'::jsonb),
    ('CONTACT', 'Mismo teléfono', true, 'WARN', '[{"field":"phone","mode":"NORMALIZED"}]'::jsonb),
    ('CONTACT', 'Nombre muy parecido', false, 'WARN', '[{"field":"fullName","mode":"FUZZY","threshold":0.9}]'::jsonb),
    ('COMPANY', 'Mismo RUC', true, 'WARN', '[{"field":"taxId","mode":"NORMALIZED"}]'::jsonb),
    ('COMPANY', 'Razón social parecida', true, 'WARN', '[{"field":"legalName","mode":"FUZZY","threshold":0.85}]'::jsonb),
    ('PRODUCT', 'Mismo SKU', true, 'WARN', '[{"field":"sku","mode":"NORMALIZED"}]'::jsonb),
    ('PRODUCT', 'Nombre parecido', true, 'WARN', '[{"field":"name","mode":"FUZZY","threshold":0.85}]'::jsonb),
    ('LEAD', 'Mismo correo y compañía', true, 'WARN', '[{"field":"email","mode":"NORMALIZED"},{"field":"companyId","mode":"EXACT"}]'::jsonb),
    ('DEAL', 'Misma compañía y título', true, 'WARN', '[{"field":"companyId","mode":"EXACT"},{"field":"title","mode":"NORMALIZED"}]'::jsonb),
    ('PROJECT', 'Nombre parecido', true, 'WARN', '[{"field":"name","mode":"FUZZY","threshold":0.85}]'::jsonb)
) AS r(entity_type, name, active, action, conditions);
