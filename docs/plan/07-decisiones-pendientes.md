# 07 — Decisiones pendientes de aprobación

La definición funcional pide **no asumir como aprobadas** las decisiones que afecten reglas
comerciales, permisos, monedas o conservación de datos. Cada decisión tiene una **propuesta**;
marque *Aprobada*, *Cambiar a…* o *Duda*. La implementación empieza cuando las marcadas como
**Bloqueante para Fase 0/1** estén resueltas; el resto puede resolverse antes de su fase.

| Estado | Significado |
| ------ | ----------- |
| ⏳ | Pendiente |
| ✅ | Aprobada |
| ✏️ | Aprobada con cambios (anotar) |

## Arquitectura e infraestructura

| ID | Decisión | Propuesta | Bloquea | Estado |
| -- | -------- | --------- | ------- | ------ |
| D-01 | Stack | NestJS (API REST + OpenAPI) + React/Vite + Prisma + PostgreSQL 16, monorepo pnpm. Alternativa: Next.js 15 como el CRM actual | Fase 0 | ⏳ |
| D-02 | ¿Una organización o varias (SaaS multiempresa)? | Diseñar multiempresa desde el inicio (`organization_id` + RLS en todas las tablas) pero lanzar con una sola organización; la creación de organizaciones queda para una etapa posterior | Fase 0 | ⏳ |
| D-03 | Dónde se despliega | Mismo servidor que el CRM y el Data Connector, detrás del proxy existente, con BD/usuario/red propios. Falta: dominio o subdominio y si habrá entorno de pruebas | Fase 6 | ⏳ |
| D-04 | Almacenamiento de archivos (importaciones, exportaciones, reportes de error) | Volumen local del servidor; exportaciones se borran a los 7 días | Fase 2 | ⏳ |
| D-18 | Respaldo y recuperación | `pg_dump` diario, retención 30 días, copia fuera del servidor, restauración probada mensualmente. ¿Quién la opera? | Fase 6 | ⏳ |
| D-21 | Idioma, zona y formatos | Solo español; `America/Lima`; fecha `dd/mm/aaaa`; números `1,234.56` | Fase 1 | ⏳ |
| D-22 | Autenticación | Correo + contraseña (mín. 10 caracteres). ¿Se requiere doble factor (2FA)? ¿Qué SMTP se usa para recuperar contraseña? | Fase 1 | ⏳ |

## Monedas y dinero

| ID | Decisión | Propuesta | Bloquea | Estado |
| -- | -------- | --------- | ------- | ------ |
| D-24 | Redondeo | Mitad hacia arriba, por línea, a los decimales de la moneda; total = suma de líneas redondeadas | Fase 3 | ⏳ |
| D-25 | Descuentos | Por línea, como importe o porcentaje; tope = descuento máximo del producto; Supervisor/Administrador pueden excederlo. ¿Habrá también descuento global de la negociación? (propuesta: no) | Fase 3 | ⏳ |
| D-05 | Selección de tasa | Tasa del día; si no hay, la más reciente anterior hasta 3 días; si no hay, pedir registro o tasa autorizada con motivo. ¿Se permite usar la inversa (1/tasa) cuando falta el par? (propuesta: sí, configurable) | Fase 2 | ⏳ |
| D-13 | Edición de tasas pasadas | Solo Administrador; cualquier fecha; con motivo obligatorio e historial. No altera importes ya guardados | Fase 2 | ⏳ |
| D-06 | ¿Cuándo se congelan importes y tasas de una negociación? | Al guardarse cada línea; mientras esté abierta se pueden recalcular con "Actualizar tasas" (explícito); al ganar/perder quedan congelados | Fase 3 | ⏳ |
| D-14 | Consolidación multimoneda en dashboard y reportes | Tasa de la fecha de corte del reporte (elegible), moneda principal por defecto; importes sin tasa se excluyen y se informa | Fase 6 | ⏳ |
| D-20 | Precio de productos de interés en prospectos | Se copia el precio del catálogo al agregar la línea y no cambia después; en la conversión se transfiere tal cual | Fase 3 | ⏳ |

## Reglas comerciales

| ID | Decisión | Propuesta | Bloquea | Estado |
| -- | -------- | --------- | ------- | ------ |
| D-07 | Prospecto tras la conversión | Pasa a etapa "Convertido", queda de solo lectura (salvo comentarios y tareas); una sola conversión por prospecto. ¿Se permite convertir parcialmente o crear varias negociaciones desde un prospecto? (propuesta: no) | Fase 3 | ⏳ |
| D-17 | Motivo de pérdida | Catálogo configurable obligatorio + nota libre opcional | Fase 3 | ⏳ |
| D-19 | Ganado / perdido | Lo determina el tipo de etapa (`WON`/`LOST`), no un campo aparte; reabrir requiere permiso | Fase 3 | ⏳ |
| D-11 | Códigos | Correlativo por organización con prefijo: `PRO-000001`, `NEG-`, `CON-`, `CIA-`, `TAR-`, `PRY-`; no se reutilizan | Fase 1 | ⏳ |
| D-12 | Tipos de campo personalizado | Texto, texto largo, número, moneda, fecha, sí/no, lista, lista múltiple, usuario, URL, correo, teléfono; máximo 50 por módulo | Fase 1 | ⏳ |
| D-23 | "Actividades" | Registro manual de interacciones (llamada, reunión, correo, nota) en la línea de tiempo del registro, distinto de las tareas | Fase 4 | ⏳ |
| D-26 | Tarea ↔ CRM | Una tarea se asocia a **un** elemento CRM como máximo (la definición dice "elemento CRM asociado" en singular) | Fase 4 | ⏳ |

## Permisos y conservación de datos

| ID | Decisión | Propuesta | Bloquea | Estado |
| -- | -------- | --------- | ------- | ------ |
| D-08 | Matriz de permisos inicial | Ver tabla en [04 §7](04-reglas-negocio.md#7-permisos-d-08): Comercial ve lo propio, Supervisor lo de su equipo, Administrador todo; contactos y compañías visibles para todos | Fase 1 | ⏳ |
| D-09 | Papelera | Retención 90 días; purga automática solo de lo que no tenga dependencias; eliminación definitiva solo Administrador; historial y auditoría se conservan siempre | Fase 1 | ⏳ |
| D-10 | Fusión de duplicados | Supervisor y Administrador; el absorbido va a papelera (recuperable) con instantánea completa; no se deshace automáticamente una fusión | Fase 5 | ⏳ |
| D-15 | Coincidencia aproximada | `pg_trgm`, umbral 0,85 configurable por regla; al guardar solo avisa, no bloquea (configurable a "bloquear") | Fase 5 | ⏳ |
| D-16 | Procesos en segundo plano | Permitidos solo: importación/exportación, purga de papelera por retención, aviso diario de tareas vencidas. Confirmar que no se consideran "automatizaciones comerciales" | Fase 1 | ⏳ |
| D-27 | Datos personales (Ley 29733) | Exportaciones auditadas; Comercial no exporta fuera de su alcance; ¿se necesita anonimizar/eliminar datos de un contacto a pedido del titular? | Fase 6 | ⏳ |

## Preguntas abiertas adicionales

1. ¿Cuántos usuarios y registros se esperan al inicio y en un año? (dimensiona servidor e índices)
2. ¿Hay datos a migrar desde otro sistema (Bitrix24, Excel)? Si es así, ¿cuál y cuántos?
3. ¿Pipelines y etapas iniciales concretos para prospectos y negociaciones?
4. ¿Relación con el CRM actual de Multiplica (`MultiplicaTusVentasOrg/crm`)? ¿Lo reemplaza, convive o es otro producto?
