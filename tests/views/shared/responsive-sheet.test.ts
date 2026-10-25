import { describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Render estático (Node, sin DOM) del pie de `ResponsiveSheet`. En el servidor
 * `useIsDesktop` devuelve false, así que se ejercita la rama de sheet móvil.
 * El Sheet de shadcn va por un Portal de Radix que no emite nada en SSR, así
 * que se reemplaza (borde externo) por contenedores transparentes con
 * `data-slot`: lo que se prueba es QUÉ decide `ResponsiveSheet` renderizar,
 * no Radix. La rama de escritorio (Dialog) depende de `matchMedia` y no se
 * puede alcanzar sin DOM.
 */
vi.mock('@/components/ui/sheet', () => {
  const slot = (name: string) => {
    const Slot = ({ children }: { children?: ReactNode }) => createElement('div', { 'data-slot': name }, children)
    Slot.displayName = `Slot(${name})`
    return Slot
  }
  return {
    Sheet: Object.assign(({ children }: { children?: ReactNode }) => createElement('div', null, children), { displayName: 'Sheet' }),
    SheetContent: slot('sheet-content'),
    SheetHeader: slot('sheet-header'),
    SheetTitle: slot('sheet-title'),
    SheetDescription: slot('sheet-description'),
    SheetFooter: slot('sheet-footer'),
  }
})

const { ResponsiveSheet } = await import('@/views/shared/responsive-sheet')

function render(footer?: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      ResponsiveSheet,
      { open: true, onOpenChange: () => {}, title: 'Titulo inventado', footer } as unknown as ComponentProps<typeof ResponsiveSheet>,
      createElement('form', { id: 'f' }, 'contenido'),
    ),
  )
}

describe('ResponsiveSheet: pie opcional', () => {
  it('sin footer no emite el slot del pie (ni su banda vacía)', () => {
    const html = render()
    expect(html).toContain('contenido')
    expect(html).not.toContain('data-slot="sheet-footer"')
  })

  it('con footer emite el pie con sus botones', () => {
    const html = render(createElement('button', { type: 'submit', form: 'f' }, 'Guardar'))
    expect(html).toContain('data-slot="sheet-footer"')
    expect(html).toContain('Guardar')
  })
})
