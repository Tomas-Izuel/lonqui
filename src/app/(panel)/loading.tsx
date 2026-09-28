import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

/**
 * Fallback de `/` mientras `getDashboard()` resuelve las RPC en paralelo.
 * Misma altura que el gráfico (`h-64`, `history-chart.tsx`) para que no
 * salte al llegar el dato (operate.md: skeletons, no spinners a mitad de
 * contenido).
 */
export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-9 w-40 rounded-lg" />
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-56 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <LoadingList rows={4} />
    </div>
  )
}
