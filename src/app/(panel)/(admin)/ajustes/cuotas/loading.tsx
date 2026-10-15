import { SettingsTabLoading } from '@/views/settings/settings-tab-views'

export default function Loading() {
  return <SettingsTabLoading panels={[{ title: 'Valores de cuota', rows: 3 }, { title: 'Cuotas', rows: 2 }]} />
}
