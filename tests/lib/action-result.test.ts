import { describe, expect, it, vi } from 'vitest'
import { failure, invalid, success } from '@/lib/action-result'
import { DomainError } from '@/lib/errors'

describe('success', () => {
  it('envuelve datos en { ok: true, data }', () => {
    expect(success({ id: 1 })).toEqual({ ok: true, data: { id: 1 } })
  })

  it('sin argumento, data es undefined pero ok sigue en true', () => {
    expect(success()).toEqual({ ok: true, data: undefined })
  })
})

describe('invalid', () => {
  it('arma un ActionResult de error con field opcional', () => {
    expect(invalid('Mensaje', 'campo')).toEqual({ ok: false, error: 'Mensaje', field: 'campo' })
  })

  it('sin field, la clave ni siquiera aparece en el objeto', () => {
    const result = invalid('Mensaje')
    expect(result).toEqual({ ok: false, error: 'Mensaje' })
    expect('field' in result).toBe(false)
  })
})

describe('failure', () => {
  it('un DomainError con field se transporta tal cual', () => {
    const result = failure(new DomainError('Ya hay un socio con ese DNI', { field: 'dni' }), 'ctx')
    expect(result).toEqual({ ok: false, error: 'Ya hay un socio con ese DNI', field: 'dni' })
  })

  it('cualquier otro error se vuelve un mensaje genérico sin field, y se loguea', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = failure(new Error('permission denied for table members'), 'members.createMember')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).not.toContain('permission denied')
    expect('field' in result).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
