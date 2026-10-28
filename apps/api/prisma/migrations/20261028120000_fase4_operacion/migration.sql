-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "task_id" UUID;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_norm" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "status" VARCHAR(15) NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE,
    "end_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "responsible_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "priority_id" UUID,
    "status_id" UUID NOT NULL,
    "status_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "project_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "contact_id" UUID,
    "company_id" UUID,
    "lead_id" UUID,
    "deal_id" UUID,
    "overdue_notified_at" TIMESTAMPTZ(3),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "search_norm" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(12) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "notes" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "author_id" UUID NOT NULL,
    "lead_id" UUID,
    "deal_id" UUID,
    "contact_id" UUID,
    "company_id" UUID,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_organization_id_deleted_at_name_idx" ON "projects"("organization_id", "deleted_at", "name");

-- CreateIndex
CREATE INDEX "projects_organization_id_owner_id_idx" ON "projects"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "projects_name_trgm" ON "projects" USING GIN ("name_norm" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("organization_id", "code");

-- CreateIndex
CREATE INDEX "tasks_organization_id_status_id_status_position_idx" ON "tasks"("organization_id", "status_id", "status_position");

-- CreateIndex
CREATE INDEX "tasks_organization_id_responsible_id_due_at_idx" ON "tasks"("organization_id", "responsible_id", "due_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_deleted_at_due_at_idx" ON "tasks"("organization_id", "deleted_at", "due_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_project_id_idx" ON "tasks"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_contact_id_idx" ON "tasks"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_company_id_idx" ON "tasks"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_lead_id_idx" ON "tasks"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_deal_id_idx" ON "tasks"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "tasks_search_trgm" ON "tasks" USING GIN ("search_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "tasks_custom_fields_idx" ON "tasks" USING GIN ("custom_fields" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_code_key" ON "tasks"("organization_id", "code");

-- CreateIndex
CREATE INDEX "task_members_organization_id_user_id_role_idx" ON "task_members"("organization_id", "user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "task_members_task_id_user_id_key" ON "task_members"("task_id", "user_id");

-- CreateIndex
CREATE INDEX "activities_organization_id_lead_id_occurred_at_idx" ON "activities"("organization_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_deal_id_occurred_at_idx" ON "activities"("organization_id", "deal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_contact_id_occurred_at_idx" ON "activities"("organization_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_company_id_occurred_at_idx" ON "activities"("organization_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "comments_organization_id_task_id_created_at_idx" ON "comments"("organization_id", "task_id", "created_at");

-- CreateIndex
CREATE INDEX "companies_search_trgm" ON "companies" USING GIN ("search_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "companies_custom_fields_idx" ON "companies" USING GIN ("custom_fields" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("organization_id", "code");

-- CreateIndex
CREATE INDEX "contacts_search_trgm" ON "contacts" USING GIN ("search_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contacts_custom_fields_idx" ON "contacts" USING GIN ("custom_fields" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_code_key" ON "contacts"("organization_id", "code");

-- CreateIndex
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name_norm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_custom_fields_idx" ON "products" USING GIN ("custom_fields" jsonb_ops);

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "task_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Agregado a mano (revisado): restricciones, índices, RLS y permisos.
-- Nota: la migración de la fase 3 eliminó por error índices creados a mano en la fase 2 (código
-- único de contactos y compañías, búsqueda trigram y GIN de campos personalizados). Ahora están
-- declarados en schema.prisma y se recrean arriba; Prisma ya no los volverá a eliminar.
-- ===========================================================================

ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("status" IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'CLOSED'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_dates_check" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dates_check" CHECK ("due_at" IS NULL OR "start_at" IS NULL OR "due_at" >= "start_at");
-- Una tarea se asocia como máximo a un elemento CRM (D-26).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_crm_target_check" CHECK (num_nonnulls("contact_id", "company_id", "lead_id", "deal_id") <= 1);
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_role_check" CHECK ("role" IN ('PARTICIPANT', 'OBSERVER'));
ALTER TABLE "activities" ADD CONSTRAINT "activities_type_check" CHECK ("type" IN ('CALL', 'MEETING', 'EMAIL', 'NOTE'));
ALTER TABLE "activities" ADD CONSTRAINT "activities_target_check" CHECK (num_nonnulls("lead_id", "deal_id", "contact_id", "company_id") = 1);

-- Un comentario pertenece exactamente a un registro (ahora también a una tarea).
ALTER TABLE "comments" DROP CONSTRAINT "comments_target_check";
ALTER TABLE "comments" ADD CONSTRAINT "comments_target_check" CHECK (num_nonnulls("lead_id", "deal_id", "contact_id", "company_id", "task_id") = 1);

-- Tareas abiertas por responsable y vencimiento (aviso diario de vencidas).
CREATE INDEX "tasks_open_due" ON "tasks" ("organization_id", "responsible_id", "due_at") WHERE "completed_at" IS NULL AND "deleted_at" IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'tasks', 'task_members', 'activities'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "projects", "tasks", "task_members", "activities" TO crm_app;
  END IF;
END $$;
