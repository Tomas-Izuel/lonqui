# Rediseño de auth (`/login`, `/cambiar-contrasena`) — frontend

## Estado final (ronda de corrección incluida)
- `src/app/(auth)/layout.tsx`: móvil = encabezado de bastones de 112px a todo el ancho, con el escudo (72px) en un disco blanco de 96px (`shadow-lifted`) montado sobre su borde inferior, alineado a la izquierda con el formulario; al lado del disco, el nombre del club; debajo título y formulario, alineados ARRIBA (sin centrado vertical: con el teclado abierto el formulario no se va). `lg+`: grid 2 columnas, izquierda con bastones y tarjeta blanca (escudo grande + nombre; el texto va sobre blanco, Naranja Mudo), derecha formulario `max-w-95` centrado en vertical. md–lg: móvil acotado a `max-w-sm`.
- `src/app/globals.css` `.club-stripes`: bastones de ANCHO IGUAL, tono sobre tono: `--brand` #F26A1B y #F58540 (elegido mirándolo; #F47B32 quedaba demasiado cerca del brand). Mismo patrón en móvil (1.25rem) y desktop (2.5rem). Dirección 270deg. Sin durazno ni blanco (vibraba).
- `src/views/auth/login-form.tsx`: solo el `<p>` de ayuda pasó a alineado a la izquierda (presentacional).
- `auth-card.tsx`: único fundido de entrada, sin desplazamiento con movimiento reducido. Pages: h1 "Ingresá a la gestión del club"; cambiar-contraseña conserva su título.

## Contraste (calculado)
Texto #111827 sobre blanco ~17:1; muted #5F6673 sobre blanco 5,78:1; botón blanco sobre #C2410C 5,18:1. Sin texto sobre los bastones.

## Capturas finales
scratchpad/final-mobile.png (390x844, sin scroll, formulario arriba), final-lg.png (1024x768), final-desktop.png (1440x900), en /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/5de45531-c6be-42e2-98ee-4c126a79fa67/scratchpad/

## Pendiente
`/cambiar-contrasena` no capturada (requiere sesión); verificada por código, mismo layout.
