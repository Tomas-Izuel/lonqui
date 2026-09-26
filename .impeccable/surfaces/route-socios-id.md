---
version: 1
slug: "route-socios-id"
primary_target: "route:/socios/[id]"
related_targets: []
---

# Ficha del socio — `/socios/[id]`

Modo: **Operate**. La vista de una persona: quién es, cómo está, qué historia tiene. En el slice 2 suma el estado de cuenta y "Registrar pago" arriba de todo.

- **Trabajo y audiencia:** ver los datos y actuar: editar, cargar el apto físico, armar el grupo familiar, dar de baja o reactivar (solo admin). Tesorería la abre con alguien esperando; Presidencia la usa para la baja formal.
- **Resultado y prueba:** encabezado con nombre, `StatusPill`, categoría, edad ("14 años · menor"); secciones: datos personales (con botón WhatsApp `wa.me` si hay teléfono), grupo familiar (integrantes, responsable de pago, contacto de pago), apto físico (estado: vigente / vence en N días / vencido / falta / no aplica; "Ver certificado" abre URL firmada; "Cargar certificado"), historia de alta/baja/reactivación con fecha y motivo. Acciones por rol: editar (admin/editor); dar de baja y reactivar (admin) mediante un diálogo con motivo obligatorio, fecha y la consecuencia escrita ("Deja de generar cuota desde el mes siguiente. La ficha queda en el sistema").
- **Estados:** cargando, no encontrado ("Esta ficha no existe"), sin permiso, subiendo certificado (progreso), error de subida (tipo o tamaño, con el límite dicho), grupo sin responsable (aviso).
- **Interacción:** la subida toma foto o archivo (`capture` opcional), reduce imágenes grandes en el browser, nunca muestra una URL de Storage; el diálogo de baja se abre desde una acción secundaria, no desde un botón rojo prominente.
- **Anti-objetivos:** la palabra "eliminar"; tarjetas anidadas; mostrar el DNI en el título de la página o en la URL.
- **Dirección seleccionada:** hereda D0.
