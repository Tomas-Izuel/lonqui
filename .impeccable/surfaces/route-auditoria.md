---
version: 1
slug: "route-auditoria"
primary_target: "route:/auditoria"
related_targets: []
---

# Auditoría — `/auditoria` (solo admin)

Modo: **Operate**, lectura pura. Contesta "¿quién tocó esto y cuándo?".

- **Trabajo y audiencia:** un admin revisa qué pasó con un socio, un usuario o un ajuste; rara vez, pero cuando lo necesita es importante (una discusión en la Comisión, un dato que cambió sin que nadie sepa).
- **Resultado y prueba:** filtros (qué: socios, eventos de estado, aptos, grupos, disciplinas, categorías, usuarios, ajustes; quién; desde/hasta en hora argentina; id de registro); lista cronológica descendente con fecha y hora, usuario, operación y campos cambiados en lenguaje del club ("Dio de baja", "Cambió teléfono, domicilio"); detalle expandible con antes/después por campo.
- **Rangos:** miles de filas al año; paginación por cursor; un filtro por socio devuelve decenas.
- **Estados:** vacío ("Todavía no hay movimientos"), sin resultados para el filtro, cargando, error.
- **Interacción:** desde la ficha de un socio se llega acá con el filtro puesto; el detalle nunca ofrece editar ni deshacer (no existe).
- **Anti-objetivos:** mostrar JSON crudo como interfaz principal; exponer la auditoría a roles que no son admin aunque sea "solo lectura".
- **Dirección seleccionada:** hereda D0.
- **Pulido (pipeline 2026-09-28-ui-expresiva, F-polish):** hereda el lienzo `bg-canvas` y `DataList` en blanco con `shadow-raised`. `AuditList` envuelve el listado en un fundido+asentamiento que solo juega al remontar (cambia un filtro → nueva `key` en `AuditoriaPage` → remonta; "Ver más" solo agrega al mismo estado, no remonta, no repite la animación) — mismo límite que `/usuarios`: sin acceso a las filas internas de `DataList`, no hay escalonado por fila. El detalle (`audit-detail-sheet.tsx`) ahora rotula cada valor con "Antes"/"Después" en vez de distinguirlos solo por el tachado, más legible como diff real.
