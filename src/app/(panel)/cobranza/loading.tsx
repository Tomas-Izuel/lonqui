import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

/** Fallback de `/cobranza` mientras la page resuelve el hub. */
export default function CobranzaLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-11 w-full" />
      <LoadingList rows={4} />
    </div>
  )
}
