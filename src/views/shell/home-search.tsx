'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

/**
 * El buscador grande del panel inicial: navega a `/socios?q=` en vez de
 * filtrar en el lugar (route.md: "la tarea de hoy en un toque"). Foco
 * inmediato en el primer viewport (brief), autocompletar apagado a
 * propósito: es un nombre o un DNI, no una contraseña guardada.
 */
export function HomeSearch() {
  const router = useRouter()
  const [value, setValue] = useState('')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = value.trim()
    router.push(q ? `/socios?q=${encodeURIComponent(q)}` : '/socios')
  }

  return (
    <form onSubmit={handleSubmit} role="search">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Buscar un socio por nombre o DNI…"
          aria-label="Buscar un socio"
          autoFocus
          autoComplete="off"
          className="h-12 pl-10 text-base"
        />
      </div>
    </form>
  )
}
