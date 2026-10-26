# 04 — Reglas de negocio

> Las reglas marcadas `[D-xx]` son **propuestas** pendientes de aprobación
> ([07](07-decisiones-pendientes.md)). Ninguna se considera aprobada todavía.

## 1. Cálculos comerciales y redondeo `[D-24]`

Por cada línea de producto (en prospecto o negociación), con aritmética decimal exacta:

```
bruto_orig      = cantidad × precio_unitario                         (moneda del producto)
descuento_orig  = según tipo: importe fijo, o bruto_orig × % / 100    (moneda del producto)
si moneda_producto = moneda_negociación:  tasa = 1
si no: tasa = tipo de cambio aplicable (sección 2), registrado en la línea

subtotal_línea  = redondear(bruto_orig × tasa,     decimales de la moneda de la negociación)
descuento_línea = redondear(descuento_orig × tasa, decimales de la moneda de la negociación)
total_línea     = subtotal_línea − descuento_línea

Subtotal   = Σ subtotal_línea
Descuento  = Σ descuento_línea
Total      = Subtotal − Descuento
```

- Redondeo **mitad hacia arriba** (`ROUND_HALF_UP`) a los decimales de la moneda (PEN y USD: 2).
- Se redondea **por línea** y luego se suma: el total coincide siempre con la suma visible.
- Descuento de línea ≤ bruto de línea; y ≤ descuento máximo permitido del producto, salvo usuario
  con permiso para exceder [D-25].
- Nunca se suman importes de monedas distintas: toda línea se convierte primero a la moneda de la
  negociación.
- Los totales se guardan en la negociación (no se recalculan al leer), así un listado o reporte
  muestra lo mismo que se confirmó.

## 2. Tipos de cambio

### 2.1 Maestro

- Tasa expresada como "1 unidad de origen = *tasa* unidades de destino". Siempre > 0.
- Un único registro **activo** por (fecha, origen, destino). Editar crea entrada en
  `exchange_rate_history`; desactivar no borra.
- Tasa inversa: si no existe B→A pero sí A→B, se usa `1 / tasa(A→B)` solo si la regla de la
  organización lo permite [D-05].
- Sin servicios externos: se registra a mano o por importación Excel/CSV.

### 2.2 Selección de la tasa aplicable `[D-05]`

Regla configurable por organización. Propuesta por defecto:

1. Tasa activa del **día de la operación** (fecha en que se agrega/actualiza la línea, o fecha de
   corte del reporte).
2. Si no existe: la tasa activa **más reciente anterior**, con antigüedad máxima configurable
   (por defecto 3 días, para cubrir fines de semana y feriados). La UI muestra la fecha usada.
3. Si tampoco existe: **no se asume ninguna tasa**. El sistema pide registrar la tasa del día (si
   el usuario tiene permiso) o elegir una tasa autorizada con motivo (queda en
   `exchange_rate_overrides`). Hasta entonces la línea no se guarda.

### 2.3 Conservación histórica `[D-06]`

- Cada línea guarda tasa, fecha de la tasa, id de la tasa, importe convertido e importe final.
- Cambiar el maestro **no** altera líneas ya guardadas.
- Mientras la negociación esté **abierta**, el usuario puede pulsar "Actualizar tasas" para
  recalcular con la tasa vigente (acción explícita, queda en historial).
- Al marcar la negociación como **Ganada o Perdida**, sus importes y tasas quedan **congelados**;
  reabrirla requiere permiso y deja historial.
- Cambiar el precio de un producto del catálogo no modifica prospectos ni negociaciones existentes.

### 2.4 Consolidación en dashboard y reportes `[D-14]`

- El usuario elige moneda de presentación (por defecto la principal).
- Opción por defecto: convertir cada importe con la tasa de la **fecha de corte del reporte**.
  Alternativa: tasa de la fecha de cierre de cada negociación.
- El reporte muestra siempre: moneda base, fecha y criterio de conversión, y lista las monedas
  sin tasa disponible (esos importes se excluyen y se indica cuánto se excluyó; no se inventa tasa).

## 3. Conversión de prospecto a negociación `[D-07]`

1. Pantalla de resumen: datos que se transfieren (título, contacto, compañía, responsable,
   prioridad, moneda, valor estimado, campos personalizados con la misma clave) y tabla de
   productos con cantidades, precios, descuentos, moneda y tasa. El usuario elige pipeline y etapa
   inicial de la negociación.
2. Confirmación → una transacción:
   - bloquea el prospecto (`FOR UPDATE`) y comprueba que no esté ya convertido;
   - crea la negociación con `source_lead_id` (restricción única: imposible duplicarla, incluso con
     dos clics simultáneos);
   - copia cada producto de interés a `deal_products` **tal como estaba** (precio, descuento,
     moneda, tasa); si la moneda de la negociación difiere, convierte con la regla 2.2 y registra
     la tasa;
   - copia contactos (el contacto del prospecto queda como principal) y compañía;
   - mueve el prospecto a la etapa de tipo `CONVERTED`, guarda `converted_deal_id`;
   - registra historial en ambos registros (`CONVERT`) con el mismo `correlation_id`.
3. Si algo falla, no se guarda nada.
4. El prospecto queda como registro histórico de solo lectura (comentarios y tareas siguen
   permitidos). Las tareas abiertas del prospecto se ofrecen para vincularlas a la negociación.

## 4. Etapas, ganado y perdido

- Cada etapa tiene un tipo: `OPEN`, `WON`, `LOST` (y `CONVERTED` en prospectos).
- Mover a una etapa `LOST` exige motivo de pérdida (catálogo + nota opcional) [D-17].
- Mover a `WON` exige valor final (por defecto el total calculado) y fecha de cierre.
- Volver de `WON`/`LOST` a `OPEN` requiere permiso y deja historial.

## 5. Papelera `[D-09]`

- "Eliminar" = eliminación lógica + entrada en `trash_entries`. El registro desaparece de listas,
  búsquedas, Kanban, dashboard y reportes operativos.
- **Dependencias al eliminar:** eliminar una compañía no elimina sus contactos ni negociaciones;
  se avisa cuántos registros quedan relacionados con una compañía eliminada. Eliminar un prospecto
  o negociación envía también a papelera sus productos asociados (mismo `cascade_group_id`).
- **Restaurar:** comprueba conflictos: código o clave única ya usada por otro registro vivo
  (p. ej. SKU), referencia a un registro que sigue en papelera o fue purgado, etapa/pipeline
  desactivado. Si hay conflicto, se muestra y se pide resolverlo (cambiar código, restaurar
  también el relacionado, elegir otra etapa). Nunca se restaura dejando referencias rotas.
- **Restauración múltiple** solo si ninguno de los elegidos tiene conflicto; si alguno lo tiene,
  se restauran los demás y se listan los pendientes.
- **Eliminación definitiva:** solo con permiso `eliminar_definitivo`, confirmación escribiendo el
  código, y si no hay dependencias vivas. Se conserva `record_history` y `audit_log`.
- **Retención:** configurable (propuesta: 90 días). Al vencer, el worker purga solo lo que no
  tenga dependencias; lo demás queda marcado para revisión manual.

## 6. Duplicados `[D-10]` `[D-15]`

- Modos de coincidencia: **exacta**; **normalizada** (minúsculas, sin tildes, sin espacios ni
  signos; teléfonos solo dígitos; RUC sin guiones); **aproximada** con similitud trigram
  (`pg_trgm`, umbral configurable, por defecto 0,85) para nombres y razones sociales.
- Reglas iniciales (activables): Contactos — documento | correo | teléfono; Compañías — RUC |
  razón social; Productos — SKU | nombre; Prospectos — correo + compañía; Negociaciones —
  compañía + título; Proyectos — nombre.
- Cuándo se evalúa: bajo demanda ("Buscar duplicados"), al guardar (aviso con enlace al posible
  duplicado; el usuario decide continuar) y al importar. Nunca se elimina ni fusiona solo.
- **Fusión:** el usuario elige registro principal y, campo por campo, qué valor conservar. Antes
  de confirmar se muestra qué relaciones se moverán (tareas, comentarios, productos, contactos,
  negociaciones…). En una transacción: actualiza el principal, mueve relaciones, guarda
  `merge_history` con instantánea completa, envía el absorbido a papelera marcado "fusionado",
  registra historial y auditoría.
- Restricciones: no se fusionan registros de distinto tipo, ni negociaciones con distinta moneda,
  ni dos prospectos ya convertidos.

## 7. Permisos `[D-08]`

Propuesta de roles iniciales (editables, salvo que el Administrador conserva todo):

| Módulo / acción            | Administrador | Supervisor          | Comercial                         |
| -------------------------- | ------------- | ------------------- | --------------------------------- |
| Prospectos / negociaciones | todos         | su(s) equipo(s)     | propios (responsable)             |
| Contactos / compañías      | todos         | todos               | ver todos, editar propios         |
| Productos                  | administrar   | ver                 | ver                               |
| Tareas                     | todas         | su(s) equipo(s)     | donde es responsable, participante u observador (observador: solo lectura y comentarios) |
| Importar / exportar        | sí            | sí (su alcance)     | exportar su alcance; no importar  |
| Papelera: restaurar        | sí            | su alcance          | lo que eliminó él                 |
| Eliminar definitivamente   | sí            | no                  | no                                |
| Fusionar duplicados        | sí            | sí                  | no                                |
| Editar tipos de cambio     | sí            | no                  | no                                |
| Configuración / usuarios   | sí            | no                  | no                                |

Todos los permisos se verifican en el backend en cada petición; la UI solo oculta lo no permitido.

## 8. Notificaciones internas `[D-16]`

Se crean solo como consecuencia directa de una acción de un usuario o del paso del tiempo sobre
una tarea, sin reglas configurables: asignación como responsable, participante u observador;
mención en un comentario; tarea vencida (aviso diario al responsable); resultado de una
importación/exportación. No se envían correos salvo recuperación de contraseña.
