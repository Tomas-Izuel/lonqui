---
version: 1
slug: "route-socios-id"
primary_target: "route:/socios/[id]"
related_targets: []
---

# Ficha del socio — `/socios/[id]`

Modo: **Operate**. La vista de una persona: quién es, cómo está, qué historia tiene. En el slice 2 suma el estado de cuenta y "Registrar pago" arriba de todo.

- **Trabajo y audiencia:** ver los datos y actuar: editar, cargar el apto físico, armar el grupo familiar, dar de baja o reactivar (solo admin). Tesorería la abre con alguien esperando; Presidencia la usa para la baja formal.
- **Resultado y prueba:** encabezado con nombre, `StatusPill`, categoría, edad ("14 años · menor"); debajo, siempre visible (nunca dentro de una pestaña): la sección de cuenta (`MemberAccountSection`) con el estado de deuda, "Registrar pago" y "Pago del grupo" — desde el pipeline 2026-09-28-ui-expresiva, los dos abren el overlay de cobranza sobre esta misma página (`?pagar=socio:<id>` / `?pagar=grupo:<id>`), nunca navegan a `/cobranza/nuevo`. Debajo, una navegación en 3 pestañas (`Tabs`, sin envolver ningún `Panel` existente en uno nuevo): **Datos** (personales con botón WhatsApp `wa.me` si hay teléfono, grupo familiar con responsable e integrantes, apto físico con estado vigente/vence en N días/vencido/falta/no aplica y "Ver certificado" por URL firmada), **Movimientos** (una tira de los últimos 12 meses — pagado/parcial/adeudado/anulado/sin cargo, con texto y no solo color — arriba de las cuotas y los pagos), **Historia** (alta/baja/reactivación con fecha y motivo).
- **Estados:** cargando, no encontrado ("Esta ficha no existe"), sin permiso, subiendo certificado (progreso), error de subida (tipo o tamaño, con el límite dicho), grupo sin responsable (aviso). El foco de teclado al cambiar de pestaña aterriza en el contenido de esa pestaña.
- **Interacción:** la subida toma foto o archivo (`capture` opcional), reduce imágenes grandes en el browser, nunca muestra una URL de Storage; el diálogo de baja se abre desde una acción secundaria, no desde un botón rojo prominente.
- **Anti-objetivos:** la palabra "eliminar"; tarjetas anidadas (tampoco dentro de una pestaña); mostrar el DNI en el título de la página o en la URL.
- **Dirección seleccionada:** hereda D0.
