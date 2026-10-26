-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(200),
    "tax_id" VARCHAR(20),
    "base_currency_code" CHAR(3) NOT NULL DEFAULT 'PEN',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "theme" VARCHAR(10) NOT NULL DEFAULT 'system',
    "last_login_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "supervisor_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "system_key" VARCHAR(20),
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "scope" VARCHAR(10) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","module","action")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(10) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "position" INTEGER NOT NULL,
    "color" CHAR(7) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "probability" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priorities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" CHAR(7) NOT NULL,
    "icon" VARCHAR(20) NOT NULL,
    "rank" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "pattern" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economic_sectors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "economic_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_statuses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" CHAR(7) NOT NULL,
    "category" VARCHAR(15) NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "section" VARCHAR(60),
    "help_text" VARCHAR(200),
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("organization_id","entity_type")
);

-- CreateTable
CREATE TABLE "record_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "user_id" UUID,
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "user_id" UUID,
    "entity_type" VARCHAR(20),
    "entity_id" UUID,
    "ip" VARCHAR(64),
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "link" VARCHAR(300),
    "entity_type" VARCHAR(20),
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trash_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "display_name" VARCHAR(300) NOT NULL,
    "code" VARCHAR(30),
    "owner_id" UUID,
    "deleted_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(10) NOT NULL DEFAULT 'IN_TRASH',
    "relations" JSONB NOT NULL DEFAULT '{}',
    "purge_after" TIMESTAMPTZ(3) NOT NULL,
    "cascade_group_id" UUID,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "trash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_active_idx" ON "users"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "teams_organization_id_deleted_at_name_idx" ON "teams"("organization_id", "deleted_at", "name");

-- CreateIndex
CREATE INDEX "team_members_organization_id_user_id_idx" ON "team_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_system_key_key" ON "roles"("organization_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_idx" ON "role_permissions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_organization_id_entity_type_name_key" ON "pipelines"("organization_id", "entity_type", "name");

-- CreateIndex
CREATE INDEX "stages_organization_id_pipeline_id_position_idx" ON "stages"("organization_id", "pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "priorities_organization_id_name_key" ON "priorities"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_organization_id_name_key" ON "lead_sources"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "loss_reasons_organization_id_entity_type_name_key" ON "loss_reasons"("organization_id", "entity_type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_organization_id_code_key" ON "document_types"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "economic_sectors_organization_id_name_key" ON "economic_sectors"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "task_statuses_organization_id_name_key" ON "task_statuses"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_organization_id_entity_type_key_key" ON "custom_field_definitions"("organization_id", "entity_type", "key");

-- CreateIndex
CREATE INDEX "record_history_organization_id_entity_type_entity_id_create_idx" ON "record_history"("organization_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_organization_id_created_at_idx" ON "audit_log"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_organization_id_event_created_at_idx" ON "audit_log"("organization_id", "event", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_user_id_read_at_created_at_idx" ON "notifications"("organization_id", "user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "trash_entries_organization_id_status_deleted_at_idx" ON "trash_entries"("organization_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "trash_entries_organization_id_entity_type_entity_id_idx" ON "trash_entries"("organization_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano (revisado): restricciones, índices parciales, Row-Level Security y permisos.
-- ===========================================================================

-- Restricciones de dominio --------------------------------------------------
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_scope_check"
  CHECK ("scope" IN ('NONE', 'OWN', 'TEAM', 'ALL'));
ALTER TABLE "roles" ADD CONSTRAINT "roles_system_key_check"
  CHECK ("system_key" IS NULL OR "system_key" IN ('ADMIN', 'SUPERVISOR', 'SALES'));
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_entity_type_check"
  CHECK ("entity_type" IN ('LEAD', 'DEAL'));
ALTER TABLE "stages" ADD CONSTRAINT "stages_kind_check"
  CHECK ("kind" IN ('OPEN', 'WON', 'LOST', 'CONVERTED'));
ALTER TABLE "stages" ADD CONSTRAINT "stages_probability_check"
  CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 100);
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_entity_type_check"
  CHECK ("entity_type" IN ('LEAD', 'DEAL'));
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_category_check"
  CHECK ("category" IN ('OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELED'));
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_status_check"
  CHECK ("status" IN ('IN_TRASH', 'RESTORED', 'PURGED'));
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_next_value_check" CHECK ("next_value" >= 1);
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));

-- Unicidad parcial ------------------------------------------------------------
-- Un solo pipeline por defecto por entidad, una sola prioridad por defecto.
CREATE UNIQUE INDEX "pipelines_one_default" ON "pipelines" ("organization_id", "entity_type") WHERE "is_default";
CREATE UNIQUE INDEX "priorities_one_default" ON "priorities" ("organization_id") WHERE "is_default";
-- Nombre de etapa único dentro del pipeline.
CREATE UNIQUE INDEX "stages_pipeline_name_key" ON "stages" ("pipeline_id", lower("name"));
-- Nombre de equipo único entre los no eliminados (uno en papelera no bloquea uno nuevo).
CREATE UNIQUE INDEX "teams_name_alive_key" ON "teams" ("organization_id", lower("name")) WHERE "deleted_at" IS NULL;
-- Un registro solo puede estar una vez "en papelera".
CREATE UNIQUE INDEX "trash_entries_in_trash_key" ON "trash_entries" ("entity_type", "entity_id") WHERE "status" = 'IN_TRASH';
CREATE INDEX "trash_entries_purge_idx" ON "trash_entries" ("purge_after") WHERE "status" = 'IN_TRASH';

-- Row-Level Security ---------------------------------------------------------
-- La aplicación fija `app.organization_id` por transacción (Db.withOrg en src/infra/db.ts).
-- Sin ese valor, current_setting devuelve '' → NULL → ninguna fila es visible ni escribible.
-- El rol dueño (migraciones/seed) no está sujeto a RLS porque no se usa FORCE: la app corre
-- con `crm_app`, que no es dueño de las tablas.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teams', 'team_members', 'roles', 'role_permissions', 'pipelines', 'stages', 'priorities',
    'lead_sources', 'loss_reasons', 'document_types', 'economic_sectors', 'task_statuses',
    'custom_field_definitions', 'sequences', 'record_history', 'audit_log', 'notifications',
    'trash_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING ("organization_id" = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)
         WITH CHECK ("organization_id" = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;

-- Permisos del rol de la aplicación ---------------------------------------------
-- Toda migración futura que cree tablas debe repetir este bloque (ver CLAUDE.md).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT USAGE ON SCHEMA public TO crm_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
    -- Historial y auditoría: solo inserción y lectura.
    REVOKE UPDATE, DELETE ON "record_history", "audit_log" FROM crm_app;
    -- La tabla de migraciones no es asunto de la aplicación.
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON "_prisma_migrations" FROM crm_app;
    END IF;
  END IF;
END $$;
