# 02 — Desarrollo: F-polish (frontend)

Slice de pulido sobre el lienzo nuevo (`bg-canvas`, `Panel`/`DataList` con
`shadow-raised`) para `src/views/auth/**`, `src/views/settings/**`,
`src/views/users/**`, `src/views/audit/**`, `src/app/(auth)/**` y
`src/app/(panel)/(admin)/**`. Sin cambios de comportamiento: mismas acciones,
mismos permisos, mismo copy (salvo dos frases nuevas de marca en el login),
formularios con las mismas reglas de `method` de siempre.

## 1. Login y cambio de contraseña — presencia de marca

**Archivos:** `src/app/(auth)/layout.tsx`, `src/views/auth/auth-card.tsx`
(nuevo), `src/views/auth/login-form.tsx`, `src/views/auth/change-password-form.tsx`.

- `AuthLayout` (Server Component, sin cambios de tipo) compone ahora una banda
  `bg-brand-soft` (naranja al 7%, el único fondo donde ese tono admite texto —
  `--muted-foreground` está medido AA sobre él) con el escudo agrandado
  (`ClubMark size="lg"` + `className="size-16 text-2xl"`, 64px en vez de
  56px — mismo componente de `views/shell`, solo el tamaño vía `className`
  como el propio componente invita a hacer) y el nombre del club ("Naranja y
  Blanco" / "Club Social y Deportivo"). La tarjeta blanca de contenido se
  monta encima con `-mt-8` y `shadow-lifted`: son dos superficies **hermanas**
  superpuestas visualmente, nunca un panel anidado dentro de otro (piso de
  calidad). El naranja institucional (`--brand`) sigue viviendo solo en el
  escudo — "La Regla del Naranja Mudo" no se tocó.
- **Nuevo primitivo local** `src/views/auth/auth-card.tsx` (no sube a
  `views/shared`: es específico de la composición banda+tarjeta de esta
  superficie, no hay un segundo consumidor). Es el único componente cliente
  del layout — `AuthLayout` sigue siendo Server Component y le pasa `children`
  (las pages de `/login` y `/cambiar-contrasena`, también Server Components)
  como prop, patrón válido de Next (CLAUDE.md: "empujar `use client` lo más
  abajo posible"). Anima la llegada de la tarjeta una sola vez por montaje
  (`initial`/`animate` de `motion/react` no vuelven a correr en re-renders del
  mismo formulario, solo si React remonta el nodo) con
  `DURATION.overlay`/`EASE_ENTER` de `views/shared/motion.ts` (consumido, no
  editado); con `prefers-reduced-motion` solo hay fundido, sin desplazamiento
  (`useMotionPreference().pick`).
- **Errores de login/cambio de contraseña** (el genérico, sin `field`) ahora
  aparecen con `AnimatePresence` + el mismo fundido/asentamiento en vez de un
  salto brusco — es feedback de estado, no decoración (animate.md, "Operate:
  motion sirve al feedback y al estado"). Reducido: solo fundido.
- Nada cambió en la lógica de los formularios (`useActionState`, validación
  con `react-hook-form`+Zod, `method="POST"` + `action={formAction}`, el texto
  de la política de contraseña, el link-que-no-es-link de "pedile una nueva a
  un administrador"): es estrictamente presentación.

## 2. Ajustes — spacing, jerarquía, hover, entrada escalonada

**Archivos:** `src/views/settings/{discipline-group,category-row,settings-page-view,billing-section}.tsx`.

- **Entrada escalonada real** en la lista de disciplinas
  (`discipline-group.tsx`, root `<li>` → `motion.li`): usa `staggerDelay(position)`
  de `views/shared/motion.ts` (techo de 8 ítems × 40ms). Es la única lista de
  todo este pipeline con escalonado **por fila real**, porque acá el markup de
  la fila es mío — a diferencia de `/usuarios` y `/auditoria`, que renderizan
  sus filas a través de `DataList` (F-shell en este pipeline, sin índice de
  fila expuesto a `renderRow`/columnas). `initial`/`animate` solo corren al
  montar: reordenar una disciplina (mismo `key`, mismo nodo) no repite la
  animación; una disciplina nueva sí la juega, en su posición.
- **Hover de fila**: la cabecera de cada disciplina y cada fila de categoría
  ganaron `hover:bg-muted/40` con `transition-colors` (lista explícita de
  propiedades, nunca `transition: all`) — antes ninguna de las dos daba
  ninguna señal visual al pasar el mouse, a diferencia de toda fila de
  `DataList` en el resto del panel.
- **Ritmo**: `category-row.tsx` pasó de `py-2` (8px) a `py-3` (12px) — el
  token "filas" de `DESIGN.md` (Layout → Ritmo), el mismo que usa una fila de
  `DataList`; antes quedaba más apretada que cualquier otra fila del sistema.
  `settings-page-view.tsx` pasó su `gap-4` exterior a `gap-6`, igualando el
  ritmo entre paneles de `/usuarios` y `/auditoria` (ambas ya en `gap-6`):
  inconsistencia cruzada entre las tres superficies `(admin)` que traía el
  slice anterior.
- **Cuotas, claridad** (`billing-section.tsx`): "Activas desde" y "Último mes
  generado" pasaron de `text-sm font-medium` sueltos a `text-base
  font-semibold tabular-nums` dentro de una caja `bg-muted/40 rounded-lg` — los
  dos hechos que Tesorería busca primero en este panel, ahora agrupados y con
  más peso tipográfico (la escala sigue cerrada: 12/14/16/20/24px, nada nuevo).
  El resto (aviso de corrida fallida, "Últimas corridas" plegado) no cambió:
  ya estaba claro.
- **No tocado a propósito**: `activate-billing-sheet.tsx`, `new-fee-price-sheet.tsx`,
  `discipline-form-sheet.tsx`, `category-form-sheet.tsx`, `confirm-toggle-dialog.tsx`,
  `fee-prices-section.tsx`, `billing-runs-list.tsx`, `club-settings-form.tsx`,
  `new-discipline-button.tsx` — ya seguían la convención (sheet/diálogo con
  `ResponsiveSheet`, estados de carga/error, copy en español rioplatense) y no
  mostraban una deriva de sistema que ameritara tocarlos en este pase.

## 3. Usuarios — entrada suave del listado

**Archivo:** `src/views/users/users-view.tsx`.

- El `<DataList>` de usuarios se envuelve en un único `motion.div` con fundido
  + asentamiento al montar (`DURATION.state`, `prefers-reduced-motion` sin
  desplazamiento). **No hay escalonado por fila**: `DataList` (F-shell en este
  pipeline, fuera de mi ownership) no pasa el índice de la fila a
  `renderRow`/`columns[].render`, así que no hay forma honesta de escalonar
  fila por fila sin editar ese archivo — el bloque completo es el único
  momento autorado de esta lista. `UsersView` sigue montado entre una Server
  Action exitosa y la siguiente (`revalidatePath` actualiza el prop `users`,
  no remonta el árbol), así que la animación no se repite en cada alta/cambio
  de rol/desactivación — solo al llegar a la página.
- Sin cambios de estado, permisos ni copy: el mix `StatusPill`/`Badge` de
  `user-status.tsx` (documentado en ese mismo archivo como deuda técnica
  intencional a resolver subiendo una variante a `views/shared/status-pill.tsx`)
  no se tocó porque ese archivo es de F-shell en este pipeline, no mío.

## 4. Auditoría — entrada del listado y diff legible

**Archivos:** `src/views/audit/audit-list.tsx`, `src/views/audit/audit-detail-sheet.tsx`.

- Mismo patrón que `/usuarios`: `AuditList` envuelve su `<DataList>` en un
  `motion.div` de fundido+asentamiento. Acá el "montar" está bien delimitado
  por el padre: `AuditoriaPage` le pone a `AuditList` una `key={filtersKey}`
  derivada de los filtros (sin el cursor), así que cambiar cualquier filtro
  remonta el componente (anima de nuevo — es una lista distinta) y "Ver más"
  solo agrega filas al mismo `state` interno sin remontar (no repite la
  animación).
- **Detalle expandible más legible** (`audit-detail-sheet.tsx`): cada campo
  cambiado ahora muestra "Antes" / "Después" como etiquetas explícitas en una
  grilla de dos columnas, no solo el tachado sobre el valor viejo — antes había
  que inferir cuál de las dos líneas era cuál. El valor nuevo pasa a
  `font-medium` para pesar más que el viejo (tachado + `text-muted-foreground`),
  sin usar color semántico (nunca `status-up-to-date` para "el valor nuevo":
  no todo cambio es una mejora, y ese verde ya significa "al día" en todo el
  resto del sistema). INSERT sigue mostrando un solo valor (no hay "antes"
  para una fila nueva), sin cambios.

## Decisiones y trade-offs

- **Escalonado por fila real solo donde el markup es propio.** `Ajustes` (mi
  propio `<li>`/`<ul>`) sí lo tiene; `Usuarios` y `Auditoría` (a través de
  `DataList`, de F-shell en este pipeline) solo tienen el fundido del bloque
  completo. Tocar `data-list.tsx` para exponer el índice de fila hubiera roto
  el límite de ownership de este pipeline (`01-tasks.md`, tabla de dueños) —
  se documenta acá y en las cuatro briefs en vez de resolverlo por mi cuenta.
  Si en un pipeline futuro se decide escalonar `DataList` de verdad, el cambio
  entra por `DataListColumn.render(item, index)` o por un prop
  `renderRow(item, index)`.
- **`ClubMark` se agranda por `className`, no se edita el componente.** El
  componente de `views/shell` ya expone `className` como escape hatch; cambiar
  su tamaño ahí (una nueva variante `xl`) hubiera sido tocar un archivo de
  F-shell.

## Acceptance criteria implementados (para test-engineer / code-reviewer)

- `/login` y `/cambiar-contrasena`: la tarjeta de contenido aparece con un
  fundido+asentamiento único al montar; con `prefers-reduced-motion: reduce`
  no hay desplazamiento vertical (verificable leyendo el valor de `y` inicial
  en el DOM/estilo aplicado, debería ser `0` desde el primer frame). El error
  genérico de credenciales/contraseña actual incorrecta se sigue mostrando con
  `role="alert"` (accesible a lectores de pantalla) y sigue seteando foco en
  el campo correspondiente cuando el error trae `field` (sin cambios en esa
  lógica). Ningún campo, atributo `autoComplete`/`inputMode` ni regla de
  `method="POST"` cambió.
- `/ajustes`: las disciplinas entran con un retraso creciente y capado (nunca
  más de 8×40ms=320ms) al cargar la página o al agregar una disciplina nueva;
  reordenar NO repite la animación en las filas existentes. Hover visible en
  la cabecera de cada disciplina y en cada fila de categoría. "Cuotas" muestra
  "Activas desde"/"Último mes generado" con mayor peso visual cuando la
  facturación está activa.
- `/usuarios` y `/auditoria`: el listado aparece con un único fundido al
  cargar o al cambiar un filtro (auditoría); "Ver más" en auditoría no repite
  la animación. El detalle de un movimiento de auditoría (sheet) rotula
  "Antes"/"Después" en cada campo modificado.
- Ningún rol, permiso, acción de Server Action, atajo de teclado o texto de
  confirmación con motivo cambió en ninguna de las cuatro superficies.

## Verificación

- `npx eslint <archivos tocados>`: limpio.
- `npx tsc --noEmit`: sin errores nuevos en los archivos de este slice (el
  único error del árbol es `dashboard-content.tsx` importando
  `@/views/payments/category-debt-chart`, de F-cobranza/F-inicio, ajeno a
  este slice y en curso en paralelo).
- `web-design-guidelines` (Vercel Web Interface Guidelines): animaciones
  nuevas solo tocan `opacity`/`transform` (nunca propiedades de layout),
  `transition-colors` explícito en los hovers (nunca `transition: all`),
  `prefers-reduced-motion` respetado en todas, estados de error mantienen
  `role="alert"` y foco. Sin hallazgos.

## Ronda 2 (2026-09-28) — hallazgos de screenshot a 390px

El coordinador revisó `/ajustes` renderizado a 390px y encontró tres defectos
que el código por sí solo no dejaba ver sin correr la app. Los tres eran
consecuencia directa de decisiones de la Ronda 1.

1. **Fila de acciones de disciplina en su propia línea.** El encabezado de
   cada disciplina (`discipline-group.tsx`) usaba `flex-wrap`: a 390px, el
   nombre + `StatusPill` + los tres botones de 44px (subir/bajar/más) no
   entraban en una sola fila y el navegador mandaba la fila de botones a una
   línea propia debajo del nombre. Arreglado con `flex-nowrap` en el
   contenedor y `min-w-0 flex-1` en el bloque nombre+pill (que ahora trunca en
   vez de forzar el wrap) — mismo patrón que ya usa `DataList` para sus
   filas. Encontré el mismo riesgo en `category-row.tsx` (misma estructura,
   mismos tres botones) y lo corregí ahí también, aunque el screenshot no lo
   mostraba explícitamente.
2. **Categorías como tarjetas anidadas.** `category-row.tsx` combinaba
   `border-l border-border` (de antes de este pipeline) con el `rounded-lg`
   que agregué en la Ronda 1 para el hover, sobre una lista que ya tiene
   `divide-y` en el `<ul>` padre (`DisciplineGroup`) — el resultado a 390px
   leía como una caja bordeada e indentada por fila, cards-dentro-de-card
   dentro del `Panel`. Saqué el `border-l` y el `rounded-lg`: la fila queda
   plana, la separación entre categorías la sigue dando solo el `divide-y`
   del padre (igual que cualquier fila de `DataList`), y la jerarquía
   "categoría bajo su disciplina" sigue leyéndose por el `pl-3`, el tamaño de
   fuente menor y estar anidada dentro del mismo `<li>` de la disciplina.
3. **"Guardar cambios" con pinta de roto en reposo.** `club-settings-form.tsx`
   usaba el `Button` por defecto (`variant="default"`) deshabilitado cuando
   `!isDirty`: `disabled:opacity-50` de `components/ui/button.tsx` (el
   estándar del sistema, sin overrides míos) aplicado sobre `bg-primary`
   sólido da un naranja pálido y lavado que en reposo (formulario recién
   cargado, sin tocar) parece un botón roto, no uno simplemente inactivo. La
   lógica de habilitar solo cuando hay cambios quedó igual; lo que cambié es
   la variante: `variant={hasChanges ? 'default' : 'outline'}`. En reposo se
   ve como cualquier acción secundaria (`outline`, sin desteñir nada); apenas
   hay un cambio pasa a la primaria sólida y habilitada; durante el envío
   (`pending`, momento fugaz) sigue mostrando el `disabled:opacity-50` del
   sistema sobre la primaria — que es exactamente "el look del sistema" que
   pidió el coordinador, ahí sí aplicado sobre un estado que dura solo
   instantes, no permanentemente en reposo.

**Login a 390px (verificación, sin cambios de código):** repasé
`AuthLayout` con los anchos reales — banda `bg-brand-soft` con `px-6` deja
~310px de contenido para el escudo de 64px y las dos líneas de texto ("Naranja
y Blanco" / "Club Social y Deportivo"), ninguna se acerca a envolver a ese
ancho; la tarjeta blanca se monta con `-mt-8` sobre un `pb-14` de banda,
dejando ~24px de naranja visible por encima del borde superior de la tarjeta
— la composición de superposición se ve intencional, no cortada. No encontré
un defecto propio de esta pantalla; no cambié nada del layout en esta ronda.

### Verificación ronda 2

- `npx eslint` sobre los 4 archivos tocados: limpio.
- `npx tsc --noEmit`: sin errores en todo el árbol (el error cruzado de
  `dashboard-content.tsx`/`category-debt-chart` de la ronda 1 ya se resolvió
  del lado de F-cobranza/F-inicio).
- No se corrió `next dev`/`build` (regla dura del pipeline): la verificación
  de los tres hallazgos es por lectura de layout (flex/wrap/min-width) y por
  contraste con el uso de `Button`/`disabled:opacity-50` en
  `components/ui/button.tsx`, no por captura de pantalla propia.
