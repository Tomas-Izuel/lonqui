import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

/**
 * Fallback de `/socios` mientras la page (Server Component) resuelve
 * `getPadron`/`listDisciplines`. También cubre `/socios/nuevo` mientras no
 * tenga su propio `loading.tsx` (Next hereda el más cercano): un skeleton de
 * lista ahí es genérico, no exacto al formulario, pero es breve y no exige
 * un segundo archivo para una carga que dura milisegundos.
 */
export default function SociosLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-11 w-full" />
      <LoadingList rows={6} />
    </div>
  )
}
