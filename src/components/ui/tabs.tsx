"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"
import { motion } from "motion/react"
import { SPRING_INDICATOR, useMotionPreference } from "@/views/shared/motion"

// Escopa el `layoutId` del indicador compartido a ESTE árbol de `Tabs`: sin
// esto, dos `<Tabs>` montados a la vez (poco común, pero pasa en un sheet
// sobre una página con pestañas) competirían por el mismo `layoutId` y
// `motion` animaría un salto entre grupos que no tienen nada que ver.
const TabsIndicatorContext = React.createContext<string>("tabs")

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const indicatorId = React.useId()
  return (
    <TabsIndicatorContext.Provider value={indicatorId}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        className={cn(
          "group/tabs flex gap-2 data-horizontal:flex-col",
          className
        )}
        {...props}
      />
    </TabsIndicatorContext.Provider>
  )
}

const tabsListVariants = cva(
  // `h-11` (44px, no `h-8`): la lista de pestañas es un destino táctil como
  // cualquier otro — el piso de calidad no hace excepciones para "chico".
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-11 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * Detecta si ESTE trigger está activo observando su propio `data-state`
 * (Radix no expone un hook de contexto público con el valor seleccionado).
 * Un `MutationObserver` sobre el único atributo que importa es más barato y
 * más correcto que reimplementar la lógica de selección de Radix.
 */
function useIsActiveTrigger(ref: React.RefObject<HTMLButtonElement | null>) {
  const [active, setActive] = React.useState(false)

  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const sync = () => setActive(node.getAttribute("data-state") === "active")
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(node, { attributes: true, attributeFilter: ["data-state"] })
    return () => observer.disconnect()
  }, [ref])

  return active
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const indicatorId = React.useContext(TabsIndicatorContext)
  const { reduced } = useMotionPreference()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const active = useIsActiveTrigger(triggerRef)

  return (
    <TabsPrimitive.Trigger
      ref={triggerRef}
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground",
        "data-active:text-foreground dark:data-active:text-foreground",
        className
      )}
      {...props}
    >
      {/*
        El indicador es UN elemento con `layoutId` compartido entre los
        triggers del mismo grupo: solo el trigger activo lo monta, así que al
        cambiar de pestaña `motion` anima su posición/tamaño desde donde
        estaba hasta donde está ahora (el mecanismo que F-shell reusa en la
        navegación principal, mismo C1). Con `prefers-reduced-motion`, la
        misma transición baja a `duration: 0`: el resultado es el mismo
        (color, sin desplazamiento) pero sin la animación espacial.
      */}
      {active ? (
        <motion.span
          layoutId={`${indicatorId}-indicator`}
          transition={reduced ? { duration: 0 } : SPRING_INDICATOR}
          className={cn(
            "absolute inset-0 rounded-md bg-background shadow-sm dark:bg-input/30",
            "group-data-[variant=line]/tabs-list:inset-x-1 group-data-[variant=line]/tabs-list:top-auto group-data-[variant=line]/tabs-list:-bottom-[3.5px] group-data-[variant=line]/tabs-list:h-0.5 group-data-[variant=line]/tabs-list:rounded-full group-data-[variant=line]/tabs-list:bg-primary group-data-[variant=line]/tabs-list:shadow-none"
          )}
        />
      ) : null}
      <span className="relative z-[1] inline-flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
