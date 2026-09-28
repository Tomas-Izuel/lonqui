"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        // Tintados con los mismos colores de estado que `StatusPill` (nunca
        // un verde/rojo genérico de la librería): el sistema tiene una sola
        // paleta de estado, ganada acá también.
        success: (
          <CircleCheckIcon className="size-4 text-status-up-to-date" />
        ),
        info: (
          <InfoIcon className="size-4 text-muted-foreground" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-status-in-debt" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-destructive" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        // `!` (Tailwind v4 "important" en sufijo, no prefijo): Sonner
        // inyecta su propio `style` inline por toast: sin forzar la
        // especificidad, `rounded-xl`/`shadow-lifted` no le ganan.
        classNames: {
          toast: "cn-toast rounded-xl! border! border-border! shadow-lifted! gap-2.5!",
          title: "font-medium!",
          description: "text-muted-foreground!",
          actionButton: "rounded-lg! bg-primary! text-primary-foreground! hover:bg-primary-hover!",
          cancelButton: "rounded-lg! bg-muted! text-foreground!",
          closeButton: "rounded-lg! border-border! bg-background! text-muted-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
