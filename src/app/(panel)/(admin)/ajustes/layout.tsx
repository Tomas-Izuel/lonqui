import { PageHeader } from '@/views/shared/page-header'
import { SettingsTabs } from '@/views/settings/settings-tabs'

/**
 * Título y barra viven acá: no se remontan al cambiar de pestaña, así que no
 * parpadean. El acceso lo cubre `(admin)/layout.tsx` y, en navegación de
 * cliente (donde los layouts no se re-ejecutan), el controller de cada pestaña.
 */
export default function AjustesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ajustes" description="Cuotas, disciplinas, conceptos de ingreso y datos del club." />
      <SettingsTabs />
      {children}
    </div>
  )
}
