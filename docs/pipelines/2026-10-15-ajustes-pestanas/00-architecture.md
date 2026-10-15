# 00 — Ajustes en pestañas

Brief de `impeccable shape`, confirmado por Tomás el 2026-10-15. Sin cambios de
schema ni de permisos: es estructura de UI + lecturas por pestaña.

## Problema

`/ajustes` apila cinco paneles (disciplinas y categorías, conceptos de
ingreso, valores de cuota, activación/generación, datos del club). El
Administrador entra por UNA cosa y en el celular tiene que scrollear todo.

## Decisiones

1. **Cuatro pestañas, una ruta cada una** (Tomás no eligió otra agrupación):
   - **Cuotas** `/ajustes/cuotas`: valores de cuota + activación/generación (van
     juntos: activar exige el valor por defecto).
   - **Deportes** `/ajustes/deportes`: disciplinas y categorías.
   - **Caja** `/ajustes/caja`: conceptos de ingreso.
   - **Club** `/ajustes/club`: datos del club.
2. **`/ajustes` redirige a `/ajustes/cuotas`** (Tomás: es lo que se toca durante
   el año).
3. **Rutas, no estado local**: cada pestaña es enlazable. Lo exige el punto 4.
4. **"Editar" desde los otros módulos** (pedido de Tomás): donde otra pantalla
   MUESTRA algo que se configura en Ajustes, un enlace discreto (texto/ícono
   secundario, 44px, nunca botón primario) lleva a la pestaña correspondiente.
   Solo lo ve quien tiene `settings.manage` (UX; la defensa sigue siendo RLS y
   el guard del controller). No se inventan enlaces donde no se muestra un dato
   configurable.
5. **Misma barra que `/caja`**: se generalizó en `src/views/shared/section-tabs.tsx`
   (`SectionTabs`, hilo principal). `CajaTabs` ya es un envoltorio de ella, sin
   cambio visible.
6. **Título "Ajustes" arriba de las pestañas, en el layout de `/ajustes`**, sin
   eyebrow. Cada pestaña tiene su `loading.tsx` y `error.tsx`, así header y
   barra no parpadean al cambiar de pestaña.
7. **Cada pestaña carga solo lo suyo** y re-verifica `settings.manage` en su
   controller (los layouts no se re-ejecutan en navegación de cliente).
8. **Revalidación**: lo que hoy hace `revalidatePath('/ajustes')` pasa a
   `revalidatePath('/ajustes', 'layout')` para cubrir las cuatro rutas.

Descartado: estado de pestaña en el cliente (no enlazable, rompe el punto 4);
tres pestañas (mezcla dos mundos sin relación); cinco (separa valores de la
activación que los necesita).

## Anti-objetivos

Cambiar el contenido o el comportamiento de cualquier panel; nuevas
funciones de ajustes; enlaces "Editar" para roles sin permiso; un segundo
patrón de pestañas.
