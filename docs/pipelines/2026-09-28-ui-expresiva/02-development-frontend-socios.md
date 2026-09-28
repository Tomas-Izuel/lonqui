# 02 — Desarrollo frontend: F-socios (vista rápida, padrón, ficha en pestañas)

Slice `F-socios` de `01-tasks.md` (Ola 1), más el ítem 2 del addendum del
hilo principal (tira de 12 meses en la ficha). Implementado por
`frontend-react-craftsman`, en paralelo con F-shell, F-inicio, F-cobranza,
F-polish, B1 y B2 (todas corriendo a la vez — ver el `git status` de la
sesión con archivos de esas slices también modificados).

## Archivos tocados

- `src/views/members/member-quick-view-sheet.tsx` (**nuevo**) — `MemberQuickViewSheet`, firma congelada por C7.
- `src/views/members/member-period-strip.tsx` (**nuevo**) — `MemberPeriodStrip`, tira de 12 meses (addendum ítem 2).
- `src/views/members/member-list.tsx` (editado) — click plano abre la vista rápida.
- `src/views/members/member-list-view.tsx` (editado) — buscador + filtros agrupados en un `Panel`.
- `src/views/members/member-account-section.tsx` (editado) — "Registrar pago"/"Pago del grupo" pasan a overlay.
- `src/views/members/member-detail-view.tsx` (editado) — reorganización en `Tabs` (Datos / Movimientos / Historia).
- `.impeccable/surfaces/route-socios.md`, `route-socios-id.md`, `route-socios-nuevo.md` (editados).

No toqué `src/views/payments/**` (solo consumo `useOverlayParam('pagar')`, nunca importo nada de ahí), `src/views/dashboard/**`, `src/views/shell/**`, `src/components/ui/**`, ni `src/models/**`. No toqué `getPadron`/`parseFilters` ni ninguna page de `app/(panel)/socios/**` — no hicieron falta ajustes ahí, ya que `MemberQuickViewSheet` se monta globalmente en `AppShell` (F-shell, fuera de mi lane).

## Contratos consumidos

- `src/views/shared/motion.ts`, `overlay-params.ts`, `hero-figure.tsx` (no usado en esta slice, no aplica), `chart-kit.tsx` (`shortMonth`, en `MemberPeriodStrip`) — todos ya estaban en el árbol (Ola 0 del hilo principal), sin cambios de mi parte.
- `getMemberQuickView(memberId): Promise<ActionResult<MemberAccount & { phone: string | null }>>` (B1, `src/controllers/members.actions.ts`) — landed durante la sesión; verificado contra la firma congelada antes de cerrar (permiso `payments.read`, error de dominio si no existe el socio, segunda lectura de `phone` por PK). `npx tsc --noEmit` sobre el repo entero: **0 errores**.
- `ResponsiveSheet` (sin cambios de props, heredé el drag-to-dismiss de C6b sin tocar el archivo).
- `components/ui/tabs.tsx` (Tabs/TabsList/TabsTrigger/TabsContent) — solo consumido con `className` de layout (`w-full sm:w-fit`, `mt-4 flex flex-col gap-4`), sin tocar el archivo.

## Comportamiento implementado (para test-engineer / code-reviewer)

### Vista rápida del socio (`MemberQuickViewSheet`)

- Lee `?ver=<id>` (`parseQuickViewParam`); si no hay id válido, el sheet existe montado pero cerrado (`open=false`) — nunca retorna `null` a secas salvo que se prefiera esa lectura del tipo `React.ReactElement | null` de C7 (mantener siempre montado es necesario para que `ResponsiveSheet` pueda animar el cierre).
- Pide `getMemberQuickView(id)` recién cuando `id` es válido (mismo patrón que `RegisterPaymentSheet`: el pedido se dispara en un efecto keyado por `id`, el `setState` de transición ocurre en el render, no dentro del efecto).
- Estados: `loading` (`LoadingList rows={3}`), `error` (`ErrorState`, con el mensaje de dominio de `getMemberQuickView` — nunca un throw sin capturar), `ready`.
- Contenido en `ready`: `MemberStatusPill`, `categoriesLabel` (ya devuelve "No practicante" para el array vacío, sin rama extra), un bloque de cuenta con `DebtStatusPill` + `accountLineText(state.data)` **reusado tal cual, sin un segundo formato** (criterio explícito de `01-tasks.md`). Sumé una línea "Desde `<PeriodText>`" cuando `debtStatus === 'in_debt'` y `oldestDuePeriod` no es null — dato que `accountLineText` no incluye pero que el producto pide explícitamente ("¿desde cuándo?", `PRODUCT.md` principio 1); esto NO es un segundo formato de la línea de cuenta, es una línea adicional con un dato que la función no cubre.
- Último pago o "Todavía no registró ningún pago."
- Tres acciones: "Registrar pago" → `useOverlayParam('pagar').set(paymentOverlayValue({ mode: 'socio', memberId }))` (reemplaza `ver` por `pagar` automáticamente: `useOverlayParam.set` ya borra los demás nombres de overlay al escribir uno nuevo, así que nunca hay que hacerlo a mano — D2 se cumple gratis). "WhatsApp" (`WhatsAppLink`) solo si `phone` no es null. "Ver ficha completa" → `<Link href="/socios/[id]">` real; al navegar, la URL deja de tener `?ver=`, así que el sheet se cierra solo (no hace falta un `onClick` extra).

**Gap conocido, reportado, no bloqueante**: `MemberQuickViewSheet` tiene cero props (congelado por C7) y no hay ningún contexto de sesión/permisos en el cliente (`AppShellSession` solo trae `displayName`/`role`, sin `permissions`). El botón "Registrar pago" se muestra siempre en `ready`, sin chequear `payments.register` — `01-tasks.md` tampoco lo pide para esta vista (a diferencia de `member-account-section.tsx`, que sí recibe `canRegister` como prop de su Server Component padre y sigue gateado). Si un usuario `consulta` (que tiene `payments.read` pero no `payments.register`) lo toca, el overlay de pago se abre igual y `getPaymentFormData` (ya exige `payments.register`) le va a mostrar un error de permiso dentro del propio sheet — nunca un bypass silencioso, la RLS/permiso real sigue protegiendo la escritura, solo que la UX no es la ideal (un botón que no hace nada útil para ese rol). Sugerencia para una ronda futura: sumar `permissions` a `AppShellSession`/`AppShell` (fuera de mi lane, `src/views/shell/**`) para que los overlays globales puedan gatear sus acciones de escritura igual que el resto del panel.

### Padrón (`member-list.tsx`, `member-list-view.tsx`)

- La fila sigue siendo un `<a href="/socios/[id]">` real (tanto en la fila apilable como en cada celda de la tabla — `DataList`, sin tocar, ya envuelve cada columna en su propio `Link` al mismo `href`). Un click plano (`isPlainLeftClick`, de `overlay-params.ts`) se intercepta con un handler de **captura** (`onClickCapture`) en el contenedor que envuelve `DataList`: `event.target.closest('a[href]')`, valida que el `href` matchee `/socios/(\d+)`, hace `preventDefault()` y `useOverlayParam('ver').set(id)`. Captura y no burbuja a propósito: si se escuchara en burbuja, el propio `<Link>` de Next ya habría disparado la navegación antes de que el handler corriera.
- Cmd/Ctrl+click y clic del medio nunca disparan `click` (el navegador dispara `auxclick`/abre pestaña nueva de forma nativa antes de que React intervenga), así que siguen abriendo `/socios/[id]` en pestaña nueva sin pasar por la vista rápida — verificado leyendo el comportamiento nativo, no hice falta ningún caso especial en el código.
- No implementé stagger de entrada en las filas del padrón (a diferencia de `TopDebtorsList` del inicio). Decisión explícita: (a) `01-tasks.md` F-socios no lo pide — el único criterio de "polish" ahí es click/hover/vacíos, el stagger con techo está especificado solo para F-inicio; (b) `DataList` (compartido, fuera de mi lane) no expone un índice ni un hook de animación por fila en su `renderRow`/`columns`, así que hacerlo bien requeriría tocar ese archivo o reinventar la lista (ambas cosas prohibidas); (c) `operate.md` desaconseja coreografía de carga en un worklist rutinario que se visita muchas veces por día — el padrón es exactamente ese caso, a diferencia de "los más atrasados" (5 filas, se lee una vez por apertura del panel inicial). Dejo esto documentado por si `code-reviewer` lo marca: es una decisión, no un olvido.
- Buscador + filtros: los envolví en un `Panel` (sin título) para que se lean como un solo bloque elevado sobre el lienzo (`bg-canvas`), en vez de flotar sueltos como antes de este pipeline. `SearchInput`/`FilterBar` no cambiaron (siguen siendo compartidos, sin tocar).
- Estados vacío/error/carga: ya existían (`EmptyState` con y sin filtro activo, `LoadingList` vía `DataList`), sin cambios de comportamiento.

### Ficha del socio (`member-detail-view.tsx`, `member-period-strip.tsx`)

- Encabezado + `MemberAccountSection` quedan **siempre visibles**, fuera de cualquier pestaña (como pedía el criterio de aceptación).
- `Tabs` (`components/ui/tabs.tsx`, consumido sin tocar) con 3 valores: `datos` (default), `movimientos`, `historia`. Cada `TabsContent` contiene los mismos `Panel`s de siempre, como hermanos — **ningún `Panel` quedó envuelto en otro `Panel` nuevo**. `datos` = Datos personales + Grupo familiar + Apto físico + Deportes/categorías (los 4 paneles que ya existían, reagrupados). `movimientos` = tira de 12 meses (nueva) + Cuotas + Pagos. `historia` = el panel de historia, igual que antes.
- Todo el contenido que existía sigue accesible — no eliminé nada, solo reagrupé JSX.
- Foco de teclado al cambiar de pestaña: Radix `Tabs.Content` da `tabIndex={0}` al panel activo por default (WAI-ARIA Tabs pattern) — no agregué manejo manual porque no hacía falta; si `test-engineer` encuentra que no aterriza, es un cambio de comportamiento de Radix a re-verificar, no algo que haya desactivado acá.
- Caso `account === null` (sin `payments.read`; hoy los 3 roles fijos lo tienen, así que es una rama defensiva para roles futuros): la pestaña "Movimientos" muestra un texto explicativo en vez de quedar vacía sin avisar.
- `TabsList` recibe `className="w-full sm:w-fit"` (layout, no toqué altura/padding): evalué forzar `h-11` para el piso de 44px pero el override por `className` compite con clases con modificador de grupo (`group-data-horizontal/tabs:h-8`) que `tailwind-merge` puede no deduplicar de forma confiable contra una clase sin modificador — más específicamente, la regla `[data-orientation=horizontal] .h-8` puede ganarle a `.h-11` por especificidad de atributo. No quise dejar una clase "muerta" que aparente resolver el piso de 44px sin hacerlo de verdad. **Reporto esto como pendiente para F-shell/quien posea `components/ui/tabs.tsx`**: el alto por default de `TabsList`/`TabsTrigger` (`h-8`, 32px) está debajo del piso de 44px del proyecto: como F-shell ya está dándole a `Tabs` un indicador animado (mismo archivo, en paralelo), es el lugar correcto para resolver también el alto táctil, no un `className` desde cada consumidor.

### `MemberPeriodStrip` (nuevo)

- Deriva 12 períodos con `addMonths(billing.currentPeriod, -i)` (nunca `new Date()` en el cliente — reusa el período ya calculado en el servidor con la hora del club, `billing.currentPeriod` que la ficha ya carga).
- Agrupa `account.statement` (`FeeStatementLine[]`, ya cargado por `getMemberPage`, **ninguna consulta nueva**) por `period` y deriva un estado agregado por celda: `pagado` (todas las líneas activas del período pagas), `parcial` (alguna línea activa parcial), `adeudado` (alguna línea activa debida, ninguna parcial), `anulado` (todas las líneas del período anuladas), `sin cargo` (sin ninguna línea).
- Cada celda lleva el mes (`shortMonth`, de `chart-kit.tsx`) y la palabra del estado como texto real (nunca solo color), más un `title` nativo con la fecha completa como ayuda extra para mouse. Grilla `grid-cols-6 sm:grid-cols-12` — nunca scroll horizontal.
- Simplificación conocida: una línea de `kind: 'opening_balance'` (saldo de arranque, cuando existe) entra al mapeo por su `period` como cualquier otra línea, aunque semánticamente representa deuda acumulada "hasta" ese período, no un cargo puntual de ese mes. Es un caso raro (solo socios migrados con saldo de Excel) y el resultado visual sigue siendo razonable (esa celda se ve "adeudada" mientras el saldo no esté cubierto); no lo separé para no sumar una quinta categoría de estado que ningún criterio pidió.

## Deferrals

- Polish visual de `member-form.tsx` (ítem 5 del pedido): no toqué el archivo. Ya hereda el nuevo look de `Panel` (sombra elevada, `rounded-xl`) sin cambios de mi parte porque `Panel` es compartido y el hilo principal ya lo restyled en Ola 0. Evalué un submit sticky en mobile y lo descarté: no tengo forma de verificar visualmente el offset correcto contra la barra inferior fija (`MobileBottomNav`, `src/views/shell/**`, fuera de mi lane) sin herramientas de captura de pantalla en este entorno, y un offset mal calculado dejaría el botón de guardar tapado por la barra — preferí no arriesgar un submit invisible en el flujo más usado del sistema. Queda como sugerencia para una ronda con verificación visual.
- Gating de permisos en `MemberQuickViewSheet` para "Registrar pago" (ver arriba, sección de la vista rápida): reportado como cross-lane con `src/views/shell/**`, no soy dueño de ese archivo ni de `AppShellSession`.
- Alto táctil de `TabsList`/`TabsTrigger` (32px vs. el piso de 44px): reportado para quien posea `components/ui/tabs.tsx` (F-shell, en paralelo en esta misma tanda).

## Verificación

- `npx tsc --noEmit` sobre el repo completo: **0 errores** (incluye la integración con `getMemberQuickView` de B1, que landed durante la sesión).
- `npx eslint src/views/members/` (todos los archivos de esta slice): **0 errores, 0 warnings**.
- No corrí `npm install`, no toqué migraciones, no reseteé la base, no corrí `next build`/`dev`/`start`.

---

## Ronda 2 — fixes de revisión de screenshots

El hilo principal ya había aplicado, antes de esta ronda, dos cambios que mantuve tal cual: `useHasPermission('payments.register')` (de `@/views/shell/panel-session`, contexto de sesión para los overlays globales) gateando "Registrar pago" en `member-quick-view-sheet.tsx`, y el import de `shortMonth` en `member-period-strip.tsx` movido de `@/views/shared/chart-kit` (Client, rompía el build de Server Components) a `@/views/shared/chart-format` (puro, sin `'use client'`).

### Archivo nuevo

- `src/views/members/member-account-answer.tsx` — `MemberAccountAnswer`, la pieza que reemplaza a `DebtStatusPill` + `accountLineText` lado a lado en los dos lugares donde convivían diciendo lo mismo dos veces (la ficha y la vista rápida). Mismo lenguaje visual que `HeroFigure`/`MoneySummaryStrip` (bloque `bg-brand-soft`, `rounded-xl`, `border-border/70`, `shadow-raised`; número grande en tipografía proporcional, nunca `tabular-nums`, mismo criterio documentado en `HeroFigure`): tres casos —
  - `up_to_date`: el titular ES el texto "Al día" en verde (`text-status-up-to-date`), sin monto (no hay nada que contar).
  - `credit`: titular "Saldo a favor $X" en verde (mantiene el monto explícito: un titular vacío tipo "$X" solo, sin la palabra, se leería ambiguo sobre si es deuda o saldo a favor).
  - `in_debt`: titular = el monto solo, en rojo (`text-status-in-debt`); una única línea debajo (no dos apiladas) junta "Debe desde `<mes>` · N meses" + "Último pago `<monto>` el `<fecha>`" separados por " · ", envolviendo si hace falta a 390px.
  - Dejé afuera el prefijo "Dado de baja ·" que traía `accountLineText`: en los dos consumidores (`member-detail-view.tsx`, `member-quick-view-sheet.tsx`) el estado activo/baja del socio YA se muestra aparte con `MemberStatusPill` (en el encabezado de la ficha y en la fila de categorías de la vista rápida) — repetirlo acá habría sido exactamente la duplicación que este fix pide eliminar, solo que en la dirección contraria.

### Fix 1 y 2 — la cuenta como LA respuesta (ficha + vista rápida)

- `member-account-section.tsx`: reemplacé el bloque `DebtStatusPill` + `<p>{accountLineText(account)}</p>` + línea de último pago (3 elementos separados, texto chico) por `<MemberAccountAnswer account={account} />` como primer hijo del panel "Cuenta", antes del aviso de facturación inactiva y de los botones. Quité los imports que quedaron sin uso (`DebtStatusPill`, `DateText`, `accountLineText`); `Amount` se mantiene (lo sigue usando el texto de "Ya tiene un saldo anterior cargado").
- `member-quick-view-sheet.tsx`: mismo reemplazo. La fila de arriba (`MemberStatusPill` + categorías) queda igual — no es la misma información que `MemberAccountAnswer` muestra (una es el estado del socio, la otra el estado de la cuenta), así que no hay duplicación ahí.

### Fix 3 — botones del encabezado, más chicos

- `member-detail-view.tsx`: "Editar" pasa de `className="h-11"` a `size="sm"`. `member-status-actions.tsx`: "Dar de baja"/"Reactivar" ídem. `size="sm"` en `components/ui/button.tsx` (compartido, sin tocar) da **igual 44px de alto** (`h-11` está en su propia definición de la variante `sm`, con menos padding horizontal y texto en `0.8rem`) — nunca un botón por debajo del piso táctil, solo más liviano visualmente. La disposición (columna en móvil con los botones debajo del nombre, fila con `justify-between` desde `sm` con los botones a la derecha) ya era así desde el slice anterior; no hizo falta reestructurar el layout, solo bajarles el peso visual para que no compitan con la cuenta de abajo.

### Fix 4 — tira de 12 meses: de 6×2 con palabra completa a 12×1 con ícono

- `member-period-strip.tsx`: reemplacé el par mes-abreviado/palabra-de-estado (que envolvía mal en una grilla de 6 columnas a 390px) por una sola fila de 12 celdas angostas (`grid-cols-12`, sin variante `sm:` — el mismo diseño en todos los anchos). Cada celda: un ícono `lucide-react` distinto por estado (`Check` pagado, `CircleDashed` parcial, `AlertCircle` adeudado, `Ban` anulado, `Circle` sin cargo — la forma cambia, no solo el color, así que sigue siendo legible para daltonismo) + la inicial del mes (`shortMonth(period).slice(0, 1)`, 12px) debajo, los dos en el color de estado. Quité el fondo por celda (`STATUS_BG_CLASS`): con el ícono como segunda señal ya no hace falta un tercer refuerzo visual, y el fondo era lo que forzaba el alto de 2 líneas que no entraba a 390px.
- Accesibilidad: cada celda lleva `title` nativo (mouse) y un `<span className="sr-only">` con el texto completo ("septiembre 2026: adeudado") — un lector de pantalla nunca escucha solo una inicial suelta. El ícono y la inicial visibles llevan `aria-hidden` porque el `sr-only` ya cubre el mismo contenido en texto completo (evita que se anuncie dos veces).

### Verificación (ronda 2)

- `npx tsc --noEmit` sobre el repo completo: **0 errores**.
- `npx eslint src/views/members/`: **0 errores, 0 warnings**.
- No toqué `src/views/shell/panel-session.tsx` ni `src/views/shared/chart-format.ts` (ya existían con los cambios del hilo principal antes de que empezara esta ronda) ni ningún archivo fuera de `src/views/members/**`.

---

## Ronda 3 — code-review: tarjeta dentro de tarjeta

`member-account-section.tsx` renderizaba `<MemberAccountAnswer>` (su propia caja `rounded-xl border bg-brand-soft shadow-raised`) como hijo de `<Panel title="Cuenta">` — una tarjeta dentro de otra, aunque `MemberAccountAnswer` no sea literalmente un `Panel`, se leía igual (piso de calidad: nada se anida).

- `member-account-answer.tsx`: sumé `variant?: 'card' | 'plain'` (default `'card'`). `'card'` es el tratamiento de siempre (borde, radio, sombra) — lo sigue usando `member-quick-view-sheet.tsx` sin cambios, porque ahí el bloque no está dentro de ningún otro contenedor con chrome propio. `'plain'` saca borde/sombra/radio y deja una banda `bg-brand-soft` que sangra a los bordes del padding del panel que la contiene (`-mx-4 -mt-4 px-4 pt-4 pb-3`, cancela exactamente el `p-4` del cuerpo de `Panel`): el color sigue marcando "esto es lo importante" sin dibujar una segunda caja.
- `member-account-section.tsx`: pasa `variant="plain"` al montar `MemberAccountAnswer` dentro de `Panel title="Cuenta"`.
- Botones "Pago del grupo"/"Cargar saldo anterior": sin cambios (el pedido era mantenerlos tal cual).

Verificación: `npx tsc --noEmit` → 0 errores; `npx eslint src/views/members/` → 0 errores/warnings. Nada fuera de `src/views/members/**` tocado.

---

## Ronda 4 — pedido de Tomás: buscador en "Grupo familiar"

El hilo principal ya había instalado `cmdk` y sumado `src/components/ui/command.tsx` + `input-group.tsx` (shadcn) antes de esta ronda — los consumo tal cual, sin tocarlos.

### Archivo nuevo

- `src/views/members/family-group-combobox.tsx` — `FamilyGroupCombobox<T>`, más las sentinelas `NO_GROUP`/`NEW_GROUP` (antes vivían como `const` locales de `member-form.tsx`; ahora las exporta este archivo porque es el que arma la lista completa, y `member-form.tsx` las importa de acá en vez de duplicarlas).
  - Trigger: un `Button variant="outline"` de 44px con el label elegido (o "Elegí una opción") + chevron — mismo aspecto que un `SelectTrigger`.
  - Escritorio (`md+`, mismo breakpoint que `AppShell`/`ResponsiveSheet`): `Popover` anclado al trigger, `PopoverContent` del ancho del trigger (`w-(--radix-popover-trigger-width)`, sintaxis Tailwind v4 con paréntesis) conteniendo el `Command`.
  - Mobile (`< md`): `Sheet` (`side="bottom"`) con el mismo `Command` adentro — nunca `ResponsiveSheet` (ese primitivo da `Dialog` centrado en escritorio, no un `Popover` anclado al campo, que es lo que pidió Tomás). Repliqué localmente el hook `useIsDesktop` de `ResponsiveSheet` (no está exportado desde ese archivo compartido; 8 líneas, más barato que pedir un export nuevo).
  - Filtro: `filter` propio de `cmdk` con normalización NFD (saca tildes) + minúsculas — "Perez" encuentra "Pérez". Usé `filter`, no `shouldFilter={false}` + filtrado manual (la otra opción que sugirió el pedido): `cmdk` ya resuelve el resaltado por teclado y el conteo de "vacío" contra el resultado del `filter`, así que no hay que reimplementar eso.
  - "Crear un grupo nuevo" (`NEW_GROUP`) vive en su propio `CommandGroup forceMount` con `CommandItem forceMount`: queda siempre visible al final sin importar el texto buscado, y `cmdk` lo saca del conteo que decide si aparece `CommandEmpty` — "No hay grupos con ese nombre." y esta opción conviven en pantalla al mismo tiempo, tal como se pidió. **Nota de copy**: el pedido decía "Crear grupo nuevo", pero el texto real que ya existía en `member-form.tsx` es "Crear un grupo nuevo" — preservé el texto EXISTENTE tal cual (consigna explícita: "preserving the current special options exactly"), no inventé un cambio de copy.
  - Teclado: flechas/Enter/Escape los da `cmdk`/Radix de fábrica (`Command` maneja la navegación, `Popover`/`Sheet` de Radix cierran con Esc y devuelven el foco al trigger al cerrarse — comportamiento por defecto, no hizo falta código extra). `handleSelect` cierra (`setOpen(false)`) al elegir cualquier opción.
  - Accesibilidad del campo: mismo patrón que `views/shared/form-fields.tsx` (que no toqué, es compartido) — `Field`/`FieldContent`/`FieldLabel htmlFor`/`FieldError` con `id`/`aria-invalid`/`aria-describedby` en el trigger.
- `member-form.tsx`: reemplacé el `<SelectField familyGroupChoice ...>` + el array `familyGroupOptions` armado a mano por `<FamilyGroupCombobox control={form.control} name="familyGroupChoice" familyGroups={familyGroups} disabled={pending} />`. El resto del formulario (el bloque condicional de "Crear un grupo nuevo" que revela `newGroupName`/`newGroupPayerContactName`/`newGroupPayerContactPhone`, y el guardado en `onValid`) no cambió — sigue leyendo `familyGroupChoice` con `useWatch` exactamente igual, porque el valor que devuelve el combobox es el mismo string sentinel/id que devolvía el `<select>`.
- Revisé `family-group-section.tsx` (gestiona el responsable de pago DENTRO de un grupo ya armado, no elige un grupo) — no tiene ningún selector de grupo familiar, así que no había otro lugar donde aplicar el mismo componente.

Verificación: `npx tsc --noEmit` → 0 errores; `npx eslint src/views/members/` → 0 errores/warnings. Nada fuera de `src/views/members/**` tocado; no se instaló nada (ya lo había hecho el hilo principal), no se corrió build/dev.
