import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

// Geist: la única familia tipográfica del sistema (dirección visual del
// 2026-09-25, `.impeccable/surfaces/route.md`). Una sola carga con next/font
// para UI, datos y títulos — no hay una segunda familia de display.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Club Naranja y Blanco — Gestión',
  description: 'Sistema de gestión administrativa del Club Social y Deportivo Naranja y Blanco.',
  // Es un panel interno con datos personales: no tiene nada que indexar.
  robots: { index: false, follow: false },
}

// Tema claro fijo (sin toggle oscuro en este slice): el color de la barra
// del navegador en iOS/Android coincide con el fondo del panel.
export const viewport: Viewport = {
  themeColor: '#FFFFFF',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" className={cn('font-sans', geist.variable)}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  )
}
