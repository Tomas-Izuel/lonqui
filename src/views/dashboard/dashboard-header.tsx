'use client'

import { Banknote, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { HomeSearch } from '@/views/shell/home-search'
import { useOverlayParam } from '@/views/shared/overlay-params'
import { cn } from '@/lib/utils'
import type { Permission } from '@/models/types'

/**
 * Cabecera del panel inicial: saludo chico + buscador + accesos por rol —
 * nunca un `Panel`. El `h1` sigue existiendo (landmark para el lector de
 * pantalla), pero visualmente es chico y mudo: el texto más grande de la
 * página es la cifra hero (`MoneySummaryStrip` → `HeroFigure`), no el saludo.
 *
 * Ronda 2 (2026-09-28, revisión sobre capturas reales a 390/1440 con datos
 * de demo): los accesos eran chips de ícono + una palabra que leían chicos
 * (~36px de alto aparente) aunque `size="sm"` ya daba 44px técnicos — el
 * problema era de PROPORCIÓN, no de altura: ancho de contenido y texto de
 * una sola palabra los hacía leer como chips, no como botones. Ahora son
 * botones reales con la etiqueta completa ("Registrar pago", "Ficha de
 * ingreso"), en grilla de 2 columnas que llena el ancho a 390 (el pulgar no
 * tiene que apuntar a un botón angosto) y ancho automático lado a lado desde
 * `sm`. "Registrar pago" es la acción primaria (variant por defecto); "Ficha
 * de ingreso" es secundaria (`outline`) — coherente con que cargar un pago es
 * la operación más frecuente del sistema (Product Principle 2).
 *
 * "Registrar pago" abre el overlay global de cobranza en vez de navegar
 * (pipeline 2026-09-28-ui-expresiva, C2/C7):
 * `useOverlayParam('pagar').set('buscar')` monta `PaymentOverlayHost` (dueño:
 * F-cobranza) con el buscador de socios encima de la página actual, sin la
 * ida y vuelta de `/cobranza/nuevo`. "Ficha de ingreso" NO cambia — sigue
 * siendo navegación real a `/socios/nuevo`, fuera del alcance de overlays de
 * este pipeline (00-architecture.md D1).
 */
export function DashboardHeader({ greeting, permissions }: { greeting: string; permissions: Permission[] }) {
  const canRegisterPayment = permissions.includes('payments.register')
  const canCreateMember = permissions.includes('members.write')
  const hasActions = canRegisterPayment || canCreateMember
  const bothActions = canRegisterPayment && canCreateMember
  const paymentOverlay = useOverlayParam('pagar')

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-sm font-medium text-muted-foreground">{greeting}</h1>
      <HomeSearch />
      {hasActions ? (
        <div className={cn('grid gap-2 sm:flex sm:flex-wrap', bothActions ? 'grid-cols-2' : 'grid-cols-1')}>
          {canRegisterPayment ? (
            <Button type="button" className="h-11 w-full sm:w-auto" onClick={() => paymentOverlay.set('buscar')}>
              <Banknote aria-hidden className="size-4" />
              Registrar pago
            </Button>
          ) : null}
          {canCreateMember ? (
            <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
              <Link href="/socios/nuevo">
                <UserPlus aria-hidden className="size-4" />
                Ficha de ingreso
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
