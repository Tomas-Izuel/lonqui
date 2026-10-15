import { redirect } from 'next/navigation'

/** Entrada sin pestaña: Cuotas es lo que se toca durante el año. */
export default function AjustesPage() {
  redirect('/ajustes/cuotas')
}
