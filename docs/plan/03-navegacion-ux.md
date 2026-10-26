# 03 — Mapa de navegación y diseño UX/UI

## 1. Mapa de navegación

```
/login · /recuperar-clave · /definir-clave
/                                   Dashboard comercial
│
├── Comercial
│   ├── /prospectos                 Kanban | Lista  (selector de pipeline, vistas guardadas)
│   │   ├── /prospectos/nuevo
│   │   ├── /prospectos/:id         Ficha (también como panel lateral desde Kanban/lista)
│   │   └── /prospectos/:id/convertir   Resumen de conversión → confirmación
│   ├── /negociaciones              Kanban | Lista
│   │   ├── /negociaciones/nueva
│   │   └── /negociaciones/:id      Ficha con productos y totales
│   ├── /contactos                  Lista
│   │   └── /contactos/:id
│   └── /companias                  Lista
│       └── /companias/:id
│
├── Operación
│   ├── /tareas                     Kanban | Lista | Calendario  (Mis tareas, Participo, Observo, Todas)
│   │   └── /tareas/:id
│   └── /proyectos                  Lista (catálogo básico)
│       └── /proyectos/:id          Datos + tareas del proyecto
│
├── Catálogo
│   └── /productos                  Lista
│       └── /productos/:id
│
├── Análisis
│   └── /reportes                   Índice de reportes
│       └── /reportes/:clave        Filtros + gráfico + tabla + exportar
│
├── Calidad de datos
│   ├── /duplicados                 Coincidencias abiertas por módulo
│   │   ├── /duplicados/:id         Comparación lado a lado → fusionar / conservar ambos / revisado
│   │   └── /duplicados/reglas      Reglas por módulo
│   ├── /importaciones              Historial de importaciones y exportaciones
│   └── /papelera                   Elementos eliminados (filtro por módulo, búsqueda, restaurar)
│
└── Administración  (según permisos)
    ├── /admin/organizacion         Datos, zona horaria, moneda principal, parámetros generales
    ├── /admin/usuarios · /admin/equipos · /admin/roles   (matriz de permisos)
    ├── /admin/pipelines            Pipelines y etapas (prospectos y negociaciones)
    ├── /admin/campos               Campos personalizados por módulo
    ├── /admin/catalogos            Prioridades, orígenes, motivos de pérdida, tipos de documento,
    │                               sectores, categorías de producto, estados de tarea
    ├── /admin/monedas              Maestro de monedas
    ├── /admin/tipos-de-cambio      Maestro diario (tabla por fecha, historial, importar/exportar)
    ├── /admin/papelera             Política de retención
    └── /admin/auditoria            Registro de auditoría

Barra superior (siempre): búsqueda global (Ctrl+K) · botón "+ Crear" · notificaciones · perfil
(tema claro/oscuro, cambiar contraseña, cerrar sesión)
```

## 2. Estructura de pantalla

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│  Logo      │ 🔍 Buscar (Ctrl+K)          [+ Crear ▾]   🔔 3   (MV) ▾      │
│            ├──────────────────────────────────────────────────────────────┤
│ ▣ Inicio   │ Prospectos   Pipeline: [Ventas B2B ▾]  [Kanban|Lista]  ⋯     │
│ ◎ Prospect.│ [Buscar…] [Responsable ▾] [Prioridad ▾] [+ Filtro]  Vista ▾  │
│ ◈ Negoc.   │ ┌─ Nuevo (12) ──┐┌─ Calificado (8)┐┌─ Propuesta (5)┐       │
│ ☺ Contactos│ │┌─────────────┐││                ││               │       │
│ ▤ Compañías│ ││▲ URGENTE    │││                ││               │ ┌────┐│
│ ✓ Tareas   │ ││Cotiz. flota │││                ││               │ │Pan-││
│ ▢ Proyectos│ ││ACME S.A.C.  │││                ││               │ │el  ││
│ ▦ Productos│ ││S/ 45,000.00 │││                ││               │ │de  ││
│ ▲ Reportes │ ││👤 Ana · 2 ✓ │││                ││               │ │det.││
│ ⧉ Duplic.  │ │└─────────────┘││                ││               │ └────┘│
│ 🗑 Papelera │ └───────────────┘└────────────────┘└───────────────┘       │
│ ⚙ Admin    │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

- **Menú lateral** plegable (íconos solos) en escritorio; cajón deslizable en tablet/móvil.
- **Panel lateral de detalle:** al pulsar una tarjeta o fila se abre a la derecha sin perder la
  lista; botón para abrir la ficha completa. En móvil ocupa toda la pantalla.
- **Ficha de registro:** cabecera (código, título, etapa como barra de progreso, prioridad,
  responsable, acciones) · pestañas: _Datos_ (secciones plegables), _Productos_, _Tareas_,
  _Comentarios y actividad_, _Relacionados_, _Historial_.

## 3. Componentes clave

| Componente             | Comportamiento                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataTable`            | Columnas visibles/orden/ancho configurables y guardadas por usuario; orden por columna; filtros; selección múltiple con acciones en lote (asignar responsable, cambiar etapa, enviar a papelera, exportar); paginación; virtualización                |
| `Kanban`               | Columnas por etapa con contador y suma de valor; arrastrar con ratón, táctil y teclado (Espacio para tomar, flechas para mover); el cambio se guarda al soltar y se revierte con aviso si el servidor lo rechaza; mover a etapa "Perdido" pide motivo |
| `PriorityBadge`        | Ícono + texto + color: ▲▲ Urgente (rojo) · ▲ Alta (naranja) · ■ Media (amarillo) · ▼ Baja (verde). Nunca solo color                                                                                                                                   |
| `MoneyInput` / `Money` | Respeta decimales y símbolo de la moneda; muestra siempre el código (`S/ 1,250.00 PEN`)                                                                                                                                                               |
| `EntityPicker`         | Búsqueda con autocompletar para contacto, compañía, producto, usuario, proyecto; opción "crear nuevo" en línea                                                                                                                                        |
| `ConfirmDialog`        | Para eliminar, convertir, fusionar, restaurar, eliminar definitivamente; describe la consecuencia; la eliminación definitiva exige escribir el nombre o código                                                                                        |
| `ImportWizard`         | 1 archivo → 2 mapeo → 3 vista previa y validación → 4 duplicados → 5 confirmación → resumen                                                                                                                                                           |
| `CompareView`          | Dos registros lado a lado, diferencias resaltadas, selección por campo del valor a conservar                                                                                                                                                          |

## 4. Principios aplicados

| Principio                      | Cómo se cumple                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pocos clics                    | "+ Crear" global; crear desde la columna Kanban; edición en línea en el panel lateral; atajos (`N` nuevo, `/` buscar, `E` editar)                       |
| Evitar pérdida de información  | Aviso al salir con cambios sin guardar; borrador local del formulario; papelera en vez de borrado; conflicto de versión sin perder lo escrito           |
| Validaciones comprensibles     | Mensaje junto al campo, en español, diciendo qué corregir ("El RUC debe tener 11 dígitos")                                                              |
| Estados sin depender del color | Íconos + texto en prioridades, estados de tarea, ganado/perdido, vencido                                                                                |
| Accesibilidad                  | WCAG 2.1 AA: contraste, foco visible, navegación completa por teclado, `aria-label` en botones de ícono, anuncios en vivo al mover tarjetas             |
| Responsive                     | Escritorio ≥ 1280, tablet 768–1279 (Kanban con desplazamiento horizontal), móvil < 768 (lista por defecto; Kanban de una columna con selector de etapa) |
| Tema                           | Claro por defecto; oscuro opcional en el perfil (tokens de color CSS)                                                                                   |
| Consistencia                   | Mismos verbos en todo el sistema: Crear, Guardar, Enviar a papelera, Restaurar, Eliminar definitivamente, Convertir, Fusionar                           |

## 5. Paleta (tokens)

| Token                            | Claro                | Uso                                                |
| -------------------------------- | -------------------- | -------------------------------------------------- |
| `primary`                        | `#2563EB`            | Acciones principales, enlaces                      |
| `priority-urgent`                | `#DC2626`            | Urgente                                            |
| `priority-high`                  | `#EA580C`            | Alta                                               |
| `priority-medium`                | `#CA8A04`            | Media (texto oscuro sobre amarillo para contraste) |
| `priority-low`                   | `#16A34A`            | Baja                                               |
| `success` / `danger` / `warning` | verde / rojo / ámbar | Ganada, perdida, vencida                           |

Los colores de prioridad y etapa son configurables en administración; el sistema verifica el
contraste del texto al guardarlos.
