import { Skeleton } from '@/components/ui/skeleton'

/** Cubre `/socios/[id]` y `/socios/[id]/editar`. */
export default function MemberLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  )
}
