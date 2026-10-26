# CRM Web Comercial — Multiplica

CRM web para gestionar el ciclo comercial de una organización: desde el registro de un prospecto
hasta el cierre de una negociación. Incluye contactos, compañías, prospectos, negociaciones,
catálogo de productos, monedas y tipos de cambio, tareas, proyectos básicos, usuarios, equipos,
permisos, reportes, control de duplicados, importación/exportación y papelera de reciclaje.

**Fuera de alcance:** integraciones con WhatsApp, SUNAT, facturación electrónica y cualquier
motor de automatizaciones comerciales.

## Estado

**Etapa 0: diseño pendiente de aprobación.** Todavía no hay código: la definición funcional pide
entregar y aprobar primero la arquitectura, el modelo de datos, el mapa de navegación y las
decisiones que afectan reglas comerciales, permisos, monedas o conservación de datos.

| Documento                                                          | Contenido                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| [01 — Arquitectura](docs/plan/01-arquitectura.md)                  | Stack, componentes, seguridad, despliegue               |
| [02 — Modelo de datos](docs/plan/02-modelo-datos.md)               | Entidades, relaciones (ER), índices, transacciones      |
| [03 — Navegación y UX/UI](docs/plan/03-navegacion-ux.md)           | Mapa de navegación, pantallas, sistema visual           |
| [04 — Reglas de negocio](docs/plan/04-reglas-negocio.md)           | Cálculos, monedas, conversión, papelera, duplicados     |
| [05 — Backlog y criterios](docs/plan/05-backlog-criterios.md)      | Historias por fase y criterios de aceptación            |
| [06 — Plan por fases](docs/plan/06-plan-fases.md)                  | Fases, dependencias técnicas, entregables, pruebas      |
| [07 — Decisiones pendientes](docs/plan/07-decisiones-pendientes.md) | **Lo que hay que aprobar antes de programar**           |

La implementación empieza por la Fase 1 cuando las decisiones del documento 07 estén aprobadas.
