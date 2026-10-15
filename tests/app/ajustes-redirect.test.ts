import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

describe('/ajustes', () => {
  it('redirige a /ajustes/cuotas (la entrada sin pestaña)', async () => {
    const { default: AjustesPage } = await import('@/app/(panel)/(admin)/ajustes/page')
    expect(() => AjustesPage()).toThrow('REDIRECT:/ajustes/cuotas')
    expect(redirectMock).toHaveBeenCalledWith('/ajustes/cuotas')
  })
})
