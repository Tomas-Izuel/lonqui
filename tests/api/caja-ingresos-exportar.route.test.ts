import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS_BY_ROLE, signedOut, signInAs } from '../stubs/sessions'

/**
 * `GET /api/caja/ingresos/exportar`: el route handler que entrega el CSV de
 * otros ingresos. Se prueba con el controller y el guard de permisos REALES
 * (solo se mockean sus bordes: sesión, modelos, auditoría) para fijar lo que
 * ve el browser: cabeceras de descarga sin cache, 403 sin permiso, 400 con un
 * filtro inválido, 500 genérico si la auditoría falla (sin archivo y sin
 * filtrar el detalle del error).
 */

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))
const getOwnAppUserMock = vi.fn()
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({ getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }))
const session = { getCurrentUser: getCurrentUserMock, getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }

const listAllCashMovementsMock = vi.fn()
vi.mock('@/models/cash-movements.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/cash-movements.model')>('@/models/cash-movements.model')
  return { ...actual, listAllCashMovements: listAllCashMovementsMock }
})
const logExportMock = vi.fn()
vi.mock('@/models/exports.model', () => ({ logExport: logExportMock }))

const route = await import('@/app/api/caja/ingresos/exportar/route')

const url = (qs: string) => new Request(`http://localhost:3000/api/caja/ingresos/exportar${qs}`)

beforeEach(() => {
  listAllCashMovementsMock.mockReset().mockResolvedValue([])
  logExportMock.mockReset().mockResolvedValue(undefined)
  signInAs(session, 'consulta')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/caja/ingresos/exportar', () => {
  it('es dinámica: nunca se prerenderiza ni se cachea (lee la sesión y audita cada descarga)', () => {
    expect(route.dynamic).toBe('force-dynamic')
  })

  it('200: CSV como descarga, UTF-8, sin cache, con el nombre del mes', async () => {
    const response = await route.GET(url('?mes=2026-09'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="otros-ingresos-2026-09.csv"')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // `Response.text()` descarta el BOM al decodificar: se mira en los bytes crudos.
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toContain('Fecha;Concepto;Sponsor;Detalle;Monto;Medio;Cargó;Estado;Motivo de anulación')
  })

  it('los filtros de la URL llegan al listado y la descarga queda auditada', async () => {
    await route.GET(url('?mes=2026-09&concepto=3&sponsor=7'))
    expect(listAllCashMovementsMock).toHaveBeenCalledWith({ period: '2026-09-01', conceptId: 3, sponsorId: 7 })
    expect(logExportMock).toHaveBeenCalledTimes(1)
    expect(logExportMock.mock.calls[0][0]).toBe('other_income')
  })

  it('sin sesión: 403 JSON, sin archivo y sin tocar la base', async () => {
    signedOut(session)
    const response = await route.GET(url('?mes=2026-09'))
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
    expect(await response.json()).toEqual({ error: 'Tu sesión venció. Volvé a ingresar.' })
    expect(listAllCashMovementsMock).not.toHaveBeenCalled()
    expect(logExportMock).not.toHaveBeenCalled()
  })

  it.each(['reports.export', 'income.read'])('sin el permiso %s: 403 y nada se lee ni se audita', async (missing) => {
    signInAs(session, 'editor', { permissions: PERMISSIONS_BY_ROLE.editor.filter((p) => p !== missing) })
    const response = await route.GET(url('?mes=2026-09'))
    expect(response.status).toBe(403)
    expect(listAllCashMovementsMock).not.toHaveBeenCalled()
    expect(logExportMock).not.toHaveBeenCalled()
  })

  it('mes inválido o ausente: 400 con el mensaje de dominio', async () => {
    for (const qs of ['', '?mes=2026-13', '?mes=hola', '?mes=2026-09&concepto=abc']) {
      const response = await route.GET(url(qs))
      expect(response.status, qs).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error.length).toBeGreaterThan(0)
      expect(response.headers.get('Content-Disposition')).toBeNull()
    }
    expect(listAllCashMovementsMock).not.toHaveBeenCalled()
  })

  it('un parámetro repetido o desconocido no se cuela: 400', async () => {
    expect((await route.GET(url('?mes=2026-09&otro=1'))).status).toBe(400)
  })

  it('si la auditoría falla: 500 genérico, SIN archivo y sin filtrar el detalle de Postgres', async () => {
    logExportMock.mockRejectedValue({ code: 'XX000', message: 'detalle interno con DNI 99123456' })
    const response = await route.GET(url('?mes=2026-09'))
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Disposition')).toBeNull()
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
    const text = await response.text()
    expect(text).not.toContain('99123456')
    expect(text).not.toContain('Fecha;Concepto')
    expect(JSON.parse(text)).toEqual({ error: 'No pudimos completar la operación. Probá de nuevo en un momento.' })
  })

  it('si el listado falla: 500 genérico, tampoco se audita una exportación que no ocurrió', async () => {
    listAllCashMovementsMock.mockRejectedValue(new Error('timeout'))
    const response = await route.GET(url('?mes=2026-09'))
    expect(response.status).toBe(500)
    expect(logExportMock).not.toHaveBeenCalled()
  })
})
