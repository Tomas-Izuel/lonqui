import { Banknote, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { HomeSearch } from '@/views/shell/home-search'
import type { Permission } from '@/models/types'

/**
 * Cabecera del panel inicial: saludo chico + buscador + accesos por rol —
 * nunca un `Panel`, nunca un botón de ancho completo. El `h1` sigue
 * existiendo (landmark para el lector de pantalla), pero visualmente es
 * chico y mudo: el texto más grande de la página es la plata
 * (`MoneySummaryStrip`), no el saludo.
 *
 * Dos filas, no una (revisión del coordinador, 2026-09-28): el buscador
 * necesita su ancho completo para que el placeholder no se corte a 390
 * ("Buscar un socio por nombre o DNI…" no entra si comparte fila con dos
 * botones); los accesos van debajo, con ícono + texto corto VISIBLE
 * ("Pago", "Alta" — no solo `aria-label`), en `size="sm"` de shadcn, que en
 * este repo da 44px de alto siempre (mismo piso que cualquier botón, nunca
 * menos por ser "chico"). El texto visible es subconjunto literal del
 * `title` completo (WCAG 2.5.3, "Label in Name"): "Pago" está contenido en
 * "Registrar pago", así que no hace falta (ni conviene) un `aria-label` que
 * lo reemplace — el nombre accesible es el texto que se ve.
 */
export function DashboardHeader({ greeting, permissions }: { greeting: string; permissions: Permission[] }) {
  const canRegisterPayment = permissions.includes('payments.register')
  const canCreateMember = permissions.includes('members.write')
  const hasActions = canRegisterPayment || canCreateMember

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-sm font-medium text-muted-foreground">{greeting}</h1>
      <HomeSearch />
      {hasActions ? (
        <div className="flex flex-wrap gap-2">
          {canRegisterPayment ? (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/cobranza/nuevo" title="Registrar pago">
                <Banknote aria-hidden className="size-4" />
                Pago
              </Link>
            </Button>
          ) : null}
          {canCreateMember ? (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/socios/nuevo" title="Cargar ficha de ingreso">
                <UserPlus aria-hidden className="size-4" />
                Alta
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
