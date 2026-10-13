import { describe, expect, it } from 'vitest'
import { toCsv } from '@/lib/csv'

/**
 * `toCsv`: CSV puro para Excel en español (Argentina). Default `;` (la coma es
 * el separador decimal), BOM UTF-8 (acentos), CRLF. El citado correcto es lo
 * que impide que un texto con `;`, comillas o saltos de línea parta o
 * desplace las columnas de una fila. (El guard de fórmulas `= + - @` es del
 * llamador, que sabe qué es texto libre: ver `income.controller.test.ts`.)
 */

const BOM = '﻿'

describe('toCsv', () => {
  it('ejemplo del contrato: separador ;, celda con ; citada, comillas duplicadas, null vacío, número sin comillas', () => {
    expect(toCsv([['a;b', 'c"d', null, 10000]], { bom: false })).toBe('"a;b";"c""d";;10000')
  })

  it('BOM por defecto (Excel abre los acentos bien) y se puede apagar', () => {
    expect(toCsv([['á']])).toBe(`${BOM}á`)
    expect(toCsv([['á']], { bom: false })).toBe('á')
  })

  it('filas separadas por CRLF, sin CRLF final', () => {
    const csv = toCsv([['a'], ['b'], ['c']], { bom: false })
    expect(csv).toBe('a\r\nb\r\nc')
    expect(csv.endsWith('\r\n')).toBe(false)
  })

  it('sin filas: cadena vacía (más el BOM)', () => {
    expect(toCsv([], { bom: false })).toBe('')
    expect(toCsv([])).toBe(BOM)
  })

  it('un salto de línea (LF o CR) dentro de una celda la cita: la fila no se parte', () => {
    expect(toCsv([['una\nlínea', 'x']], { bom: false })).toBe('"una\nlínea";x')
    expect(toCsv([['una\rlínea']], { bom: false })).toBe('"una\rlínea"')
    expect(toCsv([['a\r\nb']], { bom: false })).toBe('"a\r\nb"')
  })

  it('con separador coma: cita las celdas con coma y ya NO las que tienen punto y coma', () => {
    expect(toCsv([['a,b', 'c;d']], { separator: ',', bom: false })).toBe('"a,b",c;d')
    expect(toCsv([['a,b', 'c;d']], { bom: false })).toBe('a,b;"c;d"')
  })

  it('comillas solas: se citan y se duplican; una celda que ya es "" se escapa bien', () => {
    expect(toCsv([['"']], { bom: false })).toBe('""""')
    expect(toCsv([['""']], { bom: false })).toBe('""""""')
  })

  it('texto vacío y null dan la misma celda vacía; 0 NO es vacío', () => {
    expect(toCsv([['', null, 0]], { bom: false })).toBe(';;0')
  })

  it('los números salen tal cual, sin formato regional ni notación científica para montos de centavos grandes', () => {
    expect(toCsv([[1234567890123, -5, 0.5]], { bom: false })).toBe('1234567890123;-5;0.5')
  })

  it('el unicode (ñ, emojis, acentos) pasa intacto', () => {
    expect(toCsv([['Peña día 🎉']], { bom: false })).toBe('Peña día 🎉')
  })

  it('una fila con una sola celda vacía NO se vuelve una línea vacía ambigua entre dos filas', () => {
    expect(toCsv([['a'], [null], ['b']], { bom: false })).toBe('a\r\n\r\nb')
  })
})
