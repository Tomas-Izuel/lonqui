'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { Amount } from '@/views/shared/money'
import { DURATION, EASE_ENTER, staggerDelay, useMotionPreference } from '@/views/shared/motion'
import { isPlainLeftClick, useOverlayParam } from '@/views/shared/overlay-params'
import type { MemberAccount } from '@/models/types'

/**
 * Meses de atraso visualizados como puntos, además del texto, nunca en su
 * lugar (dataviz: "nunca color/forma solo"). Ronda 2 (revisión del
 * coordinador: "lee ruidoso"): se sacó el "+N" — el número exacto ("9
 * meses") ya está escrito al lado, repetirlo como texto en los puntos era
 * la MISMA cifra tres veces (texto, puntos, "+N"). Ahora son como mucho 6
 * puntos llenos y listo: por encima de 6 el techo visual no sigue creciendo,
 * la severidad exacta la sigue dando el texto.
 */
function MonthsBehindDots({ months }: { months: number }) {
  const dots = Math.min(months, 6)

  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className="size-1.5 rounded-full bg-status-in-debt" />
      ))}
    </span>
  )
}

function TopDebtorRow({ member, index }: { member: MemberAccount; index: number }) {
  const quickView = useOverlayParam('ver')
  const { reduced, pick } = useMotionPreference()

  // Sigue siendo un link real a la ficha (accesibilidad, Cmd/Ctrl+click,
  // clic medio, lector de pantalla) pero un click plano abre la vista rápida
  // en su lugar (mismo patrón que usa `member-list.tsx`, C2 del pipeline).
  function handleClick(event: React.MouseEvent) {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    quickView.set(String(member.memberId))
  }

  return (
    <motion.li
      initial={pick({ opacity: 0, y: 6 }, { opacity: 0 })}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.state, ease: EASE_ENTER, delay: reduced ? 0 : staggerDelay(index) }}
    >
      <Link
        href={`/socios/${member.memberId}`}
        onClick={handleClick}
        className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{member.fullName}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {member.monthsDue} {member.monthsDue === 1 ? 'mes' : 'meses'}
            <MonthsBehindDots months={member.monthsDue} />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 font-medium tabular-nums text-status-in-debt">
          <Amount cents={member.balanceCents} />
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>
    </motion.li>
  )
}

/** Lista de los 5 más atrasados, con entrada escalonada (D5, techo ≤ 400ms combinado). */
export function TopDebtorsList({ members }: { members: MemberAccount[] }) {
  if (members.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Ningún socio activo tiene deuda.</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {members.map((m, index) => (
        <TopDebtorRow key={m.memberId} member={m} index={index} />
      ))}
    </ul>
  )
}
