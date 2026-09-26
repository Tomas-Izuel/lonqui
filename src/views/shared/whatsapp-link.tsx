import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Único uso permitido de WhatsApp en el sistema (CLAUDE.md): un link a
 * `wa.me` que abre la conversación con el número ya cargado. Nada
 * automatizado, nada que mande un mensaje sin que la Comisión lo escriba.
 */
export function WhatsAppLink({ phone, className, label = 'Escribir por WhatsApp' }: { phone: string; className?: string; label?: string }) {
  const digits = phone.replace(/\D/g, '')
  // Números argentinos cargados a 10 dígitos locales: wa.me pide el +54 9.
  const e164 = digits.startsWith('54') ? digits : `54${digits.length === 10 ? '9' : ''}${digits}`

  return (
    <Button asChild variant="outline" className={cn('gap-2', className)}>
      <a href={`https://wa.me/${e164}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle aria-hidden />
        {label}
      </a>
    </Button>
  )
}
