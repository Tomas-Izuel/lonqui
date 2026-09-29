import { ClubMark } from '@/views/shell/club-mark'
import { AuthCard } from '@/views/auth/auth-card'

/**
 * Envoltorio de `/login` y `/cambiar-contrasena`, sin el `AppShell` del panel
 * (ni siquiera cuando `/cambiar-contrasena` es voluntario: no se repite la
 * navegación mientras se corta el flujo de contraseña).
 *
 * Móvil (la referencia): página blanca, sin tarjeta. Encabezado de bastones
 * con el escudo en un disco blanco sobre su borde, y el formulario. Nada compite con los
 * campos.
 *
 * Desde `lg`: dos mitades a pantalla completa. La izquierda es la camiseta
 * (bastones verticales naranja y blanco, los del escudo) con el escudo grande
 * sobre un soporte blanco; el nombre va sobre ese blanco y no sobre el
 * naranja, por "La Regla del Naranja Mudo" (#F26A1B sobre blanco da 3,06:1:
 * el naranja institucional no lleva texto). La derecha es el formulario.
 * Entre `md` y `lg` queda el layout móvil, con el formulario acotado.
 *
 * Los bastones son CSS puro (`.club-stripes` en globals.css): cero bytes de
 * imagen y nítidos a cualquier densidad.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-background lg:grid lg:grid-cols-2">
      {/* Móvil: la camiseta comprimida. El escudo va en un disco blanco montado
          sobre el borde inferior del encabezado, alineado con el formulario. */}
      <header aria-hidden className="club-stripes relative h-28 shrink-0 lg:hidden">
        <div className="absolute -bottom-12 left-4 flex size-24 items-center justify-center rounded-full bg-background shadow-lifted">
          <ClubMark size="lg" className="size-[72px]" />
        </div>
      </header>

      <aside className="club-stripes relative hidden items-center justify-center lg:flex">
        <div className="flex flex-col items-center gap-5 rounded-3xl bg-background px-14 py-12 text-center shadow-lifted">
          <ClubMark size="lg" className="h-52 w-auto" />
          <div className="flex flex-col gap-1">
            <p className="font-heading text-2xl font-semibold text-balance">Naranja y Blanco</p>
            <p className="text-sm text-muted-foreground">Club Social y Deportivo</p>
          </div>
        </div>
      </aside>

      {/* Arriba en móvil (con el teclado abierto el formulario no se va);
          centrado en vertical solo cuando hay panel de marca al lado. */}
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 pt-3 pb-8 lg:max-w-95 lg:justify-center lg:px-0 lg:py-12">
        <div className="flex min-h-12 flex-col justify-center pl-28 lg:hidden">
          <p className="font-heading text-lg leading-tight font-semibold text-balance">Naranja y Blanco</p>
          <p className="text-sm text-muted-foreground">Club Social y Deportivo</p>
        </div>
        <AuthCard>{children}</AuthCard>
      </div>
    </main>
  )
}
