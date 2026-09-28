'use client'

import { createContext, useContext } from 'react'
import type { Permission } from '@/models/types'

export type PanelSessionValue = { permissions: Permission[] }

const PanelSessionContext = createContext<PanelSessionValue | null>(null)

/**
 * Los permisos de la sesión, disponibles para cualquier Client Component del
 * árbol del panel — en particular los overlays globales que `AppShell` monta
 * FUERA de cualquier page (`PaymentOverlayHost`, `MemberQuickViewSheet`, C7):
 * no reciben props de una page que ya resolvió la sesión, así que sin esto no
 * tendrían forma de saber si el usuario puede, por ejemplo, "Registrar pago"
 * sin pedir la sesión de nuevo.
 *
 * Ocultar una acción según esto es UX, nunca la defensa real — la key
 * publicable viaja al browser y cualquiera puede pegarle a PostgREST directo;
 * la autorización real son las RLS y `requirePermission`/`requireRole` del
 * lado del servidor (CLAUDE.md).
 */
export function PanelSessionProvider({
  permissions,
  children,
}: {
  permissions: Permission[]
  children: React.ReactNode
}) {
  return <PanelSessionContext.Provider value={{ permissions }}>{children}</PanelSessionContext.Provider>
}

/** Los permisos de la sesión actual. Tira si se usa fuera de `AppShell` (bug de integración, no un caso a manejar en silencio). */
export function usePanelPermissions(): Permission[] {
  const ctx = useContext(PanelSessionContext)
  if (!ctx) {
    throw new Error('usePanelPermissions() se usa dentro de <PanelSessionProvider> (AppShell la monta una sola vez).')
  }
  return ctx.permissions
}

/** Atajo: ¿la sesión actual tiene este permiso? */
export function useHasPermission(permission: Permission): boolean {
  return usePanelPermissions().includes(permission)
}
