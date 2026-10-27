-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "symbol" VARCHAR(5) NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "symbol_position" VARCHAR(6) NOT NULL DEFAULT 'BEFORE',
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rate_date" DATE NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "exchange_rate_id" UUID NOT NULL,
    "old_rate" DECIMAL(20,10),
    "new_rate" DECIMAL(20,10),
    "old_status" VARCHAR(10),
    "new_status" VARCHAR(10),
    "reason" VARCHAR(300) NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "sku_norm" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_norm" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "price" DECIMAL(20,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "max_discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "tax_id_type_id" UUID,
    "tax_id" VARCHAR(20),
    "tax_id_norm" VARCHAR(20),
    "sector_id" UUID,
    "address" VARCHAR(300),
    "city" VARCHAR(100),
    "country" CHAR(2) NOT NULL DEFAULT 'PE',
    "email" VARCHAR(254),
    "email_norm" VARCHAR(254),
    "phone" VARCHAR(30),
    "phone_norm" VARCHAR(30),
    "website" VARCHAR(200),
    "owner_id" UUID,
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

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "document_type_id" UUID,
    "document_number" VARCHAR(30),
    "document_norm" VARCHAR(30),
    "phone" VARCHAR(30),
    "phone_norm" VARCHAR(30),
    "email" VARCHAR(254),
    "email_norm" VARCHAR(254),
    "job_title" VARCHAR(100),
    "company_id" UUID,
    "owner_id" UUID,
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

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_companies" (
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_title" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_companies_pkey" PRIMARY KEY ("contact_id","company_id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "format" VARCHAR(5) NOT NULL,
    "file_path" VARCHAR(300) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'UPLOADED',
    "headers" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "duplicate_mode" VARCHAR(10) NOT NULL DEFAULT 'SKIP',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_organization_id_code_key" ON "currencies"("organization_id", "code");

-- CreateIndex
CREATE INDEX "exchange_rates_organization_id_from_currency_to_currency_ra_idx" ON "exchange_rates"("organization_id", "from_currency", "to_currency", "rate_date" DESC);

-- CreateIndex
CREATE INDEX "exchange_rates_organization_id_rate_date_idx" ON "exchange_rates"("organization_id", "rate_date");

-- CreateIndex
CREATE INDEX "exchange_rate_history_organization_id_exchange_rate_id_crea_idx" ON "exchange_rate_history"("organization_id", "exchange_rate_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_name_key" ON "product_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "products_organization_id_deleted_at_name_idx" ON "products"("organization_id", "deleted_at", "name");

-- CreateIndex
CREATE INDEX "companies_organization_id_deleted_at_legal_name_idx" ON "companies"("organization_id", "deleted_at", "legal_name");

-- CreateIndex
CREATE INDEX "companies_organization_id_owner_id_idx" ON "companies"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_deleted_at_first_name_idx" ON "contacts"("organization_id", "deleted_at", "first_name");

-- CreateIndex
CREATE INDEX "contacts_organization_id_owner_id_idx" ON "contacts"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_company_id_idx" ON "contacts"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "contact_companies_organization_id_company_id_idx" ON "contact_companies"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "import_jobs_organization_id_created_at_idx" ON "import_jobs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_from_currency_fkey" FOREIGN KEY ("organization_id", "from_currency") REFERENCES "currencies"("organization_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_to_currency_fkey" FOREIGN KEY ("organization_id", "to_currency") REFERENCES "currencies"("organization_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_history" ADD CONSTRAINT "exchange_rate_history_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_currency_code_fkey" FOREIGN KEY ("organization_id", "currency_code") REFERENCES "currencies"("organization_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tax_id_type_id_fkey" FOREIGN KEY ("tax_id_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "economic_sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano (revisado): restricciones, índices de búsqueda, RLS y permisos.
-- ===========================================================================

-- Búsqueda por similitud (búsqueda global y, en la Fase 5, duplicados aproximados).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Restricciones de dominio --------------------------------------------------
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_code_check" CHECK ("code" ~ '^[A-Z]{3}$');
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_decimals_check" CHECK ("decimals" BETWEEN 0 AND 4);
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_symbol_position_check" CHECK ("symbol_position" IN ('BEFORE', 'AFTER'));
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" > 0);
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_pair_check" CHECK ("from_currency" <> "to_currency");
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_source_check" CHECK ("source" IN ('MANUAL', 'IMPORT'));
ALTER TABLE "products" ADD CONSTRAINT "products_price_check" CHECK ("price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_discount_check" CHECK ("max_discount_pct" BETWEEN 0 AND 100);
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("status" IN ('UPLOADED', 'COMPLETED', 'FAILED'));

-- Unicidad parcial ------------------------------------------------------------
-- Una sola moneda principal por organización.
CREATE UNIQUE INDEX "currencies_one_base" ON "currencies" ("organization_id") WHERE "is_base";
-- Un solo tipo de cambio ACTIVO por fecha y par de monedas (D-05).
CREATE UNIQUE INDEX "exchange_rates_active_key" ON "exchange_rates" ("organization_id", "rate_date", "from_currency", "to_currency") WHERE "status" = 'ACTIVE';
-- SKU y RUC únicos entre registros vigentes (uno en papelera no bloquea; al restaurar se detecta).
CREATE UNIQUE INDEX "products_sku_alive_key" ON "products" ("organization_id", "sku_norm") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "companies_tax_id_alive_key" ON "companies" ("organization_id", "tax_id_norm") WHERE "deleted_at" IS NULL AND "tax_id_norm" IS NOT NULL;
-- Códigos correlativos únicos (no se reutilizan).
CREATE UNIQUE INDEX "companies_code_key" ON "companies" ("organization_id", "code");
CREATE UNIQUE INDEX "contacts_code_key" ON "contacts" ("organization_id", "code");

-- Búsqueda -------------------------------------------------------------------
CREATE INDEX "companies_search_trgm" ON "companies" USING gin ("search_norm" gin_trgm_ops);
CREATE INDEX "contacts_search_trgm" ON "contacts" USING gin ("search_norm" gin_trgm_ops);
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name_norm" gin_trgm_ops);
CREATE INDEX "contacts_email_norm_idx" ON "contacts" ("organization_id", "email_norm") WHERE "deleted_at" IS NULL;
CREATE INDEX "contacts_document_norm_idx" ON "contacts" ("organization_id", "document_norm") WHERE "deleted_at" IS NULL;
CREATE INDEX "contacts_custom_fields_idx" ON "contacts" USING gin ("custom_fields");
CREATE INDEX "companies_custom_fields_idx" ON "companies" USING gin ("custom_fields");
CREATE INDEX "products_custom_fields_idx" ON "products" USING gin ("custom_fields");

-- Row-Level Security (mismo bloque que la migración init) ---------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'currencies', 'exchange_rates', 'exchange_rate_history', 'product_categories', 'products',
    'companies', 'contacts', 'contact_companies', 'import_jobs'
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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "currencies", "exchange_rates", "product_categories", "products", "companies", "contacts",
      "contact_companies", "import_jobs"
      TO crm_app;
    -- Historial de tipos de cambio: solo inserción y lectura.
    GRANT SELECT, INSERT ON "exchange_rate_history" TO crm_app;
  END IF;
END $$;

-- Datos: monedas iniciales (PEN principal, USD) para las organizaciones ya existentes.
INSERT INTO "currencies" ("id", "organization_id", "code", "name", "symbol", "decimals", "is_base", "updated_at")
SELECT gen_random_uuid(), o."id", c.code, c.name, c.symbol, 2, c.code = o."base_currency_code", now()
FROM "organizations" o
CROSS JOIN (VALUES ('PEN', 'Sol peruano', 'S/'), ('USD', 'Dólar estadounidense', 'US$')) AS c(code, name, symbol)
ON CONFLICT ("organization_id", "code") DO NOTHING;
