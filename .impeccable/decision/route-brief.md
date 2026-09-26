# Shell del panel y panel inicial — `/`

Modo: **Operate**. Es la estructura que envuelve todas las pantallas y la primera que se ve al entrar.

- **Trabajo y audiencia:** llegar a la tarea de hoy en un toque: buscar un socio, cargar una ficha, (desde el slice 2) registrar un pago. Tesorería y Secretaría todos los días desde el celular; Presidencia y el resto de la Comisión, de vez en cuando.
- **Resultado y prueba:** barra superior con el logo del club y el nombre del usuario; navegación por rol (`consulta` no ve Usuarios/Ajustes/Auditoría; `editor` tampoco); en móvil, navegación inferior con 3–5 destinos y targets de 44 px; en desktop, lateral. El panel inicial de este slice es una **búsqueda de socios grande** más accesos directos por rol; los indicadores llegan en el slice 3 y se diseñan entonces (sin métrica-héroe ahora ni después).
- **Estados:** sesión sin rol activo ("Tu usuario no tiene acceso" + cerrar sesión), rol sin permiso para una sección ("No tenés permiso para ver esto" con vuelta al inicio), carga inicial con skeleton, error de red.
- **Interacción:** el ítem activo se distingue con el acento, nunca con un bloque saturado; "Cerrar sesión" en el menú del usuario con confirmación breve; las rutas que no existen todavía (`/cobranza`, `/reportes`) **no** aparecen como botones muertos.
- **Anti-objetivos:** sidebar con veinte ítems, dashboards de plantilla, tarjetas icono+título+texto como estructura, un segundo color de marca.
- **Dirección seleccionada:** el estándar de la categoría (canon), elegido por Tomás en la ronda del 2026-09-25. Vara de terminación: **Linear** y el **panel de Mercado Pago**.

## Direction contract

THESIS: Un panel administrativo moderno, sin metáfora: la convención de la categoría ejecutada completa, al nivel de Linear en precisión y de Mercado Pago en claridad para gente no técnica. Rechaza tanto el SaaS gris intercambiable como la app de hinchas: la identidad del club vive en el naranja, el escudo y el tono, no en rarezas. **Mobile first es indispensable**: toda pantalla se diseña y se verifica primero a 390px con una mano; el escritorio es una adaptación de lo móvil, nunca al revés.

OWN-WORLD: Tema claro (se usa al sol). Fondo blanco, superficies #F7F7F8, bordes 1px #E5E7EB, tinta #111827, texto secundario #6B7280. Naranja del club como único acento (Restrained): #F26A1B solo en marcas no textuales (escudo, indicador del ítem activo, foco); #C2410C para botón primario con texto blanco (5,2:1) y links; hover #9A3412. Estados: al día #15803D, con deuda #B91C1C, baja gris #6B7280, siempre con texto, nunca solo color. Una familia (Geist), base 16px, numerales tabulares en montos y DNI, radios 8px, sombras mínimas con blur, íconos lucide.

STORY: Quien entra entiende en un segundo dónde está y qué puede hacer según su rol; busca a un socio y ve su estado sin abrir tres pantallas; confía en que es el sistema serio del club y deja el Excel.

FIRST VIEWPORT: Móvil (el diseño de referencia): barra superior con escudo + "Naranja y Blanco" y avatar; debajo, saludo corto y un buscador de socios grande (48px) con foco inmediato; accesos directos por rol como filas de lista con ícono y chevron; navegación inferior fija (Inicio, Socios, y lo que el rol habilite). Desktop (adaptación): barra lateral de 240px con escudo arriba, secciones del rol y usuario abajo; contenido centrado a 960px con el mismo buscador como primera pieza.

FORM: Canon (salida estándar de la ronda), no una posición de la lista propia; seed key cc0de700. Build code-led (sin generación de imágenes en esta sesión).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
