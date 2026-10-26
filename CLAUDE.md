# CLAUDE.md — CRM Web Comercial (Multiplica)

Instrucciones para cualquier persona o asistente de IA que escriba código en este repo. Léalo antes
de generar código. Diseño completo y decisiones aprobadas: `docs/plan/` (01 a 07).

## Stack (versiones fijas — no actualizar sin un PR dedicado)

Monorepo **pnpm** (nunca npm ni yarn) · Node 22 · TypeScript strict.

- `apps/api` — NestJS 11 (REST, OpenAPI en `/api/docs`) · Prisma 6 · PostgreSQL 16 · pg-boss.
  El worker (`src/worker.ts`) vive en la misma app y reutiliza sus servicios.
- `apps/web` — React 19 · Vite 7 · React Router 7 · TanStack Query/Table · Tailwind 3 · Radix UI.
- `packages/shared` — esquemas Zod, catálogo de permisos, tipos y utilidades usados por api y web.

No agregues dependencias sin justificarlo en el PR; busca antes en `components/ui`, `lib`, `shared`.

## Dónde va cada cosa

```
apps/api/src/modules/<dominio>/   <d>.controller.ts (HTTP + permisos) · <d>.service.ts (reglas,
                                  historial, auditoría) — un dominio usa otro solo vía su service
apps/api/src/common/              guard de sesión/permisos/CSRF, interceptor de organización, errores, Zod
apps/api/src/infra/               db (Prisma + RLS), env, correo
apps/api/prisma/                  schema.prisma + migraciones versionadas
apps/web/src/features/<dominio>/  páginas y formularios
apps/web/src/components/ui/       Button, Input, Field, Dialog/Drawer, DataTable… reutilízalos
packages/shared/src/schemas/      validaciones compartidas (la API y los formularios usan las mismas)
```

## Reglas de datos y organización (no negociables)

1. **`organizationId` sale siempre de la sesión** (`@CurrentUser()`), nunca del body, la URL ni la query.
2. Toda petición autenticada corre dentro de `db.withOrg()` (TenantInterceptor): una transacción con
   Row-Level Security. Usa `this.db.tx` en los repositorios/servicios. Filtra además por
   `organizationId` en el `where` (doble barrera). Edita/borra con `{ id, organizationId }`.
3. **Toda tabla nueva con `organization_id`** lleva en su migración: índices que empiezan por
   `organization_id`, la política RLS `org_isolation` (copia el bloque de la migración `init`) y el
   bloque de permisos para `crm_app`. Súmala a la lista de `tenant-isolation.test.ts`.
4. Eliminación de datos de negocio = **lógica** (`deleted_at`) + `TrashService.add()` en la misma
   transacción. El módulo implementa `TrashHandler` (conflictos al restaurar, bloqueos de purga).
5. Toda acción que cambie datos deja `HistoryService.record()`; las sensibles, además,
   `AuditService.log()` (añade el evento a `AUDIT_EVENTS` en shared).
6. Dinero: `numeric` en BD y decimal exacto en el servidor; nunca `float`. Nunca sumar monedas distintas.
7. Migraciones: `pnpm db:migrate --create-only --name x` → revisar el SQL → añadir RLS/permisos →
   aplicar. Prohibido `prisma db push`, editar migraciones ya mergeadas, `DROP`/`TRUNCATE` de tablas
   con datos o renombrar columnas en un paso.

## Endpoints

- Declara el permiso: `@RequirePermission('modulo', 'accion')`. El alcance (propios/equipo/todos)
  lo aplica el service. La UI oculta lo no permitido, pero **la API valida siempre**.
- Valida con `@ZodBody(schema)` / `@ZodQuery(schema)` usando esquemas de `@crm/shared`.
- Errores con `AppError` (`notFound`, `conflict`, `validationError`…), mensajes en español y
  comprensibles para un usuario comercial.
- Peticiones que modifican exigen la cabecera `X-CRM-Request: 1` (anti-CSRF); el cliente web la envía.

## Interfaz

- Español, terminología consistente: Crear, Guardar, Enviar a papelera, Restaurar, Eliminar
  definitivamente.
- Estados y prioridades: siempre texto + ícono + color, nunca solo color. Accesible por teclado,
  etiquetas en todos los controles (`Field`), confirmación (`ConfirmDialog`) en acciones importantes.
- Formularios: react-hook-form + zodResolver con los esquemas compartidos; errores del servidor con
  `applyServerErrors`.

## Fuera de alcance

WhatsApp, SUNAT, facturación electrónica y motores de automatizaciones comerciales. El worker solo
ejecuta procesos técnicos aprobados (importar/exportar, purga por retención, avisos de vencimiento).

## Antes de abrir un PR

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
pnpm -F @crm/web test:e2e   # con api y seed de desarrollo
```

## Puesta en marcha local

```bash
corepack enable && pnpm install
cp .env.example apps/api/.env          # ajustar si hace falta
docker compose up -d db                 # Postgres en 5435 (crea también crm_test)
pnpm db:setup && pnpm db:deploy && pnpm db:seed
pnpm dev                                # web http://localhost:5173 · API http://localhost:3001/api/docs
pnpm worker:dev                         # solo si tocas trabajos en segundo plano
```

Usuarios demo: `admin@multiplica.test / Admin12345` · `supervisor@multiplica.test / Super12345` ·
`comercial@multiplica.test / Venta12345`.
