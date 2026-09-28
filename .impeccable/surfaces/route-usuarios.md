---
version: 1
slug: "route-usuarios"
primary_target: "route:/usuarios"
related_targets: []
---

# Usuarios internos — `/usuarios` (solo admin)

Modo: **Operate**. Presidencia decide quién de la Comisión entra y con qué permiso.

- **Trabajo y audiencia:** invitar a un miembro nuevo (email, nombre, rol), cambiar un rol, desactivar a quien dejó la Comisión, reenviar una invitación que no llegó. Un admin, pocas veces al año.
- **Resultado y prueba:** lista con nombre, email, `RolePill` y estado (activo / desactivado / invitación pendiente); "Invitar usuario" como acción primaria con la explicación "le va a llegar un mail para crear su contraseña"; los roles se explican en una línea cada uno (Administrador: todo; Editor: carga socios y pagos; Consulta: solo mira).
- **Estados:** vacío imposible (siempre está el admin), enviando invitación, mail que no pudo salir (error visible con "reintentar"), fila propia con acciones deshabilitadas ("no podés cambiar tu propio rol"), intento de dejar al club sin admin (mensaje del servidor).
- **Interacción:** cambiar rol y desactivar piden confirmación que nombra la consecuencia ("Deja de poder entrar. Sus registros y auditoría quedan"); reactivar es la inversa; nunca "borrar usuario".
- **Anti-objetivos:** crear usuarios con contraseña tipeada por el admin; tablas de permisos granulares; roles nuevos desde la UI.
- **Dirección seleccionada:** hereda D0.
- **Pulido (pipeline 2026-09-28-ui-expresiva, F-polish):** hereda el lienzo `bg-canvas` y `DataList` en blanco con `shadow-raised`, sin tocarlo. `UsersView` envuelve la lista en un único fundido+asentamiento al montar (`motion/react`, `DURATION.state`, `prefers-reduced-motion` sin desplazamiento): `DataList` es de `views/shared` (F-shell en este pipeline) y no expone el índice de fila a `renderRow`/columnas, así que no hay forma de escalonar fila por fila sin tocarlo — el bloque completo es el momento autorado acá, no una coreografía por ítem. Sin cambios de comportamiento, roles ni copy.
