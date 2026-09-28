import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

/**
 * Fallback de `/` mientras `getDashboard()` resuelve las RPC en paralelo (las
 * demás rutas del panel tienen su propio `loading.tsx` más específico, así
 * que Next nunca usa este para otra cosa). Formas aproximadas a la
 * composición del panel inicial (F-inicio, mismo pipeline): saludo +
 * buscador, cifra hero de deuda, franja de "cobrado este mes", lista de
 * deudores en mora, gráfico de evolución y el resumen del padrón — mismo
 * orden que el contenido real, para que no salte al llegar el dato
 * (operate.md: skeletons, no spinners a mitad de contenido).
 */
export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-raised">
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-raised">
        <Skeleton className="mb-3 h-4 w-36" />
        <LoadingList rows={3} />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
