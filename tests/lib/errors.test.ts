import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { DomainError, PermissionError, isDomainError, toApiError, zodToApiError } from '@/lib/errors'
import { z } from 'zod'

describe('DomainError / PermissionError', () => {
  it('isDomainError distingue un DomainError de cualquier otra excepción', () => {
    expect(isDomainError(new DomainError('x'))).toBe(true)
    expect(isDomainError(new Error('x'))).toBe(false)
    expect(isDomainError('x')).toBe(false)
    expect(isDomainError(null)).toBe(false)
  })

  it('DomainError tiene status 400 por defecto', () => {
    expect(new DomainError('x').status).toBe(400)
  })

  it('PermissionError es un DomainError con status 403', () => {
    const err = new PermissionError()
    expect(isDomainError(err)).toBe(true)
    expect(err.status).toBe(403)
    expect(err.name).toBe('PermissionError')
  })

  it('PermissionError tiene un mensaje genérico por defecto que no filtra detalle', () => {
    expect(new PermissionError().message).toBe('No tenés permiso para hacer esto')
  })
})

describe('toApiError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('un DomainError pasa su mensaje tal cual: es interfaz, el usuario lo tiene que ver', () => {
    const { body, status } = toApiError(new DomainError('Ya hay un socio con ese DNI', { field: 'dni' }), 'ctx')
    expect(body).toEqual({ error: 'Ya hay un socio con ese DNI', field: 'dni' })
    expect(status).toBe(400)
  })

  it('cualquier otra excepción devuelve un mensaje genérico, nunca el texto crudo', () => {
    const { body, status } = toApiError(new Error('relation "app_users" violates constraint xyz'), 'ctx')
    expect(body.error).not.toContain('constraint')
    expect(body.field).toBeUndefined()
    expect(status).toBe(500)
  })

  it('un error interno se loguea en el servidor con el contexto', () => {
    toApiError(new Error('boom'), 'members.createMember')
    expect(errorSpy).toHaveBeenCalled()
    const loggedContext = errorSpy.mock.calls[0]?.[0] as string
    expect(loggedContext).toContain('members.createMember')
  })
})

describe('zodToApiError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('devuelve el primer mensaje y el campo de un ZodError real', () => {
    const schema = z.object({ dni: z.string().regex(/^[0-9]{7,8}$/, 'DNI inválido') })
    const result = schema.safeParse({ dni: 'abc' })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('unreachable')

    const { body, status } = zodToApiError(result.error)
    expect(body).toEqual({ error: 'DNI inválido', field: 'dni' })
    expect(status).toBe(400)
  })

  it('con .strict() y una clave desconocida, la respuesta NUNCA nombra esa clave', () => {
    const schema = z.object({ name: z.string() }).strict()
    const result = schema.safeParse({ name: 'x', secretColumn: 'y', anotherOne: 'z' })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('unreachable')

    const { body, status } = zodToApiError(result.error)
    expect(body.error).not.toContain('secretColumn')
    expect(body.error).not.toContain('anotherOne')
    expect(body.field).toBeUndefined()
    expect(status).toBe(400)
    expect(JSON.stringify(body)).not.toMatch(/secretColumn|anotherOne/)
  })

  it('la clave desconocida SÍ va al log del servidor (para poder investigar), nunca a la respuesta', () => {
    const schema = z.object({ name: z.string() }).strict()
    const result = schema.safeParse({ name: 'x', secretColumn: 'y' })
    if (result.success) throw new Error('unreachable')

    zodToApiError(result.error)
    expect(errorSpy).toHaveBeenCalled()
    const loggedExtras = errorSpy.mock.calls[0]
    expect(JSON.stringify(loggedExtras)).toContain('secretColumn')
  })

  it('sin issues, da un mensaje genérico de "revisá los datos"', () => {
    const { body, status } = zodToApiError([])
    expect(body.error).toBe('Revisá los datos ingresados')
    expect(status).toBe(400)
  })

  it('acepta directamente un array de issues (no solo un objeto con .issues)', () => {
    const schema = z.object({ email: z.email('Email inválido') })
    const result = schema.safeParse({ email: 'no-es-un-email' })
    if (result.success) throw new Error('unreachable')

    const viaIssuesArray = zodToApiError(result.error.issues)
    const viaWrapper = zodToApiError(result.error)
    expect(viaIssuesArray).toEqual(viaWrapper)
  })

  it('el campo es el ÚLTIMO segmento string del path (anidado)', () => {
    const schema = z.object({ a: z.object({ b: z.string().min(1, 'requerido') }) })
    const result = schema.safeParse({ a: { b: '' } })
    if (result.success) throw new Error('unreachable')

    const { body } = zodToApiError(result.error)
    expect(body.field).toBe('b')
  })
})
