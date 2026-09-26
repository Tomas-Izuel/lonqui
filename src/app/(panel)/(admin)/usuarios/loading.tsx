import { PageHeader } from '@/views/shared/page-header'
import { LoadingList } from '@/views/shared/states'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usuarios" description="Quién de la Comisión entra al sistema y con qué permiso." />
      <LoadingList rows={4} />
    </div>
  )
}
