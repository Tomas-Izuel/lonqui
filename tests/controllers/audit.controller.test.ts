import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `audit.controller.ts` es un controller de LECTURA para `/auditoria`
 * (Server Component): usa `requirePanelAccess`, no `requireRole` — la
 * distinción de CLAUDE.md importa acá porque esto no es una Server Action,
 * así que un redirect (en vez de tirar) es lo correcto. Se llama ANTES de
 * tocar el modelo a propósito: la policy de SELECT de `audit_log` ya es
 * admin-only, así que sin este chequeo un `editor` vería una página vacía
 * (indistinguible de "no hay auditoría") en vez del corte que le corresponde.
 */

const requirePanelAccessMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePanelAccess: requirePanelAccessMock }))

const getAuditPageModelMock = vi.fn()
const getAuditEntryModelMock = vi.fn()
vi.mock('@/models/audit.model', () => ({
  getAuditPage: getAuditPageModelMock,
  getAuditEntry: getAuditEntryModelMock,
}))

const listAppUsersMock = vi.fn()
vi.mock('@/models/app-users.model', () => ({ listAppUsers: listAppUsersMock }))

const { getAuditPage, getAuditEntry, listAuditActorOptions } = await import('@/controllers/audit.controller')

beforeEach(() => {
  requirePanelAccessMock.mockReset()
  getAuditPageModelMock.mockReset()
  getAuditEntryModelMock.mockReset()
  listAppUsersMock.mockReset()
})

describe('getAuditPage / getAuditEntry', () => {
  it('verifican el rol ANTES de tocar el modelo (para no confundir "sin acceso" con "sin filas")', async () => {
    requirePanelAccessMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })

    await expect(getAuditPage({})).rejects.toThrow('REDIRECT:/')
    expect(getAuditPageModelMock).not.toHaveBeenCalled()

    await expect(getAuditEntry(1)).rejects.toThrow('REDIRECT:/')
    expect(getAuditEntryModelMock).not.toHaveBeenCalled()
  })

  it('con acceso, delegan en el modelo y devuelven su resultado tal cual', async () => {
    requirePanelAccessMock.mockResolvedValue({ role: 'admin' })
    getAuditPageModelMock.mockResolvedValue({ items: [], nextCursor: null })
    getAuditEntryModelMock.mockResolvedValue({ id: 1 })

    expect(await getAuditPage({ tableName: 'members' })).toEqual({ items: [], nextCursor: null })
    expect(getAuditPageModelMock).toHaveBeenCalledWith({ tableName: 'members' })

    expect(await getAuditEntry(1)).toEqual({ id: 1 })
  })

  it('requirePanelAccess se llama pidiendo admin explícitamente', async () => {
    requirePanelAccessMock.mockResolvedValue({ role: 'admin' })
    getAuditPageModelMock.mockResolvedValue({ items: [], nextCursor: null })
    await getAuditPage({})
    expect(requirePanelAccessMock).toHaveBeenCalledWith('admin')
  })
})

describe('listAuditActorOptions', () => {
  it('exige acceso de admin antes de leer app_users', async () => {
    requirePanelAccessMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(listAuditActorOptions()).rejects.toThrow('REDIRECT:/')
    expect(listAppUsersMock).not.toHaveBeenCalled()
  })

  it('mapea userId/displayName y ordena alfabéticamente en español', async () => {
    requirePanelAccessMock.mockResolvedValue({ role: 'admin' })
    listAppUsersMock.mockResolvedValue([
      { userId: 'u2', displayName: 'Zulema', email: 'z@lonqui.test', role: 'editor' },
      { userId: 'u1', displayName: 'Álvaro', email: 'a@lonqui.test', role: 'admin' },
      { userId: 'u3', displayName: 'ávaro', email: 'a2@lonqui.test', role: 'consulta' },
    ])

    const result = await listAuditActorOptions()

    expect(result).toEqual([
      { userId: 'u1', displayName: 'Álvaro' },
      { userId: 'u3', displayName: 'ávaro' },
      { userId: 'u2', displayName: 'Zulema' },
    ])
  })

  it('no incluye ningún otro campo de AppUser (ni email ni rol): solo lo que el select necesita', async () => {
    requirePanelAccessMock.mockResolvedValue({ role: 'admin' })
    listAppUsersMock.mockResolvedValue([
      { userId: 'u1', displayName: 'Ana', email: 'ana@lonqui.test', role: 'admin', isActive: true },
    ])

    const result = await listAuditActorOptions()
    expect(Object.keys(result[0]).sort()).toEqual(['displayName', 'userId'])
  })
})
