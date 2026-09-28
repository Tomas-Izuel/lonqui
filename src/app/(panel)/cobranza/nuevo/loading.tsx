import { Skeleton } from '@/components/ui/skeleton'

/** Fallback de `/cobranza/nuevo`: forma de formulario, no de lista. */
export default function RegisterPaymentLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
        <Skeleton className="mt-3 h-6 w-40" />
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  )
}
