import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

/** Fallback de `/socios/revision` y de cada pedido mientras la page resuelve la cola. */
export default function ReviewLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-11 w-full" />
      <LoadingList rows={5} />
    </div>
  )
}
