import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { LoadingList } from '@/views/shared/states'

/**
 * Se muestra mientras `getSettingsPage()` resuelve (Suspense automático de
 * Next para el segmento). Esqueleto, no un spinner suelto (operate.md).
 */
export default function AjustesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ajustes" description="Disciplinas, categorías, cuotas y datos del club." />
      <Panel title="Disciplinas y categorías">
        <LoadingList rows={4} />
      </Panel>
      <Panel title="Valores de cuota">
        <LoadingList rows={3} />
      </Panel>
      <Panel title="Cuotas">
        <LoadingList rows={2} />
      </Panel>
      <Panel title="Datos del club">
        <LoadingList rows={1} />
      </Panel>
    </div>
  )
}
