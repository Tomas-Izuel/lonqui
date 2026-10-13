import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS_BY_ROLE, signedOut, signInAs } from '../stubs/sessions'

/**
 * `income.controller.ts`: lecturas de /caja/ingresos y /caja/sponsors
 * (redirigen, no tiran) y `exportOtherIncomeCsv` (tira, lo consume el route
 * handler). Guard de permisos REAL; se mockean sus bordes y los modelos.
 *
 * Lo central de la exportación: es el momento en que datos personales salen
 * del sistema. Se audita ANTES de entregar y, si la auditoría falla, no hay
 * archivo; los textos que tipea una persona no pueden ejecutarse como fórmula
 * en Excel.
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))
const getOwnAppUserMock = vi.fn()
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({ getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }))
const session = { getCurrentUser: getCurrentUserMock, getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }

const listCashMovementsMock = vi.fn()
const listAllCashMovementsMock = vi.fn()
const listSponsorMovementsMock = vi.fn()
vi.mock('@/models/cash-movements.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/cash-movements.model')>('@/models/cash-movements.model')
  return { ...actual, listCashMovements: listCashMovementsMock, listAllCashMovements: listAllCashMovementsMock, listSponsorMovements: listSponsorMovementsMock }
})
const listCashConceptsMock = vi.fn()
vi.mock('@/models/cash-concepts.model', () => ({ listCashConcepts: listCashConceptsMock }))
const logExportMock = vi.fn()
vi.mock('@/models/exports.model', () => ({ logExport: logExportMock }))
const getCashMonthSummaryMock = vi.fn()
vi.mock('@/models/reports.model', () => ({ getCashMonthSummary: getCashMonthSummaryMock }))
const getSponsorSummaryMock = vi.fn()
const listSponsorOptionsMock = vi.fn()
const listSponsorSummariesMock = vi.fn()
vi.mock('@/models/sponsors.model', () => ({
  getSponsorSummary: getSponsorSummaryMock,
  listSponsorOptions: listSponsorOptionsMock,
  listSponsorSummaries: listSponsorSummariesMock,
}))

const { getOtherIncomePage, getSponsorsPage, getSponsorDetailPage, exportOtherIncomeCsv } = await import('@/controllers/income.controller')
const { DomainError, PermissionError } = await import('@/lib/errors')

beforeEach(() => {
  redirectMock.mockClear()
  for (const m of [listCashMovementsMock, listAllCashMovementsMock, listSponsorMovementsMock, listCashConceptsMock, logExportMock, getCashMonthSummaryMock, getSponsorSummaryMock, listSponsorOptionsMock, listSponsorSummariesMock]) {
    m.mockReset()
  }
  signInAs(session, 'consulta')
})

function movement(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    direction: 'income',
    conceptId: 3,
    conceptName: 'Indumentaria',
    sponsorId: null,
    sponsorName: null,
    amountCents: 4_800_000,
    occurredOn: '2026-09-05',
    method: 'cash',
    hasReceipt: false,
    receiptFilename: null,
    description: null,
    batchId: 'b',
    createdByName: 'Persona Inventada',
    createdAt: '2026-09-05T12:00:00Z',
    voidedAt: null,
    voidReason: null,
    voided: false,
    ...over,
  }
}

describe('getOtherIncomePage', () => {
  it('compone movimientos + resumen del mes + conceptos y sponsors CON inactivos (los filtros pueden elegir uno desactivado)', async () => {
    listCashMovementsMock.mockResolvedValue([movement()])
    getCashMonthSummaryMock.mockResolvedValue({ period: '2026-09-01', totalCents: 1 })
    listCashConceptsMock.mockResolvedValue([{ id: 3 }])
    listSponsorOptionsMock.mockResolvedValue([{ id: 7 }])

    const page = await getOtherIncomePage({ period: '2026-09-01', conceptId: 3 })

    expect(page).toEqual({ movements: [movement()], summary: { period: '2026-09-01', totalCents: 1 }, concepts: [{ id: 3 }], sponsors: [{ id: 7 }], truncated: false })
    expect(listCashMovementsMock).toHaveBeenCalledWith({ period: '2026-09-01', conceptId: 3 })
    expect(getCashMonthSummaryMock).toHaveBeenCalledWith('2026-09-01')
    expect(listCashConceptsMock).toHaveBeenCalledWith({ includeInactive: true })
    expect(listSponsorOptionsMock).toHaveBeenCalledWith({ includeInactive: true })
  })

  it('exige income.read Y payments.read (el resumen incluye cuotas); si falta uno, redirige a / y no toca la base', async () => {
    signInAs(session, 'consulta', { permissions: PERMISSIONS_BY_ROLE.consulta.filter((p) => p !== 'payments.read') })
    await expect(getOtherIncomePage({ period: '2026-09-01' })).rejects.toThrow('REDIRECT:/')
    signInAs(session, 'consulta', { permissions: PERMISSIONS_BY_ROLE.consulta.filter((p) => p !== 'income.read') })
    await expect(getOtherIncomePage({ period: '2026-09-01' })).rejects.toThrow('REDIRECT:/')
    signedOut(session)
    await expect(getOtherIncomePage({ period: '2026-09-01' })).rejects.toThrow('REDIRECT:/login')
    expect(listCashMovementsMock).not.toHaveBeenCalled()
  })

  it('período inválido: DomainError (la page tiene que sanear ?mes=), sin tocar la base', async () => {
    await expect(getOtherIncomePage({ period: 'no-es-fecha' })).rejects.toBeInstanceOf(DomainError)
    await expect(getOtherIncomePage({ period: '2026-09-01', conceptId: -1 })).rejects.toBeInstanceOf(DomainError)
    expect(listCashMovementsMock).not.toHaveBeenCalled()
  })

  it('truncated: 500 filas NO (caben justo); 501 (el modelo pide uno de más) sí, y se recorta a 500', async () => {
    getCashMonthSummaryMock.mockResolvedValue({})
    listCashConceptsMock.mockResolvedValue([])
    listSponsorOptionsMock.mockResolvedValue([])
    listCashMovementsMock.mockResolvedValue(Array.from({ length: 500 }, (_, i) => movement({ id: i })))
    const exact = await getOtherIncomePage({ period: '2026-09-01' })
    expect(exact.truncated).toBe(false)
    expect(exact.movements).toHaveLength(500)

    listCashMovementsMock.mockResolvedValue(Array.from({ length: 501 }, (_, i) => movement({ id: i })))
    const over = await getOtherIncomePage({ period: '2026-09-01' })
    expect(over.truncated).toBe(true)
    expect(over.movements).toHaveLength(500)
    expect(over.movements[0].id).toBe(0)
  })
})

describe('getSponsorsPage / getSponsorDetailPage', () => {
  it('lista de sponsors: exige income.read (redirige sin él)', async () => {
    listSponsorSummariesMock.mockResolvedValue([{ id: 1 }])
    expect(await getSponsorsPage()).toEqual([{ id: 1 }])
    signInAs(session, 'consulta', { permissions: ['members.read'] })
    await expect(getSponsorsPage()).rejects.toThrow('REDIRECT:/')
  })

  it('ficha: sponsor + aportes; si el sponsor no existe devuelve null (la page hace notFound)', async () => {
    getSponsorSummaryMock.mockResolvedValue({ id: 7 })
    listSponsorMovementsMock.mockResolvedValue([movement()])
    expect(await getSponsorDetailPage(7)).toEqual({ sponsor: { id: 7 }, movements: [movement()] })
    expect(listSponsorMovementsMock).toHaveBeenCalledWith(7)

    getSponsorSummaryMock.mockResolvedValue(null)
    listSponsorMovementsMock.mockResolvedValue([])
    expect(await getSponsorDetailPage(999)).toBeNull()
  })
})

describe('exportOtherIncomeCsv: permisos y validación', () => {
  it('consulta SÍ exporta (el contrato le da exportación); sin reports.export o sin income.read, PermissionError y nada se lee', async () => {
    listAllCashMovementsMock.mockResolvedValue([])
    logExportMock.mockResolvedValue(undefined)
    await expect(exportOtherIncomeCsv({ mes: '2026-09' })).resolves.toMatchObject({ filename: 'otros-ingresos-2026-09.csv' })

    for (const missing of ['reports.export', 'income.read']) {
      listAllCashMovementsMock.mockClear()
      signInAs(session, 'editor', { permissions: PERMISSIONS_BY_ROLE.editor.filter((p) => p !== missing) })
      await expect(exportOtherIncomeCsv({ mes: '2026-09' })).rejects.toBeInstanceOf(PermissionError)
      expect(listAllCashMovementsMock).not.toHaveBeenCalled()
    }
    signedOut(session)
    await expect(exportOtherIncomeCsv({ mes: '2026-09' })).rejects.toBeInstanceOf(PermissionError)
  })

  it.each([
    ['sin mes', {}],
    ['mes 13', { mes: '2026-13' }],
    ['mes 00', { mes: '2026-00' }],
    ['mes sin cero', { mes: '2026-9' }],
    ['mes con día', { mes: '2026-09-01' }],
    ['mes con comillas (intento de romper el header)', { mes: '2026-09"; x=' }],
    ['concepto no numérico', { mes: '2026-09', concepto: 'abc' }],
    ['concepto negativo', { mes: '2026-09', concepto: '-1' }],
    ['sponsor con decimales', { mes: '2026-09', sponsor: '1.5' }],
    ['sponsor vacío', { mes: '2026-09', sponsor: '' }],
    ['clave de más', { mes: '2026-09', q: 'x' }],
    ['input que no es objeto', null],
  ])('%s: DomainError 400, no se lee ni se audita nada', async (_n, input) => {
    const err = await exportOtherIncomeCsv(input).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.status).toBe(400)
    expect(listAllCashMovementsMock).not.toHaveBeenCalled()
    expect(logExportMock).not.toHaveBeenCalled()
  })

  it('filtros: concepto y sponsor llegan como números; período es el día 1 del mes', async () => {
    listAllCashMovementsMock.mockResolvedValue([])
    logExportMock.mockResolvedValue(undefined)
    await exportOtherIncomeCsv({ mes: '2026-02', concepto: '3', sponsor: '7' })
    expect(listAllCashMovementsMock).toHaveBeenCalledWith({ period: '2026-02-01', conceptId: 3, sponsorId: 7 })
    await exportOtherIncomeCsv({ mes: '2026-02' })
    expect(listAllCashMovementsMock).toHaveBeenLastCalledWith({ period: '2026-02-01' })
  })
})

describe('exportOtherIncomeCsv: auditoría', () => {
  it('audita con listado other_income, los filtros y la cantidad de filas, ANTES de devolver el archivo', async () => {
    const order: string[] = []
    listAllCashMovementsMock.mockImplementation(async () => {
      order.push('leer')
      return [movement(), movement({ id: 2 })]
    })
    logExportMock.mockImplementation(async () => {
      order.push('auditar')
    })

    const result = await exportOtherIncomeCsv({ mes: '2026-09', concepto: '3' })
    order.push('devuelto')

    expect(order).toEqual(['leer', 'auditar', 'devuelto'])
    expect(logExportMock).toHaveBeenCalledTimes(1)
    expect(logExportMock).toHaveBeenCalledWith('other_income', { mes: '2026-09', concepto: '3', sponsor: undefined }, 2)
    expect(result.body).toContain('Indumentaria')
  })

  it('si la auditoría falla, NO se devuelve el archivo: tira, y el error crudo no se disfraza de éxito', async () => {
    listAllCashMovementsMock.mockResolvedValue([movement()])
    logExportMock.mockRejectedValue({ code: '42501', message: 'No tenés permiso para exportar' })
    const result = await exportOtherIncomeCsv({ mes: '2026-09' }).then(
      (r) => ({ resolved: r }),
      (e) => ({ rejected: e }),
    )
    expect('resolved' in result).toBe(false)
    expect(result).toMatchObject({ rejected: { code: '42501' } })
  })

  it('un mes vacío igual se audita (con 0 filas) y devuelve solo el encabezado', async () => {
    listAllCashMovementsMock.mockResolvedValue([])
    logExportMock.mockResolvedValue(undefined)
    const { body } = await exportOtherIncomeCsv({ mes: '2026-09' })
    expect(logExportMock).toHaveBeenCalledWith('other_income', expect.anything(), 0)
    expect(body.replace('﻿', '').split('\r\n')).toEqual(['Fecha;Concepto;Sponsor;Detalle;Monto;Medio;Cargó;Estado;Motivo de anulación'])
  })
})

describe('exportOtherIncomeCsv: formato del CSV', () => {
  async function csvFor(rows: unknown[]) {
    listAllCashMovementsMock.mockResolvedValue(rows)
    logExportMock.mockResolvedValue(undefined)
    const { body } = await exportOtherIncomeCsv({ mes: '2026-09' })
    return body.replace('﻿', '').split('\r\n')
  }

  it('empieza con BOM UTF-8 (Excel abre bien los acentos), separa con ; y las filas con CRLF', async () => {
    listAllCashMovementsMock.mockResolvedValue([movement()])
    logExportMock.mockResolvedValue(undefined)
    const { body } = await exportOtherIncomeCsv({ mes: '2026-09' })
    expect(body.startsWith('﻿')).toBe(true)
    expect(body).toContain('\r\n')
    expect(body.split('\r\n')[1].split(';')).toHaveLength(9)
  })

  it('una fila vigente en efectivo: fecha dd/mm/aaaa, monto en pesos enteros SIN decimales, medio y estado en español', async () => {
    const [, row] = await csvFor([movement({ sponsorName: 'Corralón Inventado', description: '12 camisetas', voided: false })])
    expect(row).toBe('05/09/2026;Indumentaria;Corralón Inventado;12 camisetas;48000;Efectivo;Persona Inventada;Vigente;')
  })

  it('transferencia anulada: medio, estado y motivo de anulación', async () => {
    const [, row] = await csvFor([movement({ method: 'transfer', voided: true, voidedAt: 'x', voidReason: 'Cargado dos veces' })])
    expect(row).toBe('05/09/2026;Indumentaria;;;48000;Transferencia;Persona Inventada;Anulado;Cargado dos veces')
  })

  it.each([
    [100, '1'],
    [100_000_000, '1000000'],
    [4_800_050, '48000,50'],
    [1, '0,01'],
    [99, '0,99'],
    [101, '1,01'],
  ])('monto %i centavos: sin float y sin separador de miles (%s)', async (cents, expected) => {
    const [, row] = await csvFor([movement({ amountCents: cents })])
    expect(row.split(';')[4]).toBe(expected)
  })

  it.each([
    ['=HYPERLINK("http://malo.test","click")', `"'=HYPERLINK(""http://malo.test"",""click"")"`],
    ['+54 9 2923 555-0000', "'+54 9 2923 555-0000"],
    ['-2+3', "'-2+3"],
    ['@SUMA(A1)', "'@SUMA(A1)"],
    ['\tcomienza con tab', "'\tcomienza con tab"],
    ['\rcomienza con CR', `"'\rcomienza con CR"`],
  ])('inyección de fórmulas: el detalle %j sale neutralizado con apóstrofo como celda %j', async (text, expectedCell) => {
    const lines = await csvFor([movement({ description: text })])
    // Columnas: ...;Indumentaria;<sponsor vacío>;<detalle>;48000;...
    expect(lines.join('\r\n')).toContain(`;Indumentaria;;${expectedCell};48000;`)
  })

  it('la neutralización alcanza a TODOS los textos libres: concepto, sponsor, detalle, quién cargó y motivo', async () => {
    const evil = '=1+1'
    const [, row] = await csvFor([
      movement({ conceptName: evil, sponsorName: evil, description: evil, createdByName: evil, voided: true, voidReason: evil }),
    ])
    const cells = row.split(';')
    for (const index of [1, 2, 3, 6, 8]) expect(cells[index], `columna ${index}`).toBe("'=1+1")
  })

  it('texto normal no se altera, ni siquiera si tiene un guion o un mas en el medio', async () => {
    const [, row] = await csvFor([movement({ description: 'Peña 7ma - día del niño + sorteo' })])
    expect(row.split(';')[3]).toBe('Peña 7ma - día del niño + sorteo')
  })

  it('comillas, punto y coma y saltos de línea en el texto: se citan y las comillas se duplican (la fila no se parte)', async () => {
    const lines = await csvFor([movement({ description: 'dijo "hola"; chau\nsegunda línea' })])
    const body = lines.join('\r\n')
    expect(body).toContain('"dijo ""hola""; chau\nsegunda línea"')
    // El salto de línea interno es LF, no CRLF: no agrega una fila.
    expect(lines).toHaveLength(2)
  })

  it('combinado: fórmula con comillas y separador queda neutralizada Y citada', async () => {
    const lines = await csvFor([movement({ description: '=A1;"x"' })])
    expect(lines[1].split('\r\n')[0]).toContain(`"'=A1;""x"""`)
  })

  it('las filas salen en el orden del modelo (más nuevo primero) y los anulados se exportan (nada se oculta)', async () => {
    const lines = await csvFor([
      movement({ id: 2, occurredOn: '2026-09-20' }),
      movement({ id: 1, occurredOn: '2026-09-02', voided: true, voidReason: 'Error' }),
    ])
    expect(lines.slice(1).map((l) => l.slice(0, 10))).toEqual(['20/09/2026', '02/09/2026'])
    expect(lines[2]).toContain('Anulado')
  })
})
