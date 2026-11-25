import { Skeleton } from '@/components/ui/skeleton'
import { LoadingList } from '@/views/shared/states'

export default function InviteByCategoryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-24 w-full" />
      <LoadingList rows={5} />
    </div>
  )
}
