-- DropIndex
DROP INDEX "companies_code_key";

-- DropIndex
DROP INDEX "companies_custom_fields_idx";

-- DropIndex
DROP INDEX "companies_search_trgm";

-- DropIndex
DROP INDEX "contacts_code_key";

-- DropIndex
DROP INDEX "contacts_custom_fields_idx";

-- DropIndex
DROP INDEX "contacts_search_trgm";

-- DropIndex
DROP INDEX "products_custom_fields_idx";

-- DropIndex
DROP INDEX "products_name_trgm";

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "contact_id" UUID,
    "company_id" UUID,
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "email_norm" VARCHAR(254),
    "source_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "stage_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stage_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID,
    "priority_id" UUID,
    "currency_code" CHAR(3) NOT NULL,
    "estimated_value" DECIMAL(20,4),
    "subtotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "loss_reason_id" UUID,
    "loss_note" VARCHAR(1000),
    "converted_at" TIMESTAMPTZ(3),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "search_norm" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "source_lead_id" UUID,
    "company_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "stage_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stage_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID,
    "priority_id" UUID,
    "currency_code" CHAR(3) NOT NULL,
    "estimated_value" DECIMAL(20,4),
    "subtotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "final_value" DECIMAL(20,4),
    "probability" INTEGER,
    "expected_close_date" DATE,
    "status" VARCHAR(6) NOT NULL DEFAULT 'OPEN',
    "closed_at" DATE,
    "loss_reason_id" UUID,
    "loss_note" VARCHAR(1000),
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "search_norm" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_contacts" (
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_contacts_pkey" PRIMARY KEY ("deal_id","contact_id")
);

-- CreateTable
CREATE TABLE "lead_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sku" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "discount_type" VARCHAR(8) NOT NULL DEFAULT 'PERCENT',
    "discount_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "exchange_rate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "exchange_rate_date" DATE,
    "exchange_rate_id" UUID,
    "rate_source" VARCHAR(8) NOT NULL DEFAULT 'NONE',
    "rate_reason" VARCHAR(300),
    "line_subtotal" DECIMAL(20,4) NOT NULL,
    "line_discount" DECIMAL(20,4) NOT NULL,
    "line_total" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_lead_product_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sku" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "discount_type" VARCHAR(8) NOT NULL DEFAULT 'PERCENT',
    "discount_value" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "exchange_rate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "exchange_rate_date" DATE,
    "exchange_rate_id" UUID,
    "rate_source" VARCHAR(8) NOT NULL DEFAULT 'NONE',
    "rate_reason" VARCHAR(300),
    "line_subtotal" DECIMAL(20,4) NOT NULL,
    "line_discount" DECIMAL(20,4) NOT NULL,
    "line_total" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID,
    "deal_id" UUID,
    "contact_id" UUID,
    "company_id" UUID,
    "body" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "mentions" UUID[] DEFAULT ARRAY[]::UUID[],
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_organization_id_pipeline_id_stage_id_stage_position_idx" ON "leads"("organization_id", "pipeline_id", "stage_id", "stage_position");

-- CreateIndex
CREATE INDEX "leads_organization_id_deleted_at_created_at_idx" ON "leads"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "leads_organization_id_owner_id_idx" ON "leads"("organization_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_source_lead_id_key" ON "deals"("source_lead_id");

-- CreateIndex
CREATE INDEX "deals_organization_id_pipeline_id_stage_id_stage_position_idx" ON "deals"("organization_id", "pipeline_id", "stage_id", "stage_position");

-- CreateIndex
CREATE INDEX "deals_organization_id_deleted_at_created_at_idx" ON "deals"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "deals_organization_id_owner_id_idx" ON "deals"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "deals_organization_id_status_closed_at_idx" ON "deals"("organization_id", "status", "closed_at");

-- CreateIndex
CREATE INDEX "deal_contacts_organization_id_contact_id_idx" ON "deal_contacts"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "lead_products_organization_id_lead_id_position_idx" ON "lead_products"("organization_id", "lead_id", "position");

-- CreateIndex
CREATE INDEX "lead_products_organization_id_product_id_idx" ON "lead_products"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "deal_products_organization_id_deal_id_position_idx" ON "deal_products"("organization_id", "deal_id", "position");

-- CreateIndex
CREATE INDEX "deal_products_organization_id_product_id_idx" ON "deal_products"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "comments_organization_id_lead_id_created_at_idx" ON "comments"("organization_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_organization_id_deal_id_created_at_idx" ON "comments"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_organization_id_contact_id_created_at_idx" ON "comments"("organization_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_organization_id_company_id_created_at_idx" ON "comments"("organization_id", "company_id", "created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_currency_code_fkey" FOREIGN KEY ("organization_id", "currency_code") REFERENCES "currencies"("organization_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_source_lead_id_fkey" FOREIGN KEY ("source_lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_currency_code_fkey" FOREIGN KEY ("organization_id", "currency_code") REFERENCES "currencies"("organization_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano (revisado): restricciones, índices, RLS y permisos.
-- ===========================================================================

ALTER TABLE "deals" ADD CONSTRAINT "deals_status_check" CHECK ("status" IN ('OPEN', 'WON', 'LOST'));
ALTER TABLE "deals" ADD CONSTRAINT "deals_probability_check" CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 100);
ALTER TABLE "leads" ADD CONSTRAINT "leads_amounts_check" CHECK ("estimated_value" IS NULL OR "estimated_value" >= 0);
ALTER TABLE "deals" ADD CONSTRAINT "deals_amounts_check" CHECK (("estimated_value" IS NULL OR "estimated_value" >= 0) AND ("final_value" IS NULL OR "final_value" >= 0));
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_values_check" CHECK (
  "quantity" > 0 AND "unit_price" >= 0 AND "discount_value" >= 0 AND "exchange_rate" > 0
  AND "discount_type" IN ('AMOUNT', 'PERCENT') AND "rate_source" IN ('NONE', 'MASTER', 'INVERSE', 'MANUAL')
  AND "line_discount" <= "line_subtotal");
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_values_check" CHECK (
  "quantity" > 0 AND "unit_price" >= 0 AND "discount_value" >= 0 AND "exchange_rate" > 0
  AND "discount_type" IN ('AMOUNT', 'PERCENT') AND "rate_source" IN ('NONE', 'MASTER', 'INVERSE', 'MANUAL')
  AND "line_discount" <= "line_subtotal");
-- Un comentario pertenece exactamente a un registro.
ALTER TABLE "comments" ADD CONSTRAINT "comments_target_check" CHECK (num_nonnulls("lead_id", "deal_id", "contact_id", "company_id") = 1);

CREATE UNIQUE INDEX "leads_code_key" ON "leads" ("organization_id", "code");
CREATE UNIQUE INDEX "deals_code_key" ON "deals" ("organization_id", "code");
-- Una sola persona de contacto principal por negociación.
CREATE UNIQUE INDEX "deal_contacts_one_primary" ON "deal_contacts" ("deal_id") WHERE "is_primary";
CREATE INDEX "leads_search_trgm" ON "leads" USING gin ("search_norm" gin_trgm_ops);
CREATE INDEX "deals_search_trgm" ON "deals" USING gin ("search_norm" gin_trgm_ops);
CREATE INDEX "leads_custom_fields_idx" ON "leads" USING gin ("custom_fields");
CREATE INDEX "deals_custom_fields_idx" ON "deals" USING gin ("custom_fields");

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'deals', 'deal_contacts', 'lead_products', 'deal_products', 'comments'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "leads", "deals", "deal_contacts", "lead_products", "deal_products", "comments" TO crm_app;
  END IF;
END $$;
