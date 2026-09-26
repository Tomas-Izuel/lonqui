---
name: Club Naranja y Blanco — Gestión
description: Panel administrativo del Club Social y Deportivo Lonquimay. El estándar de la categoría, ejecutado completo — Linear en precisión, Mercado Pago en claridad.
colors:
  ink: "#111827"
  ink-secondary: "#6B7280"
  surface: "#F7F7F8"
  border: "#E5E7EB"
  primary: "#C2410C"
  primary-hover: "#9A3412"
  brand: "#F26A1B"
  status-up-to-date: "#15803D"
  status-in-debt: "#B91C1C"
  status-inactive: "#6B7280"
  background: "#FFFFFF"
typography:
  heading:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontFeature: "tabular-nums"
rounded:
  sm: "4.8px"
  md: "6.4px"
  lg: "8px"
  xl: "11.2px"
spacing:
  sidebar: "240px"
  content-max: "1024px"
  touch-target: "44px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
---

# Design System: Club Naranja y Blanco — Gestión

## Overview

**Creative North Star: "El mostrador de la sede, en el celular"**

Este no es un dashboard SaaS genérico ni una app de hinchada: es la herramienta de tarea de siete voluntarios que atienden un club de barrio desde su propio celular, muchas veces al sol, en la cancha, con alguien esperando. La dirección elegida (2026-09-25, `.impeccable/surfaces/route.md`) es **el estándar de la categoría ejecutado completo**: la convención de panel administrativo — barra lateral, navegación inferior, tablas que colapsan, formularios de una columna — sin metáforas ni rarezas. La vara de terminación es **Linear** (precisión, calma, un solo estado activo por vez) y el **panel de Mercado Pago** (claridad absoluta para usuarios argentinos no técnicos que no van a recibir capacitación presencial).

La identidad del club vive en el naranja institucional, pero **nunca como texto**: es la marca del escudo, del ítem de navegación activo y del anillo de foco. Todo lo demás — botones, links, el color que efectivamente lee la gente — es un tono más oscuro y más serio, medido para pasar 4,5:1 sobre blanco. Esto rechaza tanto el extremo "SaaS gris intercambiable" (nada dice que es *este* club) como el extremo "app de hinchada" (nada compite con la tarea).

Mobile first no es una frase: es la restricción real de que la sede no tiene computadora fija. Toda pantalla se diseña primero a 390px, con una mano; el escritorio de 1440px es una adaptación con barra lateral, no el punto de partida.

**Key Characteristics:**
- Tema claro fijo (se usa al sol, en exteriores); no hay modo oscuro en este slice.
- Una sola familia tipográfica (Geist) para títulos, cuerpo y datos.
- El naranja institucional es una marca, no un color de texto.
- Densidad de panel administrativo (tablas, filtros, keyset), nunca una vitrina de producto.
- Un único momento de confirmación explícita: acciones con consecuencia (baja, anulación, cerrar sesión) piden motivo o confirman con texto que nombra la consecuencia — nunca la palabra "eliminar".

## Colors

Restrained: un solo acento de marca, reservado a marcas no textuales; el color que efectivamente se lee es un naranja más oscuro y más serio.

### Primary
- **Naranja quemado** (`#C2410C`): fondo del botón de acción primaria (texto blanco, 5,18:1) y color de los links. Hover **naranja quemado oscuro** (`#9A3412`, 7,31:1 con texto blanco). Es la única acción "que hace algo" en cada pantalla.

### Neutral
- **Tinta** (`#111827`): texto principal, 17,74:1 sobre blanco.
- **Tinta secundaria** (`#6B7280`): texto de apoyo, metadatos, placeholders — 4,83:1 sobre blanco, 4,52:1 sobre la superficie gris. Nunca por debajo de ese piso: si un texto secundario necesita ser más claro, el diseño está mal, no el texto.
- **Fondo** (`#FFFFFF`) y **Superficie** (`#F7F7F8`): el fondo es el lienzo del contenido; la superficie es la segunda capa neutra (barra lateral, cabeceras de tabla, filas de skeleton) — más fría que el contenido, nunca más llamativa.
- **Borde** (`#E5E7EB`, 1px): el único trazo permitido en tarjetas, tablas y separadores.

### Named Rules
**La Regla del Naranja Mudo.** El naranja institucional (`#F26A1B`, marca del club) nunca es color de texto: sobre blanco da 3,06:1, no pasa el piso de accesibilidad. Vive únicamente en el escudo, el fondo tenue del ítem de navegación activo (`bg-brand/10` + ícono `text-brand`) y el anillo de foco (`--ring`). Todo lo demás — botón primario, links, "Cambiar contraseña", cualquier CTA — usa `#C2410C`.

**La Regla del Estado con Texto.** Ningún estado (activo/baja, al día/con deuda, admin/editor/consulta) se comunica solo con color. `StatusPill` y `RolePill` siempre llevan la etiqueta en español al lado del color.

## Typography

**Body/Heading/Data Font:** Geist (variable, cargada con `next/font/google`), con fallback a la pila `ui-sans-serif` del sistema.

**Character:** una sola familia hace todo el trabajo — títulos, formularios, tablas y montos — sin una segunda voz de "display". Es la lectura de un panel de tarea, no de una landing.

### Hierarchy
- **H1** (semibold 600, `text-xl`/`text-2xl` según breakpoint, `text-balance`): título de página (`PageHeader`), sin kicker/eyebrow arriba nunca.
- **H2** (semibold 600, `text-base`): título de sección (`Panel`), no se anida un `Panel` dentro de otro.
- **Body** (regular 400, `text-sm`/`text-base`): copy de formularios, descripciones, listas.
- **Numerales tabulares**: `font-variant-numeric: tabular-nums` (clase `tabular-nums`) en `Amount`, `Dni`, `DateText`/`DateTimeText` y cualquier celda de tabla con datos numéricos o de fecha — para que las columnas alineen dígito a dígito.
- **Label** (medium, `11px`): la única etiqueta de la barra inferior móvil (`MobileBottomNav`), bajo el ícono. Es el único paso fuera de la escala `text-sm`/`text-base`/`text-xl`/`text-2xl` — deliberado: cinco destinos tienen que entrar en 390px sin truncar, como en cualquier tab bar de referencia (iOS/Android).

### Named Rules
**La Regla del Monoespaciado Ausente.** No hay una fuente monoespaciada en el sistema: la disciplina de alineación numérica la da `tabular-nums` sobre la misma Geist, no un cambio de fuente. Monoespaciada de disfraz está prohibida por el piso de calidad.

## Layout

Móvil (referencia): una columna de contenido con `padding` lateral de 16px, barra superior fija de 56px (escudo + nombre + menú de usuario) y barra inferior fija de navegación (56–64px más el *safe area*), con el contenido dejando `padding-bottom` para no quedar tapado. El buscador grande del panel inicial es de 48px de alto (`h-12`) con foco inmediato.

Escritorio (adaptación): barra lateral fija de **240px** (`w-60`) con el escudo arriba, la navegación al medio y el menú de usuario abajo; el contenido corre en un contenedor centrado de hasta `max-w-5xl` (~1024px, la aproximación en la escala de Tailwind a los 960px del brief).

Formularios: siempre de una columna, pensados para completarse con una mano — nunca una grilla de dos columnas de campos en móvil.

Tablas/listas (`DataList`): en `< md` colapsan a filas apilables con título, subtítulo y un meta a la derecha (mismo patrón que la barra inferior: información jerarquizada, no comprimida); en `≥ md` se leen como tabla completa.

## Elevation & Depth

El sistema es mayormente plano: `Panel`, `DataList` y los diálogos usan un borde de 1px (`#E5E7EB`) para separar superficies, no una sombra. Los componentes flotantes (menú desplegable, popover, diálogo) sí llevan una sombra suave con blur (heredada de shadcn: `shadow-md`/`shadow-lg` con `ring-1 ring-foreground/10`), nunca un `box-shadow` de offset duro sin blur.

### Named Rules
**La Regla de la Sombra Solo Flotante.** Una sombra aparece únicamente cuando algo se despega del flujo del documento (dropdown, popover, diálogo, sheet). El contenido en el flujo normal se separa con borde, no con sombra.

## Shapes

Radio base de **8px** (`--radius`), derivado en la escala de shadcn (`--radius-sm` 4.8px, `--radius-md` 6.4px, `--radius-lg` 8px — el que usan `Button`, `Input`, `Panel`, `DataList`). Bordes de 1px en todas las superficies separadas; nunca un `border-left` de color de más de 1px (piso de calidad).

## Components

### Buttons
- **Shape:** `rounded-lg` (8px).
- **Primary:** fondo `#C2410C`, texto blanco, alto mínimo 44px en los formularios de auth (`h-11`); hover exacto `#9A3412` (token `--primary-hover`, aplicado con un override puntual en `globals.css` porque el `hover:bg-primary/80` por defecto de shadcn mezcla con blanco en vez de oscurecer).
- **Secondary/Outline/Ghost:** heredados de shadcn sin cambios — el sistema no inventa una segunda familia de botones.
- **Loading:** ícono `Loader2` (lucide, `animate-spin`) + texto que termina en "…" ("Guardando…", "Ingresando…"); el botón se deshabilita recién cuando el pedido arrancó, no antes.

### Inputs / Fields
- **Style:** borde 1px `#E5E7EB`, radio 8px, fondo blanco (o `bg-input/30` en los variantes de shadcn).
- **Focus:** anillo de 3px del color de marca (`--ring: #F26A1B`) — el único lugar además del escudo y el ítem de navegación activo donde el naranja institucional aparece.
- **Error:** borde y anillo `destructive` (`#B91C1C` a través del token `--destructive` de shadcn) + mensaje inline debajo (`FieldError`, `role="alert"`).
- **Numérico/medición:** `tabular-nums` en `DniField`, `DateField` y cualquier columna de datos.

### Navigation
- **Barra lateral (escritorio):** ítems de 44px de alto, ícono + etiqueta; el ítem activo lleva fondo `bg-brand/10` e ícono `text-brand`, texto en tinta normal (nunca el naranja institucional como texto) — nunca un bloque saturado.
- **Barra inferior (móvil):** mismos ítems, en columna (ícono arriba, etiqueta abajo, ≥ 44px de target), con un óvalo `bg-brand/10` detrás del ícono activo.
- **Menú de usuario:** `DropdownMenu` con nombre, `RolePill` y las dos acciones ("Cambiar contraseña", "Cerrar sesión" con confirmación breve).

### Status & Role Pills
- Cápsula (`rounded-full`), fondo del color al 10% de opacidad + texto del color sólido + un punto decorativo — nunca solo el punto, siempre con la etiqueta en español.

### Dialogs (ReasonDialog, confirmaciones)
- El único modal sin condiciones del piso de calidad: siempre pide motivo (y a veces fecha) para una acción con consecuencia, con un botón que nombra la acción ("Dar de baja", "Reactivar", "Cerrar sesión") — nunca "Eliminar".

## Do's and Don'ts

### Do:
- **Do** usar `#C2410C`/`#9A3412` para toda acción primaria y link; documentar cualquier color nuevo con su contraste medido antes de usarlo como texto.
- **Do** poner el naranja institucional (`#F26A1B`) solo en el escudo, el indicador de navegación activo y el anillo de foco.
- **Do** escribir los filtros, la búsqueda y el cursor de paginación en `searchParams` (no en estado local): es lo que permite retomar una tarea después de una interrupción.
- **Do** dar estado default/hover/focus/disabled/loading/error a todo control interactivo nuevo.
- **Do** usar `tabular-nums` en cualquier columna de montos, DNI o fechas.

### Don't:
- **Don't** usar el naranja institucional como color de texto (falla WCAG AA, 3,06:1).
- **Don't** anidar un `Panel` dentro de otro `Panel`, ni construir una grilla de tarjetas icono+título+texto como estructura de página.
- **Don't** poner un kicker/eyebrow arriba de un título — es un ban sin excepciones.
- **Don't** usar la palabra "eliminar" en ningún lado de la interfaz: las acciones con historia se dan de baja o se anulan, con motivo.
- **Don't** usar `autoFocus` fuera de los lugares que el brief pide explícitamente (buscador grande del panel inicial, primer campo de login) — en cualquier otro formulario, dejar que el usuario elija dónde empezar.
