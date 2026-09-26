---
version: 1
slug: "route-socios-nuevo"
primary_target: "route:/socios/nuevo"
related_targets: ["route:/socios/[id]/editar"]
---

# Ficha de ingreso — `/socios/nuevo` (y `/socios/[id]/editar`)

Modo: **Operate**. Reemplaza la ficha en papel que pide el estatuto.

- **Trabajo y audiencia:** Secretaría (o un admin) carga a una persona nueva, a veces con el padre adelante; también se usa para cargar el padrón histórico de a uno. Debe poder completarse con una mano en un celular de gama baja.
- **Resultado y prueba:** formulario de una columna en secciones cortas: datos personales (nombre, apellido, DNI con teclado numérico, fecha de nacimiento, domicilio, teléfono, email), tipo de socio (practicante / no practicante) que muestra u oculta disciplina → categoría, grupo familiar (elegir uno existente o crear), fecha de alta (hoy por defecto). Guardar lleva a la ficha con confirmación.
- **Rangos y reglas:** DNI obligatorio salvo marcar "Todavía no tengo el DNI"; DNI duplicado se dice en el campo ("Ya hay un socio con ese DNI") con link a esa ficha; fecha de nacimiento no futura; practicante exige categoría; email opcional.
- **Estados:** validación inline al salir del campo y al enviar (foco al primer error), enviando, error de servidor genérico con reintento, éxito con toast. En edición, `joined_on` y estado no se editan (se muestran como texto).
- **Interacción:** autocompletar de navegador apagado en DNI; selects nativos en móvil; el botón primario dice "Dar de alta" en alta y "Guardar cambios" en edición.
- **Anti-objetivos:** wizard de varios pasos, modales, campos que no pide el contrato, subir el apto físico acá (se hace desde la ficha).
- **Dirección seleccionada:** hereda D0.
