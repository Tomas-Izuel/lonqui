---
version: 1
slug: "route-ajustes"
primary_target: "route:/ajustes"
related_targets: []
---

# Ajustes — `/ajustes` (solo admin)

Modo: **Operate**. Los datos maestros del club: disciplinas y categorías (en el slice 2, valores de cuota).

- **Trabajo y audiencia:** cargar las disciplinas (fútbol masculino, fútbol femenino, vóley) y sus categorías (5ta a 10ma, sub 18…), ordenarlas, desactivar las que ya no se usan. Un admin, al arrancar y una vez por temporada.
- **Resultado y prueba:** lista por disciplina con sus categorías debajo (encabezados y filas, no tarjetas anidadas), agregar y renombrar inline o en un sheet, ordenar, activar/desactivar; sección "Datos del club" con el nombre. El lugar de "Valores de cuota" existe en la arquitectura de la página pero no se muestra hasta el slice 2.
- **Estados:** vacío que enseña ("Cargá la primera disciplina y después sus categorías"), guardando, nombre duplicado en la misma disciplina, desactivar una categoría con socios activos (aviso con la cantidad, se permite).
- **Interacción:** cambios auditados sin fricción extra; sin confirmaciones para renombrar; sí para desactivar.
- **Anti-objetivos:** enums hardcodeados, borrar categorías, configuración que el club no pidió.
- **Dirección seleccionada:** hereda D0.
- **Pulido (pipeline 2026-09-28-ui-expresiva, F-polish):** hereda el lienzo `bg-canvas` y `Panel`/`DataList` en blanco con `shadow-raised` sin tocarlos. La lista de disciplinas (`discipline-group.tsx`) tiene entrada escalonada real al montar (`staggerDelay`, techo de 8 ítems, `prefers-reduced-motion` sin desplazamiento) — es la única lista de este pipeline con escalonado por fila de verdad, porque acá la fila es markup propio, no de `DataList`. Fila de disciplina y de categoría ganaron hover (`hover:bg-muted/40`) y la de categoría subió su ritmo vertical de 8px a 12px (el mismo que una fila de `DataList`). El panel "Cuotas" (`billing-section.tsx`) resalta "Activas desde"/"Último mes generado" en `text-base font-semibold` dentro de una caja `bg-muted/40`, antes texto chico sin agrupar.

- **Conceptos de ingreso (2026-10-13):** alta, renombrar, desactivar (nunca borrar), reordenar y "Pide sponsor". Mismo patrón que disciplinas y categorías. Copy de desactivar: "Deja de ofrecerse al registrar ingresos. Los ingresos ya cargados lo siguen mostrando."
- **Cambiar un valor de cuota (2026-10-15):** cada fila de valores vigentes y de próximos tiene "Cambiar" (botón de texto, 44px). Abre el mismo sheet que "Nuevo valor" en modo cambio: destino fijo (no se vuelve a elegir), "Hoy: $X desde <mes>" como contexto, **monto precargado con el valor de la fila** (decisión de Tomás), "Aplica desde" con el primer mes sin cuotas generadas por defecto (o el mes de la fila, si es un valor programado que se corrige), y la frase *"Se usa en las cuotas que se generen desde <mes>. Las cuotas ya generadas no cambian, estén pagadas o adeudadas."* Si el mes elegido ya tiene un valor para ese destino, avisa "Reemplaza el valor de $Y programado para <mes>". Las filas vigentes muestran su cambio programado más próximo ("Cambia a $Y desde <mes>"). "Historia" muestra todo, con "Reemplazado" en las filas que otra corrección dejó sin efecto. Nunca "editar", nunca "borrar": siempre una fila nueva, auditada.
- **Anti-objetivos (valores de cuota):** editar el monto inline; cambiar el valor de un mes ya generado; cancelar un programado con un mecanismo propio (se corrige de vuelta al valor vigente).
