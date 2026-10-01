import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from '@/lib/log'

/**
 * supabase-js devuelve el PostgrestError como objeto plano, no como Error. El
 * log tiene que decir qué falló (code/message/hint) pero NUNCA `details`: en
 * una violación de unique trae el valor ("Key (dni)=(...)"), o sea datos
 * personales (Ley 25.326).
 */
describe('log.error con errores que no son Error', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => spy.mockRestore())

  const loggedError = () => {
    const extras = spy.mock.calls[0].find((a: unknown) => typeof a === 'object' && a !== null) as { error: unknown }
    return extras.error as Record<string, unknown>
  }

  it('PostgrestError: loguea code, message y hint', () => {
    log.error('test', 'falló', { code: '23514', message: 'violates check constraint "x"', hint: 'revisá', details: 'Failing row contains (1)' })
    expect(loggedError()).toEqual({ code: '23514', message: 'violates check constraint "x"', hint: 'revisá' })
  })

  it('PostgrestError: NUNCA incluye details (trae el DNI en un unique)', () => {
    log.error('test', 'falló', {
      code: '23505',
      message: 'duplicate key',
      details: 'Key (dni)=(99123456) already exists.',
    })
    const serialized = JSON.stringify(spy.mock.calls)
    expect(serialized).not.toContain('99123456')
    expect(serialized).not.toContain('details')
  })

  it.each([
    ['22P02', 'invalid input syntax for type bigint: "Lucía Pérez 99123456"'],
    ['22007', 'invalid input syntax for type date: "31/02/1990 Calle Falsa 123"'],
    ['22001', 'value too long for type character varying(120)'],
    ['XX000', 'error con el teléfono 11-5555-1234'],
  ])('code %s (clase 22 u otra no segura): el message puede traer el valor tipeado y NO se loguea', (code, message) => {
    log.error('test', 'falló', { code, message })
    expect(loggedError()).toEqual({ code })
    const serialized = JSON.stringify(spy.mock.calls)
    expect(serialized).not.toContain('99123456')
    expect(serialized).not.toContain('Calle Falsa')
    expect(serialized).not.toContain('5555')
  })

  it.each(['23505', '23514', '23503', '42501', '42P01', 'PGRST116'])(
    'code %s (integridad, privilegios o PostgREST): el message se loguea porque trae el nombre de la constraint, no valores',
    (code) => {
      log.error('test', 'falló', { code, message: 'constraint "members_dni_key"' })
      expect(loggedError()).toEqual({ code, message: 'constraint "members_dni_key"' })
    },
  )

  it('sin code: no hay forma de saber si el message es seguro, no se loguea', () => {
    log.error('test', 'falló', { message: 'algo con el email ana@ejemplo.test' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('ana@ejemplo.test')
  })

  it('hint vacío se omite', () => {
    log.error('test', 'falló', { code: '42501', message: 'denied', hint: '' })
    expect(loggedError()).toEqual({ code: '42501', message: 'denied' })
  })

  it('no sale "[object Object]"', () => {
    log.error('test', 'falló', { code: '1', message: 'm' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('[object Object]')
  })

  it('Error: mantiene name, message y stack', () => {
    log.error('test', 'falló', new TypeError('boom'))
    const e = loggedError()
    expect(e.name).toBe('TypeError')
    expect(e.message).toBe('boom')
    expect(typeof e.stack).toBe('string')
  })

  it('primitivo: cae a { value: String(x) }', () => {
    log.error('test', 'falló', 'texto suelto')
    expect(loggedError()).toEqual({ value: 'texto suelto' })
  })
})
