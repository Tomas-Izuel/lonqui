import { AlertTriangle, Clock } from 'lucide-react'
import type { MedicalClearanceStatus } from '@/models/types'
import { medicalClearanceStatusLabels } from '@/views/shared/labels'
import { cn } from '@/lib/utils'

/**
 * Aviso compacto para el listado del padrón: solo se ve para estados que
 * requieren atención. `not_required` (mayores de edad) y `valid` no
 * necesitan un aviso — el padrón ya está lleno de columnas, y un aviso "todo
 * bien" es ruido, no información (route-socios.md: "aviso de apto físico
 * vencido/por vencer").
 *
 * Color: se queda dentro de la paleta de estado aprobada (`route.md`), que
 * solo define al-día/con-deuda/inactivo — no hay un cuarto tono "ámbar", así
 * que "por vencer" y "vencido/falta" comparten el rojo de "con deuda" y se
 * distinguen por ícono y texto (nunca solo color, piso de calidad).
 */
export function MedicalClearanceNotice({ status, className }: { status: MedicalClearanceStatus; className?: string }) {
  if (status === 'valid' || status === 'not_required') return null

  const Icon = status === 'expiring' ? Clock : AlertTriangle

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-status-in-debt', className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {medicalClearanceStatusLabels[status]}
    </span>
  )
}
