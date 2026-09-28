---
name: Club Naranja y Blanco — Gestión
description: Panel administrativo del Club Social y Deportivo Naranja y Blanco. El estándar de la categoría, ejecutado completo — Linear en precisión, Mercado Pago en claridad.
colors:
  ink: "#111827"
  ink-secondary: "#6B7280"
  background: "#FFFFFF"
  surface: "#F7F7F8"
  border: "#E5E7EB"
  primary: "#C2410C"
  primary-hover: "#9A3412"
  brand: "#F26A1B"
  destructive: "#B91C1C"
  status-up-to-date: "#15803D"
  status-in-debt: "#B91C1C"
  status-inactive: "#6B7280"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  headline-desktop:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.33
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
  data:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "4.8px"
  md: "6.4px"
  lg: "8px"
  xl: "11.2px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  touch-target: "44px"
  top-bar: "56px"
  sidebar: "240px"
  content-max: "1024px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "44px"
  button-outline-hover:
    backgroundColor: "{colors.surface}"
  button-destructive:
    backgroundColor: "#B91C1C1A"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    height: "44px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "44px"
  input-home-search:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "48px"
  select-trigger:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "8px 8px 8px 10px"
    height: "44px"
  nav-item:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  nav-item-active:
    backgroundColor: "#F26A1B1A"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  bottom-nav-item:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    height: "56px"
  bottom-nav-item-active:
    textColor: "{colors.ink}"
    backgroundColor: "#F26A1B1A"
    rounded: "{rounded.full}"
    size: "32px"
  panel:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: "16px"
  data-list-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    padding: "12px"
    height: "44px"
  status-pill-up-to-date:
    backgroundColor: "#15803D1A"
    textColor: "{colors.status-up-to-date}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  status-pill-in-debt:
    backgroundColor: "#B91C1C1A"
    textColor: "{colors.status-in-debt}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  status-pill-inactive:
    backgroundColor: "#6B72801A"
    textColor: "{colors.status-inactive}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  role-pill-admin:
    backgroundColor: "#C2410C1A"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "24px"
  club-mark:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    size: "36px"
---

# Design System: Club Naranja y Blanco — Gestión

## Overview

**Creative North Star: "El mostrador de la sede, en el celular"**

Es la herramienta de tarea de una Comisión de voluntarios que atiende un club de barrio desde su propio celular, muchas veces al sol, con alguien esperando. La dirección elegida (2026-09-25, `.impeccable/surfaces/route.md`) es **el estándar de la categoría ejecutado completo**: la convención de panel administrativo — barra superior y navegación inferior en el celular, barra lateral en escritorio, listas que en escritorio se leen como tabla, formularios de una columna — sin metáfora. La vara de terminación es **Linear** (precisión, calma, un solo estado activo por vez) y el **panel de Mercado Pago** (claridad para usuarios argentinos no técnicos).

La identidad del club vive en el naranja institucional, pero nunca como texto: es el escudo, el indicador del destino activo y el anillo de foco. El color que la gente efectivamente lee y toca — botón primario, links — es un naranja quemado más oscuro, medido para pasar AA sobre blanco. Rechaza a la vez el SaaS gris intercambiable (nada diría que es *este* club) y la app de hinchada (nada compite con la tarea).

Mobile first es la restricción real: la sede no tiene computadora fija. Cada pantalla se diseña primero a 390px con una mano; el escritorio de 1440px es una adaptación con barra lateral, nunca el punto de partida.

**Key Characteristics:**
- Tema claro fijo, pensado para leerse en exteriores; no existe variante oscura.
- Una sola familia (Geist) para títulos, cuerpo y datos; la alineación numérica la dan los numerales tabulares.
- El naranja institucional es una marca, no un color de texto.
- Plano por defecto: bordes de 1px separan; la sombra es solo de lo que flota.
- Todo lo que se toca mide 44px como mínimo.

## Colors

Restrained: neutros fríos de panel y un solo acento del club, partido en dos tonos — uno para marcar, otro para leer.

### Primary
- **Naranja quemado** (primary): fondo del botón primario con texto blanco (5,18:1), color de los links y del rol Administrador. Es la única acción "que hace algo" en cada pantalla. Su hover es el **naranja quemado profundo** (primary-hover, 7,31:1 con blanco), aplicado con un override exacto porque la mezcla por opacidad de shadcn aclaraba en vez de oscurecer.
- **Naranja institucional** (brand): el naranja del club. Escudo (`ClubMark`), fondo tenue al 10% y ícono del destino de navegación activo, y anillo de foco (`--ring`). Sobre blanco da 3,06:1: no es color de texto.

### Neutral
- **Tinta** (ink, 17,74:1 sobre blanco): texto principal, títulos, etiqueta del destino activo.
- **Tinta secundaria** (ink-secondary, 4,83:1 sobre blanco, 4,52:1 sobre la superficie): descripciones, metadatos, placeholders, íconos de apoyo, destinos de navegación inactivos. Es el piso: ningún texto más claro que este.
- **Fondo** (background): lienzo del contenido, barra superior móvil, barra inferior, paneles, diálogos.
- **Superficie** (surface): la segunda capa neutra — barra lateral de escritorio, hover de filas y menús, pie de diálogos, skeletons, avatar.
- **Borde** (border): el único trazo, siempre 1px, en paneles, listas, tablas, inputs y separadores de barras.

### Estados
- **Al día / activo** (status-up-to-date, 5,02:1), **con deuda** (status-in-debt, 6,47:1) y **baja / inactivo** (status-inactive): texto sólido sobre un fondo del mismo color al 10%. El rojo de deuda es el mismo valor que `destructive`, que tiñe errores de campo y acciones con consecuencia.

### Named Rules
**La Regla del Naranja Mudo.** El naranja institucional nunca es texto. Vive solo en el escudo, el indicador del destino activo y el foco; toda acción y todo link usa el naranja quemado.

**La Regla del Estado con Texto.** Ningún estado (activo/baja, al día/con deuda, rol) se comunica solo con color: la cápsula siempre lleva la etiqueta en español; el punto es decorativo.

## Typography

**Display / Body / Data Font:** Geist (variable, `next/font/google`), con fallback `ui-sans-serif, system-ui, sans-serif`.

**Character:** una sola voz neutra y precisa hace todo el trabajo; la jerarquía la cargan tamaño y peso, sin una segunda familia de display.

### Hierarchy
- **Headline** (600, 20px en móvil / 24px desde `sm`, `text-balance`): el título de página de `PageHeader`, uno por pantalla. Incluye el saludo del inicio.
- **Title** (600, 16px): título de `Panel` y de diálogos/sheets (estos en 500).
- **Body** (400, 16px): valor de inputs y textareas en móvil (16px evita el zoom de iOS; bajan a 14px desde `md`), buscadores, copy base.
- **Body-sm** (400/500, 14px): el tamaño de trabajo del panel — filas de tabla, descripciones, botones, destinos de la barra lateral, selects.
- **Label** (500, 12px): cápsulas de estado y rol, etiquetas de filtros, etiqueta de la barra inferior. Es el piso de la escala.
- **Data** (numerales tabulares): `Amount`, `Dni`, `DateText`/`DateTimeText`, campos de DNI y fecha y toda columna numérica, alineada a la derecha.

### Named Rules
**La Regla de la Escala Cerrada.** Solo cinco tamaños: 12, 14, 16, 20, 24px. Nada de tamaños a mano (`text-[11px]` ya se retiró de la barra inferior).

**La Regla del Monoespaciado Ausente.** No hay fuente monoespaciada: la disciplina numérica es `tabular-nums` sobre Geist. Nada en mayúsculas sostenidas ni con tracking de rótulo.

## Layout

**Móvil (la referencia, 390px):** una columna con 16px de margen lateral y 16px de separación entre bloques. Barra superior pegajosa de 56px (escudo, "Naranja y Blanco", menú de usuario) con borde inferior. Barra inferior fija con un destino por rol (56px de alto por destino más el *safe area*), ícono de 20px en un óvalo de 32px y etiqueta debajo; el contenido reserva 80px abajo para no quedar tapado. La acción primaria de página va debajo del título, alineada a la izquierda; los filtros bajan en filas que envuelven.

**Escritorio (adaptación, ≥ 768px):** barra lateral fija de 240px sobre la superficie, con escudo arriba, destinos al medio y usuario abajo; contenido con 24px de margen y un contenedor centrado de hasta 1024px. El título y su acción comparten fila desde `sm`.

**Ritmo:** escala de 4px — 4 (dentro de un grupo de texto), 8 (ícono–etiqueta, botones en fila), 12 (filas, cabeceras de panel), 16 (entre bloques, padding de panel), 24 (entre secciones de formulario).

**Formularios:** siempre de una columna.

**Listas (`DataList`):** debajo de `md` son filas apiladas dentro de un único borde (título, subtítulo, meta en su propia línea, acciones a la derecha, chevron si la fila navega); desde `md` son una tabla completa con cabecera de 40px.

## Elevation & Depth

Plano por capas tonales: el fondo blanco es el contenido, la superficie gris es la navegación y los estados de hover, y el borde de 1px es lo que separa. El contenido en el flujo no lleva sombra. Lo que flota sí: menús, selects y popovers llevan una sombra suave con blur más un anillo de 1px de tinta al 10%; los sheets, una sombra más amplia. Los diálogos se separan con el anillo sobre un velo de negro al 10% con desenfoque leve.

### Shadow Vocabulary
- **Flotante bajo** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` + anillo `0 0 0 1px rgb(17 24 39 / 0.1)`): menús desplegables, selects, popovers.
- **Flotante alto** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): sheets laterales y submenús.

### Named Rules
**La Regla de la Sombra Solo Flotante.** Una sombra aparece únicamente cuando algo se despega del documento. Nunca una sombra sin blur, nunca sobre un panel o una fila.

## Shapes

Esquinas suavemente redondeadas desde una sola base de 8px (`--radius`): botones, inputs, selects, paneles, listas, ítems de navegación y el escudo usan 8px; los ítems dentro de menús 6,4px; los diálogos 11,2px. Las cápsulas de estado/rol, el avatar y el óvalo del destino activo móvil son píldoras completas. El checkbox es un cuadrado de 16px con 4px de radio. Todo trazo es de 1px; ningún borde de acento a un costado.

## Components

### Buttons
Directos y sobrios: la forma estándar, el color hace el trabajo.
- **Shape:** 8px de radio, texto 14px/500, ícono lucide de 16px a 6px del texto.
- **Primary:** naranja quemado con texto blanco; hover exacto al naranja quemado profundo. Alto de 44px en toda acción que se toca.
- **Outline:** fondo blanco, borde 1px, texto tinta; hover a la superficie. Es la acción secundaria (cancelar, adjuntar, WhatsApp, cargar más).
- **Ghost:** sin fondo; hover a la superficie. Íconos de fila y "Limpiar".
- **Destructive:** rojo al 10% con texto rojo, nunca un bloque rojo sólido; se usa para confirmar una baja o una desactivación.
- **Focus:** borde al naranja institucional más anillo de 3px al 50%; además, `:focus-visible` global con contorno de 2px y 2px de separación.
- **Pressed / disabled / loading:** baja 1px al presionar; deshabilitado al 50%; cargando con `Loader2` girando y un texto que termina en "…" ("Guardando…").

### Inputs / Fields
- **Style:** 44px de alto, borde 1px, radio 8px, fondo transparente sobre blanco, texto 16px en móvil y 14px desde `md`, placeholder en tinta secundaria. Los selects comparten alto y borde, con chevron de 16px.
- **Focus:** el borde pasa al naranja institucional con un anillo de 3px al 50%.
- **Error:** borde y anillo rojos, mensaje inline debajo en 14px rojo con `role="alert"`.
- **Disabled:** al 50%, fondo del borde al 50%, con una razón visible debajo cuando el filtro todavía no aplica.
- **Checkbox:** 16px, relleno naranja quemado cuando está marcado, con una fila de etiqueta de 44px como target; sin borde de tarjeta alrededor.
- **Buscador del inicio:** 48px, ícono de 20px, foco inmediato; el buscador del padrón es de 44px.

### Navigation
- **Barra lateral (escritorio):** destinos de 44px, ícono 20px + etiqueta 14px/500 en tinta secundaria; hover a la superficie. El activo lleva fondo naranja institucional al 10%, ícono naranja institucional y etiqueta en tinta.
- **Barra inferior (móvil):** mismos destinos en columna, etiqueta 12px/500; el activo pone un óvalo de 32px al 10% detrás del ícono naranja y la etiqueta pasa a tinta en 600.
- **Menú de usuario:** disparador de 44px con avatar de 32px en la superficie; el menú muestra nombre, cápsula de rol, "Cambiar contraseña" y "Cerrar sesión" (con confirmación).

### Panel
Contenedor de sección: borde 1px, radio 8px, fondo blanco. Cabecera con borde inferior, 16px × 12px, título 16px/600 y descripción 14px; la acción se apila debajo del título en móvil y va a la derecha desde `sm`. Cuerpo con 16px. Un panel nunca contiene otro.

### DataList
La pieza signature del padrón, la auditoría y los usuarios: una sola lectura en dos formas. En móvil, filas de al menos 44px con 12px de padding, título 16px/500, subtítulo 14px en tinta secundaria, `meta` (cápsulas, avisos) en su propia línea y `actions` a la derecha, separadas de la navegación de la fila. En escritorio, tabla de 14px con cabecera de 40px, filas con hover a la superficie al 50% y columnas numéricas tabulares a la derecha. Tiene estados de carga (skeleton de filas), vacío (ícono lucide 32px, título, descripción y acción opcional) y error.

### Status & Role Pills
Cápsula de 24px, texto 12px/500, padding horizontal de 10px, fondo del color al 10% y texto sólido; las de estado llevan un punto de 6px del mismo color. Rol: Administrador en naranja quemado, Editor en tinta sobre tinta al 8%, Consulta en tinta secundaria sobre la superficie.

### Dialogs & Sheets
Diálogos centrados de 11,2px de radio con anillo, pie gris con los botones (apilados en móvil, a la derecha desde `sm`). Las acciones con consecuencia piden motivo (y a veces fecha) y el botón nombra la acción ("Dar de baja", "Reactivar", "Desactivar"). Los formularios de ajustes abren en un sheet.

### Club Mark
Placeholder del escudo: cuadrado de 28/36/56px, radio 8px, monograma "NB" en 700 blanco sobre el naranja institucional. Se reemplaza por el escudo real sin cambiar tamaño ni radio.

## Do's and Don'ts

### Do:
- **Do** usar el naranja quemado para toda acción primaria y todo link, con su hover profundo; medir el contraste de cualquier color nuevo antes de usarlo como texto.
- **Do** limitar el naranja institucional al escudo, el indicador del destino activo y el anillo de foco.
- **Do** dar 44px a todo lo que se toca, también en escritorio: botones, íconos de fila, filas de lista, destinos de navegación.
- **Do** usar numerales tabulares en montos, DNI, fechas y columnas numéricas.
- **Do** diseñar y verificar a 390px primero; el escritorio adapta con la barra lateral y el contenedor de 1024px.
- **Do** dar a toda superficie async su estado de carga, vacío y error, y a todo control su default/hover/focus/disabled/loading/error.

### Don't:
- **Don't** usar el naranja institucional como color de texto (3,06:1 sobre blanco).
- **Don't** poner un kicker o eyebrow arriba de un título.
- **Don't** anidar un panel dentro de otro ni armar la página como grilla de tarjetas icono+título+texto o métrica-héroe.
- **Don't** sumar tamaños de texto fuera de 12/14/16/20/24px ni una fuente monoespaciada.
- **Don't** usar sombra en el contenido del flujo, ni sombras sin blur, ni bordes de acento de más de 1px.
- **Don't** comunicar un estado solo con color, ni usar emoji o glifos como íconos: lucide o SVG propio.
