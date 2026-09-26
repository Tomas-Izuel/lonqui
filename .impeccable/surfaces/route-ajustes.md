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
