'use client'

import { SettingsTabError } from '@/views/settings/settings-tab-error'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SettingsTabError reset={reset} />
}
