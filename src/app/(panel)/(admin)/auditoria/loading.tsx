import { PageHeader } from '@/views/shared/page-header'
import { LoadingList } from '@/views/shared/states'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Auditoría" description="Quién tocó qué, y cuándo. Solo lectura." />
      <LoadingList rows={6} />
    </div>
  )
}
