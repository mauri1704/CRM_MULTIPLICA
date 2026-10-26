# 01 — Arquitectura propuesta

> Estado: **propuesta**. Las elecciones marcadas con `[D-xx]` dependen de una decisión de
> [07 — Decisiones pendientes](07-decisiones-pendientes.md).

## 1. Visión general

```
                 ┌──────────────────────────────────────────────┐
  Navegador ───► │ Proxy existente (Caddy) — TLS, dominio [D-03] │
                 └───────────────┬───────────────────┬──────────┘
                                 │ /                 │ /api
                     ┌───────────▼─────────┐ ┌───────▼──────────────┐
                     │ web (React SPA)     │ │ api (NestJS, REST)   │
                     │ archivos estáticos  │ │ OpenAPI en /api/docs │
                     └─────────────────────┘ └───────┬──────────────┘
                                                     │ Prisma
                     ┌─────────────────────┐ ┌───────▼──────────────┐
                     │ worker (pg-boss)    ├─►│ PostgreSQL 16        │
                     │ import/export/purga │ │ BD propia del CRM    │
                     └──────────┬──────────┘ └──────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │ Volumen de archivos │  plantillas, importaciones,
                     │ (local) [D-04]      │  exportaciones, reportes de error
                     └─────────────────────┘
```

Tres procesos, una base de datos, un solo repositorio (monorepo pnpm):

| Proceso  | Responsabilidad                                                                   |
| -------- | --------------------------------------------------------------------------------- |
| `web`    | Interfaz. No contiene reglas de negocio: todo se valida y decide en `api`.        |
| `api`    | API REST, autenticación, permisos, reglas de negocio, transacciones, auditoría.   |
| `worker` | Trabajos lentos: importaciones, exportaciones grandes, purga de papelera, avisos. |

El worker **no** es un motor de automatizaciones comerciales: solo ejecuta operaciones técnicas
pedidas por un usuario (importar, exportar) o de mantenimiento de datos (purga según retención,
aviso de tarea vencida) — ver [D-16].

## 2. Stack `[D-01]`

| Capa          | Elección                                                                            | Por qué                                                           |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Lenguaje      | TypeScript strict en todo el repo                                                   | Un solo lenguaje; tipos compartidos front/back                    |
| Runtime       | Node.js 22 LTS · pnpm workspaces                                                    | Igual que el resto de apps de Multiplica                          |
| Backend       | NestJS 11 + `@nestjs/swagger`                                                       | API REST documentada (requisito), módulos, guards de permisos, DI |
| Validación    | Zod (esquemas en `packages/shared`, usados por api y web)                           | Una sola fuente de verdad para validaciones                       |
| ORM / BD      | Prisma 6 + PostgreSQL 16 (+ extensiones `pg_trgm`, `unaccent`, `citext`)            | Migraciones versionadas, transacciones; `pg_trgm` para duplicados |
| Dinero        | `decimal.js` en servidor, `numeric` en BD — nunca `float`                           | Precisión decimal exacta                                          |
| Cola          | pg-boss (sobre la misma PostgreSQL)                                                 | Sin infraestructura extra (no Redis)                              |
| Frontend      | React 19 + Vite + React Router                                                      | SPA rápida; el SEO no aplica a un CRM privado                     |
| Datos en UI   | TanStack Query · TanStack Table (tablas configurables, virtualizadas)               | Caché, reintentos, columnas/orden/filtros configurables           |
| UI            | Tailwind CSS 3 + Radix UI (primitivas accesibles) + lucide-react (íconos)           | Accesibilidad por teclado y ARIA de serie                         |
| Formularios   | react-hook-form + zod resolver                                                      | Mismos esquemas que el backend                                    |
| Drag and drop | dnd-kit                                                                             | Accesible por teclado, Kanban                                     |
| Calendario    | FullCalendar (licencia MIT, vistas mes/semana/día)                                  | Vista calendario de tareas                                        |
| Gráficos      | Recharts                                                                            | Dashboard y reportes                                              |
| Excel / CSV   | `exceljs` (XLSX, por streaming) · `csv-parse` / `csv-stringify`                     | Lectura/escritura en streaming para archivos grandes              |
| Auth          | Sesión en servidor (cookie `httpOnly`, `Secure`, `SameSite=Lax`) + argon2id         | Revocable al desactivar usuario; sin JWT en `localStorage`        |
| Logs          | pino (JSON) con redacción de campos sensibles                                       |                                                                   |
| Pruebas       | Vitest (unidad) · Vitest + Postgres real en Docker (integración) · Playwright (E2E) |                                                                   |

**Alternativa evaluada:** Next.js 15 full-stack (el stack del CRM actual de Multiplica). Ventaja:
mismo patrón que el equipo ya conoce. Desventaja: la definición pide una API REST documentada y
permisos validados en backend de forma centralizada; con Server Actions la API no queda expuesta
ni documentada. Se recomienda NestJS + React y se deja la decisión en [D-01].

## 3. Estructura del repositorio

```
apps/
  api/
    src/
      modules/<dominio>/          contacts, companies, leads, deals, products, currencies,
                                  exchange-rates, tasks, projects, users, teams, roles,
                                  settings, custom-fields, duplicates, trash, import-export,
                                  reports, dashboard, notifications, audit
        <d>.controller.ts         HTTP: rutas, DTO, @RequirePermission
        <d>.service.ts            Reglas de negocio, transacciones, historial, auditoría
        <d>.repository.ts         Único acceso a Prisma del dominio; siempre filtra organizationId
      common/                     guards (auth, permisos, alcance), filtros de error, paginación
      infra/                      prisma, cola, archivos, logger, config (env validado con Zod)
    prisma/schema.prisma · prisma/migrations/
  web/
    src/
      app/                        rutas (React Router), layout (menú lateral + barra superior)
      features/<dominio>/         páginas, formularios, hooks de datos de cada módulo
      components/ui/              Button, Input, Select, Dialog, Drawer, DataTable, Kanban, Badge…
      lib/                        cliente API generado desde OpenAPI, formato de dinero/fechas
  (worker)                        apps/api/src/worker.ts + jobs.ts: mismo código que la API, otro
                                  proceso (purga de papelera; luego import/export y avisos)
packages/
  shared/                         esquemas Zod, catálogo de permisos, utilidades de dinero,
                                  enums (tipos de entidad, prioridades, estados)
docs/                             plan, ADRs, runbooks
deploy/                           Dockerfiles, compose de producción, ejemplo de proxy
```

Regla: un dominio solo se usa desde otro a través de su `service` público, nunca leyendo sus
tablas directamente.

## 4. Seguridad

| Requisito                        | Implementación                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticación segura             | Correo + contraseña; argon2id; bloqueo temporal tras 5 intentos fallidos; recuperación por correo [D-22]                                        |
| Sesiones                         | Tabla `sessions`, cookie `httpOnly`; expiración por inactividad (8 h) y absoluta (7 d); se invalidan al desactivar usuario o cambiar contraseña |
| CSRF                             | Cookie `SameSite=Lax` + token anti-CSRF en cabecera para métodos que modifican                                                                  |
| Control de acceso                | Guard global: módulo + acción + alcance (propio / equipo / todos) — ver [D-08]                                                                  |
| Aislamiento entre organizaciones | `organizationId` en todas las tablas de negocio + Row-Level Security en PostgreSQL [D-02]                                                       |
| Validación de entradas           | Zod en cada endpoint; límites de tamaño; archivos validados por tipo real y tamaño                                                              |
| Auditoría                        | `audit_log` (accesos, permisos, fusiones, restauraciones, borrado definitivo, tipos de cambio, exportaciones)                                   |
| Protección de datos              | Logs sin contraseñas, tokens ni datos personales completos; exportaciones registradas en auditoría                                              |
| Cabeceras                        | CSP estricta, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`                                                                                  |
| Límite de peticiones             | Rate limit en login, recuperación de contraseña e importación                                                                                   |
| Respaldo y recuperación          | `pg_dump` diario + retención 30 días + prueba de restauración mensual (runbook) [D-18]                                                          |

## 5. Transacciones (operaciones críticas)

Se ejecutan en una sola transacción de base de datos (`prisma.$transaction`), con bloqueo de fila
cuando hay riesgo de concurrencia:

- Conversión de prospecto a negociación (crea negociación + productos + historial; bloquea el
  prospecto con `SELECT … FOR UPDATE` y una restricción `UNIQUE(source_lead_id)` impide duplicarla).
- Alta/edición de productos de una negociación y recálculo de totales.
- Fusión de duplicados (mueve relaciones, guarda historial de fusión, envía el absorbido a papelera).
- Restauración desde papelera y eliminación definitiva.
- Confirmación de una importación (por lotes; cada lote es atómico, el resumen indica lotes fallidos).
- Cambio de etapa en Kanban (actualiza etapa + orden + historial).
- Generación de códigos correlativos (`PRO-000001`, …) con contador por organización.

Control de concurrencia en edición: cada registro tiene `version`; una edición con versión vieja
devuelve 409 y la UI ofrece recargar sin perder lo escrito.

## 6. API

- REST bajo `/api/v1`, JSON, documentada con OpenAPI (Swagger UI en `/api/docs`, solo autenticado).
- Convenciones: `GET /leads?filter…&sort=…&page=…`, `POST /leads`, `PATCH /leads/:id`,
  `DELETE /leads/:id` (envía a papelera), acciones como `POST /leads/:id/convert`.
- Errores con formato único `{ code, message, details? }` y mensajes en español comprensibles.
- Paginación por cursor en listas grandes; límite máximo por página.

## 7. Despliegue `[D-03]`

- Imágenes Docker: `api`, `worker` y `web` (estáticos servidos por el proxy o por un nginx mínimo).
- PostgreSQL propia del CRM: base de datos y usuario separados de las otras apps del servidor.
- Las migraciones se aplican en un paso explícito del despliegue (`prisma migrate deploy`), nunca al
  arrancar la app.
- CI (GitHub Actions): formato, lint, typecheck, pruebas unitarias, integración con Postgres,
  build, E2E en los flujos críticos.
- Variables de entorno validadas al arrancar; `.env.example` versionado.
