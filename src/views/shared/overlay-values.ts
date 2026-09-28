/**
 * Valores puros de los overlays globales (`?pagar=`, `?ver=`): parseo y
 * armado del query param, sin hooks. Vive aparte de `overlay-params.ts`
 * (que es `'use client'`) porque también lo usa un Server Component — la
 * redirección de `/cobranza/nuevo` — y un Server Component no puede llamar a
 * una función exportada por un módulo de cliente.
 */
/** `?pagar=` parseado. `null` si falta o no tiene una forma válida. */
export type PaymentOverlayTarget = { mode: 'buscar' } | { mode: 'socio'; memberId: number } | { mode: 'grupo'; familyGroupId: number }

export function parsePaymentOverlay(value: string | null): PaymentOverlayTarget | null {
  if (!value) return null
  if (value === 'buscar') return { mode: 'buscar' }
  const match = /^(socio|grupo):(\d+)$/.exec(value)
  if (!match) return null
  const id = Number(match[2])
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return match[1] === 'socio' ? { mode: 'socio', memberId: id } : { mode: 'grupo', familyGroupId: id }
}

export function paymentOverlayValue(target: PaymentOverlayTarget): string {
  if (target.mode === 'buscar') return 'buscar'
  return target.mode === 'socio' ? `socio:${target.memberId}` : `grupo:${target.familyGroupId}`
}

/** `?ver=` parseado a un id de socio, o `null`. */
export function parseQuickViewParam(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Para filas que son un link real a `/socios/[id]` pero abren la vista
 * rápida con un click plano: deja pasar Cmd/Ctrl/Shift/Alt y el botón del
 * medio (nueva pestaña) igual que `next/link`.
 */
export function isPlainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
