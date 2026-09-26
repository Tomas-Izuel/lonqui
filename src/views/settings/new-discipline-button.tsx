'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisciplineFormSheet } from '@/views/settings/discipline-form-sheet'

/**
 * Botón + sheet de alta, autocontenido (no está anidado en un menú, así que
 * no necesita el patrón de estado externo de `ConfirmToggleDialog`/los
 * sheets de edición). Se usa como acción del `Panel` y como acción del
 * `EmptyState` cuando todavía no hay ninguna disciplina cargada.
 */
export function NewDisciplineButton({ label = 'Nueva disciplina' }: { label?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-11">
        <Plus aria-hidden />
        {label}
      </Button>
      <DisciplineFormSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
