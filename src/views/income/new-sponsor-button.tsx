'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/views/shell/panel-session'
import { SponsorFormSheet } from '@/views/income/sponsor-form-sheet'

/** "Nuevo sponsor" con su sheet de alta. Solo con `income.register` (UX; la defensa real es la acción y la RLS). */
export function NewSponsorButton() {
  const canRegister = useHasPermission('income.register')
  const [open, setOpen] = useState(false)
  if (!canRegister) return null

  return (
    <>
      <Button type="button" className="h-11" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Nuevo sponsor
      </Button>
      <SponsorFormSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
