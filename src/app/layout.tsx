import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

// Tipografía provisoria (default de shadcn). La dirección visual —tipografía
// incluida— se decide una sola vez, en el primer pipeline de UI.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Club Naranja y Blanco — Gestión',
  description: 'Sistema de gestión administrativa del Club Social y Deportivo Naranja y Blanco.',
  // Es un panel interno con datos personales: no tiene nada que indexar.
  robots: { index: false, follow: false },
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
