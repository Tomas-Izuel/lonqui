import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signedOut, signInAs, type TestRole } from '../stubs/sessions'

/**
 * `sponsors.actions.ts`. Roles contra el guard REAL de permisos: `editor`
 * crea y edita (income.register) pero NO desactiva ni reactiva
 * (sponsors.deactivate, solo admin); `consulta` no escribe nada. Además: los
 * datos de contacto de un sponsor (nombre, teléfono, email) son datos
 * personales y no pueden terminar en un log aunque el modelo falle.
 */

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))
const getOwnAppUserMock = vi.fn()
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({ getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }))
const session = { getCurrentUser: getCurrentUserMock, getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }

const insertSponsorMock = vi.fn()
const updateSponsorMock = vi.fn()
const setActiveMock = vi.fn()
vi.mock('@/models/sponsors.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/sponsors.model')>('@/models/sponsors.model')
  return { ...actual, createSponsor: insertSponsorMock, updateSponsor: updateSponsorMock, setSponsorActive: setActiveMock }
})

const { createSponsor, updateSponsor, setSponsorActive } = await import('@/controllers/sponsors.actions')
const { DomainError } = await import('@/lib/errors')

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of [revalidatePathMock, insertSponsorMock, updateSponsorMock, setActiveMock]) m.mockReset()
  signInAs(session, 'editor')
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

const DENIED = { ok: false, error: 'No tenés permiso para hacer esto' }

describe('createSponsor / updateSponsor (income.register)', () => {
  it.each([
    ['consulta', false],
    ['editor', true],
    ['admin', true],
  ] as Array<[TestRole, boolean]>)('rol %s: crea y edita = %s', async (role, allowed) => {
    signInAs(session, role)
    insertSponsorMock.mockResolvedValue({ id: 1, name: 'Corralón Inventado' })
    updateSponsorMock.mockResolvedValue({ id: 1, name: 'Corralón Inventado' })

    const created = await createSponsor({ name: 'Corralón Inventado' })
    const updated = await updateSponsor(1, { name: 'Corralón Inventado' })

    expect(created.ok).toBe(allowed)
    expect(updated.ok).toBe(allowed)
    if (!allowed) {
      expect(created).toEqual(DENIED)
      expect(insertSponsorMock).not.toHaveBeenCalled()
      expect(updateSponsorMock).not.toHaveBeenCalled()
      expect(revalidatePathMock).not.toHaveBeenCalled()
    } else {
      expect(revalidatePathMock).toHaveBeenCalledWith('/caja', 'layout')
    }
  })

  it('sin sesión: denegado', async () => {
    signedOut(session)
    expect((await createSponsor({ name: 'Corralón Inventado' })).ok).toBe(false)
    expect(insertSponsorMock).not.toHaveBeenCalled()
  })

  it('validación con field: nombre corto, email inválido; el modelo no se toca', async () => {
    expect(await createSponsor({ name: 'A' })).toMatchObject({ ok: false, field: 'name' })
    expect(await createSponsor({ name: 'Corralón', email: 'no-es-mail' })).toMatchObject({ ok: false, field: 'email' })
    expect(await createSponsor({ name: 'Corralón', isActive: false })).toMatchObject({ ok: false })
    expect(insertSponsorMock).not.toHaveBeenCalled()
  })

  it('updateSponsor: id inválido (0, negativo, decimal) rechazado sin tocar el modelo', async () => {
    for (const id of [0, -3, 1.5, Number.NaN]) {
      expect((await updateSponsor(id, { name: 'Corralón' })).ok).toBe(false)
    }
    expect(updateSponsorMock).not.toHaveBeenCalled()
  })

  it('nombre repetido: el mensaje y el field del modelo llegan a la vista', async () => {
    insertSponsorMock.mockRejectedValue(new DomainError('Ya existe un sponsor con ese nombre', { field: 'name' }))
    expect(await createSponsor({ name: 'Corralón Inventado' })).toEqual({ ok: false, error: 'Ya existe un sponsor con ese nombre', field: 'name' })
  })
})

describe('setSponsorActive (sponsors.deactivate, solo admin)', () => {
  it.each([
    ['consulta', false],
    ['editor', false],
    ['admin', true],
  ] as Array<[TestRole, boolean]>)('rol %s: desactiva/reactiva = %s', async (role, allowed) => {
    signInAs(session, role)
    setActiveMock.mockResolvedValue({ id: 1, isActive: false })
    const result = await setSponsorActive({ id: 1, isActive: false, reason: 'Cerró el local' })
    expect(result.ok).toBe(allowed)
    expect(setActiveMock).toHaveBeenCalledTimes(allowed ? 1 : 0)
    if (!allowed) expect(result).toEqual(DENIED)
  })

  it('desactivar sin motivo (o corto): field reason, sin llamar al modelo', async () => {
    signInAs(session, 'admin')
    expect(await setSponsorActive({ id: 1, isActive: false })).toMatchObject({ ok: false, field: 'reason' })
    expect(await setSponsorActive({ id: 1, isActive: false, reason: 'ab' })).toMatchObject({ ok: false, field: 'reason' })
    expect(setActiveMock).not.toHaveBeenCalled()
  })

  it('desactivar pasa el motivo recortado; reactivar no necesita motivo y pasa null', async () => {
    signInAs(session, 'admin')
    setActiveMock.mockResolvedValue({ id: 1 })
    await setSponsorActive({ id: 1, isActive: false, reason: '  Cerró el local  ' })
    expect(setActiveMock).toHaveBeenLastCalledWith(1, false, 'Cerró el local')
    await setSponsorActive({ id: 1, isActive: true })
    expect(setActiveMock).toHaveBeenLastCalledWith(1, true, null)
    expect(revalidatePathMock).toHaveBeenCalledWith('/caja', 'layout')
  })
})

describe('sin datos personales en los logs', () => {
  const PII = { contactName: 'Marta Inventada', phone: '2923 555-0101', email: 'marta@ejemplo.test' }

  it('si el modelo falla con un error de Postgres que trae la fila entera en details, el log no la contiene y el usuario ve un genérico', async () => {
    insertSponsorMock.mockRejectedValue({
      code: '23514',
      message: 'new row for relation "sponsors" violates check constraint "sponsors_phone_check"',
      details: 'Failing row contains (7, Corralón Inventado, Marta Inventada, 2923 555-0101, marta@ejemplo.test)',
      hint: '',
    })

    const result = await createSponsor({ name: 'Corralón Inventado', ...PII })

    expect(result).toEqual({ ok: false, error: 'No pudimos completar la operación. Probá de nuevo en un momento.' })
    expect(errorSpy).toHaveBeenCalled()
    const logged = JSON.stringify(errorSpy.mock.calls)
    for (const secret of ['Marta', '555-0101', 'ejemplo.test', 'Corralón Inventado']) {
      expect(logged, `el log filtró "${secret}"`).not.toContain(secret)
    }
    // Sí queda lo útil para diagnosticar.
    expect(logged).toContain('23514')
    expect(logged).toContain('sponsors.createSponsor')
  })

  it('el payload con claves de más tampoco loguea valores, solo los nombres de las claves', async () => {
    await createSponsor({ name: 'Corralón Inventado', ...PII, extra: 'valor-secreto' })
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('valor-secreto')
    expect(logged).not.toContain('Marta')
  })
})
