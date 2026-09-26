---
version: 1
slug: "route-socios"
primary_target: "route:/socios"
related_targets: []
---

# Padrón — `/socios`

Modo: **Operate**. La pantalla más usada del sistema: contesta "¿quién es socio?" y, desde el slice 2, "¿debe? ¿desde cuándo? ¿cuánto?".

- **Trabajo y audiencia:** encontrar a una persona por nombre o DNI en segundos, filtrar una categoría entera, ver de un vistazo estado y alertas. Todos los roles; `consulta` solo mira.
- **Resultado y prueba:** búsqueda arriba, siempre visible; filtros (categoría, disciplina, estado, tipo) que viven en la URL para poder retomar; lista de filas apilables en móvil (nombre y apellido, DNI tabular o "DNI pendiente", categoría, `StatusPill`, aviso de apto físico vencido/por vencer si es menor) y tabla en desktop. El filtro "condición de deuda" está presente y deshabilitado con "disponible cuando se activen las cuotas". Botón primario "Ficha de ingreso" solo para admin/editor.
- **Rangos:** 0 socios (vacío que enseña: "Todavía no hay socios. Cargá la primera ficha de ingreso"), 250 típicos, 1.000 máximo del contrato; paginación por cursor "Ver más"; una búsqueda sin resultados dice qué se buscó.
- **Estados:** cargando (skeleton de filas), vacío, sin resultados, error; filtros activos visibles y limpiables.
- **Interacción:** tocar una fila abre la ficha; búsqueda con debounce y limpiar; acentos y mayúsculas indiferentes; por defecto se muestran activos, "incluir dados de baja" es un filtro explícito.
- **Anti-objetivos:** tabla con scroll horizontal en el celular, acciones destructivas en la fila, columnas de datos personales que no hacen falta para reconocer a la persona (domicilio, email).
- **Dirección seleccionada:** hereda D0.
