'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IncomeConceptFormSheet } from '@/views/settings/income-concept-form-sheet'

/** Botón + sheet de alta de concepto; sirve de acción del panel y del estado vacío. */
export function NewIncomeConceptButton({ label = 'Nuevo concepto' }: { label?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} className="h-11">
        <Plus aria-hidden />
        {label}
      </Button>
      <IncomeConceptFormSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
