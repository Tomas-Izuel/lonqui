import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, fakeSupabase, ok } from '../stubs/supabase-mock'

/**
 * `sponsors.model.ts`: un sponsor NO es un socio, nunca se borra y sus datos
 * de contacto son datos personales. Cubre: normalización del email, vacíos a
 * null, motivo obligatorio al desactivar, el mensaje del nombre repetido (con
 * y sin "desactivado", con el nombre escapado para `ilike`), `undefined` vs
 * `null` en la edición y el mapeo de la RPC `sponsor_summaries`.
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const { DomainError, PermissionError } = await import('@/lib/errors')
async function importModel() {
  return import('@/models/sponsors.model')
}

beforeEach(() => createClientMock.mockReset())

const sponsorRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Corralón Inventado',
  contact_name: null,
  phone: null,
  email: null,
  notes: null,
  is_active: true,
  deactivated_at: null,
  deactivation_reason: null,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
})

describe('createSponsorSchema / updateSponsorSchema', () => {
  it('el email se guarda en minúsculas y los vacíos pasan a null', async () => {
    const { createSponsorSchema } = await importModel()
    const parsed = createSponsorSchema.parse({ name: '  Corralón Inventado ', email: 'Compras@Ejemplo.TEST', phone: '  ', contactName: '', notes: '' })
    expect(parsed.name).toBe('Corralón Inventado')
    expect(parsed.email).toBe('compras@ejemplo.test')
    expect(parsed.phone).toBeNull()
    expect(parsed.contactName).toBeNull()
    expect(parsed.notes).toBeNull()
  })

  it('email vacío es null (no inválido); email mal formado rechaza con field email', async () => {
    const { createSponsorSchema } = await importModel()
    expect(createSponsorSchema.parse({ name: 'Ab', email: '' }).email).toBeNull()
    const bad = createSponsorSchema.safeParse({ name: 'Ab', email: 'no-es-un-mail' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0].path[0]).toBe('email')
  })

  it.each([
    ['nombre de 1 letra', { name: 'A' }, 'name'],
    ['nombre de 121 caracteres', { name: 'x'.repeat(121) }, 'name'],
    ['nombre ausente', {}, 'name'],
    ['teléfono de 41 caracteres', { name: 'Ab', phone: '1'.repeat(41) }, 'phone'],
    ['notas de 1001 caracteres', { name: 'Ab', notes: 'x'.repeat(1001) }, 'notes'],
  ])('%s: rechaza (campo %s)', async (_n, input, field) => {
    const { createSponsorSchema } = await importModel()
    const r = createSponsorSchema.safeParse(input)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path[0]).toBe(field)
  })

  it('claves de más (isActive, createdBy): rechaza; el estado no se cambia desde acá', async () => {
    const { createSponsorSchema, updateSponsorSchema } = await importModel()
    expect(createSponsorSchema.safeParse({ name: 'Ab', isActive: false }).success).toBe(false)
    expect(updateSponsorSchema.safeParse({ name: 'Ab', createdBy: 'x' }).success).toBe(false)
  })

  it('edición: campos no enviados quedan undefined (no se tocan)', async () => {
    const { updateSponsorSchema } = await importModel()
    const parsed = updateSponsorSchema.parse({ name: 'Ab' })
    expect(parsed.phone).toBeUndefined()
    expect(parsed.contactName).toBeUndefined()
  })
})

describe('setSponsorActiveSchema', () => {
  it('desactivar exige motivo de 3 o más caracteres; reactivar no lo pide', async () => {
    const { setSponsorActiveSchema } = await importModel()
    expect(setSponsorActiveSchema.safeParse({ id: 1, isActive: false }).success).toBe(false)
    expect(setSponsorActiveSchema.safeParse({ id: 1, isActive: false, reason: 'ab' }).success).toBe(false)
    expect(setSponsorActiveSchema.safeParse({ id: 1, isActive: false, reason: '   ' }).success).toBe(false)
    expect(setSponsorActiveSchema.safeParse({ id: 1, isActive: false, reason: ' abc ' }).success).toBe(true)
    expect(setSponsorActiveSchema.safeParse({ id: 1, isActive: true }).success).toBe(true)
    const noReason = setSponsorActiveSchema.safeParse({ id: 1, isActive: false })
    if (!noReason.success) expect(noReason.error.issues[0].path[0]).toBe('reason')
  })
})

describe('createSponsor', () => {
  it('inserta solo los campos del formulario y mapea la fila a camelCase', async () => {
    const fake = fakeSupabase({ from: { sponsors: [ok(sponsorRow({ email: 'a@b.test' }))] } })
    createClientMock.mockResolvedValue(fake.client)
    const { createSponsor } = await importModel()

    const created = await createSponsor({ name: 'Corralón Inventado', email: 'a@b.test' })

    const insert = fake.opsOf('from:sponsors').find(([m]) => m === 'insert')
    expect(insert?.[1][0]).toEqual({ name: 'Corralón Inventado', contact_name: null, phone: null, email: 'a@b.test', notes: null })
    expect(created).toMatchObject({ id: 1, name: 'Corralón Inventado', isActive: true, email: 'a@b.test', createdAt: '2026-09-01T00:00:00Z' })
  })

  it('nombre repetido contra uno ACTIVO: mensaje simple con field name', async () => {
    const fake = fakeSupabase({
      from: { sponsors: [fail('23505', 'duplicate key value violates unique constraint "sponsors_name_key"'), ok({ is_active: true })] },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { createSponsor } = await importModel()
    const err = await createSponsor({ name: 'Corralón Inventado' }).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toBe('Ya existe un sponsor con ese nombre')
    expect(err.field).toBe('name')
  })

  it('nombre repetido contra uno DESACTIVADO: el mensaje dice dónde reactivarlo (para que no lo dupliquen)', async () => {
    const fake = fakeSupabase({
      from: { sponsors: [fail('23505', 'duplicate key value violates unique constraint "sponsors_name_key"'), ok({ is_active: false })] },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { createSponsor } = await importModel()
    const err = await createSponsor({ name: 'Ferretería Inventada' }).catch((e) => e)
    expect(err.message).toMatch(/desactivado.*reactivalo/i)
    expect(err.field).toBe('name')
  })

  it('la búsqueda del homónimo escapa %, _ y \\ (un nombre con comodines no matchea otro sponsor)', async () => {
    const fake = fakeSupabase({
      from: { sponsors: [fail('23505', 'duplicate key "sponsors_name_key"'), ok(null)] },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { createSponsor } = await importModel()
    await createSponsor({ name: ' 100%_Fruta\\ ' }).catch(() => {})
    const lookup = fake.opsOf('from:sponsors', 1)
    expect(lookup).toContainEqual(['ilike', ['name', '100\\%\\_Fruta\\\\']])
  })

  it('un 23505 de otro índice se relanza crudo', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [fail('23505', 'duplicate key "otro_key"')] } }).client)
    const { createSponsor } = await importModel()
    const err = await createSponsor({ name: 'Ab' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
  })
})

describe('updateSponsor', () => {
  it('undefined no se manda (no pisa); null (campo vaciado) sí limpia', async () => {
    const fake = fakeSupabase({ from: { sponsors: [ok(sponsorRow())] } })
    createClientMock.mockResolvedValue(fake.client)
    const { updateSponsor } = await importModel()

    await updateSponsor(1, { name: 'Nuevo Nombre', phone: null })

    const patch = fake.opsOf('from:sponsors').find(([m]) => m === 'update')?.[1][0] as Record<string, unknown>
    expect(patch).toEqual({ name: 'Nuevo Nombre', phone: null })
    expect('contact_name' in patch).toBe(false)
    expect('email' in patch).toBe(false)
    // Nunca toca el estado.
    expect('is_active' in patch).toBe(false)
  })

  it('id inexistente (0 filas): 404; sin permiso (42501): PermissionError', async () => {
    const { updateSponsor } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [ok(null)] } }).client)
    await expect(updateSponsor(9, { name: 'Ab' })).rejects.toMatchObject({ message: 'El sponsor no existe', status: 404 })

    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [fail('42501', 'No tenés permiso para editar sponsors')] } }).client)
    await expect(updateSponsor(9, { name: 'Ab' })).rejects.toBeInstanceOf(PermissionError)
  })

  it('renombrar a un nombre existente: mismo mensaje de nombre repetido', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { sponsors: [fail('23505', 'duplicate key "sponsors_name_key"'), ok({ is_active: true })] } }).client,
    )
    const { updateSponsor } = await importModel()
    await expect(updateSponsor(1, { name: 'Otro' })).rejects.toMatchObject({ message: 'Ya existe un sponsor con ese nombre', field: 'name' })
  })
})

describe('setSponsorActive', () => {
  it('desactivar manda is_active=false con el motivo; reactivar manda null (el guard limpia la tríada)', async () => {
    const { setSponsorActive } = await importModel()

    const off = fakeSupabase({ from: { sponsors: [ok(sponsorRow({ is_active: false, deactivation_reason: 'Cerró el local' }))] } })
    createClientMock.mockResolvedValue(off.client)
    const result = await setSponsorActive(1, false, 'Cerró el local')
    expect(off.opsOf('from:sponsors').find(([m]) => m === 'update')?.[1][0]).toEqual({ is_active: false, deactivation_reason: 'Cerró el local' })
    expect(result).toMatchObject({ isActive: false, deactivationReason: 'Cerró el local' })

    const on = fakeSupabase({ from: { sponsors: [ok(sponsorRow())] } })
    createClientMock.mockResolvedValue(on.client)
    await setSponsorActive(1, true, 'motivo que se ignora')
    expect(on.opsOf('from:sponsors').find(([m]) => m === 'update')?.[1][0]).toEqual({ is_active: true, deactivation_reason: null })
  })

  it('editor (42501 del guard) -> PermissionError; motivo corto en la base -> field reason; inexistente -> 404', async () => {
    const { setSponsorActive } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [fail('42501', 'No tenés permiso para desactivar o reactivar sponsors')] } }).client)
    await expect(setSponsorActive(1, false, 'motivo')).rejects.toBeInstanceOf(PermissionError)

    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [fail('23514', 'Para desactivar un sponsor hace falta un motivo')] } }).client)
    await expect(setSponsorActive(1, false, 'ab')).rejects.toMatchObject({ field: 'reason' })

    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [fail('23514', 'violates check constraint "sponsors_deactivation_triad"')] } }).client)
    await expect(setSponsorActive(1, false, 'ab')).rejects.toMatchObject({ field: 'reason' })

    createClientMock.mockResolvedValue(fakeSupabase({ from: { sponsors: [ok(null)] } }).client)
    await expect(setSponsorActive(1, true, null)).rejects.toMatchObject({ status: 404 })

    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { sponsors: [fail('23514', 'El estado del sponsor se cambia desactivándolo o reactivándolo')] } }).client,
    )
    const triad = await setSponsorActive(1, false, 'motivo').catch((e) => e)
    expect(triad).toBeInstanceOf(DomainError)
    expect(triad.message).toBe('El estado del sponsor se cambia desactivándolo o reactivándolo')
  })
})

describe('lecturas', () => {
  it('listSponsorOptions: por defecto solo activos, ordenados por nombre; con includeInactive trae todos', async () => {
    const { listSponsorOptions } = await importModel()
    const active = fakeSupabase({ from: { sponsors: [ok([{ id: 1, name: 'A', is_active: true }])] } })
    createClientMock.mockResolvedValue(active.client)
    expect(await listSponsorOptions()).toEqual([{ id: 1, name: 'A', isActive: true }])
    expect(active.opsOf('from:sponsors')).toContainEqual(['eq', ['is_active', true]])
    expect(active.opsOf('from:sponsors')).toContainEqual(['limit', [1000]])

    const all = fakeSupabase({ from: { sponsors: [ok([])] } })
    createClientMock.mockResolvedValue(all.client)
    await listSponsorOptions({ includeInactive: true })
    expect(all.opsOf('from:sponsors').some(([m, a]) => m === 'eq' && a[0] === 'is_active')).toBe(false)
  })

  const summaryRow = (over: Record<string, unknown> = {}) => ({
    sponsor_id: 4,
    name: 'Panadería Inventada',
    is_active: true,
    contact_name: null,
    phone: null,
    email: null,
    notes: null,
    deactivated_at: null,
    deactivation_reason: null,
    year_total_cents: 5_000_000,
    all_time_total_cents: 9_000_000,
    contributions_count: 3,
    last_contribution_on: '2026-09-10',
    last_contribution_cents: 2_000_000,
    ...over,
  })

  it('listSponsorSummaries: mapea sponsor_id a id y los totales; sin año no manda target_year, con año sí', async () => {
    const { listSponsorSummaries } = await importModel()
    const fake = fakeSupabase({ rpc: { sponsor_summaries: [ok([summaryRow()])] } })
    createClientMock.mockResolvedValue(fake.client)
    const list = await listSponsorSummaries()
    expect(list[0]).toMatchObject({ id: 4, yearTotalCents: 5_000_000, allTimeTotalCents: 9_000_000, contributionsCount: 3, lastContributionOn: '2026-09-10', lastContributionCents: 2_000_000 })
    expect(fake.opsOf('rpc:sponsor_summaries')[0][1][0]).toEqual({})

    const withYear = fakeSupabase({ rpc: { sponsor_summaries: [ok([])] } })
    createClientMock.mockResolvedValue(withYear.client)
    await listSponsorSummaries(2025)
    expect(withYear.opsOf('rpc:sponsor_summaries')[0][1][0]).toEqual({ target_year: 2025 })
  })

  it('getSponsorSummary: pide solo ese id y devuelve null si no hay fila', async () => {
    const { getSponsorSummary } = await importModel()
    const fake = fakeSupabase({ rpc: { sponsor_summaries: [ok([summaryRow({ last_contribution_on: null, last_contribution_cents: null })])] } })
    createClientMock.mockResolvedValue(fake.client)
    const one = await getSponsorSummary(4)
    expect(one).toMatchObject({ id: 4, lastContributionOn: null, lastContributionCents: null })
    expect(fake.opsOf('rpc:sponsor_summaries')[0][1][0]).toEqual({ target_sponsor_id: 4 })

    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { sponsor_summaries: [ok([])] } }).client)
    expect(await getSponsorSummary(999)).toBeNull()
  })

  it('un error de la RPC (sin income.read) se propaga', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { sponsor_summaries: [fail('42501', 'No tenés permiso')] } }).client)
    const { listSponsorSummaries } = await importModel()
    await expect(listSponsorSummaries()).rejects.toMatchObject({ code: '42501' })
  })
})
