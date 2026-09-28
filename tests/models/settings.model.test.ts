import { describe, expect, it } from 'vitest'
import { updateSettingsSchema } from '@/models/settings.model'

/**
 * Revisión 3 / D18 (pipeline `2026-09-27-cuotas-pagos-panel`): activar la
 * facturación deja de ser un `UPDATE` libre de `billing_start_period` desde
 * "Datos del club". `updateSettingsSchema` pasa a aceptar SOLO `clubName`;
 * `billingStartPeriod` sale del schema (vive en `billing.model.ts:activateBilling`,
 * detrás de `billing.configure` y del trigger `settings_billing_guard`). Un
 * `unrecognized_keys` acá, aunque venga `null`, es la señal correcta: nadie
 * puede colarlo por este camino.
 */
describe('updateSettingsSchema', () => {
  it('acepta clubName solo', () => {
    expect(updateSettingsSchema.safeParse({ clubName: 'Club Test' }).success).toBe(true)
  })

  it('rechaza un nombre de club demasiado corto', () => {
    expect(updateSettingsSchema.safeParse({ clubName: 'A' }).success).toBe(false)
  })

  it('rechaza billingStartPeriod: ya no es una clave conocida, ni siquiera en null (D18, activateBilling es el único camino)', () => {
    const withNull = updateSettingsSchema.safeParse({ clubName: 'Club Test', billingStartPeriod: null })
    expect(withNull.success).toBe(false)

    const withDate = updateSettingsSchema.safeParse({ clubName: 'Club Test', billingStartPeriod: '2026-10-01' })
    expect(withDate.success).toBe(false)
  })

  it('rechaza el payload vacío: clubName es obligatorio', () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(false)
  })

  it('rechaza cualquier otra clave desconocida (.strict())', () => {
    expect(updateSettingsSchema.safeParse({ clubName: 'Club Test', extra: 1 }).success).toBe(false)
  })
})
