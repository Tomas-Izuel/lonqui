# 02 — Desarrollo frontend (T2)

## Archivos
- `src/views/members/member-form.tsx`: el panel "Fecha de alta" ahora se muestra también en edición.
- `src/views/audit/audit-labels.ts`: `members.joined_on` -> "fecha de alta". Las etiquetas de `member_status_events.effective_on` ("fecha") y `member_categories.joined_on` ya existían y alcanzan.
- `.impeccable/surfaces/route-socios-nuevo.md`: línea de "Estados" reemplazada según 01-tasks.

## Comportamiento implementado
- Edición: `joinedOn` precargado con la fecha guardada (`member?.joinedOn ?? toClubDate()`). `DateField` nativo, `max` = hoy en hora Argentina.
- Validación igual que en el alta, en los dos modos: vacía -> "Elegí una fecha", inválida, futura -> error inline antes de enviar.
- Descripción (solo edición): "Corregí la fecha si se cargó mal. Se actualiza también en la ficha de ingreso y en las inscripciones cargadas ese día."
- Nota de consecuencia (§9, información, sin alarma, `text-muted-foreground`): si el mes elegido es anterior al mes guardado, "Se van a generar las cuotas desde <mes año>." Se oculta al volver al mes original o a uno posterior. Un pago anterior no bloquea ni se avisa aparte.
- `updateMember(id, { ...shared, familyGroupId, joinedOn })`: misma action, sin llamada nueva. El error de la base (`field: 'joinedOn'`) cae bajo el campo con foco vía el mapa existente; sin modal ni motivo.
- Guardar sin tocar la fecha manda la misma fecha (el servidor la trata como no-op).
- Subtítulo "Alta: dd/mm/aaaa · Estado: ..." sin cambios.

## Contrato consumido
`updateMember` acepta `joinedOn?: ISODate` (T1, en paralelo). Typecheck y lint verdes al cierre.

## A11y
Descripción enlazada con `aria-describedby` por `DateField`; el error usa el mismo mecanismo. La nota de consecuencia es un `<p>` simple (no `role=alert`).

## Deferrals
Ninguno. Sin primitivas nuevas en `shared/`. No se corrió verificación visual en el navegador a 390px (sin stack levantado); el panel es una columna con `DateField` existente (44px).

## Fix de review (Minor 1 y 2)
- **Minor 1:** la nota "Se van a generar las cuotas desde <mes>" ahora depende del estado de facturación. `MemberForm` (modo edición) recibe `billing?: Pick<BillingStatus, 'active' | 'startPeriod'>`; la page `socios/[id]/editar/page.tsx` lo lee con `getBillingStatus()` (lectura plana del modelo, igual que `/socios`). Se muestra solo si la facturación está activa y `max(mes elegido, inicio) < max(mes guardado, inicio)`; el mes mostrado es `max(mes elegido, inicio)`. Sin facturación activa, o con ambos meses antes del inicio, no hay nota.
- **Minor 2:** `.impeccable/surfaces/route-socios-nuevo.md` ya no menciona el pago como bloqueo y describe el aviso.
- Criterio de aceptación: facturación inactiva -> sin nota; inicio 10/2026, alta 10/2026 corregida a 03/2025 -> "desde octubre 2026"; ambos antes del inicio -> sin nota.
