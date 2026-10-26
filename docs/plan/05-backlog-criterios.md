# 05 — Backlog funcional y criterios de aceptación

Convención: **Una funcionalidad no está terminada si solo tiene interfaz.** Toda historia se da por
hecha cuando persiste en base de datos, valida en backend, respeta permisos, deja historial y
tiene pruebas automáticas.

## Fase 1 — Base del sistema

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| B-01 | Iniciar y cerrar sesión | Contraseña con argon2id; 5 fallos → bloqueo 15 min; usuario inactivo no entra; cerrar sesión revoca la sesión en servidor |
| B-02 | Recuperar contraseña | Enlace de un solo uso, expira en 1 h; misma respuesta exista o no el correo |
| B-03 | Administrar usuarios | Crear, editar, desactivar (sus sesiones se cierran); no se puede desactivar al último administrador |
| B-04 | Equipos | Crear equipos, supervisor, miembros; un usuario en varios equipos |
| B-05 | Roles y permisos | Matriz módulo × acción × alcance; cada endpoint la verifica (prueba: Comercial recibe 403 al leer prospecto ajeno por URL directa) |
| B-06 | Configuración general | Organización, zona horaria, moneda principal, parámetros; cambios auditados |
| B-07 | Catálogos | Prioridades, orígenes, motivos de pérdida, tipos de documento, sectores; en uso → solo desactivar |
| B-08 | Pipelines y etapas | Crear, ordenar, desactivar; tipo de etapa obligatorio; no se borra una etapa con registros |
| B-09 | Campos personalizados | Definir por módulo; se validan en backend según tipo; aparecen en formularios, listas, filtros, import/export |
| B-10 | Papelera base | Eliminación lógica genérica + `trash_entries`; registros eliminados fuera de toda consulta normal |
| B-11 | Layout y navegación | Menú lateral, barra superior, búsqueda global, tema claro/oscuro, responsive |
| B-12 | Historial y auditoría | Toda creación/edición registra diferencias por campo; eventos sensibles en `audit_log` |

## Fase 2 — Entidades principales

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| E-01 | Contactos | CRUD, lista configurable, filtros, ficha con prospectos/negociaciones/compañías/tareas relacionadas; documento validado según tipo |
| E-02 | Compañías | CRUD, RUC de 11 dígitos con dígito verificador cuando el tipo es RUC; ficha con contactos, prospectos, negociaciones, tareas |
| E-03 | Productos | CRUD, SKU único entre vivos, activar/desactivar (inactivo no se ofrece en nuevas líneas pero sigue en las existentes) |
| E-04 | Monedas | Alta con ISO, símbolo, decimales; exactamente una principal; desactivar solo si no hay tasa activa futura en uso |
| E-05 | Tipos de cambio | Registro diario; tasa > 0; segunda tasa activa para misma fecha y par → rechazada con mensaje; edición con historial (quién, cuándo, antes, después); filtros por fecha y moneda |
| E-06 | Exportación base | XLSX y CSV (UTF-8 con BOM, separador configurable); todos o filtrados; columnas elegidas; fechas y montos con formato correcto |
| E-07 | Importación base | Plantilla descargable, mapeo, vista previa, validación por fila, resumen válidos/inválidos, confirmación, reporte de errores descargable; nada inválido entra en silencio |

## Fase 3 — Gestión comercial

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| C-01 | Prospectos CRUD | Campos iniciales completos; sin "fecha de próxima actividad"; código correlativo |
| C-02 | Kanban de prospectos | Columnas por etapa del pipeline elegido; arrastrar guarda etapa y orden; tras recargar la tarjeta sigue donde se dejó; rechazo del servidor revierte con mensaje |
| C-03 | Prioridad visual | Distintivo con ícono + texto + color en tarjeta y lista; filtrable; persiste |
| C-04 | Productos de interés | Agregar productos con cantidad, precio, descuento, moneda; tasa registrada si difiere |
| C-05 | Conversión | Resumen previo; transacción; doble clic simultáneo crea **una** negociación; todos los productos transferidos con mismos valores; prospecto conservado y enlazado |
| C-06 | Negociaciones CRUD + Kanban | Igual que prospectos + valor final, probabilidad, fecha estimada de cierre, ganado/perdido con motivo |
| C-07 | Productos de negociación y cálculos | Subtotal, descuento y total según reglas; mezcla de monedas convertida con tasa registrada; sin tasa → no se guarda la línea y se pide tasa |
| C-08 | Conservación histórica | Cambiar precio de catálogo o tasa del maestro no altera negociaciones existentes (prueba automática) |
| C-09 | Comentarios y vistas guardadas | Comentarios con menciones; vistas lista/kanban guardadas por usuario |

## Fase 4 — Gestión operativa

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| T-01 | Tareas CRUD | Responsable, participantes, observadores, fechas (vencimiento ≥ inicio), prioridad, estado |
| T-02 | Roles en la tarea | Observador ve y comenta pero no edita; participante edita estado y comenta; permisos verificados en backend |
| T-03 | Asociación CRM | Una tarea ↔ un contacto/compañía/prospecto/negociación; aparece en la ficha del elemento |
| T-04 | Proyectos básicos | Catálogo con código, nombre, descripción, responsable, estado, fechas; tareas filtrables por proyecto |
| T-05 | Vistas | Kanban por estado, lista, calendario (mes/semana/día, arrastrar cambia fechas) |
| T-06 | Estados configurables | Estados adicionales con categoría; completar registra `completed_at` |
| T-07 | Notificaciones | Asignación, mención, vencimiento; contador en barra superior; marcar como leída |

## Fase 5 — Calidad de datos

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| Q-01 | Reglas de duplicados | Por módulo, campos base/personalizados, combinados, modo exacto/normalizado/aproximado, activar/desactivar |
| Q-02 | Detección | Bajo demanda, al guardar (aviso) y al importar; lista de coincidencias con puntaje |
| Q-03 | Comparación y revisión | Lado a lado con diferencias resaltadas; conservar ambos; marcar revisado (no vuelve a aparecer el mismo par) |
| Q-04 | Fusión segura | Vista previa de valores y relaciones; transacción; relaciones movidas; absorbido a papelera; `merge_history` con instantánea; auditoría |
| Q-05 | Importación avanzada | Duplicados: omitir o actualizar (con permiso y clave inequívoca); relaciones por código/RUC/correo; lotes atómicos |
| Q-06 | Papelera completa | Filtro por módulo, búsqueda, detalle, restaurar (simple/múltiple) con detección de conflictos, eliminación definitiva con permiso, retención configurable |

## Fase 6 — Analítica y cierre

| ID   | Historia | Criterios de aceptación |
| ---- | -------- | ----------------------- |
| A-01 | Dashboard | Todos los indicadores de la definición; filtros fecha/pipeline/equipo/responsable/moneda; datos reales; indica criterio de conversión |
| A-02 | Reportes | Los 13 reportes listados; filtros; exportación XLSX/CSV; respetan alcance del usuario |
| A-03 | Pruebas integrales | E2E de los flujos críticos; pruebas de concurrencia (conversión, Kanban, fusión) |
| A-04 | Documentación | Manual de usuario, runbook de despliegue y respaldo, OpenAPI publicada |
| A-05 | Preparación de despliegue | Imágenes, migraciones, variables, monitoreo básico, restauración de respaldo probada |

## Matriz de pruebas (sección 20 de la definición)

| Área | Unidad | Integración (BD real) | E2E |
| ---- | :----: | :-------------------: | :-: |
| Autenticación y permisos (incl. acceso por URL directa a registro ajeno) | ✓ | ✓ | ✓ |
| Aislamiento entre organizaciones (A no ve/edita/borra lo de B) | | ✓ | |
| CRUD de cada módulo | | ✓ | ✓ |
| Kanban: persistencia de etapa, orden y prioridad | | ✓ | ✓ |
| Conversión + transferencia de productos + concurrencia | ✓ | ✓ | ✓ |
| Cálculos monetarios y redondeo (tabla de casos) | ✓ | | |
| Tipos de cambio: unicidad, selección, ausencia de tasa, inmutabilidad histórica | ✓ | ✓ | |
| Tareas: participantes, observadores, asociación CRM y proyecto | | ✓ | ✓ |
| Importación/exportación XLSX y CSV (archivo válido, inválido, duplicados) | ✓ | ✓ | ✓ |
| Duplicados y fusión (relaciones movidas, historial) | ✓ | ✓ | ✓ |
| Papelera: eliminar, restaurar con conflicto, eliminar definitivo | | ✓ | ✓ |
| Reportes contra datos sembrados conocidos | | ✓ | |
